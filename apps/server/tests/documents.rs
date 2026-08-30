#![cfg(feature = "postgres-tests")]

use std::{fs, time::Duration};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use http::HeaderValue;
use kanleaf_server::{AppState, document::migrate_legacy_library, router};
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
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", format!("Bearer {token}"));
    if body.is_some() {
        request = request.header("content-type", "application/json");
    }
    request
        .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
        .unwrap()
}

async fn body(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), 8 * 1024 * 1024)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn register(app: &Router, email: &str) -> (String, Uuid, Uuid) {
    let response = app
        .clone()
        .oneshot(
            Request::post("/api/auth/register")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"email": email, "password": "correct horse battery"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let payload = body(response).await;
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

async fn create_project(app: &Router, token: &str, workspace_id: Uuid, name: &str) -> Uuid {
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects"),
            Some(json!({"name": name})),
            token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    body(response).await["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap()
}

async fn create_document(
    app: &Router,
    token: &str,
    workspace_id: Uuid,
    title: &str,
    project_id: Option<Uuid>,
    parent_id: Option<Uuid>,
) -> Value {
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/documents"),
            Some(json!({
                "title": title,
                "project_id": project_id,
                "parent_id": parent_id,
            })),
            token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    body(response).await
}

#[sqlx::test(migrations = "./migrations")]
async fn document_tree_and_markdown_follow_the_complete_lifecycle(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "owner@example.com").await;
    let project_id = create_project(&app, &token, workspace_id, "Kanleaf").await;
    let root = create_document(
        &app,
        &token,
        workspace_id,
        "Architecture",
        Some(project_id),
        None,
    )
    .await;
    let root_id: Uuid = root["id"].as_str().unwrap().parse().unwrap();
    let child = create_document(
        &app,
        &token,
        workspace_id,
        "Vault",
        Some(project_id),
        Some(root_id),
    )
    .await;
    let child_id: Uuid = child["id"].as_str().unwrap().parse().unwrap();
    let project_storage_name: String =
        sqlx::query_scalar("SELECT storage_name FROM projects WHERE id = $1")
            .bind(project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(root["storage_name"], "architecture");
    assert_eq!(
        root["library_path"],
        format!("Projects/{project_storage_name}/Wiki/architecture.md")
    );
    assert_eq!(child["storage_name"], "vault");
    assert_eq!(
        child["library_path"],
        format!("Projects/{project_storage_name}/Wiki/architecture/vault.md")
    );
    let project_root_path = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Projects")
        .join(&project_storage_name)
        .join("Wiki")
        .join("architecture.md");
    assert_eq!(fs::read_to_string(&project_root_path).unwrap(), "");
    let root_path = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Wiki")
        .join("architecture.md");
    let child_path = root_path
        .parent()
        .unwrap()
        .join("architecture")
        .join("vault.md");

    let content_uri = format!("/api/workspaces/{workspace_id}/documents/{root_id}/content");
    let opened = app
        .clone()
        .oneshot(request("GET", &content_uri, None, &token))
        .await
        .unwrap();
    let opened = body(opened).await;
    let saved = app
        .clone()
        .oneshot(request(
            "PUT",
            &content_uri,
            Some(json!({
                "content": "# Architecture\n\n  Preserve spacing.  \n\nTiếng Việt\n",
                "base_revision": opened["revision"],
            })),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(saved.status(), StatusCode::OK);
    let saved = body(saved).await;
    fs::write(&project_root_path, "external editor change\n").unwrap();
    let conflict = app
        .clone()
        .oneshot(request(
            "PUT",
            &content_uri,
            Some(json!({
                "content": "local stale change",
                "base_revision": saved["revision"],
            })),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    assert_eq!(
        fs::read_to_string(&project_root_path).unwrap(),
        "external editor change\n"
    );

    let moved = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/documents/{root_id}"),
            Some(json!({"project_id": null, "title": "System architecture"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(moved.status(), StatusCode::OK);
    let moved = body(moved).await;
    assert_eq!(moved["title"], "System architecture");
    assert_eq!(moved["storage_name"], "architecture");
    assert_eq!(moved["library_path"], "Wiki/architecture.md");
    assert!(root_path.exists());
    assert!(!project_root_path.exists());
    let child_project: Option<Uuid> =
        sqlx::query_scalar("SELECT project_id FROM documents WHERE id = $1")
            .bind(child_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(child_project, None);

    let cycle = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/documents/{root_id}"),
            Some(json!({"parent_id": child_id})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(cycle.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let second_root =
        create_document(&app, &token, workspace_id, "Release notes", None, None).await;
    let second_root_id: Uuid = second_root["id"].as_str().unwrap().parse().unwrap();
    let reordered = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/documents/reorder"),
            Some(json!({
                "project_id": null,
                "parent_id": null,
                "document_ids": [second_root_id, root_id],
            })),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(reordered.status(), StatusCode::NO_CONTENT);
    let listed = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/documents"),
            None,
            &token,
        ))
        .await
        .unwrap();
    let root_ids = body(listed)
        .await
        .as_array()
        .unwrap()
        .iter()
        .filter(|document| document["parent_id"].is_null())
        .map(|document| document["id"].as_str().unwrap().to_owned())
        .collect::<Vec<_>>();
    assert_eq!(root_ids, [second_root_id.to_string(), root_id.to_string()]);

    let archived = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!("/api/workspaces/{workspace_id}/documents/{root_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(archived.status(), StatusCode::NO_CONTENT);
    let deleted = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/documents/{root_id}/delete"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    assert!(!root_path.exists());
    assert!(!child_path.exists());
}

#[sqlx::test(migrations = "./migrations")]
async fn reparenting_moves_the_portable_markdown_subtree(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let (token, _, workspace_id) = register(&app, "owner@example.com").await;
    let source = create_document(&app, &token, workspace_id, "Source", None, None).await;
    let destination = create_document(&app, &token, workspace_id, "Destination", None, None).await;
    let source_id: Uuid = source["id"].as_str().unwrap().parse().unwrap();
    let destination_id: Uuid = destination["id"].as_str().unwrap().parse().unwrap();
    let child = create_document(
        &app,
        &token,
        workspace_id,
        "Install Guide",
        None,
        Some(source_id),
    )
    .await;
    let child_id: Uuid = child["id"].as_str().unwrap().parse().unwrap();
    let grandchild =
        create_document(&app, &token, workspace_id, "Linux", None, Some(child_id)).await;
    let vault = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Wiki");
    let old_child = vault.join("source/install_guide.md");
    let old_grandchild = vault.join("source/install_guide/linux.md");
    fs::write(&old_child, "# Install\n\nKeep this source.\n").unwrap();
    fs::write(&old_grandchild, "# Linux\n").unwrap();

    let moved = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/documents/{child_id}"),
            Some(json!({
                "title": "Installation",
                "parent_id": destination_id,
            })),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(moved.status(), StatusCode::OK);
    let moved = body(moved).await;
    assert_eq!(moved["storage_name"], "install_guide");
    assert_eq!(moved["library_path"], "Wiki/destination/install_guide.md");
    assert_eq!(
        grandchild["library_path"],
        "Wiki/source/install_guide/linux.md"
    );
    let new_child = vault.join("destination/install_guide.md");
    let new_grandchild = vault.join("destination/install_guide/linux.md");
    assert_eq!(
        fs::read_to_string(&new_child).unwrap(),
        "# Install\n\nKeep this source.\n"
    );
    assert_eq!(fs::read_to_string(&new_grandchild).unwrap(), "# Linux\n");
    assert!(!old_child.exists());
    assert!(!old_grandchild.exists());
    assert!(!vault.join("source").exists());

    let detail = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/documents/{child_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(detail.status(), StatusCode::OK);
    assert_eq!(
        body(detail).await["library_path"],
        "Wiki/destination/install_guide.md"
    );

    let archived = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!("/api/workspaces/{workspace_id}/documents/{child_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(archived.status(), StatusCode::NO_CONTENT);
    let deleted = app
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/documents/{child_id}/delete"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    assert!(!new_child.exists());
    assert!(!new_grandchild.exists());
    assert!(!vault.join("destination").exists());
}

#[sqlx::test(migrations = "./migrations")]
async fn legacy_uuid_pages_migrate_to_deterministic_library_paths(pool: PgPool) {
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
    let root = create_document(&app, &token, workspace_id, "Getting Started", None, None).await;
    let root_id: Uuid = root["id"].as_str().unwrap().parse().unwrap();
    let child = create_document(
        &app,
        &token,
        workspace_id,
        "Installation",
        None,
        Some(root_id),
    )
    .await;
    let child_id: Uuid = child["id"].as_str().unwrap().parse().unwrap();
    let duplicate =
        create_document(&app, &token, workspace_id, "Getting Started", None, None).await;
    let duplicate_id: Uuid = duplicate["id"].as_str().unwrap().parse().unwrap();

    let workspace_vault = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string());
    let library = workspace_vault.join("Wiki");
    let legacy = workspace_vault.join("Pages");
    fs::create_dir_all(&legacy).unwrap();
    for (id, path, content) in [
        (root_id, library.join("getting_started.md"), "# Start\n"),
        (
            child_id,
            library.join("getting_started/installation.md"),
            "# Install\n",
        ),
        (
            duplicate_id,
            library.join("getting_started_2.md"),
            "# Another start\n",
        ),
    ] {
        fs::write(&path, content).unwrap();
        fs::rename(path, legacy.join(format!("{id}.md"))).unwrap();
    }
    fs::remove_dir_all(&library).unwrap();
    for id in [root_id, child_id, duplicate_id] {
        sqlx::query(
            "UPDATE documents SET storage_name = lower(id::text), storage_layout_version = 0 WHERE id = $1",
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    }

    migrate_legacy_library(&state).await.unwrap();
    migrate_legacy_library(&state).await.unwrap();

    let migrated: Vec<(Uuid, String, i16)> = sqlx::query_as(
        "SELECT id, storage_name, storage_layout_version FROM documents WHERE workspace_id = $1 ORDER BY id",
    )
    .bind(workspace_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(migrated.iter().all(|(_, _, version)| *version == 1));
    assert_eq!(
        migrated.iter().find(|(id, _, _)| *id == root_id).unwrap().1,
        "getting_started"
    );
    assert_eq!(
        migrated
            .iter()
            .find(|(id, _, _)| *id == duplicate_id)
            .unwrap()
            .1,
        "getting_started_2"
    );
    assert_eq!(
        fs::read_to_string(library.join("getting_started.md")).unwrap(),
        "# Start\n"
    );
    assert_eq!(
        fs::read_to_string(library.join("getting_started/installation.md")).unwrap(),
        "# Install\n"
    );
    assert_eq!(
        fs::read_to_string(library.join("getting_started_2.md")).unwrap(),
        "# Another start\n"
    );
    assert!(!legacy.exists());
    assert!(
        state
            .vault
            .pending_library_operations()
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn archiving_a_project_preserves_its_pages_as_workspace_documents(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "owner@example.com").await;
    let project_id = create_project(&app, &token, workspace_id, "Archived project").await;
    let root = create_document(
        &app,
        &token,
        workspace_id,
        "Decision log",
        Some(project_id),
        None,
    )
    .await;
    let root_id: Uuid = root["id"].as_str().unwrap().parse().unwrap();
    let child = create_document(
        &app,
        &token,
        workspace_id,
        "ADR 001",
        Some(project_id),
        Some(root_id),
    )
    .await;
    let child_id: Uuid = child["id"].as_str().unwrap().parse().unwrap();
    let project_storage_name: String =
        sqlx::query_scalar("SELECT storage_name FROM projects WHERE id = $1")
            .bind(project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let project_wiki = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Projects")
        .join(project_storage_name)
        .join("Wiki");

    let archived = app
        .oneshot(request(
            "DELETE",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(archived.status(), StatusCode::NO_CONTENT);
    let rows: Vec<(Uuid, Option<Uuid>, Option<Uuid>)> = sqlx::query_as(
        "SELECT id, project_id, parent_id FROM documents WHERE id = ANY($1) ORDER BY id",
    )
    .bind([root_id, child_id])
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(rows.iter().all(|(_, project_id, _)| project_id.is_none()));
    assert_eq!(
        rows.iter().find(|(id, _, _)| *id == child_id).unwrap().2,
        Some(root_id)
    );
    let workspace_wiki = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Wiki");
    assert!(workspace_wiki.join("decision_log.md").exists());
    assert!(workspace_wiki.join("decision_log/adr_001.md").exists());
    assert!(!project_wiki.exists());
}

#[sqlx::test(migrations = "./migrations")]
async fn document_access_follows_project_roles_and_tenant_boundaries(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, workspace_id) = register(&app, "owner@example.com").await;
    let (contributor_token, contributor_id, _) = register(&app, "contributor@example.com").await;
    let (viewer_token, viewer_id, _) = register(&app, "viewer@example.com").await;
    let (outsider_token, _, _) = register(&app, "outsider@example.com").await;
    for (user_id, role) in [(contributor_id, "member"), (viewer_id, "guest")] {
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
    let project_id = create_project(&app, &owner_token, workspace_id, "Private").await;
    for (user_id, role) in [(contributor_id, "contributor"), (viewer_id, "viewer")] {
        sqlx::query(
            "INSERT INTO project_memberships (workspace_id, project_id, user_id, role) VALUES ($1, $2, $3, $4)",
        )
        .bind(workspace_id)
        .bind(project_id)
        .bind(user_id)
        .bind(role)
        .execute(&pool)
        .await
        .unwrap();
    }
    let document = create_document(
        &app,
        &owner_token,
        workspace_id,
        "Private page",
        Some(project_id),
        None,
    )
    .await;
    let document_id = document["id"].as_str().unwrap();

    let viewer_read = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/documents/{document_id}/content"),
            None,
            &viewer_token,
        ))
        .await
        .unwrap();
    assert_eq!(viewer_read.status(), StatusCode::OK);
    let viewer_edit = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/documents/{document_id}"),
            Some(json!({"title": "Leaked"})),
            &viewer_token,
        ))
        .await
        .unwrap();
    assert_eq!(viewer_edit.status(), StatusCode::FORBIDDEN);
    let contributor_edit = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/documents/{document_id}"),
            Some(json!({"title": "Contributor edit"})),
            &contributor_token,
        ))
        .await
        .unwrap();
    assert_eq!(contributor_edit.status(), StatusCode::OK);
    let outsider_read = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/documents/{document_id}"),
            None,
            &outsider_token,
        ))
        .await
        .unwrap();
    assert_eq!(outsider_read.status(), StatusCode::NOT_FOUND);
    let guest_workspace_page = app
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/documents"),
            Some(json!({"title": "Workspace escape"})),
            &viewer_token,
        ))
        .await
        .unwrap();
    assert_eq!(guest_workspace_page.status(), StatusCode::FORBIDDEN);
}
