#![cfg(feature = "postgres-tests")]

use std::time::Duration;

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
    let bytes = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
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

#[sqlx::test(migrations = "./migrations")]
async fn workspace_and_project_lifecycle_persists(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let (token, _, personal_workspace) = register(&app, "owner@example.com").await;

    let workspaces = app
        .clone()
        .oneshot(empty_request("GET", "/api/workspaces", &token))
        .await
        .unwrap();
    let payload = response_json(workspaces).await;
    assert_eq!(payload.as_array().unwrap().len(), 1);
    assert_eq!(payload[0]["id"], personal_workspace.to_string());
    assert_eq!(payload[0]["role"], "owner");

    let created_workspace = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/workspaces",
            json!({"name": "Game production"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(created_workspace.status(), StatusCode::CREATED);
    let workspace_id: Uuid = response_json(created_workspace).await["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();

    let session = app
        .clone()
        .oneshot(empty_request("GET", "/api/session", &token))
        .await
        .unwrap();
    assert_eq!(
        response_json(session).await["user"]["active_workspace_id"],
        workspace_id.to_string()
    );

    let renamed = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}"),
            json!({"name": "Inkveil Games"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(response_json(renamed).await["name"], "Inkveil Games");

    let project = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects"),
            json!({"name": "Kanleaf"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(project.status(), StatusCode::CREATED);
    let project_id: Uuid = response_json(project).await["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();

    let duplicate = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/projects"),
            json!({"name": "kanleaf"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);

    let renamed_project = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}"),
            json!({"name": "Kanleaf Desktop"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(
        response_json(renamed_project).await["name"],
        "Kanleaf Desktop"
    );

    let archived = app
        .clone()
        .oneshot(empty_request(
            "DELETE",
            &format!("/api/workspaces/{workspace_id}/projects/{project_id}"),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(archived.status(), StatusCode::NO_CONTENT);

    let projects = app
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/projects"),
            &token,
        ))
        .await
        .unwrap();
    assert!(response_json(projects).await.as_array().unwrap().is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn users_cannot_cross_workspace_boundaries(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let (first_token, _, _) = register(&app, "first@example.com").await;
    let (second_token, _, second_workspace) = register(&app, "second@example.com").await;

    let project = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{second_workspace}/projects"),
            json!({"name": "Private project"}),
            Some(&second_token),
        ))
        .await
        .unwrap();
    let project_id = response_json(project).await["id"]
        .as_str()
        .unwrap()
        .to_owned();

    let attempts = [
        empty_request(
            "GET",
            &format!("/api/workspaces/{second_workspace}/projects"),
            &first_token,
        ),
        empty_request(
            "POST",
            &format!("/api/workspaces/{second_workspace}/activate"),
            &first_token,
        ),
        json_request(
            "PATCH",
            &format!("/api/workspaces/{second_workspace}/projects/{project_id}"),
            json!({"name": "Stolen"}),
            Some(&first_token),
        ),
    ];

    for request in attempts {
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(response_json(response).await["error"]["code"], "forbidden");
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn members_can_activate_but_only_owners_can_rename_workspaces(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, owner_workspace) = register(&app, "owner@example.com").await;
    let (member_token, member_id, _) = register(&app, "member@example.com").await;

    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')",
    )
    .bind(owner_workspace)
    .bind(member_id)
    .execute(&pool)
    .await
    .unwrap();

    let activated = app
        .clone()
        .oneshot(empty_request(
            "POST",
            &format!("/api/workspaces/{owner_workspace}/activate"),
            &member_token,
        ))
        .await
        .unwrap();
    assert_eq!(activated.status(), StatusCode::NO_CONTENT);

    let denied = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{owner_workspace}"),
            json!({"name": "Renamed by member"}),
            Some(&member_token),
        ))
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);

    let owner_rename = app
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{owner_workspace}"),
            json!({"name": "Owner renamed"}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(owner_rename.status(), StatusCode::OK);
}
