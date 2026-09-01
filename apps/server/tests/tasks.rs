#![cfg(feature = "postgres-tests")]

use std::{fs, time::Duration};

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use http::HeaderValue;
use kanleaf_server::{
    AppState, domain::VaultStorageName, router, task::recover_projection_jobs,
    workspace::migrate_workspace_vaults,
};
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
    let token = payload["token"].as_str().unwrap().to_owned();
    let user_id = payload["user"]["id"].as_str().unwrap().parse().unwrap();
    let setup = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            "/api/account/setup",
            json!({"display_name": email.split('@').next().unwrap()}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(setup.status(), StatusCode::OK);
    let workspace = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/workspaces",
            json!({"name": "Personal"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(workspace.status(), StatusCode::CREATED);
    let workspace_id = response_json(workspace).await["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    (token, user_id, workspace_id)
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
    assert_eq!(
        task["storage_name"],
        VaultStorageName::from_initial_name("Finish Markdown workflow", task_id).as_str()
    );
    assert_eq!(task["state"]["state_group"], "in_progress");
    assert_eq!(task["task_type"]["name"], "Task");
    assert_eq!(task["priority"], "high");

    let project_storage_name: String =
        sqlx::query_scalar("SELECT storage_name FROM projects WHERE id = $1")
            .bind(project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let task_storage_name = task["storage_name"].as_str().unwrap();
    let project_document_path = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Projects")
        .join(project_storage_name)
        .join("Todo")
        .join(format!("{task_storage_name}.md"));
    let created_source = fs::read_to_string(&project_document_path).unwrap();
    assert!(created_source.contains(&format!("Kanleaf ID: {task_id}\n")));
    assert!(created_source.contains("Project:\n  - Kanleaf\n"));

    let renamed_project = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}"),
            json!({"name": "Kanleaf Core", "identifier": "CORE"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(renamed_project.status(), StatusCode::OK);
    let renamed_source = fs::read_to_string(&project_document_path).unwrap();
    assert!(renamed_source.contains("Reference: CORE-1\n"));
    assert!(renamed_source.contains("Project:\n  - Kanleaf Core\n"));

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
    let document_path = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Todo")
        .join(format!("{task_storage_name}.md"));
    assert!(document_path.exists());
    assert!(!project_document_path.exists());

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
    let opened = response_json(opened).await;
    assert_eq!(opened["projection"]["status"], "saved");
    assert_eq!(
        opened["projection"]["metadata_version"],
        opened["projection"]["projected_metadata_version"]
    );
    let base_revision = opened["revision"].as_str().unwrap().to_owned();
    let metadata_update = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
            json!({"priority": "high"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(metadata_update.status(), StatusCode::OK);
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
    let source = fs::read_to_string(&document_path).unwrap();
    assert!(source.contains("Title: Finish Markdown persistence\n"));
    assert!(source.contains("State:\n  - Done\n"));
    assert!(source.contains("Priority:\n  - High\n"));
    assert!(source.ends_with(markdown));

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
    assert!(
        fs::read_to_string(document_path)
            .unwrap()
            .ends_with(markdown)
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn conflicting_external_properties_are_preserved_and_retry_after_repair(pool: PgPool) {
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
    let (token, _, workspace_id) = register(&app, "projection@example.com").await;
    let task = create_task(
        &app,
        &token,
        workspace_id,
        json!({"title": "Original title"}),
    )
    .await;
    let task_id: Uuid = task["id"].as_str().unwrap().parse().unwrap();
    let path = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Todo")
        .join(format!("{}.md", task["storage_name"].as_str().unwrap()));
    let valid_source = fs::read_to_string(&path).unwrap().replacen(
        "---\n\n",
        "Custom property:\n  nested: keep-me\n---\n\n",
        1,
    );
    let foreign_id = Uuid::new_v4();
    let conflicting_source = valid_source.replacen(
        &format!("Kanleaf ID: {task_id}"),
        &format!("Kanleaf ID: {foreign_id}"),
        1,
    );
    fs::write(&path, &conflicting_source).unwrap();

    let updated = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
            json!({"title": "Canonical title"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    assert_eq!(response_json(updated).await["title"], "Canonical title");
    assert_eq!(fs::read_to_string(&path).unwrap(), conflicting_source);

    let document = app
        .clone()
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/document"),
            &token,
        ))
        .await
        .unwrap();
    let document = response_json(document).await;
    assert_eq!(document["projection"]["status"], "error");
    assert_eq!(
        document["projection"]["message"],
        "Task properties could not be saved; the Markdown body is unchanged"
    );
    let pending: (i64, i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT tasks.metadata_version, tasks.projected_metadata_version,
               jobs.metadata_version, count(*) OVER ()
        FROM tasks
        JOIN task_projection_jobs AS jobs
          ON jobs.workspace_id = tasks.workspace_id AND jobs.task_id = tasks.id
        WHERE tasks.workspace_id = $1 AND tasks.id = $2
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(pending.0 > pending.1);
    assert_eq!(pending.0, pending.2);
    assert_eq!(pending.3, 1);

    fs::write(&path, valid_source).unwrap();
    recover_projection_jobs(&state).await.unwrap();
    let repaired = fs::read_to_string(&path).unwrap();
    assert!(repaired.contains("Title: Canonical title\n"));
    assert!(repaired.contains("Custom property:\n  nested: keep-me\n"));
    let job_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM task_projection_jobs WHERE workspace_id = $1 AND task_id = $2",
    )
    .bind(workspace_id)
    .bind(task_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(job_count, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn metadata_update_survives_temporary_vault_failure(pool: PgPool) {
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
    let (token, _, workspace_id) = register(&app, "storage-retry@example.com").await;
    let task = create_task(
        &app,
        &token,
        workspace_id,
        json!({"title": "Retry projection"}),
    )
    .await;
    let task_id: Uuid = task["id"].as_str().unwrap().parse().unwrap();
    let path = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Todo")
        .join(format!("{}.md", task["storage_name"].as_str().unwrap()));
    let unavailable_path = path.with_extension("md.unavailable");
    fs::rename(&path, &unavailable_path).unwrap();

    let updated = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
            json!({"priority": "urgent"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    assert_eq!(response_json(updated).await["priority"], "urgent");
    let error: Option<String> = sqlx::query_scalar(
        "SELECT projection_error FROM tasks WHERE workspace_id = $1 AND id = $2",
    )
    .bind(workspace_id)
    .bind(task_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(error.as_deref(), Some("storage_unavailable"));

    fs::rename(&unavailable_path, &path).unwrap();
    recover_projection_jobs(&state).await.unwrap();
    assert!(
        fs::read_to_string(&path)
            .unwrap()
            .contains("Priority:\n  - Urgent\n")
    );
    let versions: (i64, i64, Option<String>) = sqlx::query_as(
        r#"
        SELECT metadata_version, projected_metadata_version, projection_error
        FROM tasks WHERE workspace_id = $1 AND id = $2
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(versions.0, versions.1);
    assert!(versions.2.is_none());
}

#[sqlx::test(migrations = "./migrations")]
async fn task_search_treats_sql_wildcards_as_text(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
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
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "owner@example.com").await;
    let project_id = create_project(&app, &token, workspace_id, "Temporary").await;
    let task = create_task(
        &app,
        &token,
        workspace_id,
        json!({"title": "Keep me", "project_id": project_id}),
    )
    .await;
    let project_storage_name: String =
        sqlx::query_scalar("SELECT storage_name FROM projects WHERE id = $1")
            .bind(project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let task_storage_name = task["storage_name"].as_str().unwrap();
    let project_path = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Projects")
        .join(project_storage_name)
        .join("Todo")
        .join(format!("{task_storage_name}.md"));

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
    let inbox_path = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Todo")
        .join(format!("{task_storage_name}.md"));
    let source = fs::read_to_string(inbox_path).unwrap();
    assert!(source.contains("Project: []\n"));
    assert!(!project_path.exists());
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

#[sqlx::test(migrations = "./migrations")]
async fn legacy_workspace_tasks_migrate_to_portable_project_paths(pool: PgPool) {
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
    let (token, _, workspace_id) = register(&app, "owner@example.com").await;
    let project_id = create_project(&app, &token, workspace_id, "Migrated project").await;
    let task = create_task(
        &app,
        &token,
        workspace_id,
        json!({"title": "Legacy Task", "project_id": project_id}),
    )
    .await;
    let document = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/documents"),
            json!({"title": "Architecture", "project_id": project_id}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(document.status(), StatusCode::CREATED);
    let task_id: Uuid = task["id"].as_str().unwrap().parse().unwrap();
    let project_storage_name: String =
        sqlx::query_scalar("SELECT storage_name FROM projects WHERE id = $1")
            .bind(project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let workspace = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string());
    fs::remove_dir_all(workspace.join("Projects")).unwrap();
    fs::create_dir_all(workspace.join("Tasks")).unwrap();
    fs::write(
        workspace.join("Tasks").join(format!("{task_id}.md")),
        "# Legacy body\n\nKeep [[links]].\n",
    )
    .unwrap();
    fs::create_dir_all(workspace.join("Library")).unwrap();
    fs::write(
        workspace.join("Library/architecture.md"),
        "# Legacy project Wiki\n",
    )
    .unwrap();
    sqlx::query("UPDATE workspaces SET vault_layout_version = 0 WHERE id = $1")
        .bind(workspace_id)
        .execute(&pool)
        .await
        .unwrap();

    migrate_workspace_vaults(&state).await.unwrap();
    migrate_workspace_vaults(&state).await.unwrap();

    let version: i16 =
        sqlx::query_scalar("SELECT vault_layout_version FROM workspaces WHERE id = $1")
            .bind(workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(version, 2);
    let source = fs::read_to_string(
        workspace
            .join("Projects")
            .join(&project_storage_name)
            .join("Todo")
            .join(format!("{}.md", task["storage_name"].as_str().unwrap())),
    )
    .unwrap();
    assert!(source.contains(&format!("Kanleaf ID: {task_id}\n")));
    assert!(source.contains("Project:\n  - Migrated project\n"));
    assert!(source.ends_with("# Legacy body\n\nKeep [[links]].\n"));
    assert_eq!(
        fs::read_to_string(
            workspace
                .join("Projects")
                .join(&project_storage_name)
                .join("Wiki/architecture.md")
        )
        .unwrap(),
        "# Legacy project Wiki\n"
    );
    assert!(
        fs::read_dir(data_dir.path().join("vaults"))
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with(&format!("{workspace_id}.legacy-")))
    );
}
