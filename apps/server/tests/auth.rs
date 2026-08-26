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

fn test_app(pool: PgPool, data_dir: &TempDir) -> axum::Router {
    router(
        AppState::new(pool, data_dir.path().to_owned(), Duration::from_secs(3600)),
        vec![HeaderValue::from_static("http://127.0.0.1:1420")],
    )
}

fn json_request(method: &str, uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn registration_creates_a_personal_workspace_and_hashed_session(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/register",
            json!({"email": " Person@Example.COM ", "password": "correct horse battery"}),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let payload = response_json(response).await;
    let token = payload["token"].as_str().unwrap();
    assert_eq!(payload["user"]["email"], "person@example.com");
    assert!(payload["user"]["active_workspace_id"].is_string());

    let counts: (i64, i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT
            (SELECT count(*) FROM users),
            (SELECT count(*) FROM workspaces),
            (SELECT count(*) FROM workspace_memberships),
            (SELECT count(*) FROM sessions)
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(counts, (1, 1, 1, 1));

    let (role, token_hash): (String, Vec<u8>) = sqlx::query_as(
        "SELECT workspace_memberships.role, sessions.token_hash FROM workspace_memberships CROSS JOIN sessions",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(role, "owner");
    assert_eq!(token_hash.len(), 32);
    assert_ne!(token_hash, token.as_bytes());

    let session = app
        .clone()
        .oneshot(
            Request::get("/api/session")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(session.status(), StatusCode::OK);

    let logout = app
        .clone()
        .oneshot(
            Request::post("/api/auth/logout")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);

    let after_logout = app
        .oneshot(
            Request::get("/api/session")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(after_logout.status(), StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "./migrations")]
async fn duplicate_registration_rolls_back_the_entire_second_account(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let request_body = json!({"email": "owner@example.com", "password": "correct horse battery"});

    let first = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/register",
            request_body.clone(),
        ))
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::CREATED);

    let duplicate = app
        .oneshot(json_request("POST", "/api/auth/register", request_body))
        .await
        .unwrap();
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);

    let counts: (i64, i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT
            (SELECT count(*) FROM users),
            (SELECT count(*) FROM workspaces),
            (SELECT count(*) FROM workspace_memberships),
            (SELECT count(*) FROM sessions)
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(counts, (1, 1, 1, 1));
}

#[sqlx::test(migrations = "./migrations")]
async fn login_rejects_wrong_passwords_and_issues_a_new_hashed_session(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let register = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/register",
            json!({"email": "person@example.com", "password": "correct horse battery"}),
        ))
        .await
        .unwrap();
    assert_eq!(register.status(), StatusCode::CREATED);

    let rejected = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/login",
            json!({"email": "person@example.com", "password": "wrong password"}),
        ))
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);

    let accepted = app
        .oneshot(json_request(
            "POST",
            "/api/auth/login",
            json!({"email": " PERSON@example.com ", "password": "correct horse battery"}),
        ))
        .await
        .unwrap();
    assert_eq!(accepted.status(), StatusCode::OK);
    let payload = response_json(accepted).await;
    assert!(payload["token"].is_string());

    let session_count: i64 = sqlx::query_scalar("SELECT count(*) FROM sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(session_count, 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn expired_sessions_cannot_authenticate(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let registration = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/register",
            json!({"email": "person@example.com", "password": "correct horse battery"}),
        ))
        .await
        .unwrap();
    let payload = response_json(registration).await;
    let token = payload["token"].as_str().unwrap();

    sqlx::query("UPDATE sessions SET expires_at = now() - interval '1 minute'")
        .execute(&pool)
        .await
        .unwrap();

    let session = app
        .oneshot(
            Request::get("/api/session")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(session.status(), StatusCode::UNAUTHORIZED);
}
