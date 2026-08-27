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

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), 2 * 1024 * 1024)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn register(app: &Router, email: &str) -> (String, Uuid, Uuid) {
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            "/api/auth/register",
            Some(json!({"email": email, "password": "correct horse battery"})),
            None,
        ))
        .await
        .unwrap();
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

async fn create(app: &Router, token: &str, uri: &str, body: Value) -> Value {
    let response = app
        .clone()
        .oneshot(request("POST", uri, Some(body), Some(token)))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    json_body(response).await
}

async fn patch(app: &Router, token: &str, uri: &str, body: Value) -> axum::response::Response {
    app.clone()
        .oneshot(request("PATCH", uri, Some(body), Some(token)))
        .await
        .unwrap()
}

async fn get(app: &Router, token: &str, uri: &str) -> Value {
    let response = app
        .clone()
        .oneshot(request("GET", uri, None, Some(token)))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    json_body(response).await
}

async fn create_project(app: &Router, token: &str, workspace_id: Uuid, name: &str) -> Value {
    create(
        app,
        token,
        &format!("/api/workspaces/{workspace_id}/projects"),
        json!({"name": name}),
    )
    .await
}

async fn create_task(app: &Router, token: &str, workspace_id: Uuid, body: Value) -> Value {
    create(
        app,
        token,
        &format!("/api/workspaces/{workspace_id}/tasks"),
        body,
    )
    .await
}

#[sqlx::test(migrations = "./migrations")]
async fn task_numbers_are_unique_and_monotonic_under_concurrent_creation(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let (token, _, workspace_id) = register(&app, "numbering@example.com").await;

    let mut creates = Vec::new();
    for index in 0..12 {
        let app = app.clone();
        let token = token.clone();
        creates.push(tokio::spawn(async move {
            create_task(
                &app,
                &token,
                workspace_id,
                json!({"title": format!("Concurrent {index}")}),
            )
            .await
        }));
    }
    let mut numbers = Vec::new();
    for create in creates {
        let task = create.await.unwrap();
        numbers.push(task["task_number"].as_i64().unwrap());
        assert!(task["reference"].as_str().unwrap().starts_with('#'));
    }
    numbers.sort_unstable();
    assert_eq!(numbers, (1..=12).collect::<Vec<_>>());
}

#[sqlx::test(migrations = "./migrations")]
async fn metadata_hierarchy_relations_and_my_work_are_tenant_scoped(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, workspace_id) = register(&app, "owner@example.com").await;
    let (member_token, member_id, _) = register(&app, "member@example.com").await;
    let (outsider_token, _, outsider_workspace) = register(&app, "outsider@example.com").await;
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')",
    )
    .bind(workspace_id)
    .bind(member_id)
    .execute(&pool)
    .await
    .unwrap();

    let project = create_project(&app, &owner_token, workspace_id, "Kanleaf").await;
    let project_id = project["id"].as_str().unwrap();
    create(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/projects/{project_id}/members"),
        json!({"user_id": member_id, "role": "contributor"}),
    )
    .await;
    let label = create(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/labels"),
        json!({"name": "Backend", "color": "#22A06B", "description": "Server work"}),
    )
    .await;
    let label_id = label["id"].as_str().unwrap();

    let parent = create_task(
        &app,
        &owner_token,
        workspace_id,
        json!({
            "title": "Ship task workflow",
            "project_id": project_id,
            "priority": "high",
            "assignee_ids": [member_id],
            "label_ids": [label_id],
            "start_date": "2026-08-28",
            "due_date": "2026-09-04",
            "estimate": 8
        }),
    )
    .await;
    let parent_id = parent["id"].as_str().unwrap();
    assert_eq!(
        parent["reference"],
        format!("{}-1", project["identifier"].as_str().unwrap())
    );
    assert_eq!(parent["assignees"][0]["user_id"], member_id.to_string());
    assert_eq!(parent["labels"][0]["id"], label_id);

    let child = create_task(
        &app,
        &owner_token,
        workspace_id,
        json!({"title": "Cover hierarchy", "project_id": project_id, "parent_id": parent_id}),
    )
    .await;
    let child_id = child["id"].as_str().unwrap();
    let related = create_task(
        &app,
        &owner_token,
        workspace_id,
        json!({"title": "Document API", "project_id": project_id}),
    )
    .await;
    let related_id = related["id"].as_str().unwrap();
    create(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks/{parent_id}/relations"),
        json!({"task_id": related_id, "relation_type": "blocking"}),
    )
    .await;

    let parent = get(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks/{parent_id}"),
    )
    .await;
    assert_eq!(parent["subtasks"][0]["id"], child_id);
    assert_eq!(parent["relations"][0]["relation_type"], "blocking");
    let related = get(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks/{related_id}"),
    )
    .await;
    assert_eq!(related["relations"][0]["relation_type"], "blocked_by");

    let my_work = get(
        &app,
        &member_token,
        &format!("/api/workspaces/{workspace_id}/tasks?my_work=true&label_id={label_id}"),
    )
    .await;
    assert_eq!(my_work.as_array().unwrap().len(), 1);
    assert_eq!(my_work[0]["id"], parent_id);

    let cycle = patch(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks/{parent_id}"),
        json!({"parent_id": child_id}),
    )
    .await;
    assert_eq!(cycle.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let outsider_task = create_task(
        &app,
        &outsider_token,
        outsider_workspace,
        json!({"title": "Other tenant"}),
    )
    .await;
    let cross_tenant = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks/{parent_id}/relations"),
            Some(json!({
                "task_id": outsider_task["id"],
                "relation_type": "relates_to"
            })),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(cross_tenant.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test(migrations = "./migrations")]
async fn moves_bulk_updates_order_and_permanent_deletion_preserve_invariants(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, workspace_id) = register(&app, "owner@example.com").await;
    let (_member_token, member_id, _) = register(&app, "member@example.com").await;
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')",
    )
    .bind(workspace_id)
    .bind(member_id)
    .execute(&pool)
    .await
    .unwrap();
    let first_project = create_project(&app, &owner_token, workspace_id, "First").await;
    let second_project = create_project(&app, &owner_token, workspace_id, "Second").await;
    let first_id = first_project["id"].as_str().unwrap();
    let second_id = second_project["id"].as_str().unwrap();
    create(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/projects/{first_id}/members"),
        json!({"user_id": member_id, "role": "contributor"}),
    )
    .await;

    let task_type = create(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/task-types"),
        json!({
            "name": "Bug",
            "icon": "bug",
            "color": "#EF4444",
            "description": "Defect"
        }),
    )
    .await;
    let default_type_id = first_project["default_task_type_id"].as_str().unwrap();
    let configured = patch(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/projects/{first_id}"),
        json!({
            "enabled_task_type_ids": [default_type_id, task_type["id"]],
            "default_task_type_id": task_type["id"]
        }),
    )
    .await;
    assert_eq!(configured.status(), StatusCode::OK);
    let restricted = patch(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/projects/{second_id}"),
        json!({"enabled_task_type_ids": [default_type_id]}),
    )
    .await;
    assert_eq!(restricted.status(), StatusCode::OK);

    let parent = create_task(
        &app,
        &owner_token,
        workspace_id,
        json!({"title": "Parent", "project_id": first_id}),
    )
    .await;
    let parent_id = parent["id"].as_str().unwrap();
    let child = create_task(
        &app,
        &owner_token,
        workspace_id,
        json!({
            "title": "Move me",
            "project_id": first_id,
            "parent_id": parent_id,
            "assignee_ids": [member_id]
        }),
    )
    .await;
    let child_id = child["id"].as_str().unwrap();
    let rejected = patch(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks/{child_id}"),
        json!({"project_id": second_id}),
    )
    .await;
    assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let cleaned = patch(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks/{child_id}"),
        json!({"project_id": second_id, "cleanup_invalid": true}),
    )
    .await;
    assert_eq!(cleaned.status(), StatusCode::OK);
    let cleaned = json_body(cleaned).await;
    assert_eq!(cleaned["project_id"], second_id);
    assert_eq!(
        cleaned["task_type"]["id"],
        second_project["default_task_type_id"]
    );
    assert!(cleaned["assignees"].as_array().unwrap().is_empty());
    assert_eq!(cleaned["parent"], Value::Null);

    let third = create_task(
        &app,
        &owner_token,
        workspace_id,
        json!({"title": "Third", "project_id": second_id}),
    )
    .await;
    let third_id = third["id"].as_str().unwrap();
    let failed_bulk = patch(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks/bulk"),
        json!({
            "task_ids": [child_id, Uuid::new_v4()],
            "priority": "urgent"
        }),
    )
    .await;
    assert_eq!(failed_bulk.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        get(
            &app,
            &owner_token,
            &format!("/api/workspaces/{workspace_id}/tasks/{child_id}")
        )
        .await["priority"],
        "none"
    );

    let bulk = patch(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks/bulk"),
        json!({"task_ids": [child_id, third_id], "priority": "urgent"}),
    )
    .await;
    assert_eq!(bulk.status(), StatusCode::OK);
    assert_eq!(json_body(bulk).await.as_array().unwrap().len(), 2);

    let partial_reorder = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/tasks/reorder"),
            Some(json!({"task_ids": [third_id]})),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(partial_reorder.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let reordered = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/tasks/reorder"),
            Some(json!({"task_ids": [third_id, child_id]})),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(reordered.status(), StatusCode::NO_CONTENT);
    let tasks = get(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks?project_id={second_id}"),
    )
    .await;
    assert_eq!(tasks[0]["id"], third_id);
    assert_eq!(tasks[1]["id"], child_id);

    let wrong_confirmation = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks/{child_id}/delete"),
            Some(json!({"reference": "wrong"})),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(
        wrong_confirmation.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let reference = cleaned["reference"].as_str().unwrap();
    let deleted = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks/{child_id}/delete"),
            Some(json!({"reference": reference})),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    let document_path = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Tasks")
        .join(format!("{child_id}.md"));
    assert!(!document_path.exists());
}
