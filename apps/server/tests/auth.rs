#![cfg(feature = "postgres-tests")]

use std::time::Duration;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use http::HeaderValue;
use kanleaf_server::{AppState, domain::NormalizedEmail, router};
use serde_json::{Value, json};
use sqlx::PgPool;
use tempfile::TempDir;
use tower::ServiceExt;

fn test_app(pool: PgPool, data_dir: &TempDir) -> axum::Router {
    test_app_with_host(pool, data_dir, None)
}

fn test_app_with_host(pool: PgPool, data_dir: &TempDir, host_email: Option<&str>) -> axum::Router {
    let host_email = host_email.map(|email| NormalizedEmail::new(email).unwrap());
    router(
        AppState::new(pool, data_dir.path().to_owned(), Duration::from_secs(3600))
            .with_host_email(host_email),
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
    assert_eq!(payload["user"]["is_host"], false);
    assert_eq!(payload["user"]["display_name"], "person");
    assert_eq!(payload["user"]["theme"], "system");
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

#[sqlx::test(migrations = "./migrations")]
async fn restricted_access_gates_registration_login_and_existing_sessions(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app_with_host(pool.clone(), &data_dir, Some("host@example.com"));
    let password = "correct horse battery";

    let allowed_registration = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/register",
            json!({"email": "allowed@example.com", "password": password}),
        ))
        .await
        .unwrap();
    let allowed_payload = response_json(allowed_registration).await;
    let allowed_token = allowed_payload["token"].as_str().unwrap().to_owned();

    let disallowed_registration = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/register",
            json!({"email": "existing@example.com", "password": password}),
        ))
        .await
        .unwrap();
    let disallowed_payload = response_json(disallowed_registration).await;
    let disallowed_token = disallowed_payload["token"].as_str().unwrap().to_owned();

    sqlx::query("UPDATE instance_settings SET restricted_access = true WHERE id = 1")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO instance_allowed_emails (email) VALUES ('allowed@example.com'), ('new@example.com')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let counts_before: (i64, i64, i64, i64) = sqlx::query_as(
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
    let rejected_registration = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/register",
            json!({"email": "blocked@example.com", "password": password}),
        ))
        .await
        .unwrap();
    assert_eq!(rejected_registration.status(), StatusCode::FORBIDDEN);
    let rejected_payload = response_json(rejected_registration).await;
    assert_eq!(rejected_payload["error"]["code"], "access_restricted");
    assert_eq!(
        rejected_payload["error"]["message"],
        "Access to this Kanleaf host is restricted. Contact the host administrator."
    );
    let counts_after: (i64, i64, i64, i64) = sqlx::query_as(
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
    assert_eq!(counts_after, counts_before);

    let new_allowed = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/register",
            json!({"email": " New@Example.COM ", "password": password}),
        ))
        .await
        .unwrap();
    assert_eq!(new_allowed.status(), StatusCode::CREATED);

    let host_registration = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/register",
            json!({"email": " HOST@Example.COM ", "password": password}),
        ))
        .await
        .unwrap();
    assert_eq!(host_registration.status(), StatusCode::CREATED);
    let host_payload = response_json(host_registration).await;
    assert_eq!(host_payload["user"]["is_host"], true);
    let host_token = host_payload["token"].as_str().unwrap().to_owned();

    let wrong_password = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/login",
            json!({"email": "existing@example.com", "password": "wrong password"}),
        ))
        .await
        .unwrap();
    assert_eq!(wrong_password.status(), StatusCode::UNAUTHORIZED);
    let correct_password = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/login",
            json!({"email": "existing@example.com", "password": password}),
        ))
        .await
        .unwrap();
    assert_eq!(correct_password.status(), StatusCode::FORBIDDEN);

    for (token, expected) in [
        (&disallowed_token, StatusCode::UNAUTHORIZED),
        (&allowed_token, StatusCode::OK),
        (&host_token, StatusCode::OK),
    ] {
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
        assert_eq!(session.status(), expected);
        if token == &host_token {
            assert_eq!(response_json(session).await["user"]["is_host"], true);
        }
    }

    let host_login = app
        .oneshot(json_request(
            "POST",
            "/api/auth/login",
            json!({"email": "host@example.com", "password": password}),
        ))
        .await
        .unwrap();
    assert_eq!(host_login.status(), StatusCode::OK);
    assert_eq!(response_json(host_login).await["user"]["is_host"], true);
}
