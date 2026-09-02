#![cfg(feature = "postgres-tests")]

use std::{fs, time::Duration};

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use http::HeaderValue;
use kanleaf_server::{
    AppState, domain::NormalizedEmail, router, workspace::recover_workspace_deletions,
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tempfile::TempDir;
use tower::ServiceExt;
use uuid::Uuid;

const PASSWORD: &str = "correct horse battery";

fn test_app(pool: PgPool, data_dir: &TempDir) -> axum::Router {
    router(
        AppState::new(pool, data_dir.path().to_owned(), Duration::from_secs(3600))
            .with_host_email(Some(NormalizedEmail::new("host@example.com").unwrap())),
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

async fn response_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), 128 * 1024).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn register(app: &axum::Router, email: &str) -> (String, Uuid) {
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
    let user_id = payload["user"]["id"].as_str().unwrap().parse().unwrap();
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
    (token, user_id)
}

async fn create_workspace(app: &axum::Router, token: &str) -> Uuid {
    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/workspaces",
            json!({"name": "Owner Workspace", "identifier": "owner-workspace"}),
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

fn stage_interrupted_deletion(
    data_dir: &TempDir,
    workspace_id: Uuid,
    export_staging_keys: Vec<Uuid>,
) -> (std::path::PathBuf, std::path::PathBuf) {
    let trash_id = Uuid::new_v4();
    let live = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string());
    let trash = data_dir
        .path()
        .join("vaults/.trash/workspaces")
        .join(format!("{workspace_id}.{trash_id}"));
    let manifest = data_dir
        .path()
        .join("vaults/.trash/workspace-deletions")
        .join(format!("{}.workspace-deletion.json", Uuid::new_v4()));
    fs::create_dir_all(trash.parent().unwrap()).unwrap();
    fs::create_dir_all(manifest.parent().unwrap()).unwrap();
    fs::rename(live, &trash).unwrap();
    fs::write(
        &manifest,
        serde_json::to_vec(&json!({
            "operation": "workspace_delete",
            "workspace_id": workspace_id,
            "trash_id": trash_id,
            "vault_present": true,
            "export_staging_keys": export_staging_keys,
        }))
        .unwrap(),
    )
    .unwrap();
    (trash, manifest)
}

#[sqlx::test(migrations = "./migrations")]
async fn host_deletion_requires_both_confirmations_and_removes_every_managed_copy(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (host_token, host_id) = register(&app, "host@example.com").await;
    let (member_token, _) = register(&app, "member@example.com").await;
    let (owner_token, owner_id) = register(&app, "owner@example.com").await;
    let workspace_id = create_workspace(&app, &owner_token).await;

    let task = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/api/workspaces/{workspace_id}/tasks"),
            json!({"title": "Delete every managed copy"}),
            Some(&owner_token),
        ))
        .await
        .unwrap();
    assert_eq!(task.status(), StatusCode::CREATED);
    let storage_name = response_json(task).await["storage_name"]
        .as_str()
        .unwrap()
        .to_owned();
    let markdown = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string())
        .join("Todo")
        .join(format!("{storage_name}.md"));
    assert!(markdown.exists());

    let staging_key = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO workspace_operations (
            id, actor_id, workspace_id, kind, state, revision, result,
            staging_key, expires_at
        )
        VALUES ($1, $2, $3, 'workspace_export', 'ready', $4, '{}'::jsonb,
                $5, now() + interval '1 hour')
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(owner_id)
    .bind(workspace_id)
    .bind(Uuid::new_v4())
    .bind(staging_key)
    .execute(&pool)
    .await
    .unwrap();
    let export = data_dir
        .path()
        .join("operations")
        .join(format!("{staging_key}.kanleaf.zip"));
    fs::create_dir_all(export.parent().unwrap()).unwrap();
    fs::write(&export, "temporary export").unwrap();

    for (token, identifier, password, expected) in [
        (None, "owner-workspace", PASSWORD, StatusCode::UNAUTHORIZED),
        (
            Some(member_token.as_str()),
            "owner-workspace",
            PASSWORD,
            StatusCode::FORBIDDEN,
        ),
        (
            Some(host_token.as_str()),
            "another-workspace",
            PASSWORD,
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            Some(host_token.as_str()),
            "owner-workspace",
            "definitely wrong password",
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let response = app
            .clone()
            .oneshot(json_request(
                "DELETE",
                &format!("/api/host/workspaces/{workspace_id}"),
                json!({"identifier": identifier, "password": password}),
                token,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
        assert!(markdown.exists());
        assert!(export.exists());
    }

    let deleted = app
        .clone()
        .oneshot(json_request(
            "DELETE",
            &format!("/api/host/workspaces/{workspace_id}"),
            json!({"identifier": "owner-workspace", "password": PASSWORD}),
            Some(&host_token),
        ))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);

    let workspace_count: i64 = sqlx::query_scalar("SELECT count(*) FROM workspaces WHERE id = $1")
        .bind(workspace_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(workspace_count, 0);
    for table in ["workspace_memberships", "tasks", "workspace_operations"] {
        let count: i64 = sqlx::query_scalar(&format!(
            "SELECT count(*) FROM {table} WHERE workspace_id = $1"
        ))
        .bind(workspace_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 0, "{table} should not retain Workspace rows");
    }
    let active_workspace: Option<Uuid> =
        sqlx::query_scalar("SELECT active_workspace_id FROM users WHERE id = $1")
            .bind(owner_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(active_workspace, None);
    let identifier_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM workspace_identifier_registry WHERE workspace_id = $1",
    )
    .bind(workspace_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(identifier_count, 0);
    assert!(!markdown.exists());
    assert!(!export.exists());

    let reused = app
        .oneshot(json_request(
            "POST",
            "/api/workspaces",
            json!({"name": "Replacement", "identifier": "owner-workspace"}),
            Some(&host_token),
        ))
        .await
        .unwrap();
    assert_eq!(reused.status(), StatusCode::CREATED);
    let host_still_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
            .bind(host_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(host_still_exists);
}

#[sqlx::test(migrations = "./migrations")]
async fn password_change_invalidates_an_in_flight_host_deletion(pool: PgPool) {
    const NEW_PASSWORD: &str = "new correct horse battery";

    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (host_token, _) = register(&app, "host@example.com").await;
    let (owner_token, _) = register(&app, "owner@example.com").await;
    let workspace_id = create_workspace(&app, &owner_token).await;
    let mut workspace_gate = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE")
        .bind(workspace_id)
        .execute(&mut *workspace_gate)
        .await
        .unwrap();

    let delete_app = app.clone();
    let delete_token = host_token.clone();
    let deletion = tokio::spawn(async move {
        delete_app
            .oneshot(json_request(
                "DELETE",
                &format!("/api/host/workspaces/{workspace_id}"),
                json!({"identifier": "owner-workspace", "password": PASSWORD}),
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
            Some(&host_token),
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
    .expect("request did not reach its expected lock wait");
}

#[sqlx::test(migrations = "./migrations")]
async fn startup_recovery_restores_an_uncommitted_workspace_deletion(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let state = AppState::new(
        pool.clone(),
        data_dir.path().to_owned(),
        Duration::from_secs(3600),
    );
    let app = router(
        state.clone(),
        vec![HeaderValue::from_static("http://127.0.0.1:1420")],
    );
    let (owner_token, _) = register(&app, "owner@example.com").await;
    let workspace_id = create_workspace(&app, &owner_token).await;
    let live = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string());
    fs::create_dir_all(live.join("Todo")).unwrap();
    fs::write(live.join("Todo/recover.md"), "restore after rollback").unwrap();
    let staging_key = Uuid::new_v4();
    let export = data_dir
        .path()
        .join("operations")
        .join(format!("{staging_key}.kanleaf.zip"));
    fs::create_dir_all(export.parent().unwrap()).unwrap();
    fs::write(&export, "keep while database row exists").unwrap();
    let (trash, manifest) = stage_interrupted_deletion(&data_dir, workspace_id, vec![staging_key]);

    recover_workspace_deletions(&state).await.unwrap();

    assert_eq!(
        fs::read_to_string(live.join("Todo/recover.md")).unwrap(),
        "restore after rollback"
    );
    assert!(!trash.exists());
    assert!(!manifest.exists());
    assert!(export.exists());
}

#[sqlx::test(migrations = "./migrations")]
async fn startup_recovery_purges_a_committed_workspace_deletion(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let state = AppState::new(
        pool.clone(),
        data_dir.path().to_owned(),
        Duration::from_secs(3600),
    );
    let app = router(
        state.clone(),
        vec![HeaderValue::from_static("http://127.0.0.1:1420")],
    );
    let (owner_token, owner_id) = register(&app, "owner@example.com").await;
    let workspace_id = create_workspace(&app, &owner_token).await;
    let live = data_dir
        .path()
        .join("vaults")
        .join(workspace_id.to_string());
    fs::create_dir_all(live.join("Todo")).unwrap();
    fs::write(live.join("Todo/purge.md"), "remove after commit").unwrap();
    let staging_key = Uuid::new_v4();
    let export = data_dir
        .path()
        .join("operations")
        .join(format!("{staging_key}.kanleaf.zip"));
    fs::create_dir_all(export.parent().unwrap()).unwrap();
    fs::write(&export, "remove after commit").unwrap();
    let (trash, manifest) = stage_interrupted_deletion(&data_dir, workspace_id, vec![staging_key]);

    sqlx::query("UPDATE users SET active_workspace_id = NULL WHERE id = $1")
        .bind(owner_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM workspaces WHERE id = $1")
        .bind(workspace_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM workspace_identifier_registry WHERE workspace_id = $1")
        .bind(workspace_id)
        .execute(&pool)
        .await
        .unwrap();

    recover_workspace_deletions(&state).await.unwrap();

    assert!(!live.exists());
    assert!(!trash.exists());
    assert!(!manifest.exists());
    assert!(!export.exists());
}
