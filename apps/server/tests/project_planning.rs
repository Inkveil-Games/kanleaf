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

fn request(method: &str, uri: &str, body: Option<Value>, token: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(token) = token {
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
        .oneshot(request(method, uri, body, Some(token)))
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

async fn create_json(app: &Router, token: &str, uri: &str, body: Value) -> Value {
    let response = send(app, "POST", uri, Some(body), token).await;
    assert_eq!(response.status(), StatusCode::CREATED);
    json_body(response).await
}

async fn get_json(app: &Router, token: &str, uri: &str) -> Value {
    let response = send(app, "GET", uri, None, token).await;
    assert_eq!(response.status(), StatusCode::OK);
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

#[sqlx::test(migrations = "./migrations")]
async fn cycles_transfer_incomplete_work_and_modules_group_tasks(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, workspace_id) = register(&app, "planning-owner@example.com").await;
    let (contributor_token, contributor_id, _) =
        register(&app, "planning-contributor@example.com").await;
    add_workspace_member(&pool, workspace_id, contributor_id, "member").await;

    let project = create_json(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/projects"),
        json!({"name": "Planning"}),
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

    let cycles_uri = format!("/api/workspaces/{workspace_id}/projects/{project_id}/cycles");
    let current = create_json(
        &app,
        &contributor_token,
        &cycles_uri,
        json!({
            "name": "Cycle 1",
            "start_date": "2026-09-01",
            "due_date": "2026-09-14"
        }),
    )
    .await;
    let current_id = current["id"].as_str().unwrap();
    let overlap = send(
        &app,
        "POST",
        &cycles_uri,
        Some(json!({
            "name": "Overlapping",
            "start_date": "2026-09-10",
            "due_date": "2026-09-20"
        })),
        &contributor_token,
    )
    .await;
    assert_eq!(overlap.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let future = create_json(
        &app,
        &contributor_token,
        &cycles_uri,
        json!({
            "name": "Cycle 2",
            "start_date": "2026-09-15",
            "due_date": "2026-09-28"
        }),
    )
    .await;
    let future_id = future["id"].as_str().unwrap();

    let modules_uri = format!("/api/workspaces/{workspace_id}/projects/{project_id}/modules");
    let backend = create_json(
        &app,
        &contributor_token,
        &modules_uri,
        json!({"name": "Backend", "lead_user_id": contributor_id}),
    )
    .await;
    let interface = create_json(
        &app,
        &contributor_token,
        &modules_uri,
        json!({"name": "Interface", "status": "planned"}),
    )
    .await;
    let backend_id = backend["id"].as_str().unwrap();
    let interface_id = interface["id"].as_str().unwrap();
    let remove_lead = send(
        &app,
        "DELETE",
        &format!("/api/workspaces/{workspace_id}/projects/{project_id}/members/{contributor_id}"),
        None,
        &owner_token,
    )
    .await;
    assert_eq!(remove_lead.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let configuration = get_json(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/task-configuration"),
    )
    .await;
    let done_state = configuration["states"]
        .as_array()
        .unwrap()
        .iter()
        .find(|state| state["state_group"] == "done")
        .unwrap()["id"]
        .as_str()
        .unwrap();
    let tasks_uri = format!("/api/workspaces/{workspace_id}/tasks");
    let incomplete = create_json(
        &app,
        &contributor_token,
        &tasks_uri,
        json!({
            "title": "Carry forward",
            "project_id": project_id,
            "cycle_id": current_id,
            "module_ids": [backend_id, interface_id],
            "estimate": 5
        }),
    )
    .await;
    assert_eq!(incomplete["cycle"]["id"], current_id);
    assert_eq!(incomplete["modules"].as_array().unwrap().len(), 2);
    let done = create_json(
        &app,
        &contributor_token,
        &tasks_uri,
        json!({
            "title": "Already finished",
            "project_id": project_id,
            "cycle_id": current_id,
            "module_ids": [backend_id],
            "state_id": done_state,
            "estimate": 3
        }),
    )
    .await;

    let complete = send(
        &app,
        "POST",
        &format!("{cycles_uri}/{current_id}/complete"),
        Some(json!({"transfer_cycle_id": future_id})),
        &contributor_token,
    )
    .await;
    assert_eq!(complete.status(), StatusCode::OK);
    let incomplete = get_json(
        &app,
        &contributor_token,
        &format!("{tasks_uri}/{}", incomplete["id"].as_str().unwrap()),
    )
    .await;
    let done = get_json(
        &app,
        &contributor_token,
        &format!("{tasks_uri}/{}", done["id"].as_str().unwrap()),
    )
    .await;
    assert_eq!(incomplete["cycle"]["id"], future_id);
    assert_eq!(done["cycle"]["id"], current_id);

    let cycles = get_json(&app, &contributor_token, &cycles_uri).await;
    let completed = cycles
        .as_array()
        .unwrap()
        .iter()
        .find(|cycle| cycle["id"] == current_id)
        .unwrap();
    assert_eq!(completed["status"], "completed");
    assert_eq!(completed["total_tasks"], 1);
    assert_eq!(completed["completed_tasks"], 1);
    assert_eq!(completed["completed_estimate"], 3);

    let by_cycle = get_json(
        &app,
        &contributor_token,
        &format!("{tasks_uri}?cycle_id={future_id}"),
    )
    .await;
    assert_eq!(by_cycle.as_array().unwrap().len(), 1);
    let by_module = get_json(
        &app,
        &contributor_token,
        &format!("{tasks_uri}?module_id={backend_id}"),
    )
    .await;
    assert_eq!(by_module.as_array().unwrap().len(), 2);

    let contributor_archive = send(
        &app,
        "DELETE",
        &format!("{modules_uri}/{interface_id}"),
        None,
        &contributor_token,
    )
    .await;
    assert_eq!(contributor_archive.status(), StatusCode::FORBIDDEN);

    let destination = create_json(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/projects"),
        json!({"name": "Destination"}),
    )
    .await;
    let destination_id = destination["id"].as_str().unwrap();
    add_project_member(
        &app,
        &owner_token,
        workspace_id,
        destination_id,
        contributor_id,
        "contributor",
    )
    .await;
    let task_uri = format!("{tasks_uri}/{}", incomplete["id"].as_str().unwrap());
    let rejected_move = send(
        &app,
        "PATCH",
        &task_uri,
        Some(json!({"project_id": destination_id})),
        &contributor_token,
    )
    .await;
    assert_eq!(rejected_move.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let cleaned_move = send(
        &app,
        "PATCH",
        &task_uri,
        Some(json!({"project_id": destination_id, "cleanup_invalid": true})),
        &contributor_token,
    )
    .await;
    assert_eq!(cleaned_move.status(), StatusCode::OK);
    let moved = json_body(cleaned_move).await;
    assert_eq!(moved["project_id"], destination_id);
    assert!(moved["cycle"].is_null());
    assert!(moved["modules"].as_array().unwrap().is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn planning_honors_roles_feature_flags_and_project_isolation(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, workspace_id) = register(&app, "scope-owner@example.com").await;
    let (viewer_token, viewer_id, _) = register(&app, "scope-viewer@example.com").await;
    add_workspace_member(&pool, workspace_id, viewer_id, "member").await;

    let first = create_json(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/projects"),
        json!({"name": "First"}),
    )
    .await;
    let second = create_json(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/projects"),
        json!({"name": "Second"}),
    )
    .await;
    let first_id = first["id"].as_str().unwrap();
    let second_id = second["id"].as_str().unwrap();
    add_project_member(
        &app,
        &owner_token,
        workspace_id,
        first_id,
        viewer_id,
        "viewer",
    )
    .await;

    let cycles_uri = format!("/api/workspaces/{workspace_id}/projects/{first_id}/cycles");
    let cycle = create_json(
        &app,
        &owner_token,
        &cycles_uri,
        json!({
            "name": "Only first",
            "start_date": "2026-10-01",
            "due_date": "2026-10-14"
        }),
    )
    .await;
    assert_eq!(
        send(&app, "GET", &cycles_uri, None, &viewer_token)
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        send(
            &app,
            "POST",
            &cycles_uri,
            Some(json!({
                "name": "Forbidden",
                "start_date": "2026-10-15",
                "due_date": "2026-10-28"
            })),
            &viewer_token,
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );

    let wrong_project_task = send(
        &app,
        "POST",
        &format!("/api/workspaces/{workspace_id}/tasks"),
        Some(json!({
            "title": "Wrong planning scope",
            "project_id": second_id,
            "cycle_id": cycle["id"]
        })),
        &owner_token,
    )
    .await;
    assert_eq!(
        wrong_project_task.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );

    let disabled = send(
        &app,
        "PATCH",
        &format!("/api/workspaces/{workspace_id}/projects/{first_id}"),
        Some(json!({"cycles_enabled": false, "modules_enabled": false})),
        &owner_token,
    )
    .await;
    assert_eq!(disabled.status(), StatusCode::OK);
    assert_eq!(
        send(&app, "GET", &cycles_uri, None, &owner_token)
            .await
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
}
