#![cfg(feature = "postgres-tests")]

use std::{fs, time::Duration};

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
    let root_path = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Pages")
        .join(format!("{root_id}.md"));
    let child_path = root_path.with_file_name(format!("{child_id}.md"));
    assert_eq!(fs::read_to_string(&root_path).unwrap(), "");

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
    fs::write(&root_path, "external editor change\n").unwrap();
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
        fs::read_to_string(&root_path).unwrap(),
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
