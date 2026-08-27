#![cfg(feature = "postgres-tests")]

use std::time::Duration;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use http::HeaderValue;
use kanleaf_server::{AppState, router};
use serde_json::{Value, json};
use sqlx::PgPool;
use tempfile::TempDir;
use tower::ServiceExt;
use uuid::Uuid;

fn test_app(pool: PgPool, data_dir: &TempDir) -> axum::Router {
    router(
        AppState::new(pool, data_dir.path().to_owned(), Duration::from_secs(3600)),
        vec![HeaderValue::from_static("http://127.0.0.1:1420")],
    )
}

fn request(method: &str, uri: &str, body: Option<Value>, token: &str) -> Request<Body> {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"));
    if body.is_some() {
        request = request.header(header::CONTENT_TYPE, "application/json");
    }
    request
        .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), 256 * 1024).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn register(app: &axum::Router, email: &str) -> (String, Uuid, Uuid) {
    let response = app
        .clone()
        .oneshot(
            Request::post("/api/auth/register")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({"email": email, "password": "correct horse battery"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response_json(response).await;
    (
        body["token"].as_str().unwrap().to_owned(),
        body["user"]["id"].as_str().unwrap().parse().unwrap(),
        body["user"]["active_workspace_id"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap(),
    )
}

async fn configuration(app: &axum::Router, token: &str, workspace_id: Uuid) -> Value {
    let response = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/task-configuration"),
            None,
            token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    response_json(response).await
}

async fn create_resource(app: &axum::Router, token: &str, uri: &str, body: Value) -> Value {
    let response = app
        .clone()
        .oneshot(request("POST", uri, Some(body), token))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await
}

#[sqlx::test(migrations = "./migrations")]
async fn defaults_are_installed_and_configuration_is_tenant_and_role_scoped(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, owner_workspace) = register(&app, "owner@example.com").await;
    let (member_token, member_id, member_workspace) = register(&app, "member@example.com").await;

    let owner_configuration = configuration(&app, &owner_token, owner_workspace).await;
    assert_eq!(owner_configuration["states"].as_array().unwrap().len(), 5);
    assert_eq!(
        owner_configuration["states"]
            .as_array()
            .unwrap()
            .iter()
            .map(|state| state["state_group"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["backlog", "todo", "in_progress", "done", "canceled"]
    );
    assert_eq!(
        owner_configuration["task_types"].as_array().unwrap().len(),
        1
    );
    assert_eq!(owner_configuration["task_types"][0]["is_protected"], true);
    assert_eq!(
        owner_configuration["default_task_type_id"],
        owner_configuration["task_types"][0]["id"]
    );

    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')",
    )
    .bind(owner_workspace)
    .bind(member_id)
    .execute(&pool)
    .await
    .unwrap();
    configuration(&app, &member_token, owner_workspace).await;

    let denied = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{owner_workspace}/states"),
            Some(json!({"name": "Review", "color": "#F59E0B", "state_group": "in_progress"})),
            &member_token,
        ))
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let isolated = app
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{member_workspace}/task-configuration"),
            None,
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(isolated.status(), StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "./migrations")]
async fn states_labels_and_types_support_edit_reorder_archive_and_guards(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "owner@example.com").await;
    let state_uri = format!("/api/workspaces/{workspace_id}/states");
    let review = create_resource(
        &app,
        &token,
        &state_uri,
        json!({"name": "Review", "color": "#F59E0B", "state_group": "in_progress"}),
    )
    .await;
    let review_id = review["id"].as_str().unwrap();

    let duplicate = app
        .clone()
        .oneshot(request(
            "POST",
            &state_uri,
            Some(json!({"name": "review", "color": "#F59E0B", "state_group": "in_progress"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);

    let config = configuration(&app, &token, workspace_id).await;
    let reversed_ids: Vec<_> = config["states"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .map(|state| state["id"].clone())
        .collect();
    let reordered = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("{state_uri}/reorder"),
            Some(json!({"ids": reversed_ids})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(reordered.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        configuration(&app, &token, workspace_id).await["states"][0]["id"],
        review_id
    );

    let defaulted = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/task-configuration"),
            Some(json!({"state_id": review_id})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(defaulted.status(), StatusCode::OK);
    let archive_default = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("{state_uri}/{review_id}"),
            Some(json!({"archived": true})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(archive_default.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let label_uri = format!("/api/workspaces/{workspace_id}/labels");
    let label = create_resource(
        &app,
        &token,
        &label_uri,
        json!({"name": "Backend", "color": "#22A06B", "description": "Server work"}),
    )
    .await;
    let label_id = label["id"].as_str().unwrap();
    let archived_label = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("{label_uri}/{label_id}"),
            Some(json!({"archived": true})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(archived_label.status(), StatusCode::OK);
    let deleted_label = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!("{label_uri}/{label_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(deleted_label.status(), StatusCode::NO_CONTENT);

    let protected_id = configuration(&app, &token, workspace_id).await["task_types"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    for (method, body) in [("PATCH", Some(json!({"archived": true}))), ("DELETE", None)] {
        let response = app
            .clone()
            .oneshot(request(
                method,
                &format!("/api/workspaces/{workspace_id}/task-types/{protected_id}"),
                body,
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn task_state_and_type_replacement_is_explicit_and_atomic(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "owner@example.com").await;
    let original = configuration(&app, &token, workspace_id).await;
    let protected_type_id = original["default_task_type_id"].as_str().unwrap();
    let done_state_id = original["states"]
        .as_array()
        .unwrap()
        .iter()
        .find(|state| state["state_group"] == "done")
        .unwrap()["id"]
        .as_str()
        .unwrap();

    let ready = create_resource(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/states"),
        json!({"name": "Ready", "color": "#0EA5E9", "state_group": "todo"}),
    )
    .await;
    let queued = create_resource(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/states"),
        json!({"name": "Queued", "color": "#0284C7", "state_group": "todo"}),
    )
    .await;
    let bug = create_resource(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/task-types"),
        json!({"name": "Bug", "icon": "bug", "color": "#DC2626", "description": "Defect"}),
    )
    .await;
    let ready_id = ready["id"].as_str().unwrap();
    let queued_id = queued["id"].as_str().unwrap();
    let bug_id = bug["id"].as_str().unwrap();

    let task = create_resource(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/tasks"),
        json!({
            "title": "Fix crash",
            "state_id": ready_id,
            "task_type_id": bug_id,
            "priority": "urgent"
        }),
    )
    .await;
    let task_id = task["id"].as_str().unwrap();
    assert_eq!(task["state"]["name"], "Ready");
    assert_eq!(task["task_type"]["name"], "Bug");
    assert_eq!(task["priority"], "urgent");

    let missing_replacement = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!("/api/workspaces/{workspace_id}/states/{ready_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(missing_replacement.status(), StatusCode::CONFLICT);
    let wrong_group = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!(
                "/api/workspaces/{workspace_id}/states/{ready_id}?replacement_id={done_state_id}"
            ),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(wrong_group.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let replaced_state = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!("/api/workspaces/{workspace_id}/states/{ready_id}?replacement_id={queued_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(replaced_state.status(), StatusCode::NO_CONTENT);

    let missing_type_replacement = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!("/api/workspaces/{workspace_id}/task-types/{bug_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(missing_type_replacement.status(), StatusCode::CONFLICT);
    let replaced_type = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!(
                "/api/workspaces/{workspace_id}/task-types/{bug_id}?replacement_id={protected_type_id}"
            ),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(replaced_type.status(), StatusCode::NO_CONTENT);

    let updated_task = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    let updated_task = response_json(updated_task).await;
    assert_eq!(updated_task["state"]["id"], queued_id);
    assert_eq!(updated_task["task_type"]["id"], protected_type_id);

    let other_data_dir = TempDir::new().unwrap();
    let other_app = test_app(pool, &other_data_dir);
    let (other_token, _, other_workspace) = register(&other_app, "other@example.com").await;
    let cross_workspace = other_app
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{other_workspace}/tasks"),
            Some(json!({"title": "Escaped", "state_id": queued_id})),
            &other_token,
        ))
        .await
        .unwrap();
    assert_eq!(cross_workspace.status(), StatusCode::UNPROCESSABLE_ENTITY);
}
