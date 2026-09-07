#![cfg(feature = "postgres-tests")]

use std::{
    fs,
    io::{Cursor, Read, Write},
    time::Duration,
};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use http::HeaderValue;
use kanleaf_server::{AppState, portability::recover_import_operations, router};
use serde_json::{Value, json};
use sqlx::PgPool;
use tempfile::TempDir;
use tower::ServiceExt;
use uuid::Uuid;
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

fn test_app(pool: PgPool, data_dir: &TempDir) -> Router {
    router(
        AppState::new(pool, data_dir.path().to_owned(), Duration::from_secs(3600)),
        vec![HeaderValue::from_static("http://127.0.0.1:1420")],
    )
}

async fn send_json(
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

async fn register_account(app: &Router, email: &str) -> (String, Uuid) {
    let response = send_json(
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
    (token, user_id)
}

async fn register(app: &Router, email: &str) -> (String, Uuid, Uuid) {
    let (token, user_id) = register_account(app, email).await;
    let setup = send_json(
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
    let completed = send_json(app, "POST", "/api/account/setup/complete", None, &token).await;
    assert_eq!(completed.status(), StatusCode::OK);
    (token, user_id, workspace_id)
}

async fn create(app: &Router, token: &str, uri: &str, body: Value) -> Value {
    let response = send_json(app, "POST", uri, Some(body), token).await;
    assert_eq!(response.status(), StatusCode::CREATED, "{uri}");
    response_json(response).await
}

async fn get_json(app: &Router, token: &str, uri: &str) -> Value {
    let response = send_json(app, "GET", uri, None, token).await;
    assert_eq!(response.status(), StatusCode::OK, "{uri}");
    response_json(response).await
}

async fn save_document(app: &Router, token: &str, uri: &str, content: &str) {
    let opened = get_json(app, token, uri).await;
    let response = send_json(
        app,
        "PUT",
        uri,
        Some(json!({"content": content, "base_revision": opened["revision"]})),
        token,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
}

async fn export_workspace(app: &Router, token: &str, workspace_id: Uuid) -> Vec<u8> {
    let response = send_json(
        app,
        "POST",
        &format!("/api/workspaces/{workspace_id}/exports"),
        None,
        token,
    )
    .await;
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let started = response_json(response).await;
    let id = started["id"].as_str().unwrap();
    let ready = wait_for_operation(
        app,
        token,
        &format!("/api/workspace-exports/{id}"),
        "preparing",
    )
    .await;
    assert_eq!(ready["state"], "ready", "{ready:#}");
    let response = send_json(
        app,
        "GET",
        ready["download_url"].as_str().unwrap(),
        None,
        token,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    to_bytes(response.into_body(), 64 * 1024 * 1024)
        .await
        .unwrap()
        .to_vec()
}

async fn wait_for_operation(app: &Router, token: &str, uri: &str, pending_state: &str) -> Value {
    for _ in 0..200 {
        let operation = get_json(app, token, uri).await;
        if operation["state"] != pending_state {
            return operation;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("operation did not finish");
}

async fn preview_import(app: &Router, token: &str, archive: &[u8]) -> Value {
    let boundary = "kanleaf-test-boundary";
    let mut body = Vec::new();
    write!(
        body,
        "--{boundary}\r\nContent-Disposition: form-data; name=\"archive\"; filename=\"workspace.kanleaf.zip\"\r\nContent-Type: application/zip\r\n\r\n"
    )
    .unwrap();
    body.extend_from_slice(archive);
    write!(body, "\r\n--{boundary}--\r\n").unwrap();
    let request = Request::builder()
        .method("POST")
        .uri("/api/workspace-imports/preview")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await
}

async fn apply_import(app: &Router, token: &str, preview: &Value) -> Value {
    let response = send_json(
        app,
        "POST",
        &format!(
            "/api/workspace-imports/{}/apply",
            preview["id"].as_str().unwrap()
        ),
        Some(json!({"revision": preview["revision"]})),
        token,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    response_json(response).await
}

#[sqlx::test(migrations = "./migrations")]
async fn account_details_are_required_before_import_apply(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (source_token, _, source_workspace_id) = register(&app, "source@example.com").await;
    let archive = export_workspace(&app, &source_token, source_workspace_id).await;
    let (importer_token, importer_id) = register_account(&app, "importer@example.com").await;
    let preview = preview_import(&app, &importer_token, &archive).await;
    assert_eq!(preview["state"], "ready", "{preview:#}");

    let rejected = send_json(
        &app,
        "POST",
        &format!(
            "/api/workspace-imports/{}/apply",
            preview["id"].as_str().unwrap()
        ),
        Some(json!({"revision": preview["revision"]})),
        &importer_token,
    )
    .await;
    assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let imported_memberships: i64 =
        sqlx::query_scalar("SELECT count(*) FROM workspace_memberships WHERE user_id = $1")
            .bind(importer_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let account: (String, Option<Uuid>) =
        sqlx::query_as("SELECT setup_stage, active_workspace_id FROM users WHERE id = $1")
            .bind(importer_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let operation: (String, Option<Uuid>) = sqlx::query_as(
        "SELECT state, (result->>'target_workspace_id')::uuid FROM workspace_operations WHERE id = $1",
    )
    .bind(preview["id"].as_str().unwrap().parse::<Uuid>().unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(imported_memberships, 0);
    assert_eq!(account, ("account".to_owned(), None));
    assert_eq!(operation, ("ready".to_owned(), None));
}

#[sqlx::test(migrations = "./migrations")]
async fn export_import_round_trip_remaps_ids_and_preserves_portable_content(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (source_token, source_owner_id, source_workspace_id) =
        register(&app, "source-owner@example.com").await;
    let (_, source_member_id, _) = register(&app, "source-member@example.com").await;
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')",
    )
    .bind(source_workspace_id)
    .bind(source_member_id)
    .execute(&pool)
    .await
    .unwrap();
    let project = create(
        &app,
        &source_token,
        &format!("/api/workspaces/{source_workspace_id}/projects"),
        json!({"name": "Portable"}),
    )
    .await;
    let project_id = project["id"].as_str().unwrap();
    let configuration = get_json(
        &app,
        &source_token,
        &format!("/api/workspaces/{source_workspace_id}/task-configuration"),
    )
    .await;
    let label = create(
        &app,
        &source_token,
        &format!("/api/workspaces/{source_workspace_id}/labels"),
        json!({"name": "Portable", "color": "#336699", "description": "Round trip"}),
    )
    .await;
    let cycle = create(
        &app,
        &source_token,
        &format!("/api/workspaces/{source_workspace_id}/projects/{project_id}/cycles"),
        json!({"name": "September", "start_date": "2026-09-01", "due_date": "2026-09-30"}),
    )
    .await;
    let module = create(
        &app,
        &source_token,
        &format!("/api/workspaces/{source_workspace_id}/projects/{project_id}/modules"),
        json!({"name": "Vault", "description": "Portable files"}),
    )
    .await;
    let property = create(
        &app,
        &source_token,
        &format!("/api/workspaces/{source_workspace_id}/properties"),
        json!({
            "name": "Impact",
            "type": "single_select",
            "description": "Portable custom metadata",
            "options": [{"name": "High", "color": "#EF4444"}]
        }),
    )
    .await;
    let root_task = create(
        &app,
        &source_token,
        &format!("/api/workspaces/{source_workspace_id}/tasks"),
        json!({
            "title": "Export root",
            "project_id": project_id,
            "priority": "high",
            "state_id": configuration["default_state_id"],
            "task_type_id": configuration["default_task_type_id"],
            "assignee_ids": [source_owner_id],
            "label_ids": [label["id"]],
            "cycle_id": cycle["id"],
            "module_ids": [module["id"]],
            "start_date": "2026-09-02",
            "due_date": "2026-09-09",
            "estimate": 5
        }),
    )
    .await;
    let child_task = create(
        &app,
        &source_token,
        &format!("/api/workspaces/{source_workspace_id}/tasks"),
        json!({
            "title": "Export child",
            "project_id": project_id,
            "parent_id": root_task["id"]
        }),
    )
    .await;
    let property_value = send_json(
        &app,
        "PUT",
        &format!(
            "/api/workspaces/{source_workspace_id}/tasks/{}/properties/{}",
            root_task["id"].as_str().unwrap(),
            property["id"].as_str().unwrap()
        ),
        Some(json!({"value": property["options"][0]["id"]})),
        &source_token,
    )
    .await;
    assert_eq!(property_value.status(), StatusCode::OK);
    let relation = send_json(
        &app,
        "POST",
        &format!(
            "/api/workspaces/{source_workspace_id}/tasks/{}/relations",
            root_task["id"].as_str().unwrap()
        ),
        Some(json!({"task_id": child_task["id"], "relation_type": "blocking"})),
        &source_token,
    )
    .await;
    assert_eq!(relation.status(), StatusCode::CREATED);

    save_document(
        &app,
        &source_token,
        &format!(
            "/api/workspaces/{source_workspace_id}/tasks/{}/document",
            root_task["id"].as_str().unwrap()
        ),
        "# Durable body\n\n[[Architecture]]\n",
    )
    .await;
    let task_path = data_dir
        .path()
        .join("vaults")
        .join(source_workspace_id.to_string())
        .join("Projects")
        .join(project["storage_name"].as_str().unwrap())
        .join("Todo")
        .join(format!(
            "{}.md",
            root_task["storage_name"].as_str().unwrap()
        ));
    let task_source = fs::read_to_string(&task_path).unwrap();
    let task_source = task_source.replacen(
        "\n---\n\n# Durable body",
        "\nCustom property: keep me\n---\n\n# Durable body",
        1,
    );
    fs::write(&task_path, task_source).unwrap();

    let root_note = create(
        &app,
        &source_token,
        &format!("/api/workspaces/{source_workspace_id}/documents"),
        json!({"title": "Architecture", "project_id": project_id}),
    )
    .await;
    let child_note = create(
        &app,
        &source_token,
        &format!("/api/workspaces/{source_workspace_id}/documents"),
        json!({
            "title": "Storage",
            "project_id": project_id,
            "parent_id": root_note["id"]
        }),
    )
    .await;
    save_document(
        &app,
        &source_token,
        &format!(
            "/api/workspaces/{source_workspace_id}/documents/{}/content",
            child_note["id"].as_str().unwrap()
        ),
        "# Storage\n\nNormal Markdown.\n",
    )
    .await;
    create(
        &app,
        &source_token,
        &format!("/api/workspaces/{source_workspace_id}/views"),
        json!({
            "name": "Portable work",
            "visibility": "shared",
            "project_id": project_id,
            "layout": "board",
            "query": {
                "version": 1,
                "scope": {"kind": "project", "project_id": project_id},
                "filters": {
                    "labels": {"values": [label["id"]]},
                    "cycles": {"values": [cycle["id"]]},
                    "modules": {"values": [module["id"]]},
                    "assignees": {"values": [source_owner_id]}
                },
                "grouping": {"primary": "state"},
                "sort": [],
                "display": ["state", "labels"],
                "include_completed": false
            }
        }),
    )
    .await;

    let archive = export_workspace(&app, &source_token, source_workspace_id).await;
    let (importer_token, importer_id, importer_personal_workspace) =
        register(&app, "importer@example.com").await;
    let preview = preview_import(&app, &importer_token, &archive).await;
    assert_eq!(preview["state"], "ready", "{preview:#}");
    assert_eq!(preview["summary"]["projects"], 1);
    assert_eq!(preview["summary"]["tasks"], 2);
    assert_eq!(preview["summary"]["documents"], 2);
    assert_eq!(preview["summary"]["shared_views"], 1);
    assert_eq!(preview["summary"]["excluded_member_references"], 2);
    assert_eq!(preview["summary"]["excluded_assignee_references"], 1);

    let imported = apply_import(&app, &importer_token, &preview).await;
    assert_eq!(imported["state"], "completed", "{imported:#}");
    let imported_workspace_id: Uuid = imported["workspace_id"].as_str().unwrap().parse().unwrap();
    assert_ne!(imported_workspace_id, source_workspace_id);
    assert_ne!(imported_workspace_id, importer_personal_workspace);
    let imported_identifier: String =
        sqlx::query_scalar("SELECT identifier FROM workspaces WHERE id = $1")
            .bind(imported_workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        imported_identifier,
        format!("workspace-{}", imported_workspace_id.simple())
    );
    let member: (Uuid, String) =
        sqlx::query_as("SELECT user_id, role FROM workspace_memberships WHERE workspace_id = $1")
            .bind(imported_workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(member, (importer_id, "owner".to_owned()));

    let imported_project: (Uuid, String) =
        sqlx::query_as("SELECT id, storage_name FROM projects WHERE workspace_id = $1")
            .bind(imported_workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_ne!(imported_project.0.to_string(), project_id);
    assert_eq!(imported_project.1, project["storage_name"]);
    let imported_tasks: Vec<(Uuid, String, String)> = sqlx::query_as(
        "SELECT id, title, storage_name FROM tasks WHERE workspace_id = $1 ORDER BY task_number",
    )
    .bind(imported_workspace_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(imported_tasks.len(), 2);
    assert_ne!(imported_tasks[0].0.to_string(), root_task["id"]);
    let imported_task_path = data_dir
        .path()
        .join("vaults")
        .join(imported_workspace_id.to_string())
        .join("Projects")
        .join(&imported_project.1)
        .join("Todo")
        .join(format!("{}.md", imported_tasks[0].2));
    let imported_source = fs::read_to_string(imported_task_path).unwrap();
    assert!(imported_source.contains("Custom property: keep me"));
    assert!(imported_source.contains("Impact: High"));
    assert!(imported_source.contains("[[Architecture]]"));
    assert!(imported_source.contains(&format!("Kanleaf ID: {}", imported_tasks[0].0)));
    assert!(!imported_source.contains(root_task["id"].as_str().unwrap()));

    let imported_properties = get_json(
        &app,
        &importer_token,
        &format!("/api/workspaces/{imported_workspace_id}/properties"),
    )
    .await;
    assert_eq!(imported_properties.as_array().unwrap().len(), 1);
    assert_eq!(imported_properties[0]["name"], "Impact");
    assert_ne!(imported_properties[0]["id"], property["id"]);
    assert_ne!(
        imported_properties[0]["options"][0]["id"],
        property["options"][0]["id"]
    );
    let imported_task = get_json(
        &app,
        &importer_token,
        &format!(
            "/api/workspaces/{imported_workspace_id}/tasks/{}",
            imported_tasks[0].0
        ),
    )
    .await;
    assert_eq!(
        imported_task["custom_properties"][0]["property_id"],
        imported_properties[0]["id"]
    );
    assert_eq!(
        imported_task["custom_properties"][0]["value"],
        imported_properties[0]["options"][0]["id"]
    );

    let counts: (i64, i64, i64, i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT
            (SELECT count(*) FROM task_relations WHERE workspace_id = $1),
            (SELECT count(*) FROM task_assignees WHERE workspace_id = $1),
            (SELECT count(*) FROM task_label_assignments WHERE workspace_id = $1),
            (SELECT count(*) FROM task_cycle_assignments WHERE workspace_id = $1),
            (SELECT count(*) FROM task_module_assignments WHERE workspace_id = $1),
            (SELECT count(*) FROM saved_views WHERE workspace_id = $1)
        "#,
    )
    .bind(imported_workspace_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(counts, (1, 0, 1, 1, 1, 1));
    let documents: Vec<(String, i64, Option<Uuid>)> = sqlx::query_as(
        "SELECT title, document_number, parent_id FROM documents WHERE workspace_id = $1 ORDER BY document_number",
    )
    .bind(imported_workspace_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(documents.len(), 2);
    assert!(
        documents
            .iter()
            .any(|(title, _, parent)| title == "Storage" && parent.is_some())
    );
    assert_eq!(
        documents
            .iter()
            .map(|(_, number, _)| *number)
            .collect::<Vec<_>>(),
        [1, 2]
    );
    let next_document_number: i64 =
        sqlx::query_scalar("SELECT next_document_number FROM workspaces WHERE id = $1")
            .bind(imported_workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(next_document_number, 3);
    let view_query: Value =
        sqlx::query_scalar("SELECT query FROM saved_views WHERE workspace_id = $1")
            .bind(imported_workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        view_query["scope"]["project_id"],
        imported_project.0.to_string()
    );
    assert!(
        view_query["filters"]["assignees"]["values"]
            .as_array()
            .unwrap()
            .is_empty()
    );

    let second_preview = preview_import(&app, &importer_token, &archive).await;
    let second = apply_import(&app, &importer_token, &second_preview).await;
    assert_eq!(second["state"], "completed", "{second:#}");
    assert_ne!(second["workspace_id"], imported["workspace_id"]);
}

#[sqlx::test(migrations = "./migrations")]
async fn document_numbers_are_validated_and_legacy_archives_receive_stable_numbers(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (source_token, _, source_workspace_id) = register(&app, "pages-source@example.com").await;
    for title in ["First page", "Second page"] {
        create(
            &app,
            &source_token,
            &format!("/api/workspaces/{source_workspace_id}/documents"),
            json!({"title": title}),
        )
        .await;
    }
    let archive = export_workspace(&app, &source_token, source_workspace_id).await;
    let (importer_token, _, _) = register(&app, "pages-importer@example.com").await;

    let missing_number = rewrite_archive(&archive, |path, content| {
        if path != ".kanleaf/manifest.json" {
            return content;
        }
        let mut manifest: Value = serde_json::from_slice(&content).unwrap();
        manifest["source"]["documents"][0]
            .as_object_mut()
            .unwrap()
            .remove("number");
        serde_json::to_vec_pretty(&manifest).unwrap()
    });
    let rejected = preview_import(&app, &importer_token, &missing_number).await;
    assert_eq!(rejected["state"], "failed");
    assert_eq!(rejected["error"]["code"], "invalid_metadata");

    let duplicate_number = rewrite_archive(&archive, |path, content| {
        if path != ".kanleaf/manifest.json" {
            return content;
        }
        let mut manifest: Value = serde_json::from_slice(&content).unwrap();
        let number = manifest["source"]["documents"][0]["number"].clone();
        manifest["source"]["documents"][1]["number"] = number;
        serde_json::to_vec_pretty(&manifest).unwrap()
    });
    let rejected = preview_import(&app, &importer_token, &duplicate_number).await;
    assert_eq!(rejected["state"], "failed");
    assert_eq!(rejected["error"]["code"], "invalid_metadata");

    let legacy_archive = rewrite_archive(&archive, |path, content| {
        if path != ".kanleaf/manifest.json" {
            return content;
        }
        let mut manifest: Value = serde_json::from_slice(&content).unwrap();
        assert_eq!(manifest["source"]["format_version"], 2);
        let mut numbers = manifest["source"]["documents"]
            .as_array()
            .unwrap()
            .iter()
            .map(|document| document["number"].as_i64().unwrap())
            .collect::<Vec<_>>();
        numbers.sort_unstable();
        assert_eq!(numbers, [1, 2]);
        manifest["source"]["format_version"] = json!(1);
        for document in manifest["source"]["documents"].as_array_mut().unwrap() {
            document.as_object_mut().unwrap().remove("number");
        }
        serde_json::to_vec_pretty(&manifest).unwrap()
    });
    let preview = preview_import(&app, &importer_token, &legacy_archive).await;
    assert_eq!(preview["state"], "ready", "{preview:#}");
    let imported = apply_import(&app, &importer_token, &preview).await;
    let imported_workspace_id: Uuid = imported["workspace_id"].as_str().unwrap().parse().unwrap();
    let numbers: Vec<i64> = sqlx::query_scalar(
        "SELECT document_number FROM documents WHERE workspace_id = $1 ORDER BY document_number",
    )
    .bind(imported_workspace_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(numbers, [1, 2]);
    let next_number: i64 =
        sqlx::query_scalar("SELECT next_document_number FROM workspaces WHERE id = $1")
            .bind(imported_workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(next_number, 3);
}

#[sqlx::test(migrations = "./migrations")]
async fn preview_rejects_traversal_checksum_tampering_and_newer_schema(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (source_token, _, workspace_id) = register(&app, "malicious-source@example.com").await;
    create(
        &app,
        &source_token,
        &format!("/api/workspaces/{workspace_id}/tasks"),
        json!({"title": "Archive payload"}),
    )
    .await;
    let archive = export_workspace(&app, &source_token, workspace_id).await;
    let (importer_token, _, _) = register(&app, "malicious-importer@example.com").await;
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM workspaces")
        .fetch_one(&pool)
        .await
        .unwrap();

    let traversal = archive_with_extra(&archive, "../outside.md", b"escape");
    let traversal_preview = preview_import(&app, &importer_token, &traversal).await;
    assert_eq!(traversal_preview["state"], "failed");
    assert_eq!(traversal_preview["error"]["code"], "unsafe_archive_entry");
    assert!(!data_dir.path().join("outside.md").exists());

    let tampered = rewrite_archive(&archive, |path, content| {
        if path.ends_with(".md") {
            b"tampered".to_vec()
        } else {
            content
        }
    });
    let tampered_preview = preview_import(&app, &importer_token, &tampered).await;
    assert_eq!(tampered_preview["state"], "failed");
    assert_eq!(tampered_preview["error"]["code"], "checksum_mismatch");

    let newer = rewrite_archive(&archive, |path, content| {
        if path == ".kanleaf/manifest.json" {
            let mut manifest: Value = serde_json::from_slice(&content).unwrap();
            manifest["format_version"] = json!(99);
            serde_json::to_vec_pretty(&manifest).unwrap()
        } else {
            content
        }
    });
    let newer_preview = preview_import(&app, &importer_token, &newer).await;
    assert_eq!(newer_preview["state"], "failed");
    assert_eq!(newer_preview["error"]["code"], "unsupported_schema");

    let after: i64 = sqlx::query_scalar("SELECT count(*) FROM workspaces")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(before, after);
    let guessed = send_json(
        &app,
        "GET",
        &format!(
            "/api/workspace-imports/{}",
            newer_preview["id"].as_str().unwrap()
        ),
        None,
        &source_token,
    )
    .await;
    assert_eq!(guessed.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test(migrations = "./migrations")]
async fn startup_recovery_cleans_interrupted_and_expired_import_storage(pool: PgPool) {
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
    let (_, actor_id, existing_workspace_id) = register(&app, "recovery@example.com").await;

    let preparing_id = Uuid::new_v4();
    let preparing_key = Uuid::new_v4();
    let orphan_id = Uuid::new_v4();
    let orphan_key = Uuid::new_v4();
    let orphan_workspace_id = Uuid::new_v4();
    let completed_id = Uuid::new_v4();
    let completed_key = Uuid::new_v4();
    let expired_id = Uuid::new_v4();
    let expired_key = Uuid::new_v4();
    for key in [preparing_key, orphan_key, completed_key, expired_key] {
        fs::create_dir_all(
            data_dir
                .path()
                .join("operations")
                .join(format!("import-{key}"))
                .join("vault"),
        )
        .unwrap();
    }
    fs::create_dir_all(
        data_dir
            .path()
            .join("vaults")
            .join(orphan_workspace_id.to_string()),
    )
    .unwrap();
    fs::create_dir_all(
        data_dir
            .path()
            .join("vaults")
            .join(existing_workspace_id.to_string()),
    )
    .unwrap();

    let operations = [
        (preparing_id, "preparing", preparing_key, None, "30 minutes"),
        (
            orphan_id,
            "applying",
            orphan_key,
            Some(orphan_workspace_id),
            "30 minutes",
        ),
        (
            completed_id,
            "applying",
            completed_key,
            Some(existing_workspace_id),
            "30 minutes",
        ),
        (expired_id, "ready", expired_key, None, "-1 minute"),
    ];
    for (id, operation_state, staging_key, target_workspace_id, ttl) in operations {
        sqlx::query(
            r#"
            INSERT INTO workspace_operations (
                id, actor_id, kind, state, revision, result, staging_key, expires_at
            ) VALUES (
                $1, $2, 'workspace_import', $3, $4, $5, $6,
                now() + $7::interval
            )
            "#,
        )
        .bind(id)
        .bind(actor_id)
        .bind(operation_state)
        .bind(Uuid::new_v4())
        .bind(json!({
            "summary": null,
            "target_workspace_id": target_workspace_id,
            "error": null,
        }))
        .bind(staging_key)
        .bind(ttl)
        .execute(&pool)
        .await
        .unwrap();
    }

    recover_import_operations(&state).await.unwrap();

    let states: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id, state FROM workspace_operations WHERE id = ANY($1) ORDER BY id")
            .bind(vec![preparing_id, orphan_id, completed_id, expired_id])
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(states.len(), 3);
    assert!(states.contains(&(preparing_id, "failed".to_owned())));
    assert!(states.contains(&(orphan_id, "failed".to_owned())));
    assert!(states.contains(&(completed_id, "completed".to_owned())));
    assert!(
        !data_dir
            .path()
            .join("vaults")
            .join(orphan_workspace_id.to_string())
            .exists()
    );
    for key in [preparing_key, orphan_key, completed_key, expired_key] {
        assert!(
            !data_dir
                .path()
                .join("operations")
                .join(format!("import-{key}"))
                .exists()
        );
    }
}

fn rewrite_archive(source: &[u8], mut rewrite: impl FnMut(&str, Vec<u8>) -> Vec<u8>) -> Vec<u8> {
    let mut archive = ZipArchive::new(Cursor::new(source)).unwrap();
    let mut entries = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).unwrap();
        let name = entry.name().to_owned();
        let mut content = Vec::new();
        entry.read_to_end(&mut content).unwrap();
        entries.push((name, rewrite(entry.name(), content)));
    }
    write_archive(entries)
}

fn archive_with_extra(source: &[u8], path: &str, content: &[u8]) -> Vec<u8> {
    let mut archive = ZipArchive::new(Cursor::new(source)).unwrap();
    let mut entries = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).unwrap();
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).unwrap();
        entries.push((entry.name().to_owned(), bytes));
    }
    entries.push((path.to_owned(), content.to_vec()));
    write_archive(entries)
}

fn write_archive(entries: Vec<(String, Vec<u8>)>) -> Vec<u8> {
    let cursor = Cursor::new(Vec::new());
    let mut archive = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);
    for (path, content) in entries {
        archive.start_file(path, options).unwrap();
        archive.write_all(&content).unwrap();
    }
    archive.finish().unwrap().into_inner()
}
