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

fn json_request(method: &str, uri: &str, body: Value, token: Option<&str>) -> Request<Body> {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(token) = token {
        request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    request.body(Body::from(body.to_string())).unwrap()
}

fn empty_request(method: &str, uri: &str, token: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), 8 * 1024 * 1024)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn register(app: &axum::Router, email: &str) -> (String, Uuid, Uuid) {
    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/register",
            json!({"email": email, "password": "correct horse battery"}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let payload = response_json(response).await;
    (
        payload["token"].as_str().unwrap().to_owned(),
        payload["user"]["id"].as_str().unwrap().parse().unwrap(),
        payload["user"]["active_workspace_id"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap(),
    )
}

async fn create_project(app: &axum::Router, token: &str, workspace_id: Uuid, name: &str) -> Uuid {
    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects"),
            json!({"name": name}),
            Some(token),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap()
}

async fn create_task(app: &axum::Router, token: &str, workspace_id: Uuid, body: Value) -> Value {
    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            body,
            Some(token),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await
}

async fn task_configuration(app: &axum::Router, token: &str, workspace_id: Uuid) -> Value {
    let response = app
        .clone()
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/task-configuration"),
            token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    response_json(response).await
}

#[sqlx::test(migrations = "./migrations")]
async fn task_metadata_and_markdown_persist_through_the_complete_lifecycle(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "owner@example.com").await;
    let project_id = create_project(&app, &token, workspace_id, "Kanleaf").await;
    let configuration = task_configuration(&app, &token, workspace_id).await;
    let in_progress_id = configuration["states"]
        .as_array()
        .unwrap()
        .iter()
        .find(|state| state["state_group"] == "in_progress")
        .unwrap()["id"]
        .clone();
    let done_id = configuration["states"]
        .as_array()
        .unwrap()
        .iter()
        .find(|state| state["state_group"] == "done")
        .unwrap()["id"]
        .clone();
    let task = create_task(
        &app,
        &token,
        workspace_id,
        json!({
            "title": "  Finish Markdown workflow  ",
            "project_id": project_id,
            "state_id": in_progress_id,
            "priority": "high"
        }),
    )
    .await;
    let task_id: Uuid = task["id"].as_str().unwrap().parse().unwrap();
    assert_eq!(task["title"], "Finish Markdown workflow");
    assert_eq!(task["state"]["state_group"], "in_progress");
    assert_eq!(task["task_type"]["name"], "Task");
    assert_eq!(task["priority"], "high");

    let document_path = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Tasks")
        .join(format!("{task_id}.md"));
    assert_eq!(fs::read_to_string(&document_path).unwrap(), "");

    let project_tasks = app
        .clone()
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks?project_id={project_id}"),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(project_tasks).await.as_array().unwrap().len(),
        1
    );

    let updated = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
            json!({
                "title": "Finish Markdown persistence",
                "state_id": done_id,
                "priority": "medium",
                "project_id": null
            }),
            Some(&token),
        ))
        .await
        .unwrap();
    let updated = response_json(updated).await;
    assert_eq!(updated["project_id"], Value::Null);
    assert_eq!(updated["state"]["state_group"], "done");

    let inbox_search = app
        .clone()
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks?inbox=true&query=persistence"),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(inbox_search).await.as_array().unwrap().len(),
        1
    );

    let markdown = "# Architecture\n\n  Keep spacing.  \n\n- [x] PostgreSQL\n- [ ] Preview\n";
    let opened = app
        .clone()
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/document"),
            &token,
        ))
        .await
        .unwrap();
    let base_revision = response_json(opened).await["revision"]
        .as_str()
        .unwrap()
        .to_owned();
    let saved = app
        .clone()
        .oneshot(json_request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/document"),
            json!({"content": markdown, "base_revision": base_revision}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(saved.status(), StatusCode::OK);
    let saved = response_json(saved).await;
    assert_eq!(saved["content"], markdown);
    let stale_save = app
        .clone()
        .oneshot(json_request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/document"),
            json!({"content": "stale overwrite", "base_revision": base_revision}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(stale_save.status(), StatusCode::CONFLICT);

    let document = app
        .clone()
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/document"),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response_json(document).await["content"], markdown);
    assert_eq!(fs::read_to_string(&document_path).unwrap(), markdown);

    let archived = app
        .clone()
        .oneshot(empty_request(
            "DELETE",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(archived.status(), StatusCode::NO_CONTENT);

    let inbox = app
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks?inbox=true"),
            &token,
        ))
        .await
        .unwrap();
    assert!(response_json(inbox).await.as_array().unwrap().is_empty());
    assert_eq!(fs::read_to_string(document_path).unwrap(), markdown);
}

#[sqlx::test(migrations = "./migrations")]
async fn task_search_treats_sql_wildcards_as_text(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let (token, _, workspace_id) = register(&app, "owner@example.com").await;
    create_task(
        &app,
        &token,
        workspace_id,
        json!({"title": "Reach 100%_done"}),
    )
    .await;
    create_task(
        &app,
        &token,
        workspace_id,
        json!({"title": "Reach 100xZdone"}),
    )
    .await;

    let response = app
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks?query=100%25_done"),
            &token,
        ))
        .await
        .unwrap();
    let tasks = response_json(response).await;
    assert_eq!(tasks.as_array().unwrap().len(), 1);
    assert_eq!(tasks[0]["title"], "Reach 100%_done");
}

#[sqlx::test(migrations = "./migrations")]
async fn task_and_document_access_isolated_by_workspace(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (first_token, _, first_workspace) = register(&app, "first@example.com").await;
    let (second_token, _, second_workspace) = register(&app, "second@example.com").await;
    let second_project = create_project(&app, &second_token, second_workspace, "Private").await;
    let second_task = create_task(
        &app,
        &second_token,
        second_workspace,
        json!({"title": "Private task", "project_id": second_project}),
    )
    .await;
    let second_task_id = second_task["id"].as_str().unwrap();

    let attempts = [
        empty_request(
            "GET",
            &format!("/api/workspaces/{second_workspace}/tasks/{second_task_id}"),
            &first_token,
        ),
        empty_request(
            "GET",
            &format!("/api/workspaces/{second_workspace}/tasks/{second_task_id}/document"),
            &first_token,
        ),
        json_request(
            "PUT",
            &format!("/api/workspaces/{second_workspace}/tasks/{second_task_id}/document"),
            json!({"content": "stolen", "base_revision": "0".repeat(64)}),
            Some(&first_token),
        ),
    ];
    for request in attempts {
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    let cross_project = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{first_workspace}/tasks"),
            json!({"title": "Escaped task", "project_id": second_project}),
            Some(&first_token),
        ))
        .await
        .unwrap();
    assert_eq!(cross_project.status(), StatusCode::NOT_FOUND);

    let first_task_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM tasks WHERE workspace_id = $1")
            .bind(first_workspace)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(first_task_count, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn archiving_a_project_moves_its_active_tasks_to_inbox(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let (token, _, workspace_id) = register(&app, "owner@example.com").await;
    let project_id = create_project(&app, &token, workspace_id, "Temporary").await;
    let task = create_task(
        &app,
        &token,
        workspace_id,
        json!({"title": "Keep me", "project_id": project_id}),
    )
    .await;

    let archived = app
        .clone()
        .oneshot(empty_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}/archive"),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(archived.status(), StatusCode::NO_CONTENT);

    let inbox = app
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks?inbox=true"),
            &token,
        ))
        .await
        .unwrap();
    let inbox = response_json(inbox).await;
    assert_eq!(inbox.as_array().unwrap().len(), 1);
    assert_eq!(inbox[0]["id"], task["id"]);
    assert_eq!(inbox[0]["project_id"], Value::Null);
}

#[sqlx::test(migrations = "./migrations")]
async fn task_creation_rolls_back_when_the_vault_cannot_create_a_document(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    fs::write(data_dir.path().join("vaults"), "not a directory").unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "owner@example.com").await;

    let response = app
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            json!({"title": "Cannot persist"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

    let task_count: i64 = sqlx::query_scalar("SELECT count(*) FROM tasks")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(task_count, 0);
}
