#![cfg(feature = "postgres-tests")]

use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use http::HeaderValue;
use kanleaf_server::{
    AppState,
    mail::{MailFuture, MailMessage, MailTransport, MailTransportError, Mailer},
    router,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tempfile::TempDir;
use tower::ServiceExt;
use url::Url;

const OLD_PASSWORD: &str = "correct horse battery";
const NEW_PASSWORD: &str = "new correct horse battery";

#[derive(Default)]
struct CapturingTransport {
    messages: Mutex<Vec<MailMessage>>,
    fail: AtomicBool,
}

impl MailTransport for CapturingTransport {
    fn send(&self, message: MailMessage) -> MailFuture<'_> {
        self.messages.lock().unwrap().push(message);
        Box::pin(async move {
            if self.fail.load(Ordering::SeqCst) {
                Err(MailTransportError)
            } else {
                Ok(())
            }
        })
    }
}

#[derive(Default)]
struct PendingTransport {
    attempts: AtomicUsize,
}

impl MailTransport for PendingTransport {
    fn send(&self, _message: MailMessage) -> MailFuture<'_> {
        self.attempts.fetch_add(1, Ordering::SeqCst);
        Box::pin(std::future::pending())
    }
}

fn test_app(pool: PgPool, data_dir: &TempDir, mailer: Mailer) -> axum::Router {
    router(
        AppState::new(pool, data_dir.path().to_owned(), Duration::from_secs(3600))
            .with_mailer(mailer),
        vec![HeaderValue::from_static("http://127.0.0.1:1420")],
    )
}

fn capturing_mailer(transport: Arc<dyn MailTransport>) -> Mailer {
    Mailer::with_transport(
        Url::parse("https://kanleaf.example.com/base/../").unwrap(),
        "Kanleaf",
        "notifications@example.com",
        transport,
    )
}

fn json_request(uri: &str, body: Value) -> Request<Body> {
    Request::post(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn empty_body(response: axum::response::Response) -> (StatusCode, Vec<u8>) {
    let status = response.status();
    let body = to_bytes(response.into_body(), 64 * 1024)
        .await
        .unwrap()
        .to_vec();
    (status, body)
}

async fn response_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn register(app: &axum::Router, email: &str) -> (String, String) {
    let response = app
        .clone()
        .oneshot(json_request(
            "/api/auth/register",
            json!({"email": email, "password": OLD_PASSWORD}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let payload = response_json(response).await;
    (
        payload["token"].as_str().unwrap().to_owned(),
        payload["user"]["id"].as_str().unwrap().to_owned(),
    )
}

async fn login(app: &axum::Router, email: &str, password: &str) -> axum::response::Response {
    app.clone()
        .oneshot(json_request(
            "/api/auth/login",
            json!({"email": email, "password": password}),
        ))
        .await
        .unwrap()
}

async fn forgot(
    app: &axum::Router,
    email: &str,
    return_to: Option<&str>,
) -> axum::response::Response {
    app.clone()
        .oneshot(json_request(
            "/api/auth/forgot-password",
            json!({"email": email, "return_to": return_to}),
        ))
        .await
        .unwrap()
}

async fn reset(app: &axum::Router, token: &str, password: &str) -> axum::response::Response {
    app.clone()
        .oneshot(json_request(
            "/api/auth/reset-password",
            json!({"token": token, "password": password}),
        ))
        .await
        .unwrap()
}

async fn captured_reset(transport: &CapturingTransport, index: usize) -> (MailMessage, String) {
    let message = tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            let message = transport.messages.lock().unwrap().get(index).cloned();
            if let Some(message) = message {
                break message;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("password reset delivery task did not start");
    let url = message
        .text_body
        .lines()
        .find_map(|line| {
            line.starts_with("https://")
                .then(|| Url::parse(line).unwrap())
        })
        .expect("reset mail must contain a standalone reset URL");
    let token = url
        .fragment()
        .and_then(|fragment| {
            url::form_urlencoded::parse(fragment.as_bytes())
                .find_map(|(key, value)| (key == "token").then(|| value.into_owned()))
        })
        .expect("reset URL must contain a token fragment");
    (message, token)
}

async fn session_status(app: &axum::Router, token: &str) -> StatusCode {
    app.clone()
        .oneshot(
            Request::get("/api/session")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

#[sqlx::test(migrations = "./migrations")]
async fn forgot_password_stores_only_a_hash_and_sends_one_fragment_link(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let transport = Arc::new(CapturingTransport::default());
    let app = test_app(pool.clone(), &data_dir, capturing_mailer(transport.clone()));
    register(&app, "person@example.com").await;
    let invitation_return_to = format!("/invite#token={}", "I".repeat(43));

    let response = forgot(&app, " Person@Example.COM ", Some(&invitation_return_to)).await;
    assert_eq!(empty_body(response).await, (StatusCode::NO_CONTENT, vec![]));

    let (message, raw_token) = captured_reset(&transport, 0).await;
    assert_eq!(transport.messages.lock().unwrap().len(), 1);
    assert_eq!(message.to_email, "person@example.com");
    assert_eq!(message.subject, "Reset your Kanleaf password");
    assert!(message.text_body.contains("Reset your password"));
    assert!(message.html_body.contains("Reset your password"));
    assert!(message.text_body.contains("/reset-password#token="));
    assert!(message.html_body.contains("/reset-password#token="));
    assert!(!message.text_body.contains("?token="));
    assert!(!message.html_body.contains("?token="));
    assert_eq!(raw_token.len(), 43);

    let url_line = message
        .text_body
        .lines()
        .find(|line| line.starts_with("https://"))
        .unwrap();
    let url = Url::parse(url_line).unwrap();
    assert_eq!(url.path(), "/reset-password");
    let return_to = url::form_urlencoded::parse(url.fragment().unwrap().as_bytes())
        .find_map(|(key, value)| (key == "returnTo").then(|| value.into_owned()));
    assert_eq!(return_to.as_deref(), Some(invitation_return_to.as_str()));

    let stored_hash: Vec<u8> = sqlx::query_scalar("SELECT token_hash FROM password_reset_tokens")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored_hash, Sha256::digest(raw_token.as_bytes()).as_slice());
    assert_ne!(stored_hash, raw_token.as_bytes());
}

#[sqlx::test(migrations = "./migrations")]
async fn forgot_password_is_non_disclosing_and_enforces_cooldown(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let transport = Arc::new(CapturingTransport::default());
    let app = test_app(pool.clone(), &data_dir, capturing_mailer(transport.clone()));
    register(&app, "person@example.com").await;

    let existing = empty_body(forgot(&app, "person@example.com", None).await).await;
    let unknown = empty_body(forgot(&app, "missing@example.com", None).await).await;
    let cooldown = empty_body(forgot(&app, "person@example.com", None).await).await;

    assert_eq!(existing, (StatusCode::NO_CONTENT, vec![]));
    assert_eq!(unknown, existing);
    assert_eq!(cooldown, existing);
    captured_reset(&transport, 0).await;
    assert_eq!(transport.messages.lock().unwrap().len(), 1);
    let token_count: i64 = sqlx::query_scalar("SELECT count(*) FROM password_reset_tokens")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(token_count, 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn forgot_password_does_not_wait_for_slow_smtp(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let transport = Arc::new(PendingTransport::default());
    let app = test_app(pool, &data_dir, capturing_mailer(transport.clone()));
    register(&app, "slow-mail@example.com").await;

    let unknown_started_at = Instant::now();
    let unknown = forgot(&app, "unknown@example.com", None).await;
    assert_eq!(unknown.status(), StatusCode::NO_CONTENT);
    assert!(unknown_started_at.elapsed() >= Duration::from_millis(400));

    let started_at = Instant::now();
    let response = tokio::time::timeout(
        Duration::from_secs(2),
        forgot(&app, "slow-mail@example.com", None),
    )
    .await
    .expect("SMTP latency must not make an existing account distinguishable");

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(started_at.elapsed() >= Duration::from_millis(400));
    tokio::task::yield_now().await;
    assert_eq!(transport.attempts.load(Ordering::SeqCst), 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn valid_reset_changes_password_and_revokes_only_the_users_sessions(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let transport = Arc::new(CapturingTransport::default());
    let app = test_app(pool, &data_dir, capturing_mailer(transport.clone()));
    let (first_session, _) = register(&app, "person@example.com").await;
    let second_session_payload =
        response_json(login(&app, "person@example.com", OLD_PASSWORD).await).await;
    let second_session = second_session_payload["token"].as_str().unwrap().to_owned();
    let (other_session, _) = register(&app, "other@example.com").await;
    assert_eq!(
        forgot(&app, "person@example.com", None).await.status(),
        StatusCode::NO_CONTENT
    );
    let (_, reset_token) = captured_reset(&transport, 0).await;

    assert_eq!(
        reset(&app, &reset_token, NEW_PASSWORD).await.status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        login(&app, "person@example.com", OLD_PASSWORD)
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        login(&app, "person@example.com", NEW_PASSWORD)
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        session_status(&app, &first_session).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        session_status(&app, &second_session).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(session_status(&app, &other_session).await, StatusCode::OK);

    assert_eq!(
        reset(&app, &reset_token, NEW_PASSWORD).await.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn reset_rejects_malformed_expired_and_weak_tokens_without_consuming_a_valid_one(
    pool: PgPool,
) {
    let data_dir = TempDir::new().unwrap();
    let transport = Arc::new(CapturingTransport::default());
    let app = test_app(pool.clone(), &data_dir, capturing_mailer(transport.clone()));
    register(&app, "person@example.com").await;
    forgot(&app, "person@example.com", None).await;
    let (_, token) = captured_reset(&transport, 0).await;

    for malformed in ["", "not base64!", &"A".repeat(42), &"A".repeat(44)] {
        assert_eq!(
            reset(&app, malformed, NEW_PASSWORD).await.status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    assert_eq!(
        reset(&app, &token, "too short").await.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        reset(&app, &token, NEW_PASSWORD).await.status(),
        StatusCode::NO_CONTENT
    );

    sqlx::query("UPDATE password_reset_tokens SET consumed_at = NULL, expires_at = now() - interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        reset(&app, &token, NEW_PASSWORD).await.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn a_new_request_invalidates_the_previous_reset_link(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let transport = Arc::new(CapturingTransport::default());
    let app = test_app(pool.clone(), &data_dir, capturing_mailer(transport.clone()));
    register(&app, "person@example.com").await;
    forgot(&app, "person@example.com", None).await;
    let (_, first) = captured_reset(&transport, 0).await;
    sqlx::query("UPDATE password_reset_tokens SET created_at = now() - interval '61 seconds'")
        .execute(&pool)
        .await
        .unwrap();

    forgot(&app, "person@example.com", None).await;
    let (_, second) = captured_reset(&transport, 1).await;
    assert_ne!(first, second);
    assert_eq!(
        reset(&app, &first, NEW_PASSWORD).await.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        reset(&app, &second, NEW_PASSWORD).await.status(),
        StatusCode::NO_CONTENT
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn concurrent_reset_attempts_cannot_both_succeed(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let transport = Arc::new(CapturingTransport::default());
    let app = test_app(pool, &data_dir, capturing_mailer(transport.clone()));
    register(&app, "person@example.com").await;
    forgot(&app, "person@example.com", None).await;
    let (_, token) = captured_reset(&transport, 0).await;

    let (first, second) = tokio::join!(
        reset(&app, &token, NEW_PASSWORD),
        reset(&app, &token, "another secure password")
    );
    let statuses = [first.status(), second.status()];
    assert_eq!(
        statuses
            .iter()
            .filter(|status| **status == StatusCode::NO_CONTENT)
            .count(),
        1
    );
    assert_eq!(
        statuses
            .iter()
            .filter(|status| **status == StatusCode::UNPROCESSABLE_ENTITY)
            .count(),
        1
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn disabled_or_failed_smtp_never_changes_the_public_response(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let disabled_app = test_app(pool.clone(), &data_dir, Mailer::disabled());
    register(&disabled_app, "disabled@example.com").await;
    let disabled_existing =
        empty_body(forgot(&disabled_app, "disabled@example.com", None).await).await;
    let disabled_unknown =
        empty_body(forgot(&disabled_app, "unknown@example.com", None).await).await;
    assert_eq!(disabled_existing, (StatusCode::NO_CONTENT, vec![]));
    assert_eq!(disabled_unknown, disabled_existing);
    let disabled_tokens: i64 = sqlx::query_scalar("SELECT count(*) FROM password_reset_tokens")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(disabled_tokens, 0);

    let transport = Arc::new(CapturingTransport::default());
    transport.fail.store(true, Ordering::SeqCst);
    let failing_app = test_app(pool.clone(), &data_dir, capturing_mailer(transport.clone()));
    register(&failing_app, "failing@example.com").await;
    let failed_existing = empty_body(forgot(&failing_app, "failing@example.com", None).await).await;
    let failed_unknown =
        empty_body(forgot(&failing_app, "still-missing@example.com", None).await).await;
    assert_eq!(failed_existing, (StatusCode::NO_CONTENT, vec![]));
    assert_eq!(failed_unknown, failed_existing);
    captured_reset(&transport, 0).await;
    assert_eq!(transport.messages.lock().unwrap().len(), 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn forgot_password_rejects_every_unsafe_return_destination(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let transport = Arc::new(CapturingTransport::default());
    let app = test_app(pool, &data_dir, capturing_mailer(transport.clone()));
    register(&app, "person@example.com").await;

    for return_to in [
        "https://evil.example",
        "//evil.example",
        "javascript:alert(1)",
        "/host",
        "/invite?token=secret",
        "/invite#token=short",
    ] {
        assert_eq!(
            forgot(&app, "person@example.com", Some(return_to))
                .await
                .status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "accepted {return_to}"
        );
    }
    assert!(transport.messages.lock().unwrap().is_empty());
}
