#![cfg(feature = "postgres-tests")]

use std::{collections::HashMap, fs, path::PathBuf, time::Duration};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use http::HeaderValue;
use kanleaf_server::{
    AppState, portability::recover_workspace_operations, router, task::recover_projection_jobs,
};
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
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"));
    if body.is_some() {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
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
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await
}

fn task_path(
    data_dir: &TempDir,
    workspace_id: Uuid,
    project_storage: Option<&str>,
    task_storage: &str,
) -> PathBuf {
    let workspace = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string());
    project_storage.map_or_else(
        || workspace.join("Todo").join(format!("{task_storage}.md")),
        |project| {
            workspace
                .join("Projects")
                .join(project)
                .join("Todo")
                .join(format!("{task_storage}.md"))
        },
    )
}

#[sqlx::test(migrations = "./migrations")]
async fn external_properties_and_legacy_urgent_priority_apply_canonically(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "sync-owner@example.com").await;
    let projects_uri = format!("/api/workspaces/{workspace_id}/projects");
    let first = create(&app, &token, &projects_uri, json!({"name": "First"})).await;
    let second = create(&app, &token, &projects_uri, json!({"name": "Second"})).await;
    let property = create(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/properties"),
        json!({
            "name": "Impact",
            "type": "single_select",
            "options": [
                {"name": "High", "color": "#EF4444"},
                {"name": "Low", "color": "#3B82F6"}
            ]
        }),
    )
    .await;
    let task = create(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/tasks"),
        json!({"title": "Sync me", "project_id": first["id"]}),
    )
    .await;
    let task_id = task["id"].as_str().unwrap();
    let initial_property = send(
        &app,
        "PUT",
        &format!(
            "/api/workspaces/{workspace_id}/tasks/{task_id}/properties/{}",
            property["id"].as_str().unwrap()
        ),
        Some(json!({"value": property["options"][0]["id"]})),
        &token,
    )
    .await;
    assert_eq!(initial_property.status(), StatusCode::OK);
    let source_path = task_path(
        &data_dir,
        workspace_id,
        first["storage_name"].as_str(),
        task["storage_name"].as_str().unwrap(),
    );
    let source = fs::read_to_string(&source_path)
        .unwrap()
        .replace("Title: Sync me", "Title: Synced externally")
        .replace("Project:\n  - First", "Project:\n  - Second")
        .replace("State:\n  - Todo", "State:\n  - In Progress")
        .replace("Priority: []", "Priority:\n  - Urgent")
        .replace("Impact: High", "Impact: Low")
        .replacen("---\n\n", "External tool: Obsidian\n---\n\n", 1);
    fs::write(&source_path, format!("{source}# External body\n")).unwrap();

    let preview = send(
        &app,
        "POST",
        &format!("/api/workspaces/{workspace_id}/vault-syncs/preview"),
        None,
        &token,
    )
    .await;
    assert_eq!(preview.status(), StatusCode::CREATED);
    let preview = response_json(preview).await;
    assert_eq!(preview["items"][0]["status"], "valid");
    assert_eq!(
        preview["items"][0]["changes"],
        json!(["title", "project", "state", "priority", "properties"])
    );

    let applied = send(
        &app,
        "POST",
        &format!(
            "/api/workspaces/{workspace_id}/vault-syncs/{}/apply",
            preview["id"].as_str().unwrap()
        ),
        Some(json!({
            "revision": preview["revision"],
            "task_ids": [task_id]
        })),
        &token,
    )
    .await;
    assert_eq!(applied.status(), StatusCode::OK);
    let applied = response_json(applied).await;
    assert_eq!(applied["state"], "completed");
    assert_eq!(applied["applied_task_ids"], json!([task_id]));

    let task_response = send(
        &app,
        "GET",
        &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
        None,
        &token,
    )
    .await;
    let task_response = response_json(task_response).await;
    assert_eq!(task_response["title"], "Synced externally");
    assert_eq!(task_response["project_id"], second["id"]);
    assert_eq!(task_response["state"]["system_role"], "in_progress");
    assert_eq!(task_response["priority"], "critical");
    assert_eq!(
        task_response["custom_properties"][0]["value"],
        property["options"][1]["id"]
    );
    assert!(!source_path.exists());
    let destination = task_path(
        &data_dir,
        workspace_id,
        second["storage_name"].as_str(),
        task["storage_name"].as_str().unwrap(),
    );
    let projected = fs::read_to_string(destination).unwrap();
    assert!(projected.contains("Project:\n  - Second\n"));
    assert!(projected.contains("Priority:\n  - Critical\n"));
    assert!(projected.contains("External tool: Obsidian\n"));
    assert!(projected.ends_with("# External body\n"));
}

#[sqlx::test(migrations = "./migrations")]
async fn type_syncs_as_custom_data_and_legacy_cleanup_survives_projection_retry(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let state = AppState::new(
        pool.clone(),
        data_dir.path().to_owned(),
        Duration::from_secs(3600),
    );
    let app = router(
        state.clone(),
        vec![HeaderValue::from_static("http://127.0.0.1:1420")],
    );

    let (typed_token, _, typed_workspace_id) = register(&app, "typed-sync-owner@example.com").await;
    let type_property = create(
        &app,
        &typed_token,
        &format!("/api/workspaces/{typed_workspace_id}/properties"),
        json!({
            "name": "Type",
            "type": "single_select",
            "options": [
                {"name": "Bug", "color": "#EF4444"},
                {"name": "Feature", "color": "#3B82F6"}
            ]
        }),
    )
    .await;
    let typed_task = create(
        &app,
        &typed_token,
        &format!("/api/workspaces/{typed_workspace_id}/tasks"),
        json!({"title": "Typed task"}),
    )
    .await;
    let typed_task_id = typed_task["id"].as_str().unwrap();
    let set_type = send(
        &app,
        "PUT",
        &format!(
            "/api/workspaces/{typed_workspace_id}/tasks/{typed_task_id}/properties/{}",
            type_property["id"].as_str().unwrap()
        ),
        Some(json!({"value": type_property["options"][0]["id"]})),
        &typed_token,
    )
    .await;
    assert_eq!(set_type.status(), StatusCode::OK);
    let typed_path = task_path(
        &data_dir,
        typed_workspace_id,
        None,
        typed_task["storage_name"].as_str().unwrap(),
    );
    let typed_source = fs::read_to_string(&typed_path).unwrap();
    assert_eq!(typed_source.matches("Type:").count(), 1);
    fs::write(
        &typed_path,
        typed_source.replace("Type: Bug", "Type: Feature"),
    )
    .unwrap();

    let preview = send(
        &app,
        "POST",
        &format!("/api/workspaces/{typed_workspace_id}/vault-syncs/preview"),
        None,
        &typed_token,
    )
    .await;
    assert_eq!(preview.status(), StatusCode::CREATED);
    let preview = response_json(preview).await;
    assert_eq!(preview["items"][0]["status"], "valid");
    assert_eq!(preview["items"][0]["changes"], json!(["properties"]));
    let applied = send(
        &app,
        "POST",
        &format!(
            "/api/workspaces/{typed_workspace_id}/vault-syncs/{}/apply",
            preview["id"].as_str().unwrap()
        ),
        Some(json!({
            "revision": preview["revision"],
            "task_ids": [typed_task_id]
        })),
        &typed_token,
    )
    .await;
    assert_eq!(applied.status(), StatusCode::OK);
    let typed_task = send(
        &app,
        "GET",
        &format!("/api/workspaces/{typed_workspace_id}/tasks/{typed_task_id}"),
        None,
        &typed_token,
    )
    .await;
    let typed_task = response_json(typed_task).await;
    assert_eq!(
        typed_task["custom_properties"][0]["value"],
        type_property["options"][1]["id"]
    );

    let (plain_token, _, plain_workspace_id) = register(&app, "plain-sync-owner@example.com").await;
    let plain_task = create(
        &app,
        &plain_token,
        &format!("/api/workspaces/{plain_workspace_id}/tasks"),
        json!({"title": "Plain task"}),
    )
    .await;
    let plain_task_id: Uuid = plain_task["id"].as_str().unwrap().parse().unwrap();
    let plain_path = task_path(
        &data_dir,
        plain_workspace_id,
        None,
        plain_task["storage_name"].as_str().unwrap(),
    );
    let legacy_source = fs::read_to_string(&plain_path).unwrap().replacen(
        "---\n\n",
        "Type:\n  - Task\n# external comment\nExternal nested:\n  owner: \"01\"\nExternal list: [one, two]\nExternal scalar: keep\n---\n\n",
        1,
    );
    fs::write(&plain_path, &legacy_source).unwrap();
    let metadata_version: i64 = sqlx::query_scalar(
        "UPDATE tasks SET metadata_version = metadata_version + 1 WHERE workspace_id = $1 AND id = $2 RETURNING metadata_version",
    )
    .bind(plain_workspace_id)
    .bind(plain_task_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO task_projection_jobs (
            workspace_id, task_id, metadata_version, cleanup_property_names
        ) VALUES ($1, $2, $3, ARRAY['Type']::text[])
        ON CONFLICT (workspace_id, task_id) DO UPDATE
        SET metadata_version = EXCLUDED.metadata_version,
            cleanup_property_names = EXCLUDED.cleanup_property_names,
            next_attempt_at = now()
        "#,
    )
    .bind(plain_workspace_id)
    .bind(plain_task_id)
    .bind(metadata_version)
    .execute(&pool)
    .await
    .unwrap();
    let unavailable_path = plain_path.with_extension("md.unavailable");
    fs::rename(&plain_path, &unavailable_path).unwrap();
    recover_projection_jobs(&state).await.unwrap();
    let pending: (Vec<String>, i32) = sqlx::query_as(
        "SELECT cleanup_property_names, attempts FROM task_projection_jobs WHERE workspace_id = $1 AND task_id = $2",
    )
    .bind(plain_workspace_id)
    .bind(plain_task_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(pending.0, ["Type"]);
    assert_eq!(pending.1, 1);

    fs::rename(&unavailable_path, &plain_path).unwrap();
    sqlx::query(
        "UPDATE task_projection_jobs SET next_attempt_at = now() WHERE workspace_id = $1 AND task_id = $2",
    )
    .bind(plain_workspace_id)
    .bind(plain_task_id)
    .execute(&pool)
    .await
    .unwrap();
    recover_projection_jobs(&state).await.unwrap();
    let repaired = fs::read_to_string(&plain_path).unwrap();
    assert!(!repaired.contains("Type:"));
    assert!(repaired.contains(
        "# external comment\nExternal nested:\n  owner: \"01\"\nExternal list: [one, two]\nExternal scalar: keep\n"
    ));
    let remaining_jobs: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM task_projection_jobs WHERE workspace_id = $1 AND task_id = $2",
    )
    .bind(plain_workspace_id)
    .bind(plain_task_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(remaining_jobs, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn invalid_custom_property_blocks_the_entire_sync_item(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let (token, _, workspace_id) = register(&app, "invalid-property-sync@example.com").await;
    let property = create(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/properties"),
        json!({"name": "Notes", "type": "text"}),
    )
    .await;
    let task = create(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/tasks"),
        json!({"title": "Canonical title"}),
    )
    .await;
    let task_id = task["id"].as_str().unwrap();
    let set = send(
        &app,
        "PUT",
        &format!(
            "/api/workspaces/{workspace_id}/tasks/{task_id}/properties/{}",
            property["id"].as_str().unwrap()
        ),
        Some(json!({"value": "Original"})),
        &token,
    )
    .await;
    assert_eq!(set.status(), StatusCode::OK);
    let path = task_path(
        &data_dir,
        workspace_id,
        None,
        task["storage_name"].as_str().unwrap(),
    );
    let source = fs::read_to_string(&path)
        .unwrap()
        .replace("Title: Canonical title", "Title: External title")
        .replace("Notes: Original", "Notes: \"\"");
    fs::write(&path, source).unwrap();

    let preview = send(
        &app,
        "POST",
        &format!("/api/workspaces/{workspace_id}/vault-syncs/preview"),
        None,
        &token,
    )
    .await;
    assert_eq!(preview.status(), StatusCode::CREATED);
    let preview = response_json(preview).await;
    assert_eq!(preview["items"][0]["status"], "invalid");
    assert_eq!(
        preview["items"][0]["message"],
        "Invalid value for Notes property"
    );

    let unchanged = send(
        &app,
        "GET",
        &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
        None,
        &token,
    )
    .await;
    let unchanged = response_json(unchanged).await;
    assert_eq!(unchanged["title"], "Canonical title");
    assert_eq!(unchanged["custom_properties"][0]["value"], "Original");
}

#[sqlx::test(migrations = "./migrations")]
async fn property_change_after_preview_does_not_partially_apply_a_task(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "atomic-property-sync@example.com").await;
    let property = create(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/properties"),
        json!({"name": "Notes", "type": "text"}),
    )
    .await;
    let property_id: Uuid = property["id"].as_str().unwrap().parse().unwrap();
    let task = create(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/tasks"),
        json!({"title": "Canonical title"}),
    )
    .await;
    let task_id = task["id"].as_str().unwrap();
    let set = send(
        &app,
        "PUT",
        &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/properties/{property_id}"),
        Some(json!({"value": "Original"})),
        &token,
    )
    .await;
    assert_eq!(set.status(), StatusCode::OK);
    let path = task_path(
        &data_dir,
        workspace_id,
        None,
        task["storage_name"].as_str().unwrap(),
    );
    let source = fs::read_to_string(&path)
        .unwrap()
        .replace("Title: Canonical title", "Title: External title")
        .replace("Notes: Original", "Notes: Updated");
    fs::write(&path, source).unwrap();

    let preview = send(
        &app,
        "POST",
        &format!("/api/workspaces/{workspace_id}/vault-syncs/preview"),
        None,
        &token,
    )
    .await;
    let preview = response_json(preview).await;
    assert_eq!(preview["items"][0]["status"], "valid");

    sqlx::query(
        "UPDATE custom_property_definitions SET archived_at = now() WHERE workspace_id = $1 AND id = $2",
    )
    .bind(workspace_id)
    .bind(property_id)
    .execute(&pool)
    .await
    .unwrap();

    let applied = send(
        &app,
        "POST",
        &format!(
            "/api/workspaces/{workspace_id}/vault-syncs/{}/apply",
            preview["id"].as_str().unwrap()
        ),
        Some(json!({"revision": preview["revision"], "task_ids": [task_id]})),
        &token,
    )
    .await;
    assert_eq!(applied.status(), StatusCode::OK);
    assert_eq!(response_json(applied).await["state"], "failed");

    let task = send(
        &app,
        "GET",
        &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
        None,
        &token,
    )
    .await;
    let task = response_json(task).await;
    assert_eq!(task["title"], "Canonical title");
    assert_eq!(task["custom_properties"][0]["value"], "Original");
}

#[sqlx::test(migrations = "./migrations")]
async fn stale_selected_file_prevents_every_selected_change(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "stale-sync@example.com").await;
    let tasks_uri = format!("/api/workspaces/{workspace_id}/tasks");
    let first = create(&app, &token, &tasks_uri, json!({"title": "First"})).await;
    let second = create(&app, &token, &tasks_uri, json!({"title": "Second"})).await;
    let first_path = task_path(
        &data_dir,
        workspace_id,
        None,
        first["storage_name"].as_str().unwrap(),
    );
    let second_path = task_path(
        &data_dir,
        workspace_id,
        None,
        second["storage_name"].as_str().unwrap(),
    );
    fs::write(
        &first_path,
        fs::read_to_string(&first_path)
            .unwrap()
            .replace("Title: First", "Title: First external"),
    )
    .unwrap();
    fs::write(
        &second_path,
        fs::read_to_string(&second_path)
            .unwrap()
            .replace("Title: Second", "Title: Second external"),
    )
    .unwrap();
    let preview = send(
        &app,
        "POST",
        &format!("/api/workspaces/{workspace_id}/vault-syncs/preview"),
        None,
        &token,
    )
    .await;
    let preview = response_json(preview).await;
    fs::write(
        &first_path,
        format!(
            "{}\nchanged after preview\n",
            fs::read_to_string(&first_path).unwrap()
        ),
    )
    .unwrap();

    let applied = send(
        &app,
        "POST",
        &format!(
            "/api/workspaces/{workspace_id}/vault-syncs/{}/apply",
            preview["id"].as_str().unwrap()
        ),
        Some(json!({
            "revision": preview["revision"],
            "task_ids": [first["id"].clone(), second["id"].clone()]
        })),
        &token,
    )
    .await;
    assert_eq!(applied.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(applied).await["error"]["code"],
        "stale_preview"
    );
    let titles: Vec<String> =
        sqlx::query_scalar("SELECT title FROM tasks WHERE workspace_id = $1 ORDER BY title")
            .bind(workspace_id)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(titles, ["First", "Second"]);
}

#[sqlx::test(migrations = "./migrations")]
async fn sync_is_admin_only_and_operations_are_actor_scoped(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, workspace_id) = register(&app, "sync-owner@example.com").await;
    let (admin_token, admin_id, _) = register(&app, "sync-admin@example.com").await;
    let (member_token, member_id, _) = register(&app, "sync-member@example.com").await;
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

    let preview = send(
        &app,
        "POST",
        &format!("/api/workspaces/{workspace_id}/vault-syncs/preview"),
        None,
        &owner_token,
    )
    .await;
    let preview = response_json(preview).await;
    let guessed = send(
        &app,
        "GET",
        &format!(
            "/api/workspaces/{workspace_id}/vault-syncs/{}",
            preview["id"].as_str().unwrap()
        ),
        None,
        &admin_token,
    )
    .await;
    assert_eq!(guessed.status(), StatusCode::NOT_FOUND);
    let owner_get = send(
        &app,
        "GET",
        &format!(
            "/api/workspaces/{workspace_id}/vault-syncs/{}",
            preview["id"].as_str().unwrap()
        ),
        None,
        &owner_token,
    )
    .await;
    assert_eq!(owner_get.status(), StatusCode::OK);
    let denied = send(
        &app,
        "POST",
        &format!("/api/workspaces/{workspace_id}/vault-syncs/preview"),
        None,
        &member_token,
    )
    .await;
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    let canceled = send(
        &app,
        "DELETE",
        &format!(
            "/api/workspaces/{workspace_id}/vault-syncs/{}",
            preview["id"].as_str().unwrap()
        ),
        None,
        &owner_token,
    )
    .await;
    assert_eq!(canceled.status(), StatusCode::NO_CONTENT);
}

#[sqlx::test(migrations = "./migrations")]
async fn preview_reports_missing_moved_duplicate_unknown_and_unmanaged_files(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let (token, _, workspace_id) = register(&app, "scan-owner@example.com").await;
    let project = create(
        &app,
        &token,
        &format!("/api/workspaces/{workspace_id}/projects"),
        json!({"name": "Destination"}),
    )
    .await;
    let tasks_uri = format!("/api/workspaces/{workspace_id}/tasks");
    let missing = create(&app, &token, &tasks_uri, json!({"title": "Missing"})).await;
    let moved = create(&app, &token, &tasks_uri, json!({"title": "Moved"})).await;
    let duplicate = create(&app, &token, &tasks_uri, json!({"title": "Duplicate"})).await;
    let invalid = create(
        &app,
        &token,
        &tasks_uri,
        json!({"title": "Invalid vocabulary"}),
    )
    .await;
    let todo = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Todo");
    fs::remove_file(task_path(
        &data_dir,
        workspace_id,
        None,
        missing["storage_name"].as_str().unwrap(),
    ))
    .unwrap();
    let moved_source = task_path(
        &data_dir,
        workspace_id,
        None,
        moved["storage_name"].as_str().unwrap(),
    );
    let moved_destination = task_path(
        &data_dir,
        workspace_id,
        project["storage_name"].as_str(),
        moved["storage_name"].as_str().unwrap(),
    );
    fs::create_dir_all(moved_destination.parent().unwrap()).unwrap();
    fs::rename(moved_source, moved_destination).unwrap();
    let duplicate_source = task_path(
        &data_dir,
        workspace_id,
        None,
        duplicate["storage_name"].as_str().unwrap(),
    );
    fs::copy(&duplicate_source, todo.join("duplicate-copy--abcdef.md")).unwrap();
    let invalid_path = task_path(
        &data_dir,
        workspace_id,
        None,
        invalid["storage_name"].as_str().unwrap(),
    );
    fs::write(
        &invalid_path,
        fs::read_to_string(&invalid_path)
            .unwrap()
            .replace("State:\n  - Todo", "State:\n  - Does not exist"),
    )
    .unwrap();
    let unknown_id = Uuid::new_v4();
    fs::write(
        todo.join("unknown--123456.md"),
        fs::read_to_string(&duplicate_source)
            .unwrap()
            .replace(duplicate["id"].as_str().unwrap(), &unknown_id.to_string()),
    )
    .unwrap();
    fs::write(todo.join("notes.txt"), "not managed").unwrap();

    let preview = send(
        &app,
        "POST",
        &format!("/api/workspaces/{workspace_id}/vault-syncs/preview"),
        None,
        &token,
    )
    .await;
    assert_eq!(preview.status(), StatusCode::CREATED);
    let preview = response_json(preview).await;
    let statuses = preview["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| {
            (
                item["task_id"].as_str().unwrap().to_owned(),
                item["status"].as_str().unwrap().to_owned(),
            )
        })
        .collect::<HashMap<_, _>>();
    assert_eq!(statuses[missing["id"].as_str().unwrap()], "missing");
    assert_eq!(statuses[moved["id"].as_str().unwrap()], "moved");
    assert_eq!(statuses[duplicate["id"].as_str().unwrap()], "duplicate");
    assert_eq!(statuses[invalid["id"].as_str().unwrap()], "invalid");
    let issue_kinds = preview["issues"]
        .as_array()
        .unwrap()
        .iter()
        .map(|issue| issue["kind"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert!(issue_kinds.contains(&"unknown_task"));
    assert!(issue_kinds.contains(&"unmanaged_entry"));
}

#[sqlx::test(migrations = "./migrations")]
async fn startup_recovery_fails_interrupted_syncs_and_removes_expired_previews(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "recovery-owner@example.com").await;
    let preview = send(
        &app,
        "POST",
        &format!("/api/workspaces/{workspace_id}/vault-syncs/preview"),
        None,
        &token,
    )
    .await;
    let preview = response_json(preview).await;
    let operation_id: Uuid = preview["id"].as_str().unwrap().parse().unwrap();
    sqlx::query("UPDATE workspace_operations SET state = 'applying' WHERE id = $1")
        .bind(operation_id)
        .execute(&pool)
        .await
        .unwrap();
    recover_workspace_operations(&pool).await.unwrap();
    let recovered = send(
        &app,
        "GET",
        &format!("/api/workspaces/{workspace_id}/vault-syncs/{operation_id}"),
        None,
        &token,
    )
    .await;
    let recovered = response_json(recovered).await;
    assert_eq!(recovered["state"], "failed");
    assert_eq!(
        recovered["error"],
        "Vault sync was interrupted; create a new preview"
    );

    sqlx::query("UPDATE workspace_operations SET expires_at = now() - interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    recover_workspace_operations(&pool).await.unwrap();
    let missing = send(
        &app,
        "GET",
        &format!("/api/workspaces/{workspace_id}/vault-syncs/{operation_id}"),
        None,
        &token,
    )
    .await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
}
