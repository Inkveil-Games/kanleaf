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

async fn response_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn register(app: &axum::Router, email: &str, identifier: &str) -> (String, Uuid) {
    let response = app
        .clone()
        .oneshot(
            Request::post("/api/auth/register")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({"email": email, "password": "correct horse battery"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let payload = response_json(response).await;
    let token = payload["token"].as_str().unwrap().to_owned();
    let setup = app
        .clone()
        .oneshot(
            Request::patch("/api/account/setup")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({"display_name": "Asset owner"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(setup.status(), StatusCode::OK);
    let workspace = app
        .clone()
        .oneshot(
            Request::post("/api/workspaces")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({"name": "Assets", "identifier": identifier}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(workspace.status(), StatusCode::CREATED);
    let workspace_id = response_json(workspace).await["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    (token, workspace_id)
}

async fn create_task(app: &axum::Router, token: &str, workspace_id: Uuid) -> Uuid {
    let response = app
        .clone()
        .oneshot(
            Request::post(format!("/api/workspaces/{workspace_id}/tasks"))
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({"title": "Asset target"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap()
}

fn multipart(filename: &str, content_type: &str, bytes: &[u8]) -> (String, Vec<u8>) {
    let boundary = format!("kanleaf-{}", Uuid::new_v4());
    let mut body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n"
    )
    .into_bytes();
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    (boundary, body)
}

async fn upload(
    app: &axum::Router,
    token: &str,
    workspace_id: Uuid,
    task_id: Uuid,
    filename: &str,
) -> axum::response::Response {
    let (boundary, body) = multipart(filename, "image/png", b"\x89PNG\r\n\x1a\ncontent");
    app.clone()
        .oneshot(
            Request::post(format!(
                "/api/workspaces/{workspace_id}/assets/images?target_kind=task&target_id={task_id}"
            ))
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(
                header::CONTENT_TYPE,
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(Body::from(body))
            .unwrap(),
        )
        .await
        .unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn image_assets_use_opaque_collision_safe_workspace_paths(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = router(
        AppState::new(pool, data_dir.path().to_owned(), Duration::from_secs(3600)),
        vec![HeaderValue::from_static("http://127.0.0.1:1420")],
    );
    let (token, workspace_id) = register(&app, "assets@example.com", "assets-workspace").await;
    let task_id = create_task(&app, &token, workspace_id).await;

    let first = upload(&app, &token, workspace_id, task_id, "same-name.png").await;
    let second = upload(&app, &token, workspace_id, task_id, "same-name.png").await;
    assert_eq!(first.status(), StatusCode::CREATED);
    assert_eq!(second.status(), StatusCode::CREATED);
    let first = response_json(first).await;
    let second = response_json(second).await;
    assert_ne!(first["reference"], second["reference"]);
    assert_eq!(first["original_name"], "same-name.png");
    assert!(
        first["reference"]
            .as_str()
            .unwrap()
            .starts_with("kanleaf-asset://images/")
    );

    let asset_directory = data_dir
        .path()
        .join("vaults/assets-workspace/assets/images");
    assert_eq!(fs::read_dir(&asset_directory).unwrap().count(), 2);
    assert_eq!(
        fs::read_dir(&asset_directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<std::collections::HashSet<_>>()
            .len(),
        2
    );

    let file_name = first["reference"]
        .as_str()
        .unwrap()
        .strip_prefix("kanleaf-asset://images/")
        .unwrap();
    let read = app
        .clone()
        .oneshot(
            Request::get(format!(
                "/api/workspaces/{workspace_id}/assets/images/{file_name}?target_kind=task&target_id={task_id}"
            ))
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(read.status(), StatusCode::OK);
    assert_eq!(read.headers()[header::CONTENT_TYPE], "image/png");
}

#[sqlx::test(migrations = "./migrations")]
async fn image_upload_rejects_traversal_and_cross_workspace_targets(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = router(
        AppState::new(pool, data_dir.path().to_owned(), Duration::from_secs(3600)),
        vec![HeaderValue::from_static("http://127.0.0.1:1420")],
    );
    let (owner_token, workspace_id) =
        register(&app, "owner-assets@example.com", "owner-assets").await;
    let task_id = create_task(&app, &owner_token, workspace_id).await;
    let (other_token, other_workspace_id) =
        register(&app, "other-assets@example.com", "other-assets").await;

    let traversal = upload(
        &app,
        &owner_token,
        workspace_id,
        task_id,
        "../../outside.png",
    )
    .await;
    assert_eq!(traversal.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(!data_dir.path().join("outside.png").exists());

    let cross_workspace = upload(
        &app,
        &other_token,
        other_workspace_id,
        task_id,
        "capture.png",
    )
    .await;
    assert_eq!(cross_workspace.status(), StatusCode::NOT_FOUND);
}
