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

async fn account_workspace(app: &axum::Router, token: &str) -> Uuid {
    let setup = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            "/api/account/setup",
            json!({"display_name": "Owner"}),
            Some(token),
        ))
        .await
        .unwrap();
    assert_eq!(setup.status(), StatusCode::OK);
    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/workspaces",
            json!({"name": "Shared Team", "identifier": "shared-team"}),
            Some(token),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap()
}

async fn request_account_deletion(
    app: &axum::Router,
    token: &str,
    password: &str,
) -> axum::response::Response {
    app.clone()
        .oneshot(json_request(
            "DELETE",
            "/api/account",
            json!({"password": password}),
            Some(token),
        ))
        .await
        .unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn delete_account_rejects_wrong_password_and_workspace_ownership(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let token = register(&app, "owner@example.com", "correct horse battery").await;
    let workspace_id = account_workspace(&app, &token).await;
    let vault = data_dir.path().join("vaults/shared-team");
    assert!(vault.is_dir());
    let wrong = request_account_deletion(&app, &token, "incorrect password").await;
    assert_eq!(wrong.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response_json(wrong).await["error"]["message"],
        "Current password is incorrect"
    );
    let blocked = request_account_deletion(&app, &token, "correct horse battery").await;
    assert_eq!(blocked.status(), StatusCode::CONFLICT);
    let message = response_json(blocked).await;
    assert!(
        message["error"]["message"]
            .as_str()
            .unwrap()
            .contains("Shared Team (/shared-team)")
    );
    assert!(vault.is_dir());
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND role = 'owner')")
        .bind(workspace_id).fetch_one(&pool).await.unwrap();
    assert!(exists);
    assert_eq!(
        app.oneshot(empty_request("GET", "/api/session", &token))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn delete_account_preserves_shared_history_and_cleans_personal_references(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let owner_token = register(&app, "owner@example.com", "correct horse battery").await;
    let workspace_id = account_workspace(&app, &owner_token).await;
    let member_token = register(&app, "member@example.com", "correct horse battery").await;
    let member_id: Uuid =
        sqlx::query_scalar("SELECT id FROM users WHERE email = 'member@example.com'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let owner_id: Uuid =
        sqlx::query_scalar("SELECT id FROM users WHERE email = 'owner@example.com'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let task = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            json!({"title": "Shared task"}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(task.status(), StatusCode::CREATED);
    let task_id: Uuid = response_json(task).await["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let project_id = Uuid::new_v4();
    let comment_id = Uuid::new_v4();
    let invitation_id = Uuid::new_v4();
    let shared_view_id = Uuid::new_v4();
    sqlx::raw_sql(&format!(r#"
        INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ('{workspace_id}', '{member_id}', 'admin');
        INSERT INTO projects (id, workspace_id, name, storage_name, identifier, default_state_id, lead_user_id, default_assignee_id)
            SELECT '{project_id}', id, 'Shared project', 'shared-project--abcdef', 'shared-project', default_inbox_state_id, '{member_id}', '{member_id}' FROM workspaces WHERE id = '{workspace_id}';
        INSERT INTO project_modules (id, workspace_id, project_id, name, lead_user_id) VALUES (gen_random_uuid(), '{workspace_id}', '{project_id}', 'Module', '{member_id}');
        INSERT INTO project_memberships (workspace_id, project_id, user_id, role) VALUES ('{workspace_id}', '{project_id}', '{member_id}', 'contributor');
        INSERT INTO task_assignees (workspace_id, task_id, user_id) VALUES ('{workspace_id}', '{task_id}', '{member_id}');
        INSERT INTO task_subscriptions (workspace_id, task_id, user_id) VALUES ('{workspace_id}', '{task_id}', '{member_id}');
        INSERT INTO task_comments (id, workspace_id, task_id, author_id, body) VALUES ('{comment_id}', '{workspace_id}', '{task_id}', '{member_id}', 'Keep this comment');
        INSERT INTO task_comment_revisions (id, workspace_id, task_id, comment_id, editor_id, body) VALUES (gen_random_uuid(), '{workspace_id}', '{task_id}', '{comment_id}', '{member_id}', 'Keep this revision');
        INSERT INTO task_comment_mentions (workspace_id, task_id, comment_id, user_id) VALUES ('{workspace_id}', '{task_id}', '{comment_id}', '{member_id}');
        INSERT INTO task_activity (id, workspace_id, task_id, actor_id, event_type) VALUES (gen_random_uuid(), '{workspace_id}', '{task_id}', '{member_id}', 'task_updated');
        INSERT INTO workspace_invitations (id, workspace_id, email, role, invited_by, token_hash, expires_at) VALUES ('{invitation_id}', '{workspace_id}', 'invited@example.com', 'member', '{member_id}', decode(repeat('01', 32), 'hex'), now() + interval '1 day');
        INSERT INTO notifications (id, recipient_id, workspace_id, task_id, actor_id, notification_type) VALUES
            (gen_random_uuid(), '{member_id}', '{workspace_id}', '{task_id}', '{owner_id}', 'assignment'),
            (gen_random_uuid(), '{owner_id}', '{workspace_id}', '{task_id}', '{member_id}', 'comment');
        INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (gen_random_uuid(), '{member_id}', decode(repeat('02',32),'hex'), now() + interval '1 hour');
        INSERT INTO webhooks (id, workspace_id, name, endpoint_url, project_scope, secret_nonce, signing_key_id, created_by_user_id) VALUES
            (gen_random_uuid(), '{workspace_id}', 'Shared webhook', 'https://example.com/hook', 'all', decode(repeat('03',32),'hex'), 'test', '{member_id}');
        INSERT INTO saved_views (id, workspace_id, owner_id, name, visibility, query_version, query, layout) VALUES
            ('{shared_view_id}', '{workspace_id}', '{member_id}', 'Shared view', 'shared', 2, '{{"version":2,"scope":{{"kind":"workspace"}},"filters":{{}},"sort":[]}}', 'list'),
            (gen_random_uuid(), '{workspace_id}', '{member_id}', 'Personal view', 'personal', 2, '{{"version":2,"scope":{{"kind":"workspace"}},"filters":{{}},"sort":[]}}', 'list');
        INSERT INTO workspace_operations (id, actor_id, workspace_id, kind, state, revision, staging_key, expires_at) VALUES
            (gen_random_uuid(), '{member_id}', '{workspace_id}', 'workspace_export', 'preparing', gen_random_uuid(), gen_random_uuid(), now() + interval '1 hour');
    "#)).execute(&pool).await.unwrap();
    let response = request_account_deletion(&app, &member_token, "correct horse battery").await;
    assert_eq!(
        response.status(),
        StatusCode::NO_CONTENT,
        "{}",
        response_json_if_error(response).await
    );
    for (table, column) in [
        ("task_comments", "author_id"),
        ("task_comment_revisions", "editor_id"),
        ("workspace_invitations", "invited_by"),
        ("webhooks", "created_by_user_id"),
        ("saved_views", "owner_id"),
        ("workspace_operations", "actor_id"),
        ("project_modules", "lead_user_id"),
    ] {
        let count: i64 = sqlx::query_scalar(&format!(
            "SELECT count(*) FROM {table} WHERE {column} IS NULL"
        ))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 1, "{table}");
    }
    for table in [
        "task_assignees",
        "task_subscriptions",
        "task_comment_mentions",
        "project_memberships",
        "password_reset_tokens",
    ] {
        let count: i64 =
            sqlx::query_scalar(&format!("SELECT count(*) FROM {table} WHERE user_id = $1"))
                .bind(member_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 0, "{table}");
    }
    let remaining_notifications: (i64, i64) =
        sqlx::query_as("SELECT count(*), count(actor_id) FROM notifications WHERE task_id = $1")
            .bind(task_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(remaining_notifications, (1, 0));
    let actor: Option<Uuid> =
        sqlx::query_scalar("SELECT actor_id FROM task_activity WHERE event_type = 'task_updated'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(actor, None);
    let project: (Option<Uuid>, Option<Uuid>) =
        sqlx::query_as("SELECT lead_user_id, default_assignee_id FROM projects WHERE id = $1")
            .bind(project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(project, (None, None));
    let projection_state = AppState::new(
        pool.clone(),
        data_dir.path().to_owned(),
        Duration::from_secs(3600),
    );
    kanleaf_server::workspace::register_workspace_vault_paths(&projection_state)
        .await
        .unwrap();
    kanleaf_server::portability::recover_config_projection_jobs(&projection_state)
        .await
        .unwrap();
    let views: Value = serde_json::from_slice(
        &std::fs::read(
            data_dir
                .path()
                .join("vaults/shared-team/.kanleaf/views.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(views["views"].as_array().unwrap().len(), 1);
    assert_eq!(views["views"][0]["name"], "Shared view");
    assert!(views["views"][0]["owner_email"].is_null());
    let operation_state: String = sqlx::query_scalar("SELECT state FROM workspace_operations")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(operation_state, "canceled");
    let staging_key: Uuid = sqlx::query_scalar("SELECT staging_key FROM workspace_operations")
        .fetch_one(&pool)
        .await
        .unwrap();
    let artifacts = data_dir.path().join("operations");
    std::fs::create_dir_all(&artifacts).unwrap();
    let artifact = artifacts.join(format!("{staging_key}.kanleaf.zip"));
    std::fs::write(&artifact, b"interrupted export").unwrap();
    let recovery = AppState::new(
        pool.clone(),
        data_dir.path().to_owned(),
        Duration::from_secs(3600),
    );
    kanleaf_server::portability::recover_export_operations(&recovery)
        .await
        .unwrap();
    assert!(!artifact.exists());
    let operations: i64 = sqlx::query_scalar("SELECT count(*) FROM workspace_operations")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(operations, 0);
    let view = app
        .clone()
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/views/{shared_view_id}"),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(view.status(), StatusCode::OK);
    let view = response_json(view).await;
    assert_eq!(view["name"], "Shared view");
    assert!(view["owner_id"].is_null());
    assert!(
        data_dir
            .path()
            .join("vaults/shared-team/tasks/1.md")
            .is_file()
    );
    assert_eq!(
        app.clone()
            .oneshot(empty_request("GET", "/api/session", &owner_token))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        app.oneshot(empty_request("GET", "/api/session", &member_token))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
}

async fn response_json_if_error(response: axum::response::Response) -> Value {
    if response.status() == StatusCode::NO_CONTENT {
        Value::Null
    } else {
        response_json(response).await
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn delete_account_rechecks_ownership_after_concurrent_transfer(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let owner_token = register(&app, "owner@example.com", "correct horse battery").await;
    let workspace_id = account_workspace(&app, &owner_token).await;
    let target_token = register(&app, "target@example.com", "correct horse battery").await;
    let target_id: Uuid =
        sqlx::query_scalar("SELECT id FROM users WHERE email = 'target@example.com'")
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'admin')",
    )
    .bind(workspace_id)
    .bind(target_id)
    .execute(&pool)
    .await
    .unwrap();
    let mut transfer = pool.begin().await.unwrap();
    let blocker: i32 =
        sqlx::query_scalar("SELECT pg_backend_pid() FROM workspaces WHERE id = $1 FOR UPDATE")
            .bind(workspace_id)
            .fetch_one(&mut *transfer)
            .await
            .unwrap();
    let deleting_app = app.clone();
    let deletion = tokio::spawn(async move {
        request_account_deletion(&deleting_app, &target_token, "correct horse battery").await
    });
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let waiting: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)))")
                .bind(blocker).fetch_one(&pool).await.unwrap();
            if waiting { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }).await.unwrap();
    sqlx::query("UPDATE workspace_memberships SET role = 'admin' WHERE workspace_id = $1 AND role = 'owner'")
        .bind(workspace_id).execute(&mut *transfer).await.unwrap();
    sqlx::query(
        "UPDATE workspace_memberships SET role = 'owner' WHERE workspace_id = $1 AND user_id = $2",
    )
    .bind(workspace_id)
    .bind(target_id)
    .execute(&mut *transfer)
    .await
    .unwrap();
    transfer.commit().await.unwrap();
    assert_eq!(deletion.await.unwrap().status(), StatusCode::CONFLICT);
    assert_eq!(
        request_account_deletion(&app, &owner_token, "correct horse battery")
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
    let owner: Uuid = sqlx::query_scalar(
        "SELECT user_id FROM workspace_memberships WHERE workspace_id = $1 AND role = 'owner'",
    )
    .bind(workspace_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(owner, target_id);
    assert!(data_dir.path().join("vaults/shared-team").is_dir());
}

#[sqlx::test(migrations = "./migrations")]
async fn delete_account_allows_every_non_owner_role_and_requires_authentication(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let owner_token = register(&app, "owner@example.com", "correct horse battery").await;
    let workspace_id = account_workspace(&app, &owner_token).await;
    for role in ["admin", "member", "guest"] {
        let email = format!("{role}@example.com");
        let token = register(&app, &email, "correct horse battery").await;
        sqlx::query("INSERT INTO workspace_memberships (workspace_id, user_id, role) SELECT $1, id, $2 FROM users WHERE email = $3")
            .bind(workspace_id).bind(role).bind(&email).execute(&pool).await.unwrap();
        assert_eq!(
            request_account_deletion(&app, &token, "incorrect password")
                .await
                .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            app.clone()
                .oneshot(empty_request("GET", "/api/session", &token))
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            request_account_deletion(&app, &token, "correct horse battery")
                .await
                .status(),
            StatusCode::NO_CONTENT
        );
    }
    let members: i64 =
        sqlx::query_scalar("SELECT count(*) FROM workspace_memberships WHERE workspace_id = $1")
            .bind(workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(members, 1);
    let response = app
        .oneshot(json_request(
            "DELETE",
            "/api/account",
            json!({"password": "correct horse battery"}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "./migrations")]
async fn delete_account_revokes_every_session_and_allows_host_registration_again(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app_with_host(pool.clone(), &data_dir, Some("host@example.com"));
    let password = "correct horse battery";
    let token = register(&app, "host@example.com", password).await;
    let other = response_json(login(&app, "host@example.com", password).await).await;
    sqlx::query("UPDATE instance_settings SET restricted_access = true")
        .execute(&pool)
        .await
        .unwrap();
    let deleted = app
        .clone()
        .oneshot(json_request(
            "DELETE",
            "/api/account",
            json!({"password": password}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    for table in ["users", "sessions"] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
    for old_token in [&token, other["token"].as_str().unwrap()] {
        let response = app
            .clone()
            .oneshot(empty_request("GET", "/api/session", old_token))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    assert_eq!(
        login(&app, "host@example.com", password).await.status(),
        StatusCode::UNAUTHORIZED
    );
    let replacement = register(&app, "host@example.com", password).await;
    let response = app
        .oneshot(empty_request("GET", "/api/account", &replacement))
        .await
        .unwrap();
    assert_eq!(response_json(response).await["is_host"], true);
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
