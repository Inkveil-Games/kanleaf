#![cfg(feature = "postgres-tests")]

use std::{fs, time::Duration};

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
    let token = body["token"].as_str().unwrap().to_owned();
    let user_id = body["user"]["id"].as_str().unwrap().parse().unwrap();
    let setup = app
        .clone()
        .oneshot(request(
            "PATCH",
            "/api/account/setup",
            Some(json!({"display_name": email.split('@').next().unwrap()})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(setup.status(), StatusCode::OK);
    let workspace =
        create_resource(app, &token, "/api/workspaces", json!({"name": "Personal"})).await;
    let workspace_id = workspace["id"].as_str().unwrap().parse().unwrap();
    (token, user_id, workspace_id)
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
    assert_eq!(
        owner_configuration["states"]
            .as_array()
            .unwrap()
            .iter()
            .map(|state| (
                state["system_role"].as_str().unwrap(),
                state["name"].as_str().unwrap(),
                state["color"].as_str().unwrap(),
            ))
            .collect::<Vec<_>>(),
        [
            ("backlog", "Backlog", "#727480"),
            ("todo", "Todo", "#7A4DD1"),
            ("in_progress", "In Progress", "#296DD6"),
            ("done", "Done", "#2F945C"),
            ("cancelled", "Cancelled", "#D63D3C"),
        ]
    );
    assert!(
        owner_configuration["states"]
            .as_array()
            .unwrap()
            .iter()
            .all(|state| state.get("icon").is_none())
    );
    assert_eq!(
        owner_configuration["state_property_description"],
        "The current step of work."
    );
    assert_eq!(
        owner_configuration["label_property_description"],
        "Shared tags used to organize work."
    );
    assert!(owner_configuration.get("task_types").is_none());
    assert!(owner_configuration.get("default_task_type_id").is_none());
    assert_eq!(
        owner_configuration["default_state_id"],
        owner_configuration["states"][1]["id"]
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
            &format!("/api/workspaces/{owner_workspace}/labels"),
            Some(json!({
                "name": "Member label",
                "color": "#F59E0B",
                "description": "No access"
            })),
            &member_token,
        ))
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let denied_settings = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{owner_workspace}/task-configuration"),
            Some(json!({"state_property_description": "No access"})),
            &member_token,
        ))
        .await
        .unwrap();
    assert_eq!(denied_settings.status(), StatusCode::FORBIDDEN);

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
async fn states_are_fixed_while_property_descriptions_and_default_remain_editable(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let (token, _, workspace_id) = register(&app, "core-states@example.com").await;
    let config = configuration(&app, &token, workspace_id).await;
    let todo_id = config["states"][1]["id"].as_str().unwrap();
    let todo_uri = format!("/api/workspaces/{workspace_id}/states/{todo_id}");

    for (method, uri, body) in [
        (
            "POST",
            format!("/api/workspaces/{workspace_id}/states"),
            Some(json!({
                "name": "Review",
                "color": "#F59E0B",
                "description": "Awaiting review"
            })),
        ),
        (
            "PUT",
            format!("/api/workspaces/{workspace_id}/states/reorder"),
            Some(json!({"ids": [todo_id]})),
        ),
        (
            "PATCH",
            todo_uri.clone(),
            Some(json!({"description": "Ready to be picked up"})),
        ),
        ("DELETE", todo_uri, None),
    ] {
        let response = app
            .clone()
            .oneshot(request(method, &uri, body, &token))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    let settings = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/task-configuration"),
            Some(json!({
                "state_id": todo_id,
                "state_property_description": "Where the work is now.",
                "label_property_description": "Shared vocabulary for organizing work."
            })),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(settings.status(), StatusCode::OK);
    let settings = response_json(settings).await;
    assert_eq!(settings["default_state_id"], todo_id);
    assert_eq!(
        settings["state_property_description"],
        "Where the work is now."
    );
    assert_eq!(
        settings["label_property_description"],
        "Shared vocabulary for organizing work."
    );

    let empty = app
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/task-configuration"),
            Some(json!({})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(empty.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[sqlx::test(migrations = "./migrations")]
async fn labels_keep_edit_reorder_archive_and_projection_behavior(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let (token, _, workspace_id) = register(&app, "custom-values@example.com").await;

    let label_uri = format!("/api/workspaces/{workspace_id}/labels");
    let backend = create_resource(
        &app,
        &token,
        &label_uri,
        json!({
            "name": "Backend",
            "color": "#22A06B",
            "description": "Server work"
        }),
    )
    .await;
    let design = create_resource(
        &app,
        &token,
        &label_uri,
        json!({
            "name": "Design",
            "color": "#A855F7",
            "description": "Visual work"
        }),
    )
    .await;
    assert!(backend.get("icon").is_none());
    assert!(design.get("icon").is_none());
    assert_eq!(backend["position"], 0);
    assert_eq!(design["position"], 1);
    let backend_id = backend["id"].as_str().unwrap();
    let design_id = design["id"].as_str().unwrap();

    let task = create_resource(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/tasks"),
        json!({
            "title": "Move freely",
            "label_ids": [backend_id]
        }),
    )
    .await;
    assert!(task["state"].get("icon").is_none());

    let reordered = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("{label_uri}/reorder"),
            Some(json!({"ids": [design_id, backend_id]})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(reordered.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        configuration(&app, &token, workspace_id).await["labels"][0]["id"],
        design_id
    );

    let updated = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("{label_uri}/{backend_id}"),
            Some(json!({
                "name": "Server",
                "description": "Backend systems"
            })),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    let updated = response_json(updated).await;
    assert!(updated.get("icon").is_none());
    assert_eq!(updated["description"], "Backend systems");

    let archived = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("{label_uri}/{backend_id}"),
            Some(json!({"archived": true})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(archived.status(), StatusCode::OK);
    let restored = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("{label_uri}/{backend_id}"),
            Some(json!({"archived": false})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(restored.status(), StatusCode::OK);
    assert_eq!(response_json(restored).await["position"], 1);

    let task_path = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Todo")
        .join(format!("{}.md", task["storage_name"].as_str().unwrap()));
    let source = fs::read_to_string(task_path).unwrap();
    assert!(source.contains("State:\n  - Todo\n"));
    assert!(source.contains("Labels:\n  - Server\n"));
}
