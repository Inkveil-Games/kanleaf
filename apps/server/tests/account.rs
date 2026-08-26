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

async fn register(app: &axum::Router, email: &str, password: &str) -> String {
    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/register",
            json!({"email": email, "password": password}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await["token"]
        .as_str()
        .unwrap()
        .to_owned()
}

async fn login(app: &axum::Router, email: &str, password: &str) -> axum::response::Response {
    app.clone()
        .oneshot(json_request(
            "POST",
            "/api/auth/login",
            json!({"email": email, "password": password}),
            None,
        ))
        .await
        .unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn profile_and_preferences_are_validated_and_persisted(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let token = register(&app, "quang.tran@example.com", "correct horse battery").await;

    let initial = app
        .clone()
        .oneshot(empty_request("GET", "/api/account", &token))
        .await
        .unwrap();
    let initial = response_json(initial).await;
    assert_eq!(initial["display_name"], "quang.tran");
    assert_eq!(initial["theme"], "system");
    assert_eq!(initial["timezone"], "UTC");

    let profile = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            "/api/account/profile",
            json!({"display_name": " Quang Tran "}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(profile.status(), StatusCode::OK);
    assert_eq!(response_json(profile).await["display_name"], "Quang Tran");

    let preferences = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            "/api/account/preferences",
            json!({
                "theme": "dark",
                "timezone": "asia/ho_chi_minh",
                "week_start": "sunday",
                "date_format": "dd_mm_yyyy"
            }),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(preferences.status(), StatusCode::OK);
    let preferences = response_json(preferences).await;
    assert_eq!(preferences["theme"], "dark");
    assert_eq!(preferences["timezone"], "Asia/Ho_Chi_Minh");
    assert_eq!(preferences["week_start"], "sunday");
    assert_eq!(preferences["date_format"], "dd_mm_yyyy");

    let invalid = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            "/api/account/preferences",
            json!({
                "theme": "light",
                "timezone": "GMT+7",
                "week_start": "monday",
                "date_format": "locale"
            }),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let session = app
        .oneshot(empty_request("GET", "/api/session", &token))
        .await
        .unwrap();
    let user = &response_json(session).await["user"];
    assert_eq!(user["display_name"], "Quang Tran");
    assert_eq!(user["timezone"], "Asia/Ho_Chi_Minh");
}

#[sqlx::test(migrations = "./migrations")]
async fn session_revocation_and_password_change_keep_only_the_current_session(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let email = "person@example.com";
    let old_password = "correct horse battery";
    let first_token = register(&app, email, old_password).await;

    let second_login = login(&app, email, old_password).await;
    assert_eq!(second_login.status(), StatusCode::OK);
    let second_token = response_json(second_login).await["token"]
        .as_str()
        .unwrap()
        .to_owned();

    let sessions = app
        .clone()
        .oneshot(empty_request("GET", "/api/account/sessions", &second_token))
        .await
        .unwrap();
    let sessions = response_json(sessions).await;
    assert_eq!(sessions.as_array().unwrap().len(), 2);
    let current_id = sessions
        .as_array()
        .unwrap()
        .iter()
        .find(|session| session["is_current"] == true)
        .unwrap()["id"]
        .as_str()
        .unwrap();
    let other_id = sessions
        .as_array()
        .unwrap()
        .iter()
        .find(|session| session["is_current"] == false)
        .unwrap()["id"]
        .as_str()
        .unwrap();

    let current_revoke = app
        .clone()
        .oneshot(empty_request(
            "DELETE",
            &format!("/api/account/sessions/{current_id}"),
            &second_token,
        ))
        .await
        .unwrap();
    assert_eq!(current_revoke.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let revoke_one = app
        .clone()
        .oneshot(empty_request(
            "DELETE",
            &format!("/api/account/sessions/{other_id}"),
            &second_token,
        ))
        .await
        .unwrap();
    assert_eq!(revoke_one.status(), StatusCode::NO_CONTENT);

    let revoked = app
        .clone()
        .oneshot(empty_request("GET", "/api/session", &first_token))
        .await
        .unwrap();
    assert_eq!(revoked.status(), StatusCode::UNAUTHORIZED);

    let third_login = login(&app, email, old_password).await;
    assert_eq!(third_login.status(), StatusCode::OK);
    let third_token = response_json(third_login).await["token"]
        .as_str()
        .unwrap()
        .to_owned();

    let revoke_others = app
        .clone()
        .oneshot(empty_request(
            "POST",
            "/api/account/sessions/revoke-others",
            &second_token,
        ))
        .await
        .unwrap();
    assert_eq!(revoke_others.status(), StatusCode::NO_CONTENT);

    let revoked = app
        .clone()
        .oneshot(empty_request("GET", "/api/session", &third_token))
        .await
        .unwrap();
    assert_eq!(revoked.status(), StatusCode::UNAUTHORIZED);

    let fourth_login = login(&app, email, old_password).await;
    assert_eq!(fourth_login.status(), StatusCode::OK);
    let fourth_token = response_json(fourth_login).await["token"]
        .as_str()
        .unwrap()
        .to_owned();

    let wrong_current = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/account/password",
            json!({
                "current_password": "this password is wrong",
                "new_password": "a different secure password"
            }),
            Some(&second_token),
        ))
        .await
        .unwrap();
    assert_eq!(wrong_current.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let changed = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/account/password",
            json!({
                "current_password": old_password,
                "new_password": "a different secure password"
            }),
            Some(&second_token),
        ))
        .await
        .unwrap();
    assert_eq!(changed.status(), StatusCode::NO_CONTENT);

    let fourth_session = app
        .clone()
        .oneshot(empty_request("GET", "/api/session", &fourth_token))
        .await
        .unwrap();
    assert_eq!(fourth_session.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        login(&app, email, old_password).await.status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        login(&app, email, "a different secure password")
            .await
            .status(),
        StatusCode::OK
    );

    let current_session = app
        .oneshot(empty_request("GET", "/api/session", &second_token))
        .await
        .unwrap();
    assert_eq!(current_session.status(), StatusCode::OK);
}
