#![cfg(feature = "postgres-tests")]

use std::{
    collections::HashMap,
    fs,
    io::{Cursor, Read},
    time::Duration,
};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use http::HeaderValue;
use kanleaf_server::{AppState, portability::recover_export_operations, router};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tempfile::TempDir;
use tower::ServiceExt;
use uuid::Uuid;
use zip::ZipArchive;

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
    let bytes = to_bytes(response.into_body(), 8 * 1024 * 1024)
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

async fn save_document(app: &Router, token: &str, uri: &str, content: &str) {
    let opened = send(app, "GET", uri, None, token).await;
    assert_eq!(opened.status(), StatusCode::OK);
    let opened = response_json(opened).await;
    let saved = send(
        app,
        "PUT",
        uri,
        Some(json!({"content": content, "base_revision": opened["revision"]})),
        token,
    )
    .await;
    assert_eq!(saved.status(), StatusCode::OK);
}

async fn wait_for_export(app: &Router, token: &str, operation_id: &str) -> Value {
    for _ in 0..200 {
        let response = send(
            app,
            "GET",
            &format!("/api/workspace-exports/{operation_id}"),
            None,
            token,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let operation = response_json(response).await;
        if operation["state"] != "preparing" {
            return operation;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("Workspace export did not finish");
}

fn archive_entries(bytes: Vec<u8>) -> HashMap<String, Vec<u8>> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut entries = HashMap::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).unwrap();
        let mut content = Vec::new();
        entry.read_to_end(&mut content).unwrap();
        entries.insert(entry.name().to_owned(), content);
    }
    entries
}

fn sha256(content: &[u8]) -> String {
    let digest = Sha256::digest(content);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[sqlx::test(migrations = "./migrations")]
async fn exports_managed_markdown_config_and_verified_manifest(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let state = test_state(pool.clone(), &data_dir);
    let app = test_app(state);
    let (token, _, workspace_id) = register(&app, "export-owner@example.com").await;
    let project = create(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/projects"),
        json!({"name": "Archive"}),
    )
    .await;
    let project_id = project["id"].as_str().unwrap();
    let task = create(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/tasks"),
        json!({"title": "Portable task", "project_id": project_id}),
    )
    .await;
    let label = create(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/labels"),
        json!({
            "name": "Portable",
            "color": "#336699",
            "description": "Round-trip label"
        }),
    )
    .await;
    let default_option_id = Uuid::new_v4();
    let property = create(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/properties"),
        json!({
            "name": "Impact",
            "type": "single_select",
            "description": "Portable custom metadata",
            "default_option_id": default_option_id,
            "options": [{
                "id": default_option_id,
                "name": "High",
                "color": "#EF4444",
                "description": "Needs prompt attention"
            }]
        }),
    )
    .await;
    save_document(
        &app,
        &token,
        &format!(
            "/api/workspaces/{workspace_id}/tasks/{}/document",
            task["id"].as_str().unwrap()
        ),
        "# Portable body\n\n[[Architecture]]\n",
    )
    .await;
    let note = create(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/documents"),
        json!({"title": "Architecture", "project_id": project_id}),
    )
    .await;
    save_document(
        &app,
        &token,
        &format!(
            "/api/workspaces/{workspace_id}/documents/{}/content",
            note["id"].as_str().unwrap()
        ),
        "# Architecture\n\nDurable Markdown.\n",
    )
    .await;

    let workspace_root = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string());
    fs::write(workspace_root.join("notes.txt"), "do not export").unwrap();
    fs::create_dir_all(workspace_root.join(".obsidian")).unwrap();
    fs::write(workspace_root.join(".obsidian/workspace.json"), "secret").unwrap();

    let started = send(
        &app,
        "POST",
        &format!("/api/workspaces/{workspace_id}/exports"),
        None,
        &token,
    )
    .await;
    assert_eq!(started.status(), StatusCode::ACCEPTED);
    let started = response_json(started).await;
    let operation = wait_for_export(&app, &token, started["id"].as_str().unwrap()).await;
    assert_eq!(operation["state"], "ready", "{operation:#}");
    assert!(operation["download_url"].is_string());
    assert!(
        operation["exclusions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["path"] == "notes.txt" && entry["reason"] == "unmanaged_file")
    );
    assert!(
        operation["exclusions"]
            .as_array()
            .unwrap()
            .iter()
            .any(
                |entry| entry["path"] == ".obsidian" && entry["reason"] == "obsidian_configuration"
            )
    );

    let download = send(
        &app,
        "GET",
        operation["download_url"].as_str().unwrap(),
        None,
        &token,
    )
    .await;
    assert_eq!(download.status(), StatusCode::OK);
    assert_eq!(download.headers()[header::CONTENT_TYPE], "application/zip");
    let bytes = to_bytes(download.into_body(), 64 * 1024 * 1024)
        .await
        .unwrap()
        .to_vec();
    let entries = archive_entries(bytes);
    assert!(!entries.contains_key("notes.txt"));
    assert!(!entries.keys().any(|path| path.starts_with(".obsidian/")));
    assert!(entries.contains_key(".kanleaf/workspace.json"));
    assert!(entries.contains_key(".kanleaf/task-config.json"));
    assert!(entries.contains_key(".kanleaf/views.json"));
    assert!(entries.contains_key(&format!(".kanleaf/projects/{project_id}.json")));
    let workspace_config: Value =
        serde_json::from_slice(&entries[".kanleaf/workspace.json"]).unwrap();
    assert_eq!(workspace_config["format_version"], 2);
    assert!(workspace_config.get("default_task_type_id").is_none());
    assert!(workspace_config["state_property_description"].is_string());
    assert!(workspace_config["label_property_description"].is_string());
    let task_config: Value = serde_json::from_slice(&entries[".kanleaf/task-config.json"]).unwrap();
    assert_eq!(task_config["format_version"], 3);
    assert!(task_config.get("types").is_none());
    assert_eq!(task_config["states"].as_array().unwrap().len(), 5);
    assert_eq!(
        task_config["states"]
            .as_array()
            .unwrap()
            .iter()
            .map(|state| state["system_role"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["backlog", "todo", "in_progress", "done", "cancelled"]
    );
    assert!(
        task_config["states"]
            .as_array()
            .unwrap()
            .iter()
            .all(|state| state.get("icon").is_none())
    );
    let todo = task_config["states"]
        .as_array()
        .unwrap()
        .iter()
        .find(|state| state["system_role"] == "todo")
        .unwrap();
    assert!(todo["description"].is_string());
    let exported_label = task_config["labels"]
        .as_array()
        .unwrap()
        .iter()
        .find(|value| value["id"] == label["id"])
        .unwrap();
    assert!(exported_label.get("icon").is_none());
    assert_eq!(exported_label["position"], 0);
    let exported_property = task_config["properties"]
        .as_array()
        .unwrap()
        .iter()
        .find(|value| value["id"] == property["id"])
        .unwrap();
    assert_eq!(
        exported_property["default_option_id"],
        default_option_id.to_string()
    );
    assert!(exported_property["options"][0].get("icon").is_none());
    assert_eq!(
        exported_property["options"][0]["description"],
        "Needs prompt attention"
    );
    let project_config: Value =
        serde_json::from_slice(&entries[&format!(".kanleaf/projects/{project_id}.json")]).unwrap();
    assert_eq!(project_config["format_version"], 3);
    assert!(project_config.get("default_task_type_id").is_none());
    assert!(project_config.get("enabled_task_type_ids").is_none());
    let task_path = format!(
        "Projects/{}/Todo/{}.md",
        project["storage_name"].as_str().unwrap(),
        task["storage_name"].as_str().unwrap()
    );
    let wiki_path = format!(
        "Projects/{}/Wiki/architecture.md",
        project["storage_name"].as_str().unwrap()
    );
    assert!(String::from_utf8_lossy(&entries[&task_path]).contains("[[Architecture]]"));
    assert_eq!(
        String::from_utf8_lossy(&entries[&wiki_path]),
        "# Architecture\n\nDurable Markdown.\n"
    );

    let manifest: Value = serde_json::from_slice(&entries[".kanleaf/manifest.json"]).unwrap();
    assert_eq!(manifest["format_version"], 1);
    assert_eq!(manifest["source"]["workspace_id"], workspace_id.to_string());
    assert_eq!(manifest["omitted"]["authentication"], true);
    for file in manifest["files"].as_array().unwrap() {
        let path = file["path"].as_str().unwrap();
        assert_eq!(file["size"].as_u64().unwrap(), entries[path].len() as u64);
        assert_eq!(file["sha256"], sha256(&entries[path]));
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn export_is_admin_only_actor_scoped_and_rechecks_download_access(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(test_state(pool.clone(), &data_dir));
    let (owner_token, _, workspace_id) = register(&app, "export-access-owner@example.com").await;
    let (admin_token, admin_id, _) = register(&app, "export-access-admin@example.com").await;
    let (member_token, member_id, _) = register(&app, "export-access-member@example.com").await;
    for (user_id, role) in [(admin_id, "admin"), (member_id, "member")] {
        sqlx::query(
            "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)",
        )
        .bind(workspace_id)
        .bind(user_id)
        .bind(role)
        .execute(&pool)
        .await
        .unwrap();
    }
    let forbidden = send(
        &app,
        "POST",
        &format!("/api/workspaces/{workspace_id}/exports"),
        None,
        &member_token,
    )
    .await;
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

    let started = send(
        &app,
        "POST",
        &format!("/api/workspaces/{workspace_id}/exports"),
        None,
        &admin_token,
    )
    .await;
    assert_eq!(started.status(), StatusCode::ACCEPTED);
    let started = response_json(started).await;
    let operation_id = started["id"].as_str().unwrap();
    let operation = wait_for_export(&app, &admin_token, operation_id).await;
    assert_eq!(operation["state"], "ready", "{operation:#}");

    let guessed = send(
        &app,
        "GET",
        &format!("/api/workspace-exports/{operation_id}"),
        None,
        &owner_token,
    )
    .await;
    assert_eq!(guessed.status(), StatusCode::NOT_FOUND);
    let guessed_cancel = send(
        &app,
        "DELETE",
        &format!("/api/workspace-exports/{operation_id}"),
        None,
        &owner_token,
    )
    .await;
    assert_eq!(guessed_cancel.status(), StatusCode::NOT_FOUND);

    let downgraded = send(
        &app,
        "PATCH",
        &format!("/api/workspaces/{workspace_id}/members/{admin_id}"),
        Some(json!({"role": "member"})),
        &owner_token,
    )
    .await;
    assert_eq!(downgraded.status(), StatusCode::OK);
    let download = send(
        &app,
        "GET",
        operation["download_url"].as_str().unwrap(),
        None,
        &admin_token,
    )
    .await;
    assert_eq!(download.status(), StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "./migrations")]
async fn startup_recovery_removes_export_artifacts_and_expires_operations(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(test_state(pool.clone(), &data_dir));
    let (_, user_id, workspace_id) = register(&app, "export-recovery@example.com").await;
    let operations = data_dir.path().join("operations");
    fs::create_dir_all(&operations).unwrap();
    let interrupted_key = Uuid::new_v4();
    let expired_key = Uuid::new_v4();
    for staging_key in [interrupted_key, expired_key] {
        fs::write(
            operations.join(format!("{staging_key}.kanleaf.zip")),
            "partial",
        )
        .unwrap();
    }
    let interrupted_id = Uuid::new_v4();
    let expired_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO workspace_operations (
            id, actor_id, workspace_id, kind, state, revision, result,
            staging_key, expires_at
        ) VALUES
            ($1, $2, $3, 'workspace_export', 'preparing', $4, $5, $6, now() + interval '10 minutes'),
            ($7, $2, $3, 'workspace_export', 'ready', $8, $5, $9, now() - interval '1 minute')
        "#,
    )
    .bind(interrupted_id)
    .bind(user_id)
    .bind(workspace_id)
    .bind(Uuid::new_v4())
    .bind(json!({"file_name": "workspace.kanleaf.zip", "file_count": 0, "content_bytes": 0, "archive_bytes": null, "exclusions": [], "error": null}))
    .bind(interrupted_key)
    .bind(expired_id)
    .bind(Uuid::new_v4())
    .bind(expired_key)
    .execute(&pool)
    .await
    .unwrap();

    let state = test_state(pool.clone(), &data_dir);
    recover_export_operations(&state).await.unwrap();

    let interrupted: (String, Value) =
        sqlx::query_as("SELECT state, result FROM workspace_operations WHERE id = $1")
            .bind(interrupted_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(interrupted.0, "failed");
    assert_eq!(interrupted.1["error"]["code"], "interrupted");
    let expired_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workspace_operations WHERE id = $1)")
            .bind(expired_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!expired_exists);
    assert!(
        !operations
            .join(format!("{interrupted_key}.kanleaf.zip"))
            .exists()
    );
    assert!(
        !operations
            .join(format!("{expired_key}.kanleaf.zip"))
            .exists()
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn canceled_preparing_export_recovers_an_artifact_written_after_cancel(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(test_state(pool.clone(), &data_dir));
    let (token, user_id, workspace_id) = register(&app, "export-cancel@example.com").await;
    let operation_id = Uuid::new_v4();
    let staging_key = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO workspace_operations (
            id, actor_id, workspace_id, kind, state, revision, result,
            staging_key, expires_at
        ) VALUES ($1, $2, $3, 'workspace_export', 'preparing', $4, $5, $6,
                  now() + interval '10 minutes')
        "#,
    )
    .bind(operation_id)
    .bind(user_id)
    .bind(workspace_id)
    .bind(Uuid::new_v4())
    .bind(json!({
        "file_name": "workspace.kanleaf.zip",
        "file_count": 0,
        "content_bytes": 0,
        "archive_bytes": null,
        "exclusions": [],
        "error": null
    }))
    .bind(staging_key)
    .execute(&pool)
    .await
    .unwrap();

    let canceled = send(
        &app,
        "DELETE",
        &format!("/api/workspace-exports/{operation_id}"),
        None,
        &token,
    )
    .await;
    assert_eq!(canceled.status(), StatusCode::NO_CONTENT);
    let canceled_state: Option<String> =
        sqlx::query_scalar("SELECT state FROM workspace_operations WHERE id = $1")
            .bind(operation_id)
            .fetch_optional(&pool)
            .await
            .unwrap();
    assert_eq!(canceled_state.as_deref(), Some("canceled"));

    let hidden = send(
        &app,
        "GET",
        &format!("/api/workspace-exports/{operation_id}"),
        None,
        &token,
    )
    .await;
    assert_eq!(hidden.status(), StatusCode::NOT_FOUND);
    let hidden_download = send(
        &app,
        "GET",
        &format!("/api/workspace-exports/{operation_id}/download"),
        None,
        &token,
    )
    .await;
    assert_eq!(hidden_download.status(), StatusCode::NOT_FOUND);

    let repeated = send(
        &app,
        "DELETE",
        &format!("/api/workspace-exports/{operation_id}"),
        None,
        &token,
    )
    .await;
    assert_eq!(repeated.status(), StatusCode::NOT_FOUND);

    let operations = data_dir.path().join("operations");
    fs::create_dir_all(&operations).unwrap();
    let artifact = operations.join(format!("{staging_key}.kanleaf.zip"));
    fs::write(&artifact, "archive published after cancellation").unwrap();

    recover_export_operations(&test_state(pool.clone(), &data_dir))
        .await
        .unwrap();

    assert!(!artifact.exists());
    let operation_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workspace_operations WHERE id = $1)")
            .bind(operation_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!operation_exists);
}
