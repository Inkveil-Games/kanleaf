#![cfg(feature = "postgres-tests")]

use std::time::Duration;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use http::HeaderValue;
use kanleaf_server::{AppState, router};
use serde_json::{Value, json};
use sqlx::PgPool;
use tempfile::TempDir;
use tower::ServiceExt;
use uuid::Uuid;

fn test_app(pool: PgPool, data_dir: &TempDir) -> Router {
    router(
        AppState::new(pool, data_dir.path().to_owned(), Duration::from_secs(3600)),
        vec![HeaderValue::from_static("http://127.0.0.1:1420")],
    )
}

fn request(method: &str, uri: &str, body: Option<Value>, token: &str) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(uri);
    if !token.is_empty() {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    builder
        .body(body.map_or_else(Body::empty, |value| Body::from(value.to_string())))
        .unwrap()
}

async fn send(
    app: &Router,
    method: &str,
    uri: &str,
    body: Option<Value>,
    token: &str,
) -> axum::response::Response {
    app.clone()
        .oneshot(request(method, uri, body, token))
        .await
        .unwrap()
}

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), 2 * 1024 * 1024)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn register(app: &Router, email: &str) -> (String, Uuid, Uuid) {
    let response = send(
        app,
        "POST",
        "/api/auth/register",
        Some(json!({"email": email, "password": "correct horse battery"})),
        "",
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    let body = json_body(response).await;
    let token = body["token"].as_str().unwrap().to_owned();
    let user_id = body["user"]["id"].as_str().unwrap().parse().unwrap();
    let setup = send(
        app,
        "PATCH",
        "/api/account/setup",
        Some(json!({"display_name": email.split('@').next().unwrap()})),
        &token,
    )
    .await;
    assert_eq!(setup.status(), StatusCode::OK);
    let workspace = create_json(app, &token, "/api/workspaces", json!({"name": "Personal"})).await;
    let workspace_id = workspace["id"].as_str().unwrap().parse().unwrap();
    (token, user_id, workspace_id)
}

async fn create_json(app: &Router, token: &str, uri: &str, body: Value) -> Value {
    let response = send(app, "POST", uri, Some(body), token).await;
    assert_eq!(response.status(), StatusCode::CREATED);
    json_body(response).await
}

async fn add_workspace_member(pool: &PgPool, workspace_id: Uuid, user_id: Uuid, role: &str) {
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)",
    )
    .bind(workspace_id)
    .bind(user_id)
    .bind(role)
    .execute(pool)
    .await
    .unwrap();
}

async fn add_project_member(
    app: &Router,
    owner_token: &str,
    workspace_id: Uuid,
    project_id: &str,
    user_id: Uuid,
    role: &str,
) {
    let response = send(
        app,
        "POST",
        &format!("/api/workspaces/{workspace_id}/projects/{project_id}/members"),
        Some(json!({"user_id": user_id, "role": role})),
        owner_token,
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
}

fn project_query(project_id: &str) -> Value {
    json!({
        "version": 1,
        "scope": {"kind": "project", "project_id": project_id},
        "filters": {},
        "grouping": {"primary": "state"},
        "sort": [{"field": "priority", "direction": "descending"}],
        "display": ["state", "priority", "assignees", "due_date"],
        "include_completed": false
    })
}

#[sqlx::test(migrations = "./migrations")]
async fn typed_query_matches_legacy_scopes_and_treats_search_as_data(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "query-owner@example.com").await;
    let projects_uri = format!("/api/workspaces/{workspace_id}/projects");
    let project = create_json(&app, &token, &projects_uri, json!({"name": "Query"})).await;
    let project_id = project["id"].as_str().unwrap();
    let tasks_uri = format!("/api/workspaces/{workspace_id}/tasks");
    create_json(
        &app,
        &token,
        &tasks_uri,
        json!({
            "title": "High priority",
            "project_id": project_id,
            "priority": "urgent",
            "due_date": "2026-10-03",
            "estimate": 5
        }),
    )
    .await;
    create_json(
        &app,
        &token,
        &tasks_uri,
        json!({
            "title": "No schedule",
            "project_id": project_id,
            "priority": "low"
        }),
    )
    .await;
    create_json(&app, &token, &tasks_uri, json!({"title": "Inbox only"})).await;
    let configuration = send(
        &app,
        "GET",
        &format!("/api/workspaces/{workspace_id}/task-configuration"),
        None,
        &token,
    )
    .await;
    let configuration = json_body(configuration).await;
    let done_state = configuration["states"]
        .as_array()
        .unwrap()
        .iter()
        .find(|state| state["state_group"] == "done")
        .unwrap()["id"]
        .as_str()
        .unwrap();
    create_json(
        &app,
        &token,
        &tasks_uri,
        json!({
            "title": "Completed work",
            "project_id": project_id,
            "state_id": done_state
        }),
    )
    .await;

    let legacy = send(
        &app,
        "GET",
        &format!("{tasks_uri}?project_id={project_id}&priority=urgent"),
        None,
        &token,
    )
    .await;
    assert_eq!(legacy.status(), StatusCode::OK);
    let legacy = json_body(legacy).await;
    let typed = send(
        &app,
        "POST",
        &format!("{tasks_uri}/query"),
        Some(json!({
            "version": 1,
            "scope": {"kind": "project", "project_id": project_id},
            "filters": {"priorities": ["urgent"]},
            "include_completed": false
        })),
        &token,
    )
    .await;
    assert_eq!(typed.status(), StatusCode::OK);
    let typed = json_body(typed).await;
    assert_eq!(legacy, typed);

    let incomplete = send(
        &app,
        "POST",
        &format!("{tasks_uri}/query"),
        Some(json!({
            "version": 1,
            "scope": {"kind": "project", "project_id": project_id},
            "include_completed": false
        })),
        &token,
    )
    .await;
    assert_eq!(incomplete.status(), StatusCode::OK);
    assert_eq!(json_body(incomplete).await.as_array().unwrap().len(), 2);

    let unplanned = send(
        &app,
        "POST",
        &format!("{tasks_uri}/query"),
        Some(json!({
            "version": 1,
            "scope": {"kind": "project", "project_id": project_id},
            "filters": {
                "due_date": {"include_none": true},
                "estimate": {"include_none": true}
            },
            "sort": [{"field": "title", "direction": "ascending"}],
            "include_completed": false
        })),
        &token,
    )
    .await;
    assert_eq!(unplanned.status(), StatusCode::OK);
    let unplanned = json_body(unplanned).await;
    assert_eq!(unplanned.as_array().unwrap().len(), 1);
    assert_eq!(unplanned[0]["title"], "No schedule");

    let unlabeled = send(
        &app,
        "POST",
        &format!("{tasks_uri}/query"),
        Some(json!({
            "version": 1,
            "scope": {"kind": "project", "project_id": project_id},
            "filters": {"labels": {"include_none": true}},
            "include_completed": false
        })),
        &token,
    )
    .await;
    assert_eq!(unlabeled.status(), StatusCode::OK);
    assert_eq!(json_body(unlabeled).await.as_array().unwrap().len(), 2);

    let injection = send(
        &app,
        "POST",
        &format!("{tasks_uri}/query"),
        Some(json!({
            "version": 1,
            "scope": {"kind": "workspace"},
            "search": "%\" OR true --",
            "include_completed": true
        })),
        &token,
    )
    .await;
    assert_eq!(injection.status(), StatusCode::OK);
    assert!(json_body(injection).await.as_array().unwrap().is_empty());

    let unsupported = send(
        &app,
        "POST",
        &format!("{tasks_uri}/query"),
        Some(json!({
            "version": 9,
            "scope": {"kind": "workspace"}
        })),
        &token,
    )
    .await;
    assert_eq!(unsupported.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[sqlx::test(migrations = "./migrations")]
async fn saved_views_enforce_personal_shared_and_project_admin_rules(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, workspace_id) = register(&app, "view-owner@example.com").await;
    let (contributor_token, contributor_id, _) =
        register(&app, "view-contributor@example.com").await;
    let (viewer_token, viewer_id, _) = register(&app, "view-viewer@example.com").await;
    let (outsider_token, _, outsider_workspace_id) =
        register(&app, "view-outsider@example.com").await;
    add_workspace_member(&pool, workspace_id, contributor_id, "member").await;
    add_workspace_member(&pool, workspace_id, viewer_id, "member").await;

    let project = create_json(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/projects"),
        json!({"name": "Views"}),
    )
    .await;
    let project_id = project["id"].as_str().unwrap();
    add_project_member(
        &app,
        &owner_token,
        workspace_id,
        project_id,
        contributor_id,
        "contributor",
    )
    .await;
    add_project_member(
        &app,
        &owner_token,
        workspace_id,
        project_id,
        viewer_id,
        "viewer",
    )
    .await;
    let views_uri = format!("/api/workspaces/{workspace_id}/views");
    let shared = create_json(
        &app,
        &contributor_token,
        &views_uri,
        json!({
            "name": "Team board",
            "visibility": "shared",
            "project_id": project_id,
            "query": project_query(project_id),
            "layout": "board"
        }),
    )
    .await;
    let shared_id = shared["id"].as_str().unwrap();
    let personal = create_json(
        &app,
        &viewer_token,
        &views_uri,
        json!({
            "name": "My table",
            "project_id": project_id,
            "query": project_query(project_id),
            "layout": "table"
        }),
    )
    .await;
    let personal_id = personal["id"].as_str().unwrap();

    let forbidden_shared = send(
        &app,
        "POST",
        &views_uri,
        Some(json!({
            "name": "Viewer shared",
            "visibility": "shared",
            "project_id": project_id,
            "query": project_query(project_id),
            "layout": "list"
        })),
        &viewer_token,
    )
    .await;
    assert_eq!(forbidden_shared.status(), StatusCode::FORBIDDEN);

    let viewer_list = send(
        &app,
        "GET",
        &format!("{views_uri}?project_id={project_id}"),
        None,
        &viewer_token,
    )
    .await;
    assert_eq!(viewer_list.status(), StatusCode::OK);
    let viewer_list = json_body(viewer_list).await;
    assert_eq!(viewer_list.as_array().unwrap().len(), 2);
    assert!(
        viewer_list
            .as_array()
            .unwrap()
            .iter()
            .any(|view| view["id"] == shared_id)
    );
    assert!(
        viewer_list
            .as_array()
            .unwrap()
            .iter()
            .any(|view| view["id"] == personal_id)
    );

    let contributor_personal = create_json(
        &app,
        &contributor_token,
        &views_uri,
        json!({
            "name": "Contributor private",
            "project_id": project_id,
            "query": project_query(project_id),
            "layout": "list"
        }),
    )
    .await;
    let hidden = send(
        &app,
        "GET",
        &format!(
            "{views_uri}/{}",
            contributor_personal["id"].as_str().unwrap()
        ),
        None,
        &viewer_token,
    )
    .await;
    assert_eq!(hidden.status(), StatusCode::NOT_FOUND);

    let contributor_cannot_edit_other_shared = send(
        &app,
        "PATCH",
        &format!("{views_uri}/{shared_id}"),
        Some(json!({"name": "Still team board"})),
        &viewer_token,
    )
    .await;
    assert_eq!(
        contributor_cannot_edit_other_shared.status(),
        StatusCode::FORBIDDEN
    );
    let admin_update = send(
        &app,
        "PATCH",
        &format!("{views_uri}/{shared_id}"),
        Some(json!({"name": "Delivery board", "layout": "timeline"})),
        &owner_token,
    )
    .await;
    assert_eq!(admin_update.status(), StatusCode::OK);
    let admin_update = json_body(admin_update).await;
    assert_eq!(admin_update["layout"], "timeline");

    let cross_workspace = send(
        &app,
        "GET",
        &format!("/api/workspaces/{outsider_workspace_id}/views/{shared_id}"),
        None,
        &outsider_token,
    )
    .await;
    assert_eq!(cross_workspace.status(), StatusCode::NOT_FOUND);

    let delete_personal = send(
        &app,
        "DELETE",
        &format!(
            "{views_uri}/{}",
            contributor_personal["id"].as_str().unwrap()
        ),
        None,
        &contributor_token,
    )
    .await;
    assert_eq!(delete_personal.status(), StatusCode::NO_CONTENT);
    let deleted = send(
        &app,
        "GET",
        &format!(
            "{views_uri}/{}",
            contributor_personal["id"].as_str().unwrap()
        ),
        None,
        &contributor_token,
    )
    .await;
    assert_eq!(deleted.status(), StatusCode::NOT_FOUND);

    let disable = send(
        &app,
        "PATCH",
        &format!("/api/workspaces/{workspace_id}/projects/{project_id}"),
        Some(json!({"views_enabled": false})),
        &owner_token,
    )
    .await;
    assert_eq!(disable.status(), StatusCode::OK);
    let disabled_list = send(
        &app,
        "GET",
        &format!("{views_uri}?project_id={project_id}"),
        None,
        &owner_token,
    )
    .await;
    assert_eq!(disabled_list.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let saved_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM saved_views WHERE workspace_id = $1 AND project_id = $2",
    )
    .bind(workspace_id)
    .bind(project_id.parse::<Uuid>().unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(saved_count, 2);
}
