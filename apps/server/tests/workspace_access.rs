#![cfg(feature = "postgres-tests")]

use std::time::Duration;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use http::HeaderValue;
use kanleaf_server::{AppState, router};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tempfile::TempDir;
use tower::ServiceExt;
use uuid::Uuid;

const PASSWORD: &str = "correct horse battery";

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
    let bytes = to_bytes(response.into_body(), 128 * 1024).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn register(app: &axum::Router, email: &str) -> (String, Uuid, Uuid) {
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
    let payload = response_json(response).await;
    let token = payload["token"].as_str().unwrap().to_owned();
    let user_id: Uuid = payload["user"]["id"].as_str().unwrap().parse().unwrap();
    let setup = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            "/api/account/setup",
            json!({"display_name": email.split('@').next().unwrap()}),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(setup.status(), StatusCode::OK);
    let created = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/workspaces",
            json!({
                "name": "Personal",
                "identifier": format!("test-{}", &user_id.simple().to_string()[..12])
            }),
            Some(&token),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let workspace_id = response_json(created).await["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let completed = app
        .clone()
        .oneshot(empty_request("POST", "/api/account/setup/complete", &token))
        .await
        .unwrap();
    assert_eq!(completed.status(), StatusCode::OK);
    (token, user_id, workspace_id)
}

async fn invite(
    app: &axum::Router,
    owner_token: &str,
    workspace_id: Uuid,
    email: &str,
    role: &str,
) -> Value {
    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/invitations"),
            json!({"email": email, "role": role}),
            Some(owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await
}

#[sqlx::test(migrations = "./migrations")]
async fn invitation_membership_roles_and_ownership_are_enforced(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, owner_id, workspace_id) = register(&app, "owner@example.com").await;
    let invitation = invite(
        &app,
        &owner_token,
        workspace_id,
        "future.admin@example.com",
        "member",
    )
    .await;
    let invitation_id = invitation["id"].as_str().unwrap();
    let invitation_token = invitation["token"].as_str().unwrap();
    assert_eq!(invitation_token.len(), 43);

    let stored_hash: Vec<u8> =
        sqlx::query_scalar("SELECT token_hash FROM workspace_invitations WHERE id = $1")
            .bind(invitation_id.parse::<Uuid>().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        stored_hash,
        Sha256::digest(invitation_token.as_bytes()).as_slice()
    );
    assert_ne!(stored_hash, invitation_token.as_bytes());

    let duplicate = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/invitations"),
            json!({"email": " FUTURE.ADMIN@example.com ", "role": "admin"}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);

    let (member_token, member_id, _) = register(&app, "future.admin@example.com").await;
    let pending = app
        .clone()
        .oneshot(empty_request("GET", "/api/invitations", &member_token))
        .await
        .unwrap();
    let pending = response_json(pending).await;
    assert_eq!(pending.as_array().unwrap().len(), 1);
    assert_eq!(pending[0]["workspace_id"], workspace_id.to_string());
    assert_eq!(
        pending[0]["workspace_identifier"],
        format!("test-{}", &owner_id.simple().to_string()[..12])
    );

    let accepted = app
        .clone()
        .oneshot(empty_request(
            "POST",
            &format!("/api/invitations/{invitation_id}/accept"),
            &member_token,
        ))
        .await
        .unwrap();
    assert_eq!(accepted.status(), StatusCode::NO_CONTENT);

    let members = app
        .clone()
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/members"),
            &member_token,
        ))
        .await
        .unwrap();
    let members = response_json(members).await;
    assert_eq!(members.as_array().unwrap().len(), 2);
    assert!(
        members
            .as_array()
            .unwrap()
            .iter()
            .any(|member| member["user_id"] == member_id.to_string() && member["role"] == "member")
    );

    let promoted = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/members/{member_id}"),
            json!({"role": "admin"}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(response_json(promoted).await["role"], "admin");

    let admin_rename = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}"),
            json!({"name": "Shared work", "accent": "blue"}),
            Some(&member_token),
        ))
        .await
        .unwrap();
    let admin_rename = response_json(admin_rename).await;
    assert_eq!(admin_rename["name"], "Shared work");
    assert_eq!(admin_rename["accent"], "blue");

    let transferred = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/transfer-ownership"),
            json!({"user_id": member_id}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(transferred.status(), StatusCode::NO_CONTENT);

    let roles: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT user_id, role FROM workspace_memberships WHERE workspace_id = $1 ORDER BY role",
    )
    .bind(workspace_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(roles.contains(&(owner_id, "admin".to_owned())));
    assert!(roles.contains(&(member_id, "owner".to_owned())));

    let former_owner_transfer = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/transfer-ownership"),
            json!({"user_id": owner_id}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(former_owner_transfer.status(), StatusCode::FORBIDDEN);

    let guest = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            &format!("/api/workspaces/{workspace_id}/members/{owner_id}"),
            json!({"role": "guest"}),
            Some(&member_token),
        ))
        .await
        .unwrap();
    assert_eq!(response_json(guest).await["role"], "guest");
    let guest_projects = app
        .oneshot(empty_request(
            "GET",
            &format!("/api/workspaces/{workspace_id}/projects"),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(guest_projects.status(), StatusCode::OK);
    assert!(
        response_json(guest_projects)
            .await
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn invitations_can_be_declined_renewed_revoked_and_accepted_by_token(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, workspace_id) = register(&app, "owner@example.com").await;
    let first = invite(
        &app,
        &owner_token,
        workspace_id,
        "member@example.com",
        "member",
    )
    .await;
    let invitation_id = first["id"].as_str().unwrap();
    let old_token = first["token"].as_str().unwrap();
    let (member_token, member_id, _) = register(&app, "member@example.com").await;
    let (other_token, _, _) = register(&app, "other@example.com").await;

    let wrong_account = app
        .clone()
        .oneshot(empty_request(
            "POST",
            &format!("/api/invitations/{invitation_id}/accept"),
            &other_token,
        ))
        .await
        .unwrap();
    assert_eq!(wrong_account.status(), StatusCode::FORBIDDEN);

    let declined = app
        .clone()
        .oneshot(empty_request(
            "POST",
            &format!("/api/invitations/{invitation_id}/decline"),
            &member_token,
        ))
        .await
        .unwrap();
    assert_eq!(declined.status(), StatusCode::NO_CONTENT);

    let renewed = app
        .clone()
        .oneshot(empty_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/invitations/{invitation_id}/renew"),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(renewed.status(), StatusCode::OK);
    let renewed = response_json(renewed).await;
    let new_token = renewed["token"].as_str().unwrap();
    assert_ne!(new_token, old_token);
    assert_eq!(renewed["status"], "pending");

    let old_rejected = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/invitations/accept-token",
            json!({"token": old_token}),
            Some(&member_token),
        ))
        .await
        .unwrap();
    assert_eq!(old_rejected.status(), StatusCode::CONFLICT);

    sqlx::query("UPDATE users SET setup_stage = 'workspace' WHERE id = $1")
        .bind(member_id)
        .execute(&pool)
        .await
        .unwrap();

    let token_accepted = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/invitations/accept-token",
            json!({"token": new_token}),
            Some(&member_token),
        ))
        .await
        .unwrap();
    assert_eq!(token_accepted.status(), StatusCode::NO_CONTENT);

    let role: String = sqlx::query_scalar(
        "SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2",
    )
    .bind(workspace_id)
    .bind(member_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(role, "member");

    let session = app
        .clone()
        .oneshot(empty_request("GET", "/api/session", &member_token))
        .await
        .unwrap();
    let user = &response_json(session).await["user"];
    assert_eq!(user["active_workspace_id"], workspace_id.to_string());
    assert_eq!(user["setup_stage"], "complete");

    let revoked = invite(
        &app,
        &owner_token,
        workspace_id,
        "revoked@example.com",
        "guest",
    )
    .await;
    let revoked_id = revoked["id"].as_str().unwrap();
    let revoke = app
        .clone()
        .oneshot(empty_request(
            "DELETE",
            &format!("/api/workspaces/{workspace_id}/invitations/{revoked_id}"),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(revoke.status(), StatusCode::NO_CONTENT);

    let expired = invite(
        &app,
        &owner_token,
        workspace_id,
        "expired@example.com",
        "member",
    )
    .await;
    let expired_id: Uuid = expired["id"].as_str().unwrap().parse().unwrap();
    sqlx::query(
        r#"
        UPDATE workspace_invitations
        SET created_at = now() - interval '8 days',
            expires_at = now() - interval '1 day'
        WHERE id = $1
        "#,
    )
    .bind(expired_id)
    .execute(&pool)
    .await
    .unwrap();
    let (expired_token, _, _) = register(&app, "expired@example.com").await;
    let pending = app
        .clone()
        .oneshot(empty_request("GET", "/api/invitations", &expired_token))
        .await
        .unwrap();
    assert!(response_json(pending).await.as_array().unwrap().is_empty());
    let expired_accept = app
        .oneshot(empty_request(
            "POST",
            &format!("/api/invitations/{expired_id}/accept"),
            &expired_token,
        ))
        .await
        .unwrap();
    assert_eq!(expired_accept.status(), StatusCode::CONFLICT);
}

#[sqlx::test(migrations = "./migrations")]
async fn leaving_removal_and_workspace_deletion_keep_active_workspace_valid(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, personal_workspace) = register(&app, "owner@example.com").await;
    let created = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/workspaces",
            json!({"name": "Delete me", "accent": "rose"}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    let deleted_workspace: Uuid = response_json(created).await["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let task = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{deleted_workspace}/tasks"),
            json!({"title": "Keep this until confirmation"}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    let task = response_json(task).await;
    let task_storage_name = task["storage_name"].as_str().unwrap();
    let task_path = data_dir
        .path()
        .join("vaults")
        .join(deleted_workspace.to_string())
        .join("Todo")
        .join(format!("{task_storage_name}.md"));
    assert!(task_path.exists());

    let wrong_confirmation = app
        .clone()
        .oneshot(json_request(
            "DELETE",
            &format!("/api/workspaces/{deleted_workspace}"),
            json!({"name": "delete me", "password": PASSWORD}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(
        wrong_confirmation.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert!(task_path.exists());

    let deleted = app
        .clone()
        .oneshot(json_request(
            "DELETE",
            &format!("/api/workspaces/{deleted_workspace}"),
            json!({"name": "Delete me", "password": PASSWORD}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    assert!(!task_path.exists());
    let active: Option<Uuid> =
        sqlx::query_scalar("SELECT active_workspace_id FROM users WHERE email = $1")
            .bind("owner@example.com")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(active, Some(personal_workspace));

    let (member_token, member_id, member_personal) = register(&app, "member@example.com").await;
    let invitation = invite(
        &app,
        &owner_token,
        personal_workspace,
        "member@example.com",
        "member",
    )
    .await;
    let invitation_id = invitation["id"].as_str().unwrap();
    let accepted = app
        .clone()
        .oneshot(empty_request(
            "POST",
            &format!("/api/invitations/{invitation_id}/accept"),
            &member_token,
        ))
        .await
        .unwrap();
    assert_eq!(accepted.status(), StatusCode::NO_CONTENT);
    let activated = app
        .clone()
        .oneshot(empty_request(
            "POST",
            &format!("/api/workspaces/{personal_workspace}/activate"),
            &member_token,
        ))
        .await
        .unwrap();
    assert_eq!(activated.status(), StatusCode::NO_CONTENT);
    let removed = app
        .clone()
        .oneshot(empty_request(
            "DELETE",
            &format!("/api/workspaces/{personal_workspace}/members/{member_id}"),
            &owner_token,
        ))
        .await
        .unwrap();
    assert_eq!(removed.status(), StatusCode::NO_CONTENT);
    let member_active: Option<Uuid> =
        sqlx::query_scalar("SELECT active_workspace_id FROM users WHERE id = $1")
            .bind(member_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(member_active, Some(member_personal));
}

#[sqlx::test(migrations = "./migrations")]
async fn failed_database_deletion_restores_the_workspace_vault(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, workspace_id) = register(&app, "owner@example.com").await;
    let task = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            json!({"title": "Restore my vault"}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    let task = response_json(task).await;
    let task_storage_name = task["storage_name"].as_str().unwrap();
    let task_path = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Todo")
        .join(format!("{task_storage_name}.md"));

    sqlx::query(
        r#"
        CREATE FUNCTION reject_workspace_deletion() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'test deletion failure';
        END
        $$
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        CREATE TRIGGER reject_workspace_deletion
        BEFORE DELETE ON workspaces
        FOR EACH ROW EXECUTE FUNCTION reject_workspace_deletion()
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    let failed = app
        .oneshot(json_request(
            "DELETE",
            &format!("/api/workspaces/{workspace_id}"),
            json!({"name": "Personal", "password": PASSWORD}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(failed.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert!(task_path.exists());
    let workspace_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = $1)")
            .bind(workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(workspace_exists);
}

#[sqlx::test(migrations = "./migrations")]
async fn ownership_transfer_invalidates_an_in_flight_owner_deletion(pool: PgPool) {
    const TRANSFER_GATE: i64 = 8_752_341;

    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, owner_id, workspace_id) = register(&app, "owner@example.com").await;
    let (_successor_token, successor_id, _) = register(&app, "successor@example.com").await;
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'admin')",
    )
    .bind(workspace_id)
    .bind(successor_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        CREATE FUNCTION hold_owner_demotion() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF OLD.role = 'owner' AND NEW.role = 'admin' THEN
                PERFORM pg_advisory_xact_lock(8752341);
            END IF;
            RETURN NEW;
        END
        $$
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        CREATE TRIGGER hold_owner_demotion
        BEFORE UPDATE ON workspace_memberships
        FOR EACH ROW EXECUTE FUNCTION hold_owner_demotion()
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut gate = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(TRANSFER_GATE)
        .execute(&mut *gate)
        .await
        .unwrap();

    let transfer_app = app.clone();
    let transfer_token = owner_token.clone();
    let transfer = tokio::spawn(async move {
        transfer_app
            .oneshot(json_request(
                "POST",
                &format!("/api/workspaces/{workspace_id}/transfer-ownership"),
                json!({"user_id": successor_id}),
                Some(&transfer_token),
            ))
            .await
            .unwrap()
    });
    wait_for_lock_waiters(&pool, 1).await;

    let delete_app = app.clone();
    let delete_token = owner_token.clone();
    let deletion = tokio::spawn(async move {
        delete_app
            .oneshot(json_request(
                "DELETE",
                &format!("/api/workspaces/{workspace_id}"),
                json!({"name": "Personal", "password": PASSWORD}),
                Some(&delete_token),
            ))
            .await
            .unwrap()
    });
    wait_for_lock_waiters(&pool, 2).await;
    let unlocked: bool = sqlx::query_scalar("SELECT pg_advisory_unlock($1)")
        .bind(TRANSFER_GATE)
        .fetch_one(&mut *gate)
        .await
        .unwrap();
    assert!(unlocked);

    let transferred = transfer.await.unwrap();
    assert_eq!(transferred.status(), StatusCode::NO_CONTENT);
    let rejected = deletion.await.unwrap();
    assert_eq!(rejected.status(), StatusCode::FORBIDDEN);

    let workspace_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = $1)")
            .bind(workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let roles: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT user_id, role FROM workspace_memberships WHERE workspace_id = $1 ORDER BY user_id",
    )
    .bind(workspace_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(workspace_exists);
    assert!(roles.contains(&(owner_id, "admin".to_owned())));
    assert!(roles.contains(&(successor_id, "owner".to_owned())));
    let successor_workspace_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM workspace_memberships WHERE user_id = $1 AND workspace_id <> $2",
    )
    .bind(successor_id)
    .bind(workspace_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(successor_workspace_count, 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn password_change_invalidates_an_in_flight_owner_deletion(pool: PgPool) {
    const NEW_PASSWORD: &str = "new correct horse battery";

    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, workspace_id) = register(&app, "owner@example.com").await;
    let mut workspace_gate = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE")
        .bind(workspace_id)
        .execute(&mut *workspace_gate)
        .await
        .unwrap();

    let delete_app = app.clone();
    let delete_token = owner_token.clone();
    let deletion = tokio::spawn(async move {
        delete_app
            .oneshot(json_request(
                "DELETE",
                &format!("/api/workspaces/{workspace_id}"),
                json!({"name": "Personal", "password": PASSWORD}),
                Some(&delete_token),
            ))
            .await
            .unwrap()
    });
    wait_for_lock_waiters(&pool, 1).await;

    let changed = app
        .oneshot(json_request(
            "POST",
            "/api/account/password",
            json!({"current_password": PASSWORD, "new_password": NEW_PASSWORD}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(changed.status(), StatusCode::NO_CONTENT);
    workspace_gate.commit().await.unwrap();

    let rejected = deletion.await.unwrap();
    assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let workspace_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = $1)")
            .bind(workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(workspace_exists);
}

async fn wait_for_lock_waiters(pool: &PgPool, expected: i64) {
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let waiting: i64 = sqlx::query_scalar(
                r#"
                SELECT count(*)
                FROM pg_stat_activity
                WHERE datname = current_database() AND wait_event_type = 'Lock'
                "#,
            )
            .fetch_one(pool)
            .await
            .unwrap();
            if waiting >= expected {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("requests did not reach their expected lock waits");
}

#[sqlx::test(migrations = "./migrations")]
async fn a_non_owner_can_leave_their_final_workspace(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (_owner_token, _, owner_workspace) = register(&app, "owner@example.com").await;
    let (member_token, member_id, member_workspace) = register(&app, "member@example.com").await;

    let delete_own_workspace = app
        .clone()
        .oneshot(json_request(
            "DELETE",
            &format!("/api/workspaces/{member_workspace}"),
            json!({"name": "Personal", "password": PASSWORD}),
            Some(&member_token),
        ))
        .await
        .unwrap();
    assert_eq!(delete_own_workspace.status(), StatusCode::NO_CONTENT);

    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')",
    )
    .bind(owner_workspace)
    .bind(member_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE users SET active_workspace_id = $1 WHERE id = $2")
        .bind(owner_workspace)
        .bind(member_id)
        .execute(&pool)
        .await
        .unwrap();

    let left = app
        .oneshot(empty_request(
            "POST",
            &format!("/api/workspaces/{owner_workspace}/leave"),
            &member_token,
        ))
        .await
        .unwrap();
    assert_eq!(left.status(), StatusCode::NO_CONTENT);

    let active: Option<Uuid> =
        sqlx::query_scalar("SELECT active_workspace_id FROM users WHERE id = $1")
            .bind(member_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(active, None);
}
