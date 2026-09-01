#![cfg(feature = "postgres-tests")]

use std::{fs, time::Duration};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use http::HeaderValue;
use kanleaf_server::{AppState, portability::recover_config_projection_jobs, router};
use serde_json::{Value, json};
use sqlx::PgPool;
use tempfile::TempDir;
use tower::ServiceExt;
use uuid::Uuid;

fn test_state(pool: PgPool, data_dir: &TempDir) -> AppState {
    AppState::new(pool, data_dir.path().to_owned(), Duration::from_secs(3600))
}

fn test_app(state: AppState) -> Router {
    router(
        state,
        vec![HeaderValue::from_static("http://127.0.0.1:1420")],
    )
}

async fn send(
    app: &Router,
    method: &str,
    uri: &str,
    body: Option<Value>,
    token: &str,
) -> axum::response::Response {
    let mut request = Request::builder().method(method).uri(uri);
    if !token.is_empty() {
        request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    if body.is_some() {
        request = request.header(header::CONTENT_TYPE, "application/json");
    }
    app.clone()
        .oneshot(
            request
                .body(body.map_or_else(Body::empty, |value| Body::from(value.to_string())))
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
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
    let body = response_json(response).await;
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
    let workspace = create(app, &token, "/api/workspaces", json!({"name": "Personal"})).await;
    let workspace_id = workspace["id"].as_str().unwrap().parse().unwrap();
    (token, user_id, workspace_id)
}

async fn create(app: &Router, token: &str, uri: &str, body: Value) -> Value {
    let response = send(app, "POST", uri, Some(body), token).await;
    assert_eq!(response.status(), StatusCode::CREATED, "{uri}");
    response_json(response).await
}

fn config_path(data_dir: &TempDir, workspace_id: Uuid, name: &str) -> std::path::PathBuf {
    data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join(".kanleaf")
        .join(name)
}

#[sqlx::test(migrations = "./migrations")]
async fn projects_complete_portable_config_and_coalesces_mutations(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let state = test_state(pool.clone(), &data_dir);
    let app = test_app(state.clone());
    let (owner_token, owner_id, workspace_id) = register(&app, "config-owner@example.com").await;
    let (_, member_id, _) = register(&app, "config-member@example.com").await;
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')",
    )
    .bind(workspace_id)
    .bind(member_id)
    .execute(&pool)
    .await
    .unwrap();

    let project = create(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/projects"),
        json!({"name": "Portable"}),
    )
    .await;
    let project_id = project["id"].as_str().unwrap();
    create(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/labels"),
        json!({"name": "Docs", "color": "#336699", "description": "Documentation"}),
    )
    .await;
    create(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/projects/{project_id}/cycles"),
        json!({"name": "September", "start_date": "2026-09-01", "due_date": "2026-09-30"}),
    )
    .await;
    create(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/projects/{project_id}/modules"),
        json!({"name": "Vault", "description": "Portable storage"}),
    )
    .await;
    let task = create(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks"),
        json!({"title": "Export me", "project_id": project_id}),
    )
    .await;
    let query = json!({
        "version": 1,
        "scope": {"kind": "project", "project_id": project_id},
        "filters": {},
        "grouping": {},
        "sort": [],
        "display": ["state", "priority"],
        "include_completed": false
    });
    create(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/views"),
        json!({"name": "Shared work", "visibility": "shared", "project_id": project_id, "query": query, "layout": "list"}),
    )
    .await;
    create(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/views"),
        json!({"name": "Private work", "visibility": "personal", "project_id": project_id, "query": query, "layout": "board"}),
    )
    .await;

    recover_config_projection_jobs(&state).await.unwrap();

    let workspace: Value = serde_json::from_str(
        &fs::read_to_string(config_path(&data_dir, workspace_id, "workspace.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(workspace["format_version"], 1);
    assert_eq!(workspace["workspace_id"], workspace_id.to_string());
    assert_eq!(workspace["members"].as_array().unwrap().len(), 2);
    assert!(workspace.get("sessions").is_none());
    assert!(workspace.get("invitations").is_none());
    assert!(workspace.get("notification_preferences").is_none());

    let task_config: Value = serde_json::from_str(
        &fs::read_to_string(config_path(&data_dir, workspace_id, "task-config.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(task_config["states"].as_array().unwrap().len(), 5);
    assert_eq!(task_config["types"].as_array().unwrap().len(), 1);
    assert_eq!(task_config["labels"][0]["name"], "Docs");

    let views: Value = serde_json::from_str(
        &fs::read_to_string(config_path(&data_dir, workspace_id, "views.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(views["views"].as_array().unwrap().len(), 1);
    assert_eq!(views["views"][0]["name"], "Shared work");

    let project_config: Value = serde_json::from_str(
        &fs::read_to_string(config_path(
            &data_dir,
            workspace_id,
            &format!("projects/{project_id}.json"),
        ))
        .unwrap(),
    )
    .unwrap();
    assert_eq!(project_config["storage_name"], project["storage_name"]);
    assert_eq!(project_config["cycles"][0]["name"], "September");
    assert_eq!(project_config["modules"][0]["name"], "Vault");

    let first_manifest: Value = serde_json::from_str(
        &fs::read_to_string(config_path(&data_dir, workspace_id, "manifest.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(first_manifest["tasks"][0]["id"], task["id"]);
    let first_version = first_manifest["config_version"].as_i64().unwrap();

    fs::write(
        config_path(&data_dir, workspace_id, "workspace.json"),
        "{\"format_version\":1,\"externally_changed\":true}\n",
    )
    .unwrap();
    let sync_preview = send(
        &app,
        "POST",
        &format!("/api/workspaces/{workspace_id}/vault-syncs/preview"),
        None,
        &owner_token,
    )
    .await;
    assert_eq!(sync_preview.status(), StatusCode::CREATED);
    let sync_preview = response_json(sync_preview).await;
    assert!(
        sync_preview["issues"]
            .as_array()
            .unwrap()
            .iter()
            .any(|issue| issue["kind"] == "configuration_drift"
                && issue["path"] == ".kanleaf/workspace.json")
    );

    sqlx::query("UPDATE workspaces SET name = 'Portable renamed' WHERE id = $1")
        .bind(workspace_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE users SET display_name = 'Workspace Owner' WHERE id = $1")
        .bind(owner_id)
        .execute(&pool)
        .await
        .unwrap();
    let jobs: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM workspace_config_projection_jobs WHERE workspace_id = $1",
    )
    .bind(workspace_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(jobs, 1);

    recover_config_projection_jobs(&state).await.unwrap();
    let updated_workspace: Value = serde_json::from_str(
        &fs::read_to_string(config_path(&data_dir, workspace_id, "workspace.json")).unwrap(),
    )
    .unwrap();
    let updated_manifest: Value = serde_json::from_str(
        &fs::read_to_string(config_path(&data_dir, workspace_id, "manifest.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(updated_workspace["name"], "Portable renamed");
    assert!(
        updated_workspace["members"]
            .as_array()
            .unwrap()
            .iter()
            .any(|member| member["user_id"] == owner_id.to_string()
                && member["display_name"] == "Workspace Owner")
    );
    assert!(updated_manifest["config_version"].as_i64().unwrap() > first_version);
    let versions: (i64, i64, Option<String>) = sqlx::query_as(
        "SELECT config_version, projected_config_version, config_projection_error FROM workspaces WHERE id = $1",
    )
    .bind(workspace_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(versions.0, versions.1);
    assert!(versions.2.is_none());
}

#[sqlx::test(migrations = "./migrations")]
async fn account_preferences_and_sessions_do_not_dirty_workspace_config(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let state = test_state(pool.clone(), &data_dir);
    let app = test_app(state.clone());
    let (token, user_id, workspace_id) = register(&app, "local-only@example.com").await;
    recover_config_projection_jobs(&state).await.unwrap();
    let before: i64 = sqlx::query_scalar("SELECT config_version FROM workspaces WHERE id = $1")
        .bind(workspace_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let response = send(
        &app,
        "PATCH",
        "/api/account/preferences",
        Some(json!({
            "theme": "dark",
            "timezone": "Asia/Ho_Chi_Minh",
            "week_start": "sunday",
            "date_format": "yyyy_mm_dd"
        })),
        &token,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    sqlx::query(
        "UPDATE sessions SET expires_at = expires_at + interval '1 minute' WHERE user_id = $1",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();

    let after: i64 = sqlx::query_scalar("SELECT config_version FROM workspaces WHERE id = $1")
        .bind(workspace_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(before, after);
    let jobs: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM workspace_config_projection_jobs WHERE workspace_id = $1",
    )
    .bind(workspace_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(jobs, 0);
}

#[cfg(unix)]
#[sqlx::test(migrations = "./migrations")]
async fn projection_rejects_symlinked_machine_config_directory(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    let state = test_state(pool.clone(), &data_dir);
    let app = test_app(state.clone());
    let (_, _, workspace_id) = register(&app, "symlink-config@example.com").await;
    let workspace_root = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string());
    fs::create_dir_all(&workspace_root).unwrap();
    std::os::unix::fs::symlink(outside.path(), workspace_root.join(".kanleaf")).unwrap();

    recover_config_projection_jobs(&state).await.unwrap();

    assert!(fs::read_dir(outside.path()).unwrap().next().is_none());
    let failure: (Option<String>, i32) = sqlx::query_as(
        r#"
        SELECT workspaces.config_projection_error, jobs.attempts
        FROM workspaces
        JOIN workspace_config_projection_jobs AS jobs ON jobs.workspace_id = workspaces.id
        WHERE workspaces.id = $1
        "#,
    )
    .bind(workspace_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(failure.0.as_deref(), Some("storage_unavailable"));
    assert_eq!(failure.1, 1);
}
