#![cfg(feature = "postgres-tests")]

use std::{fs, time::Duration};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use http::HeaderValue;
use kanleaf_server::{
    AppState,
    document::{migrate_legacy_library, recover_library_operations},
    router,
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
    let token = payload["token"].as_str().unwrap().to_owned();
    let user_id = payload["user"]["id"].as_str().unwrap().parse().unwrap();
    let setup = app
        .clone()
        .oneshot(request(
            "PATCH",
            "/api/account/setup",
            Some(json!({"display_name": email.split('@').next().unwrap()})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(setup.status(), StatusCode::OK);
    let workspace = app
        .clone()
        .oneshot(request(
            "POST",
            "/api/workspaces",
            Some(json!({"name": "Personal"})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(workspace.status(), StatusCode::CREATED);
    let workspace_id = body(workspace).await["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    (token, user_id, workspace_id)
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
async fn concurrent_document_creation_allocates_distinct_numbers(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let (token, _, workspace_id) = register(&app, "concurrent-pages@example.com").await;
    let mut creates = tokio::task::JoinSet::new();

    for index in 0..8 {
        let app = app.clone();
        let token = token.clone();
        creates.spawn(async move {
            create_document(
                &app,
                &token,
                workspace_id,
                &format!("Page {index}"),
                None,
                None,
            )
            .await["document_number"]
                .as_i64()
                .unwrap()
        });
    }

    let mut numbers = Vec::new();
    while let Some(result) = creates.join_next().await {
        numbers.push(result.unwrap());
    }
    numbers.sort_unstable();
    assert_eq!(numbers, (1..=8).collect::<Vec<_>>());
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
    assert_eq!(root["document_number"], 1);
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
    assert_eq!(child["document_number"], 2);
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
    assert_eq!(moved["document_number"], 1);
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
    assert_eq!(second_root["document_number"], 3);

    let resolved = app
        .clone()
        .oneshot(request(
            "GET",
            &format!(
                "/api/workspaces/{workspace_id}/documents/by-number/{}",
                moved["document_number"]
            ),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(resolved.status(), StatusCode::OK);
    assert_eq!(body(resolved).await["id"], root_id.to_string());
    let reordered = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/documents/{second_root_id}/move"),
            Some(json!({
                "parent_id": null,
                "index": 0,
            })),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(reordered.status(), StatusCode::OK);
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
    assert_eq!(deleted.status(), StatusCode::OK);
    assert!(!root_path.exists());
    assert!(!child_path.exists());

    let after_delete = create_document(&app, &token, workspace_id, "Postmortem", None, None).await;
    assert_eq!(after_delete["document_number"], 4);
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
    assert_eq!(deleted.status(), StatusCode::OK);
    assert!(!new_child.exists());
    assert!(!new_grandchild.exists());
    assert!(!vault.join("destination").exists());
}

#[sqlx::test(migrations = "./migrations")]
async fn atomic_move_reorders_reparents_unnests_and_rejects_invalid_destinations(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "move-owner@example.com").await;
    let a = create_document(&app, &token, workspace_id, "A", None, None).await;
    let b = create_document(&app, &token, workspace_id, "B", None, None).await;
    let c = create_document(&app, &token, workspace_id, "C", None, None).await;
    let a_id: Uuid = a["id"].as_str().unwrap().parse().unwrap();
    let b_id: Uuid = b["id"].as_str().unwrap().parse().unwrap();
    let c_id: Uuid = c["id"].as_str().unwrap().parse().unwrap();
    let a1 = create_document(&app, &token, workspace_id, "A1", None, Some(a_id)).await;
    let a1_id: Uuid = a1["id"].as_str().unwrap().parse().unwrap();
    let a1a = create_document(&app, &token, workspace_id, "A1a", None, Some(a1_id)).await;
    let a1a_id: Uuid = a1a["id"].as_str().unwrap().parse().unwrap();
    let b1 = create_document(&app, &token, workspace_id, "B1", None, Some(b_id)).await;
    let b1_id: Uuid = b1["id"].as_str().unwrap().parse().unwrap();

    let reordered = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/documents/{a_id}/move"),
            Some(json!({"parent_id": null, "index": 2})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(reordered.status(), StatusCode::OK);
    let reordered = body(reordered).await;
    let roots = reordered["documents"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|document| document["parent_id"].is_null())
        .map(|document| {
            (
                document["id"].as_str().unwrap().to_owned(),
                document["position"].as_i64().unwrap(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        roots,
        [
            (b_id.to_string(), 0),
            (c_id.to_string(), 1),
            (a_id.to_string(), 2),
        ]
    );
    let descendants: Vec<(Uuid, Option<Uuid>)> =
        sqlx::query_as("SELECT id, parent_id FROM documents WHERE id = ANY($1) ORDER BY id")
            .bind([a1_id, a1a_id])
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        descendants.iter().find(|(id, __)| *id == a1_id).unwrap().1,
        Some(a_id)
    );
    assert_eq!(
        descendants.iter().find(|(id, _)| *id == a1a_id).unwrap().1,
        Some(a1_id)
    );

    let reparented = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/documents/{b1_id}/move"),
            Some(json!({"parent_id": a_id, "index": 1})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(reparented.status(), StatusCode::OK);
    let reparented = body(reparented).await;
    let moved = reparented["documents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|document| document["id"] == b1_id.to_string())
        .unwrap();
    assert_eq!(moved["parent_id"], a_id.to_string());
    assert_eq!(moved["position"], 1);
    assert_eq!(moved["library_path"], "Wiki/a/b1.md");
    let vault = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Wiki");
    assert!(!vault.join("b/b1.md").exists());
    assert!(vault.join("a/b1.md").exists());

    let unnested = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/documents/{b1_id}/move"),
            Some(json!({"parent_id": null, "index": 1})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(unnested.status(), StatusCode::OK);
    let root_order: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM documents WHERE workspace_id = $1 AND parent_id IS NULL AND archived_at IS NULL ORDER BY position, id",
    )
    .bind(workspace_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(root_order, [b_id, b1_id, c_id, a_id]);
    assert!(vault.join("b1.md").exists());

    for (parent_id, index) in [(Some(a1_id), 0_i64), (Some(a_id), 0_i64), (None, 99_i64)] {
        let invalid = app
            .clone()
            .oneshot(request(
                "PUT",
                &format!("/api/workspaces/{workspace_id}/documents/{a_id}/move"),
                Some(json!({"parent_id": parent_id, "index": index})),
                &token,
            ))
            .await
            .unwrap();
        assert_eq!(invalid.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    let project_id = create_project(&app, &token, workspace_id, "Other scope").await;
    let project_document = create_document(
        &app,
        &token,
        workspace_id,
        "Project page",
        Some(project_id),
        None,
    )
    .await;
    let project_document_id = project_document["id"].as_str().unwrap();
    let cross_scope = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/documents/{a_id}/move"),
            Some(json!({"parent_id": project_document_id, "index": 0})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(cross_scope.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let (outsider_token, _, _) = register(&app, "move-outsider@example.com").await;
    let unauthorized = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/documents/{a_id}/move"),
            Some(json!({"parent_id": null, "index": 0})),
            &outsider_token,
        ))
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);

    let unauthorized_delete = app
        .clone()
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/documents/{a_id}/delete"),
            None,
            &outsider_token,
        ))
        .await
        .unwrap();
    assert_eq!(unauthorized_delete.status(), StatusCode::FORBIDDEN);

    sqlx::query("UPDATE documents SET project_id = $2 WHERE id = $1")
        .bind(a1_id)
        .bind(project_id)
        .execute(&pool)
        .await
        .unwrap();
    let invalid_subtree_scope = app
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/documents/{a_id}/delete"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(
        invalid_subtree_scope.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn move_commit_failure_restores_database_and_markdown_tree(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "move-rollback@example.com").await;
    let source = create_document(&app, &token, workspace_id, "Source", None, None).await;
    let target = create_document(&app, &token, workspace_id, "Target", None, None).await;
    let source_id: Uuid = source["id"].as_str().unwrap().parse().unwrap();
    let target_id: Uuid = target["id"].as_str().unwrap().parse().unwrap();
    let child = create_document(&app, &token, workspace_id, "Child", None, Some(source_id)).await;
    let child_id: Uuid = child["id"].as_str().unwrap().parse().unwrap();
    let vault = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Wiki");

    sqlx::query(
        r#"
        CREATE FUNCTION fail_document_move_commit() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'forced document move commit failure';
        END;
        $$ LANGUAGE plpgsql
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        CREATE CONSTRAINT TRIGGER fail_document_move_commit
        AFTER UPDATE ON documents DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION fail_document_move_commit()
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    let failed = app
        .oneshot(request(
            "PUT",
            &format!("/api/workspaces/{workspace_id}/documents/{child_id}/move"),
            Some(json!({"parent_id": target_id, "index": 0})),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(failed.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let parent_id: Option<Uuid> =
        sqlx::query_scalar("SELECT parent_id FROM documents WHERE id = $1")
            .bind(child_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(parent_id, Some(source_id));
    assert!(vault.join("source/child.md").exists());
    assert!(!vault.join("target/child.md").exists());
    assert_eq!(
        fs::read_dir(data_dir.path().join("vaults/.trash/library-operations"))
            .unwrap()
            .count(),
        0
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn direct_permanent_delete_removes_the_exact_subtree_but_archive_keeps_markdown(
    pool: PgPool,
) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "delete-owner@example.com").await;
    let root = create_document(&app, &token, workspace_id, "Root", None, None).await;
    let other = create_document(&app, &token, workspace_id, "Other", None, None).await;
    let root_id: Uuid = root["id"].as_str().unwrap().parse().unwrap();
    let other_id: Uuid = other["id"].as_str().unwrap().parse().unwrap();
    let child = create_document(&app, &token, workspace_id, "Child", None, Some(root_id)).await;
    let child_id: Uuid = child["id"].as_str().unwrap().parse().unwrap();
    let grandchild = create_document(
        &app,
        &token,
        workspace_id,
        "Grandchild",
        None,
        Some(child_id),
    )
    .await;
    let grandchild_id: Uuid = grandchild["id"].as_str().unwrap().parse().unwrap();
    let vault = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Wiki");

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
    assert_eq!(deleted.status(), StatusCode::OK);
    let mut deleted_ids = body(deleted).await["deleted_ids"]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| id.as_str().unwrap().parse::<Uuid>().unwrap())
        .collect::<Vec<_>>();
    deleted_ids.sort_unstable();
    let mut expected = vec![root_id, child_id, grandchild_id];
    expected.sort_unstable();
    assert_eq!(deleted_ids, expected);
    let remaining: i64 = sqlx::query_scalar("SELECT count(*) FROM documents WHERE id = ANY($1)")
        .bind([root_id, child_id, grandchild_id])
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(remaining, 0);
    let other_position: i64 = sqlx::query_scalar("SELECT position FROM documents WHERE id = $1")
        .bind(other_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(other_position, 0);
    assert!(!vault.join("root.md").exists());
    assert!(!vault.join("root/child.md").exists());

    let inaccessible = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/documents/{child_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(inaccessible.status(), StatusCode::NOT_FOUND);

    let archived = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!("/api/workspaces/{workspace_id}/documents/{other_id}"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(archived.status(), StatusCode::NO_CONTENT);
    let archived_at: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("SELECT archived_at FROM documents WHERE id = $1")
            .bind(other_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(archived_at.is_some());
    assert!(vault.join("other.md").exists());

    let deleted_leaf = app
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/documents/{other_id}/delete"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(deleted_leaf.status(), StatusCode::OK);
    assert_eq!(body(deleted_leaf).await["deleted_ids"], json!([other_id]));
    assert!(!vault.join("other.md").exists());
}

#[sqlx::test(migrations = "./migrations")]
async fn delete_commit_failure_restores_database_and_markdown_subtree(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (token, _, workspace_id) = register(&app, "delete-rollback@example.com").await;
    let root = create_document(&app, &token, workspace_id, "Root", None, None).await;
    let root_id: Uuid = root["id"].as_str().unwrap().parse().unwrap();
    let child = create_document(&app, &token, workspace_id, "Child", None, Some(root_id)).await;
    let child_id: Uuid = child["id"].as_str().unwrap().parse().unwrap();
    let vault = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Wiki");

    sqlx::query(
        r#"
        CREATE FUNCTION fail_document_delete_commit() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'forced document delete commit failure';
        END;
        $$ LANGUAGE plpgsql
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        CREATE CONSTRAINT TRIGGER fail_document_delete_commit
        AFTER DELETE ON documents DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION fail_document_delete_commit()
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    let failed = app
        .oneshot(request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/documents/{root_id}/delete"),
            None,
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(failed.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let remaining: i64 = sqlx::query_scalar("SELECT count(*) FROM documents WHERE id = ANY($1)")
        .bind([root_id, child_id])
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(remaining, 2);
    assert!(vault.join("root.md").exists());
    assert!(vault.join("root/child.md").exists());
    assert_eq!(
        fs::read_dir(data_dir.path().join("vaults/.trash/library"))
            .unwrap()
            .count(),
        0
    );
    assert_eq!(
        fs::read_dir(data_dir.path().join("vaults/.trash/library-operations"))
            .unwrap()
            .count(),
        0
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn startup_retires_superseded_library_moves_without_touching_current_markdown(pool: PgPool) {
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
    let (token, _, workspace_id) = register(&app, "superseded-move@example.com").await;
    let document = create_document(&app, &token, workspace_id, "Current", None, None).await;
    let document_id: Uuid = document["id"].as_str().unwrap().parse().unwrap();
    let operations = data_dir.path().join("operations");
    fs::create_dir(&operations).unwrap();
    let stale = operations.join(format!("{}.json", Uuid::new_v4()));
    fs::write(
        &stale,
        serde_json::to_vec(&json!({
            "operation": "move",
            "workspace_id": workspace_id,
            "document_id": document_id,
            "source": ["a"],
            "destination": ["b"]
        }))
        .unwrap(),
    )
    .unwrap();

    recover_library_operations(&state).await.unwrap();

    let wiki = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Wiki");
    assert!(!stale.exists());
    assert!(wiki.join("current.md").exists());

    sqlx::query("DELETE FROM documents WHERE workspace_id = $1 AND id = $2")
        .bind(workspace_id)
        .bind(document_id)
        .execute(&pool)
        .await
        .unwrap();
    fs::remove_file(wiki.join("current.md")).unwrap();
    let missing = operations.join(format!("{}.json", Uuid::new_v4()));
    fs::write(
        &missing,
        serde_json::to_vec(&json!({
            "operation": "move",
            "workspace_id": workspace_id,
            "document_id": document_id,
            "source": ["b"],
            "destination": ["c"]
        }))
        .unwrap(),
    )
    .unwrap();

    recover_library_operations(&state).await.unwrap();

    assert!(!missing.exists());
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
async fn archiving_a_project_preserves_its_project_pages_in_place(pool: PgPool) {
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
    assert!(
        rows.iter()
            .all(|(_, stored_project_id, _)| *stored_project_id == Some(project_id))
    );
    assert_eq!(
        rows.iter().find(|(id, _, _)| *id == child_id).unwrap().2,
        Some(root_id)
    );
    assert!(project_wiki.join("decision_log.md").exists());
    assert!(project_wiki.join("decision_log/adr_001.md").exists());
}

#[sqlx::test(migrations = "./migrations")]
async fn document_access_follows_project_roles_and_tenant_boundaries(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, workspace_id) = register(&app, "owner@example.com").await;
    let (contributor_token, contributor_id, _) = register(&app, "contributor@example.com").await;
    let (viewer_token, viewer_id, _) = register(&app, "viewer@example.com").await;
    let (member_token, member_id, _) = register(&app, "member@example.com").await;
    let (outsider_token, _, _) = register(&app, "outsider@example.com").await;
    for (user_id, role) in [
        (contributor_id, "member"),
        (viewer_id, "guest"),
        (member_id, "member"),
    ] {
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
    let document_number = document["document_number"].as_i64().unwrap();

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
    let viewer_resolved = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/documents/by-number/{document_number}"),
            None,
            &viewer_token,
        ))
        .await
        .unwrap();
    assert_eq!(viewer_resolved.status(), StatusCode::OK);
    let inaccessible_member_resolved = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/documents/by-number/{document_number}"),
            None,
            &member_token,
        ))
        .await
        .unwrap();
    assert_eq!(inaccessible_member_resolved.status(), StatusCode::NOT_FOUND);
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
    let outsider_resolved = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/documents/by-number/{document_number}"),
            None,
            &outsider_token,
        ))
        .await
        .unwrap();
    assert_eq!(outsider_resolved.status(), StatusCode::NOT_FOUND);
    let workspace_document = create_document(
        &app,
        &owner_token,
        workspace_id,
        "Workspace page",
        None,
        None,
    )
    .await;
    let workspace_document_number = workspace_document["document_number"].as_i64().unwrap();
    let guest_workspace_resolved = app
        .clone()
        .oneshot(request(
            "GET",
            &format!(
                "/api/workspaces/{workspace_id}/documents/by-number/{workspace_document_number}"
            ),
            None,
            &viewer_token,
        ))
        .await
        .unwrap();
    assert_eq!(guest_workspace_resolved.status(), StatusCode::NOT_FOUND);
    let malformed_number = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/documents/by-number/0"),
            None,
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(malformed_number.status(), StatusCode::NOT_FOUND);
    let unauthenticated = app
        .clone()
        .oneshot(
            Request::get(format!(
                "/api/workspaces/{workspace_id}/documents/by-number/{document_number}"
            ))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);
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
