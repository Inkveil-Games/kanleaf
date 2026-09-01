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

fn test_app(pool: PgPool, data_dir: &TempDir) -> axum::Router {
    test_app_with_host(pool, data_dir, None)
}

fn test_app_with_host(pool: PgPool, data_dir: &TempDir, host_email: Option<&str>) -> axum::Router {
    router(
        AppState::new(pool, data_dir.path().to_owned(), Duration::from_secs(3600))
            .with_host_email(host_email.map(|email| NormalizedEmail::new(email).unwrap())),
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
async fn account_setup_persists_defaults_and_never_regresses_a_later_stage(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let token = register(&app, "setup@example.com", "correct horse battery").await;

    let setup = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            "/api/account/setup",
            json!({"display_name": " Setup Person "}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(setup.status(), StatusCode::OK);
    let user = response_json(setup).await;
    assert_eq!(user["display_name"], "Setup Person");
    assert_eq!(user["theme"], "system");
    assert_eq!(user["timezone"], "UTC");
    assert_eq!(user["setup_stage"], "workspace");

    let workspace = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/workspaces",
            json!({"name": "Setup Team", "identifier": "setup-team"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(workspace.status(), StatusCode::CREATED);

    let retry = app
        .oneshot(json_request(
            "PATCH",
            "/api/account/setup",
            json!({"display_name": "Updated Setup Person", "theme": "dark"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(retry.status(), StatusCode::OK);
    let user = response_json(retry).await;
    assert_eq!(user["display_name"], "Updated Setup Person");
    assert_eq!(user["theme"], "dark");
    assert_eq!(user["setup_stage"], "invite");
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_completion_requires_the_first_workspace_to_still_exist(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let token = register(&app, "setup@example.com", "correct horse battery").await;

    let setup = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            "/api/account/setup",
            json!({"display_name": "Setup Person"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(setup.status(), StatusCode::OK);
    let rejected = app
        .clone()
        .oneshot(empty_request("POST", "/api/account/setup/complete", &token))
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);

    sqlx::query("UPDATE users SET setup_stage = 'invite' WHERE email = 'setup@example.com'")
        .execute(&pool)
        .await
        .unwrap();
    let missing_workspace = app
        .clone()
        .oneshot(empty_request("POST", "/api/account/setup/complete", &token))
        .await
        .unwrap();
    assert_eq!(missing_workspace.status(), StatusCode::UNPROCESSABLE_ENTITY);

    sqlx::query("UPDATE users SET setup_stage = 'workspace' WHERE email = 'setup@example.com'")
        .execute(&pool)
        .await
        .unwrap();
    let created = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/workspaces",
            json!({"name": "Setup Team", "identifier": "setup-team"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);

    let completed = app
        .oneshot(empty_request("POST", "/api/account/setup/complete", &token))
        .await
        .unwrap();
    assert_eq!(completed.status(), StatusCode::OK);
    assert_eq!(response_json(completed).await["setup_stage"], "complete");
}

#[sqlx::test(migrations = "./migrations")]
async fn configured_host_can_complete_setup_without_a_workspace(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app_with_host(pool, &data_dir, Some("host@example.com"));
    let token = register(&app, "host@example.com", "correct horse battery").await;

    let setup = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            "/api/account/setup",
            json!({"display_name": "Instance Host"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(setup.status(), StatusCode::OK);

    let completed = app
        .oneshot(empty_request("POST", "/api/account/setup/complete", &token))
        .await
        .unwrap();
    assert_eq!(completed.status(), StatusCode::OK);
    let host = response_json(completed).await;
    assert_eq!(host["setup_stage"], "complete");
    assert!(host["active_workspace_id"].is_null());
}

#[sqlx::test(migrations = "./migrations")]
async fn configured_host_can_recover_invite_setup_without_a_workspace(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app_with_host(pool.clone(), &data_dir, Some("host@example.com"));
    let token = register(&app, "host@example.com", "correct horse battery").await;

    let setup = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            "/api/account/setup",
            json!({"display_name": "Instance Host"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(setup.status(), StatusCode::OK);
    sqlx::query("UPDATE users SET setup_stage = 'invite' WHERE email = 'host@example.com'")
        .execute(&pool)
        .await
        .unwrap();

    let completed = app
        .oneshot(empty_request("POST", "/api/account/setup/complete", &token))
        .await
        .unwrap();
    assert_eq!(completed.status(), StatusCode::OK);
    let host = response_json(completed).await;
    assert_eq!(host["setup_stage"], "complete");
    assert!(host["active_workspace_id"].is_null());
}

#[sqlx::test(migrations = "./migrations")]
async fn invalid_account_setup_does_not_partially_update_the_account(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let token = register(&app, "setup@example.com", "correct horse battery").await;

    let invalid = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            "/api/account/setup",
            json!({
                "display_name": "Changed",
                "theme": "dark",
                "timezone": "GMT+7"
            }),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let account = app
        .oneshot(empty_request("GET", "/api/account", &token))
        .await
        .unwrap();
    let account = response_json(account).await;
    assert_eq!(account["display_name"], "setup");
    assert_eq!(account["theme"], "system");
    assert_eq!(account["setup_stage"], "account");
}

#[sqlx::test(migrations = "./migrations")]
async fn account_details_are_required_before_workspace_creation(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let token = register(&app, "setup@example.com", "correct horse battery").await;

    let rejected = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/workspaces",
            json!({"name": "Bypassed setup", "identifier": "bypassed-setup"}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let workspace_count: i64 = sqlx::query_scalar("SELECT count(*) FROM workspaces")
        .fetch_one(&pool)
        .await
        .unwrap();
    let registry_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM workspace_identifier_registry")
            .fetch_one(&pool)
            .await
            .unwrap();
    let account: (String, Option<Uuid>) = sqlx::query_as(
        "SELECT setup_stage, active_workspace_id FROM users WHERE email = 'setup@example.com'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(workspace_count, 0);
    assert_eq!(registry_count, 0);
    assert_eq!(account, ("account".to_owned(), None));
}

#[sqlx::test(migrations = "./migrations")]
async fn account_details_are_required_before_invitation_acceptance(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let owner_token = register(&app, "owner@example.com", "correct horse battery").await;
    let owner_setup = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            "/api/account/setup",
            json!({"display_name": "Owner"}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(owner_setup.status(), StatusCode::OK);
    let workspace = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/workspaces",
            json!({"name": "Invitation source", "identifier": "invitation-source"}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(workspace.status(), StatusCode::CREATED);
    let workspace_id: Uuid = response_json(workspace).await["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let invitation = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/invitations"),
            json!({"email": "invitee@example.com", "role": "member"}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(invitation.status(), StatusCode::CREATED);
    let invitation_id: Uuid = response_json(invitation).await["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let invitee_token = register(&app, "invitee@example.com", "correct horse battery").await;

    let rejected = app
        .clone()
        .oneshot(empty_request(
            "POST",
            &format!("/api/invitations/{invitation_id}/accept"),
            &invitee_token,
        ))
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let membership_count: i64 = sqlx::query_scalar(
        r#"
        SELECT count(*)
        FROM workspace_memberships
        JOIN users ON users.id = workspace_memberships.user_id
        WHERE workspace_memberships.workspace_id = $1
          AND users.email = 'invitee@example.com'
        "#,
    )
    .bind(workspace_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let accepted_at: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("SELECT accepted_at FROM workspace_invitations WHERE id = $1")
            .bind(invitation_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let account: (String, Option<Uuid>) = sqlx::query_as(
        "SELECT setup_stage, active_workspace_id FROM users WHERE email = 'invitee@example.com'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(membership_count, 0);
    assert_eq!(accepted_at, None);
    assert_eq!(account, ("account".to_owned(), None));
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
