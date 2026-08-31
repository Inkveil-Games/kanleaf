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
use uuid::Uuid;

const PASSWORD: &str = "correct horse battery";

fn test_app(pool: PgPool, data_dir: &TempDir, host_email: Option<&str>) -> axum::Router {
    let host_email = host_email.map(|email| NormalizedEmail::new(email).unwrap());
    router(
        AppState::new(pool, data_dir.path().to_owned(), Duration::from_secs(3600))
            .with_host_email(host_email),
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

fn empty_request(method: &str, uri: &str, token: Option<&str>) -> Request<Body> {
    let mut request = Request::builder().method(method).uri(uri);
    if let Some(token) = token {
        request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    request.body(Body::empty()).unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), 128 * 1024).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn register(app: &axum::Router, email: &str) -> Value {
    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/register",
            json!({"email": email, "password": PASSWORD}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await
}

async fn session_status(app: &axum::Router, token: &str) -> StatusCode {
    app.clone()
        .oneshot(empty_request("GET", "/api/session", Some(token)))
        .await
        .unwrap()
        .status()
}

#[sqlx::test(migrations = "./migrations")]
async fn every_host_route_requires_the_configured_authenticated_host(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir, Some("host@example.com"));
    let member = register(&app, "member@example.com").await;
    let member_token = member["token"].as_str().unwrap();
    let host = register(&app, "host@example.com").await;
    let host_token = host["token"].as_str().unwrap();

    for (method, uri, body) in [
        ("GET", "/api/host/workspaces", Value::Null),
        ("GET", "/api/host/access", Value::Null),
        (
            "PUT",
            "/api/host/access",
            json!({"restricted": false, "allowed_emails": []}),
        ),
    ] {
        let unauthenticated = app
            .clone()
            .oneshot(if method == "PUT" {
                json_request(method, uri, body.clone(), None)
            } else {
                empty_request(method, uri, None)
            })
            .await
            .unwrap();
        assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);

        let non_host = app
            .clone()
            .oneshot(if method == "PUT" {
                json_request(method, uri, body.clone(), Some(member_token))
            } else {
                empty_request(method, uri, Some(member_token))
            })
            .await
            .unwrap();
        assert_eq!(non_host.status(), StatusCode::FORBIDDEN);

        let host_response = app
            .clone()
            .oneshot(if method == "PUT" {
                json_request(method, uri, body, Some(host_token))
            } else {
                empty_request(method, uri, Some(host_token))
            })
            .await
            .unwrap();
        assert_eq!(host_response.status(), StatusCode::OK);
    }

    let host_console_disabled = test_app(pool, &data_dir, None)
        .oneshot(empty_request("GET", "/api/host/access", Some(host_token)))
        .await
        .unwrap();
    assert_eq!(host_console_disabled.status(), StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "./migrations")]
async fn host_replaces_the_policy_atomically_and_revokes_disallowed_sessions(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir, Some("host@example.com"));
    let host = register(&app, "host@example.com").await;
    let host_token = host["token"].as_str().unwrap();
    let allowed = register(&app, "allowed@example.com").await;
    let allowed_token = allowed["token"].as_str().unwrap();
    let blocked = register(&app, "blocked@example.com").await;
    let blocked_token = blocked["token"].as_str().unwrap();

    let update = app
        .clone()
        .oneshot(json_request(
            "PUT",
            "/api/host/access",
            json!({
                "restricted": true,
                "allowed_emails": [
                    " Zebra@Example.COM ",
                    "allowed@example.com",
                    "ALLOWED@example.com"
                ]
            }),
            Some(host_token),
        ))
        .await
        .unwrap();
    assert_eq!(update.status(), StatusCode::OK);
    assert_eq!(
        response_json(update).await,
        json!({
            "restricted": true,
            "allowed_emails": ["allowed@example.com", "zebra@example.com"]
        })
    );

    assert_eq!(session_status(&app, host_token).await, StatusCode::OK);
    assert_eq!(session_status(&app, allowed_token).await, StatusCode::OK);
    assert_eq!(
        session_status(&app, blocked_token).await,
        StatusCode::UNAUTHORIZED
    );

    let blocked_login = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/login",
            json!({"email": "blocked@example.com", "password": PASSWORD}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(blocked_login.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(blocked_login).await["error"]["code"],
        "access_restricted"
    );

    let read = app
        .clone()
        .oneshot(empty_request("GET", "/api/host/access", Some(host_token)))
        .await
        .unwrap();
    assert_eq!(read.status(), StatusCode::OK);
    assert_eq!(
        response_json(read).await,
        json!({
            "restricted": true,
            "allowed_emails": ["allowed@example.com", "zebra@example.com"]
        })
    );

    let invalid = app
        .clone()
        .oneshot(json_request(
            "PUT",
            "/api/host/access",
            json!({
                "restricted": false,
                "allowed_emails": ["replacement@example.com", "invalid"]
            }),
            Some(host_token),
        ))
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let stored: (bool, Vec<String>) = sqlx::query_as(
        r#"
        SELECT settings.restricted_access,
               array_agg(allowed.email ORDER BY allowed.email)
        FROM instance_settings AS settings
        JOIN instance_allowed_emails AS allowed ON TRUE
        WHERE settings.id = 1
        GROUP BY settings.id, settings.restricted_access
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        stored,
        (
            true,
            vec![
                "allowed@example.com".to_owned(),
                "zebra@example.com".to_owned()
            ]
        )
    );
    assert_eq!(session_status(&app, allowed_token).await, StatusCode::OK);

    let open = app
        .clone()
        .oneshot(json_request(
            "PUT",
            "/api/host/access",
            json!({
                "restricted": false,
                "allowed_emails": ["prepared@example.com"]
            }),
            Some(host_token),
        ))
        .await
        .unwrap();
    assert_eq!(open.status(), StatusCode::OK);
    assert_eq!(
        response_json(open).await,
        json!({
            "restricted": false,
            "allowed_emails": ["prepared@example.com"]
        })
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn policy_transition_cannot_leave_a_concurrent_disallowed_session(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir, Some("host@example.com"));
    let host = register(&app, "host@example.com").await;
    let host_token = host["token"].as_str().unwrap().to_owned();

    let mut shared_lock = pool.begin().await.unwrap();
    sqlx::query("SELECT restricted_access FROM instance_settings WHERE id = 1 FOR SHARE")
        .fetch_one(&mut *shared_lock)
        .await
        .unwrap();

    let update_app = app.clone();
    let mut update = tokio::spawn(async move {
        update_app
            .oneshot(json_request(
                "PUT",
                "/api/host/access",
                json!({"restricted": true, "allowed_emails": []}),
                Some(&host_token),
            ))
            .await
            .unwrap()
    });
    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut update)
            .await
            .is_err(),
        "the policy writer must wait for existing shared policy readers"
    );

    let newcomer_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)",
    )
    .bind(newcomer_id)
    .bind("newcomer@example.com")
    .bind("newcomer")
    .bind("test-only-password-hash")
    .execute(&mut *shared_lock)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO sessions (id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, now() + interval '1 hour')
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(newcomer_id)
    .bind(vec![7_u8; 32])
    .execute(&mut *shared_lock)
    .await
    .unwrap();
    shared_lock.commit().await.unwrap();

    assert_eq!(update.await.unwrap().status(), StatusCode::OK);
    let surviving_sessions: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sessions WHERE user_id = $1")
            .bind(newcomer_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(surviving_sessions, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn host_lists_only_workspace_owner_metadata_without_gaining_workspace_access(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir, Some("host@example.com"));
    let host = register(&app, "host@example.com").await;
    let host_token = host["token"].as_str().unwrap();
    let host_workspace = host["user"]["active_workspace_id"].as_str().unwrap();
    let owner = register(&app, "owner@example.com").await;
    let owner_workspace = owner["user"]["active_workspace_id"].as_str().unwrap();

    let response = app
        .clone()
        .oneshot(empty_request(
            "GET",
            "/api/host/workspaces",
            Some(host_token),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let workspaces = response_json(response).await;
    let workspaces = workspaces.as_array().unwrap();
    assert_eq!(workspaces.len(), 2);

    for (workspace_id, owner_email) in [
        (host_workspace, "host@example.com"),
        (owner_workspace, "owner@example.com"),
    ] {
        let workspace = workspaces
            .iter()
            .find(|workspace| workspace["id"] == workspace_id)
            .unwrap();
        assert_eq!(workspace["name"], "Personal");
        assert_eq!(workspace["owner"]["email"], owner_email);
        assert!(workspace["owner"]["id"].is_string());
        assert!(workspace["owner"]["display_name"].is_string());
        assert!(workspace["created_at"].is_string());
        assert!(workspace.get("members").is_none());
        assert!(workspace.get("vault_path").is_none());
        assert!(workspace["owner"].get("password_hash").is_none());
    }

    let membership_scoped = app
        .clone()
        .oneshot(empty_request("GET", "/api/workspaces", Some(host_token)))
        .await
        .unwrap();
    let visible = response_json(membership_scoped).await;
    assert_eq!(visible.as_array().unwrap().len(), 1);
    assert_eq!(visible[0]["id"], host_workspace);

    let cross_workspace_tasks = app
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{owner_workspace}/tasks"),
            Some(host_token),
        ))
        .await
        .unwrap();
    assert_eq!(cross_workspace_tasks.status(), StatusCode::FORBIDDEN);
}
