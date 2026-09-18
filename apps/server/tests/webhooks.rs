#![cfg(feature = "postgres-tests")]

use axum::{
    Router,
    body::{Body, Bytes, to_bytes},
    extract::State,
    http::{HeaderMap, Request, StatusCode},
    routing::post,
};
use kanleaf_server::{
    AppState, router,
    webhook::{SigningKey, WebhookPolicy, dispatch_events, process_delivery, validate_signing_key},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tempfile::TempDir;
use tokio::{
    sync::{Notify, mpsc},
    task::JoinHandle,
};
use tower::ServiceExt;
use uuid::Uuid;

struct Fixture {
    state: AppState,
    app: Router,
    token: String,
    user: Uuid,
    workspace: Uuid,
    project: Uuid,
    _dir: TempDir,
}
fn configured_state(pool: PgPool, dir: &TempDir) -> AppState {
    AppState::new(pool, dir.path().to_owned(), Duration::from_secs(3600)).with_webhooks(
        Some(SigningKey::parse("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=").unwrap()),
        WebhookPolicy {
            allow_http: true,
            allow_private_networks: true,
            request_timeout: Duration::from_millis(500),
        },
    )
}
async fn request(
    app: &Router,
    token: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 8 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap()
        },
    )
}
async fn register(app: &Router, email: &str) -> (String, Uuid, Uuid) {
    let (status, body) = request(
        app,
        "",
        "POST",
        "/api/auth/register",
        Some(json!({"email":email,"password":"correct horse battery"})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let token = body["token"].as_str().unwrap().to_owned();
    let user = body["user"]["id"].as_str().unwrap().parse().unwrap();
    assert_eq!(
        request(
            app,
            &token,
            "PATCH",
            "/api/account/setup",
            Some(json!({"display_name":"Webhook tester"}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let (status, workspace) = request(
        app,
        &token,
        "POST",
        "/api/workspaces",
        Some(json!({"name":"Webhook test"})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    (
        token,
        user,
        workspace["id"].as_str().unwrap().parse().unwrap(),
    )
}
async fn project(app: &Router, token: &str, workspace: Uuid, name: &str) -> Uuid {
    let (status, body) = request(
        app,
        token,
        "POST",
        &format!("/api/workspaces/{workspace}/projects"),
        Some(json!({"name":name})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().parse().unwrap()
}
async fn fixture(pool: PgPool) -> Fixture {
    let dir = TempDir::new().unwrap();
    let state = configured_state(pool, &dir);
    let app = router(state.clone(), vec![]);
    let (token, user, workspace) = register(&app, "owner@example.com").await;
    let project = project(&app, &token, workspace, "Backend").await;
    Fixture {
        state,
        app,
        token,
        user,
        workspace,
        project,
        _dir: dir,
    }
}
fn input(endpoint: &str) -> Value {
    json!({"name":"Automation","endpoint_url":endpoint,"project_scope":"all","project_ids":[],"event_types":["task.created","task.updated","task.deleted","comment.created","comment.updated","comment.deleted"],"enabled":true})
}
async fn create(f: &Fixture, body: Value) -> Value {
    let (status, body) = request(
        &f.app,
        &f.token,
        "POST",
        &format!("/api/workspaces/{}/webhooks", f.workspace),
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body
}
async fn task(f: &Fixture, project: Uuid) -> Uuid {
    let (status, body) = request(
        &f.app,
        &f.token,
        "POST",
        &format!("/api/workspaces/{}/tasks", f.workspace),
        Some(json!({"title":"Useful event","project_id":project})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().parse().unwrap()
}
fn hook_id(body: &Value) -> Uuid {
    body["webhook"]["id"].as_str().unwrap().parse().unwrap()
}
fn hook_path(f: &Fixture, id: Uuid) -> String {
    format!("/api/workspaces/{}/webhooks/{id}", f.workspace)
}
async fn recent(f: &Fixture, id: Uuid) -> Value {
    let (status, body) = request(
        &f.app,
        &f.token,
        "GET",
        &format!("{}/deliveries", hook_path(f, id)),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    body
}

struct Receiver {
    url: String,
    requests: mpsc::UnboundedReceiver<(HeaderMap, Bytes)>,
    count: Arc<AtomicUsize>,
    handle: JoinHandle<()>,
}
impl Drop for Receiver {
    fn drop(&mut self) {
        self.handle.abort();
    }
}
#[derive(Clone)]
struct ReceiverState {
    sender: mpsc::UnboundedSender<(HeaderMap, Bytes)>,
    count: Arc<AtomicUsize>,
    status: StatusCode,
    delay: Duration,
    release: Option<Arc<Notify>>,
}
async fn receive(
    State(state): State<ReceiverState>,
    headers: HeaderMap,
    body: Bytes,
) -> StatusCode {
    state.count.fetch_add(1, Ordering::SeqCst);
    state.sender.send((headers, body)).unwrap();
    if let Some(release) = state.release {
        release.notified().await;
    }
    tokio::time::sleep(state.delay).await;
    state.status
}
async fn receiver(status: StatusCode, delay: Duration) -> Receiver {
    receiver_with_release(status, delay, None).await
}
async fn receiver_with_release(
    status: StatusCode,
    delay: Duration,
    release: Option<Arc<Notify>>,
) -> Receiver {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/receive", listener.local_addr().unwrap());
    let (sender, requests) = mpsc::unbounded_channel();
    let count = Arc::new(AtomicUsize::new(0));
    let app = Router::new()
        .route("/receive", post(receive))
        .with_state(ReceiverState {
            sender,
            count: count.clone(),
            status,
            delay,
            release,
        });
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Receiver {
        url,
        requests,
        count,
        handle,
    }
}

#[sqlx::test]
async fn management_checks_current_roles_tenants_inputs_and_one_time_secrets(pool: PgPool) {
    let f = fixture(pool).await;
    let created = create(&f, input("http://127.0.0.1:9/receive")).await;
    let id = hook_id(&created);
    let secret = created["signing_secret"].as_str().unwrap();
    assert!(secret.starts_with("klf_whsec_"));
    for path in [
        hook_path(&f, id),
        format!("/api/workspaces/{}/webhooks", f.workspace),
    ] {
        let (status, body) = request(&f.app, &f.token, "GET", &path, None).await;
        assert_eq!(status, StatusCode::OK);
        assert!(!body.to_string().contains(secret));
        assert!(!body.to_string().contains("secret_nonce"));
        assert!(!body.to_string().contains("signing_secret"));
    }
    let (status, new_secret) = request(
        &f.app,
        &f.token,
        "POST",
        &format!("{}/secret", hook_path(&f, id)),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_ne!(new_secret["signing_secret"], created["signing_secret"]);
    validate_signing_key(&f.state).await.unwrap();
    let changed = f.state.clone().with_webhooks(
        Some(SigningKey::parse("AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=").unwrap()),
        WebhookPolicy::default(),
    );
    assert!(validate_signing_key(&changed).await.is_err());
    let (other_token, user, other_workspace) = register(&f.app, "other@example.com").await;
    let foreign = project(&f.app, &other_token, other_workspace, "Foreign").await;
    sqlx::query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role").bind(f.workspace).bind(user).bind("admin").execute(&f.state.pool).await.unwrap();
    for (method, suffix, body) in [
        ("GET", "", None),
        ("PATCH", "", Some(input("http://127.0.0.1:9/receive"))),
        ("PATCH", "/enabled", Some(json!({"enabled":true}))),
        ("POST", "/secret", None),
        ("POST", "/test", None),
        ("GET", "/deliveries", None),
    ] {
        let (status, _) = request(
            &f.app,
            &other_token,
            method,
            &format!("{}{suffix}", hook_path(&f, id)),
            body,
        )
        .await;
        assert_eq!(
            status,
            if suffix == "/test" {
                StatusCode::ACCEPTED
            } else {
                StatusCode::OK
            },
            "admin {suffix}"
        );
    }
    let (status, body) = request(
        &f.app,
        &other_token,
        "POST",
        &format!("/api/workspaces/{}/webhooks", f.workspace),
        Some(input("http://127.0.0.1:9/receive")),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(
        request(&f.app, &other_token, "DELETE", &hook_path(&f, id), None)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    // Recreate after the Admin delete, then revoke that current membership.
    let id = hook_id(&create(&f, input("http://127.0.0.1:9/receive")).await);
    for role in ["member", "guest"] {
        sqlx::query(
            "UPDATE workspace_memberships SET role=$1 WHERE workspace_id=$2 AND user_id=$3",
        )
        .bind(role)
        .bind(f.workspace)
        .bind(user)
        .execute(&f.state.pool)
        .await
        .unwrap();
        for (method, suffix, body) in [
            ("GET", "", None),
            ("PATCH", "", Some(input("http://127.0.0.1:9/receive"))),
            ("DELETE", "", None),
            ("PATCH", "/enabled", Some(json!({"enabled":false}))),
            ("POST", "/secret", None),
            ("POST", "/test", None),
            ("GET", "/deliveries", None),
        ] {
            assert_eq!(
                request(
                    &f.app,
                    &other_token,
                    method,
                    &format!("{}{suffix}", hook_path(&f, id)),
                    body
                )
                .await
                .0,
                StatusCode::FORBIDDEN,
                "{role} {suffix}"
            );
        }
        assert_eq!(
            request(
                &f.app,
                &other_token,
                "POST",
                &format!("/api/workspaces/{}/webhooks", f.workspace),
                Some(input("http://127.0.0.1:9/receive"))
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
    }
    sqlx::query("DELETE FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2")
        .bind(f.workspace)
        .bind(user)
        .execute(&f.state.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&f.app, &other_token, "GET", &hook_path(&f, id), None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(
            &f.app,
            &other_token,
            "GET",
            &format!("/api/workspaces/{other_workspace}/webhooks/{id}"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    for patch in [
        json!({"project_scope":"selected","project_ids":[]}),
        json!({"project_scope":"selected","project_ids":[foreign]}),
        json!({"event_types":[]}),
        json!({"event_types":["task.completed"]}),
        json!({"event_types":["webhook.test"]}),
        json!({"event_types":["task.created","task.created"]}),
        json!({"endpoint_url":"http://user:password@127.0.0.1"}),
    ] {
        let mut body = input("http://127.0.0.1:9/receive");
        for (key, value) in patch.as_object().unwrap() {
            body[key] = value.clone();
        }
        let (status, error) = request(
            &f.app,
            &f.token,
            "POST",
            &format!("/api/workspaces/{}/webhooks", f.workspace),
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
        assert!(!error.to_string().contains("password@"));
    }
}

#[sqlx::test]
async fn committed_task_comment_events_filters_independent_deliveries_and_cascades(pool: PgPool) {
    let f = fixture(pool).await;
    let good = receiver(StatusCode::NO_CONTENT, Duration::ZERO).await;
    let bad = receiver(StatusCode::BAD_GATEWAY, Duration::ZERO).await;
    let all = hook_id(&create(&f, input(&good.url)).await);
    let mut selected = input(&bad.url);
    selected["project_scope"] = json!("selected");
    selected["project_ids"] = json!([f.project]);
    selected["event_types"] = json!(["task.updated"]);
    let selected = hook_id(&create(&f, selected).await);
    let other = project(&f.app, &f.token, f.workspace, "Frontend").await;
    let id = task(&f, f.project).await;
    let (_, inbox) = request(
        &f.app,
        &f.token,
        "POST",
        &format!("/api/workspaces/{}/tasks", f.workspace),
        Some(json!({"title":"Inbox"})),
    )
    .await;
    assert!(inbox["id"].is_string());
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM domain_events")
        .fetch_one(&f.state.pool)
        .await
        .unwrap();
    assert_eq!(before, 1);
    let task_path = format!("/api/workspaces/{}/tasks/{id}", f.workspace);
    assert_eq!(
        request(
            &f.app,
            &f.token,
            "PATCH",
            &task_path,
            Some(json!({"title":"Changed","priority":"high"}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let after: i64 = sqlx::query_scalar("SELECT count(*) FROM domain_events")
        .fetch_one(&f.state.pool)
        .await
        .unwrap();
    assert_eq!(after, before + 1);
    let update: String =
        sqlx::query_scalar("SELECT raw_body FROM domain_events WHERE event_type='task.updated'")
            .fetch_one(&f.state.pool)
            .await
            .unwrap();
    let update: Value = serde_json::from_str(&update).unwrap();
    assert_eq!(update["data"]["task"]["reference"], "#1");
    assert_eq!(
        update["data"]["changed_fields"],
        json!(["title", "priority"])
    );
    assert_eq!(update["actor"]["id"], f.user.to_string());
    assert_eq!(
        request(
            &f.app,
            &f.token,
            "PATCH",
            &task_path,
            Some(json!({"title":""}))
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM domain_events")
            .fetch_one(&f.state.pool)
            .await
            .unwrap(),
        after
    );
    let (_, comment) = request(
        &f.app,
        &f.token,
        "POST",
        &format!("{task_path}/comments"),
        Some(json!({"body":"Comment example"})),
    )
    .await;
    let comment_id = comment["id"].as_str().unwrap();
    assert_eq!(
        request(
            &f.app,
            &f.token,
            "PATCH",
            &format!("{task_path}/comments/{comment_id}"),
            Some(json!({"body":"Edited comment"}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &f.app,
            &f.token,
            "DELETE",
            &format!("{task_path}/comments/{comment_id}"),
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let deleted: String =
        sqlx::query_scalar("SELECT raw_body FROM domain_events WHERE event_type='comment.deleted'")
            .fetch_one(&f.state.pool)
            .await
            .unwrap();
    assert!(!deleted.contains("Edited comment"));
    assert!(
        !serde_json::from_str::<Value>(&deleted).unwrap()["data"]["comment"]
            .as_object()
            .unwrap()
            .contains_key("body")
    );
    task(&f, other).await;
    let (first, second) = tokio::join!(dispatch_events(&f.state), dispatch_events(&f.state));
    assert_eq!(first.unwrap() + second.unwrap(), 6);
    assert_eq!(recent(&f, all).await.as_array().unwrap().len(), 6);
    assert_eq!(recent(&f, selected).await.as_array().unwrap().len(), 1);
    for _ in 0..7 {
        process_delivery(&f.state).await.unwrap();
    }
    assert!(
        recent(&f, all)
            .await
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["status"] == "succeeded")
    );
    assert_eq!(recent(&f, selected).await[0]["status"], "pending");
    assert_eq!(
        request(
            &f.app,
            &f.token,
            "PATCH",
            &format!("{}/enabled", hook_path(&f, selected)),
            Some(json!({"enabled":false}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(recent(&f, selected).await[0]["status"], "canceled");
    assert_eq!(
        request(
            &f.app,
            &f.token,
            "PATCH",
            &task_path,
            Some(json!({"priority":"low"}))
        )
        .await
        .0,
        StatusCode::OK
    );
    dispatch_events(&f.state).await.unwrap();
    assert_eq!(recent(&f, selected).await.as_array().unwrap().len(), 1);
    assert_eq!(
        request(
            &f.app,
            &f.token,
            "POST",
            &format!("{task_path}/delete"),
            Some(json!({"reference":"wrong"}))
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        request(
            &f.app,
            &f.token,
            "POST",
            &format!("{task_path}/delete"),
            Some(json!({"reference":"#1"}))
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM domain_events WHERE event_type='task.deleted'"
        )
        .fetch_one(&f.state.pool)
        .await
        .unwrap(),
        1
    );
    dispatch_events(&f.state).await.unwrap();
    sqlx::query("DELETE FROM projects WHERE id=$1")
        .bind(f.project)
        .execute(&f.state.pool)
        .await
        .unwrap();
    assert!(
        request(&f.app, &f.token, "GET", &hook_path(&f, selected), None)
            .await
            .1["projects"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    sqlx::query("DELETE FROM workspaces WHERE id=$1")
        .bind(f.workspace)
        .execute(&f.state.pool)
        .await
        .unwrap();
    for table in [
        "webhooks",
        "webhook_projects",
        "webhook_event_subscriptions",
        "webhook_deliveries",
        "domain_events",
        "domain_event_outbox",
    ] {
        let count = sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(&f.state.pool)
            .await
            .unwrap();
        assert_eq!(count, 0, "{table}");
    }
}

#[sqlx::test]
async fn durable_attempts_sign_exact_bytes_claim_once_retry_and_exhaust(pool: PgPool) {
    let f = fixture(pool).await;
    let mut receiver = receiver(StatusCode::NO_CONTENT, Duration::from_millis(100)).await;
    let created = create(&f, input(&receiver.url)).await;
    let id = hook_id(&created);
    let (status, delivery) = request(
        &f.app,
        &f.token,
        "POST",
        &format!("{}/test", hook_path(&f, id)),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(delivery["event_type"], "webhook.test");
    let reconstructed = configured_state(f.state.pool.clone(), &f._dir);
    let (first, second) =
        tokio::join!(process_delivery(&f.state), process_delivery(&reconstructed));
    assert_ne!(first.unwrap(), second.unwrap());
    let (headers, body) = receiver.requests.recv().await.unwrap();
    assert_eq!(receiver.count.load(Ordering::SeqCst), 1);
    assert_eq!(
        headers["x-kanleaf-delivery"],
        delivery["id"].as_str().unwrap()
    );
    let timestamp = headers["x-kanleaf-timestamp"].to_str().unwrap();
    let signed = [timestamp.as_bytes(), b".", &body].concat();
    let key = ring::hmac::Key::new(
        ring::hmac::HMAC_SHA256,
        created["signing_secret"].as_str().unwrap().as_bytes(),
    );
    let hex = ring::hmac::sign(&key, &signed)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    assert_eq!(headers["x-kanleaf-signature"], format!("v1={hex}"));
    let row = recent(&f, id).await;
    assert_eq!(row[0]["status"], "succeeded");
    assert_eq!(row[0]["http_status"], 204);
    assert!(row[0]["duration_ms"].as_i64().unwrap() >= 90);
    let regenerated = request(
        &f.app,
        &f.token,
        "POST",
        &format!("{}/secret", hook_path(&f, id)),
        None,
    )
    .await
    .1;
    request(
        &f.app,
        &f.token,
        "POST",
        &format!("{}/test", hook_path(&f, id)),
        None,
    )
    .await;
    process_delivery(&f.state).await.unwrap();
    let (headers, body) = receiver.requests.recv().await.unwrap();
    let bytes = [headers["x-kanleaf-timestamp"].as_bytes(), b".", &body].concat();
    let new_key = ring::hmac::Key::new(
        ring::hmac::HMAC_SHA256,
        regenerated["signing_secret"].as_str().unwrap().as_bytes(),
    );
    let new_hex = ring::hmac::sign(&new_key, &bytes)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    assert_eq!(headers["x-kanleaf-signature"], format!("v1={new_hex}"));
    assert_ne!(
        ring::hmac::sign(&key, &bytes).as_ref(),
        ring::hmac::sign(&new_key, &bytes).as_ref()
    );
    let mut failed_receiver = receiver_for_failure().await;
    let failure = hook_id(&create(&f, input(&failed_receiver.url)).await);
    task(&f, f.project).await;
    dispatch_events(&f.state).await.unwrap();
    // Finish the successful hook's delivery while retrying the independent failure.
    for _ in 0..2 {
        process_delivery(&reconstructed).await.unwrap();
    }
    let first = recent(&f, failure).await;
    let stable_id = first[0]["id"].clone();
    assert_eq!(first[0]["attempt_count"], 1);
    assert_eq!(first[0]["status"], "pending");
    for attempt in 2..=6 {
        sqlx::query("UPDATE webhook_deliveries SET next_attempt_at=now() WHERE webhook_id=$1 AND status='pending'").bind(failure).execute(&f.state.pool).await.unwrap();
        process_delivery(&reconstructed).await.unwrap();
        let row = recent(&f, failure).await;
        assert_eq!(row[0]["attempt_count"], attempt);
        assert_eq!(row[0]["id"], stable_id);
    }
    let row = recent(&f, failure).await;
    assert_eq!(row[0]["status"], "failed");
    assert_eq!(row[0]["http_status"], 502);
    assert_eq!(failed_receiver.count.load(Ordering::SeqCst), 6);
    let mut bodies = Vec::new();
    while let Ok((headers, body)) = failed_receiver.requests.try_recv() {
        assert_eq!(headers["x-kanleaf-delivery"], stable_id.as_str().unwrap());
        bodies.push(body);
    }
    assert!(bodies.windows(2).all(|pair| pair[0] == pair[1]));
}
async fn receiver_for_failure() -> Receiver {
    receiver(StatusCode::BAD_GATEWAY, Duration::ZERO).await
}

#[sqlx::test]
async fn property_edits_and_failed_commit_obey_the_event_transaction(pool: PgPool) {
    let f = fixture(pool).await;
    let id = task(&f, f.project).await;
    let (status, property) = request(
        &f.app,
        &f.token,
        "POST",
        &format!("/api/workspaces/{}/properties", f.workspace),
        Some(json!({"name":"External reference","type":"text","description":""})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let property = property["id"].as_str().unwrap();
    let path = format!(
        "/api/workspaces/{}/tasks/{id}/properties/{property}",
        f.workspace
    );
    for _ in 0..2 {
        assert_eq!(
            request(
                &f.app,
                &f.token,
                "PUT",
                &path,
                Some(json!({"value":"external-42"}))
            )
            .await
            .0,
            StatusCode::OK
        );
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM domain_events WHERE event_type='task.updated'"
        )
        .fetch_one(&f.state.pool)
        .await
        .unwrap(),
        1
    );
    assert_eq!(
        request(&f.app, &f.token, "DELETE", &path, None).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM domain_events WHERE event_type='task.updated'"
        )
        .fetch_one(&f.state.pool)
        .await
        .unwrap(),
        2
    );
    assert_eq!(
        request(&f.app, &f.token, "PUT", &path, Some(json!({"value":123})))
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM domain_events WHERE event_type='task.updated'"
        )
        .fetch_one(&f.state.pool)
        .await
        .unwrap(),
        2
    );
    sqlx::raw_sql("CREATE FUNCTION refuse_event_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test commit failure'; END $$; CREATE CONSTRAINT TRIGGER refuse_event_commit AFTER INSERT ON domain_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refuse_event_commit();").execute(&f.state.pool).await.unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM tasks")
        .fetch_one(&f.state.pool)
        .await
        .unwrap();
    let (status, _) = request(
        &f.app,
        &f.token,
        "POST",
        &format!("/api/workspaces/{}/tasks", f.workspace),
        Some(json!({"title":"Rolled back","project_id":f.project})),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM tasks")
            .fetch_one(&f.state.pool)
            .await
            .unwrap(),
        count
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM domain_events WHERE event_type='task.created'"
        )
        .fetch_one(&f.state.pool)
        .await
        .unwrap(),
        1
    );
}

async fn wait_for_workspace_fence(pool: &PgPool, query_fragment: &str) {
    tokio::time::timeout(Duration::from_secs(3),async {
        loop {
            let waiting: bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1)").bind(format!("%{query_fragment}%")).fetch_one(pool).await.unwrap();
            if waiting { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }).await.expect("operation did not wait on its Workspace fence");
}

#[sqlx::test]
async fn comment_and_management_fences_do_not_deadlock_scope_deletion(pool: PgPool) {
    let f = fixture(pool).await;
    let task = task(&f, f.project).await;
    let path = format!("/api/workspaces/{}/tasks/{task}", f.workspace);
    let (_, body) = request(
        &f.app,
        &f.token,
        "POST",
        &format!("{path}/comments"),
        Some(json!({"body":"Before deletion"})),
    )
    .await;
    let comment = body["id"].as_str().unwrap();
    let edit_path = format!("{path}/comments/{comment}");
    let mut tx = f.state.pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE")
        .bind(f.workspace)
        .execute(&mut *tx)
        .await
        .unwrap();
    let app = f.app.clone();
    let token = f.token.clone();
    let pending = tokio::spawn(async move {
        request(
            &app,
            &token,
            "PATCH",
            &edit_path,
            Some(json!({"body":"After deletion"})),
        )
        .await
    });
    wait_for_workspace_fence(
        &f.state.pool,
        "SELECT id FROM workspaces WHERE id = $1 FOR UPDATE",
    )
    .await;
    sqlx::query("DELETE FROM tasks WHERE project_id=$1")
        .bind(f.project)
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("DELETE FROM projects WHERE id=$1")
        .bind(f.project)
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    let (status, _) = tokio::time::timeout(Duration::from_secs(2), pending)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM domain_events WHERE event_type='comment.updated'"
        )
        .fetch_one(&f.state.pool)
        .await
        .unwrap(),
        0
    );
    let mut tx = f.state.pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE")
        .bind(f.workspace)
        .execute(&mut *tx)
        .await
        .unwrap();
    let app = f.app.clone();
    let token = f.token.clone();
    let path = format!("/api/workspaces/{}/webhooks", f.workspace);
    let pending = tokio::spawn(async move {
        request(
            &app,
            &token,
            "POST",
            &path,
            Some(input("http://127.0.0.1:9/receive")),
        )
        .await
    });
    wait_for_workspace_fence(
        &f.state.pool,
        "SELECT id FROM workspaces WHERE id=$1 FOR KEY SHARE",
    )
    .await;
    sqlx::query("DELETE FROM workspaces WHERE id=$1")
        .bind(f.workspace)
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    let (status, _) = tokio::time::timeout(Duration::from_secs(2), pending)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[sqlx::test]
async fn canceled_worker_attempt_can_be_claimed_after_reconstruction(pool: PgPool) {
    let f = fixture(pool).await;
    let mut receiver = receiver(StatusCode::NO_CONTENT, Duration::from_millis(300)).await;
    let id = hook_id(&create(&f, input(&receiver.url)).await);
    let (_, delivery) = request(
        &f.app,
        &f.token,
        "POST",
        &format!("{}/test", hook_path(&f, id)),
        None,
    )
    .await;
    let state = f.state.clone();
    let attempt = tokio::spawn(async move { process_delivery(&state).await });
    let (first_headers, first_body) = receiver.requests.recv().await.unwrap();
    attempt.abort();
    let _ = attempt.await;
    let reconstructed = configured_state(f.state.pool.clone(), &f._dir);
    assert!(process_delivery(&reconstructed).await.unwrap());
    let (second_headers, second_body) = receiver.requests.recv().await.unwrap();
    assert_eq!(
        first_headers["x-kanleaf-delivery"],
        second_headers["x-kanleaf-delivery"]
    );
    assert_eq!(first_body, second_body);
    assert_eq!(recent(&f, id).await[0]["id"], delivery["id"]);
    assert_eq!(recent(&f, id).await[0]["status"], "succeeded");
}

#[sqlx::test]
async fn slow_webhook_backlog_does_not_occupy_every_worker(pool: PgPool) {
    let mut f = fixture(pool).await;
    f.state = f.state.clone().with_webhooks(
        Some(SigningKey::parse("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=").unwrap()),
        WebhookPolicy {
            allow_http: true,
            allow_private_networks: true,
            request_timeout: Duration::from_secs(10),
        },
    );
    let release = Arc::new(Notify::new());
    let mut slow = receiver_with_release(
        StatusCode::NO_CONTENT,
        Duration::ZERO,
        Some(release.clone()),
    )
    .await;
    let fast = receiver(StatusCode::NO_CONTENT, Duration::ZERO).await;
    let slow_id = hook_id(&create(&f, input(&slow.url)).await);
    let fast_id = hook_id(&create(&f, input(&fast.url)).await);
    for id in [slow_id, slow_id, fast_id] {
        request(
            &f.app,
            &f.token,
            "POST",
            &format!("{}/test", hook_path(&f, id)),
            None,
        )
        .await;
    }
    let state = f.state.clone();
    let pending = tokio::spawn(async move { process_delivery(&state).await });
    slow.requests.recv().await.unwrap();
    assert!(
        tokio::time::timeout(Duration::from_secs(3), process_delivery(&f.state))
            .await
            .unwrap()
            .unwrap()
    );
    assert_eq!(fast.count.load(Ordering::SeqCst), 1);
    assert_eq!(slow.count.load(Ordering::SeqCst), 1);
    assert!(!pending.is_finished());
    release.notify_one();
    assert!(pending.await.unwrap().unwrap());
    let state = f.state.clone();
    let pending = tokio::spawn(async move { process_delivery(&state).await });
    slow.requests.recv().await.unwrap();
    release.notify_one();
    assert!(pending.await.unwrap().unwrap());
    assert!(
        recent(&f, slow_id)
            .await
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["status"] == "succeeded")
    );
}

#[sqlx::test]
async fn catalog_preview_uses_live_workspace_project_context_and_exact_schema(pool: PgPool) {
    let f = fixture(pool).await;
    let (status, catalog) = request(
        &f.app,
        &f.token,
        "GET",
        &format!(
            "/api/workspaces/{}/webhook-catalog?project_id={}",
            f.workspace, f.project
        ),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(catalog["event_types"].as_array().unwrap().len(), 6);
    let fixtures: Value =
        serde_json::from_str(include_str!("fixtures/webhook-payloads.json")).unwrap();
    for (event, example) in catalog["examples"].as_object().unwrap() {
        let mut expected = fixtures[event].clone();
        expected["workspace"] = example["workspace"].clone();
        expected["project"] = example["project"].clone();
        assert_eq!(*example, expected);
        assert_eq!(example["workspace"]["id"], f.workspace.to_string());
        assert_eq!(example["project"]["id"], f.project.to_string());
    }
    let (token, _, workspace) = register(&f.app, "foreign@example.com").await;
    let foreign = project(&f.app, &token, workspace, "Foreign").await;
    assert_eq!(
        request(
            &f.app,
            &f.token,
            "GET",
            &format!(
                "/api/workspaces/{}/webhook-catalog?project_id={foreign}",
                f.workspace
            ),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[sqlx::test]
async fn network_timeouts_redirects_and_policy_use_the_same_safe_transport(pool: PgPool) {
    let f = fixture(pool).await;
    let slow = receiver(StatusCode::OK, Duration::from_secs(2)).await;
    let id = hook_id(&create(&f, input(&slow.url)).await);
    request(
        &f.app,
        &f.token,
        "POST",
        &format!("{}/test", hook_path(&f, id)),
        None,
    )
    .await;
    let start = tokio::time::Instant::now();
    process_delivery(&f.state).await.unwrap();
    assert!(start.elapsed() < Duration::from_secs(1));
    assert_eq!(
        recent(&f, id).await[0]["last_error"],
        "Endpoint request timed out"
    );
    let id = hook_id(&create(&f, input("http://127.0.0.1:9/receive")).await);
    task(&f, f.project).await;
    dispatch_events(&f.state).await.unwrap();
    for _ in 0..2 {
        process_delivery(&f.state).await.unwrap();
    }
    let row = recent(&f, id).await;
    assert_eq!(row[0]["status"], "pending");
    assert_eq!(row[0]["last_error"], "Endpoint connection failed");
    let public_state = f.state.clone().with_webhooks(
        Some(SigningKey::parse("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=").unwrap()),
        WebhookPolicy {
            allow_http: true,
            ..Default::default()
        },
    );
    let public_app = router(public_state.clone(), vec![]);
    for endpoint in [
        "http://127.0.0.1/receive",
        "http://localhost/receive",
        "http://169.254.169.254/latest/meta-data",
    ] {
        let (status, body) = request(
            &public_app,
            &f.token,
            "POST",
            &format!("/api/workspaces/{}/webhooks", f.workspace),
            Some(input(endpoint)),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(
            body["error"]["message"]
                .as_str()
                .unwrap()
                .contains("policy")
        );
    }
    sqlx::query("UPDATE webhook_deliveries SET next_attempt_at=now() WHERE webhook_id=$1")
        .bind(id)
        .execute(&f.state.pool)
        .await
        .unwrap();
    process_delivery(&public_state).await.unwrap();
    assert!(
        recent(&f, id).await[0]["last_error"]
            .as_str()
            .unwrap()
            .contains("policy")
    );
    let target = receiver(StatusCode::OK, Duration::ZERO).await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/receive", listener.local_addr().unwrap());
    let location = target.url.clone();
    let redirect = Router::new().route(
        "/receive",
        post(move || {
            let location = location.clone();
            async move { (StatusCode::TEMPORARY_REDIRECT, [("location", location)]) }
        }),
    );
    let handle = tokio::spawn(async move {
        axum::serve(listener, redirect).await.unwrap();
    });
    let id = hook_id(&create(&f, input(&endpoint)).await);
    request(
        &f.app,
        &f.token,
        "POST",
        &format!("{}/test", hook_path(&f, id)),
        None,
    )
    .await;
    // Only this test is immediately due; other regular deliveries are in backoff.
    process_delivery(&f.state).await.unwrap();
    let row = recent(&f, id).await;
    assert_eq!(row[0]["http_status"], 307);
    assert_eq!(row[0]["status"], "failed");
    assert_eq!(target.count.load(Ordering::SeqCst), 0);
    handle.abort();
}

#[sqlx::test]
async fn waiting_enable_does_not_backfill_events_created_while_disabled(pool: PgPool) {
    use kanleaf_server::domain::events::{Event, EventType, Identity};
    let f = fixture(pool).await;
    let mut configuration = input("http://127.0.0.1:9/receive");
    configuration["enabled"] = json!(false);
    let id = hook_id(&create(&f, configuration).await);
    for full_update in [false, true] {
        request(
            &f.app,
            &f.token,
            "PATCH",
            &format!("{}/enabled", hook_path(&f, id)),
            Some(json!({"enabled":false})),
        )
        .await;
        let mut tx = f.state.pool.begin().await.unwrap();
        sqlx::query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE")
            .bind(f.workspace)
            .execute(&mut *tx)
            .await
            .unwrap();
        let app = f.app.clone();
        let token = f.token.clone();
        let path = if full_update {
            hook_path(&f, id)
        } else {
            format!("{}/enabled", hook_path(&f, id))
        };
        let pending = tokio::spawn(async move {
            let body = if full_update {
                input("http://127.0.0.1:9/receive")
            } else {
                json!({"enabled":true})
            };
            request(&app, &token, "PATCH", &path, Some(body)).await
        });
        wait_for_workspace_fence(
            &f.state.pool,
            "SELECT id FROM workspaces WHERE id=$1 FOR KEY SHARE",
        )
        .await;
        let workspace = Identity {
            id: f.workspace,
            identifier: "example-workspace".into(),
        };
        let project = Identity {
            id: f.project,
            identifier: "example-project".into(),
        };
        let example = Event::example(EventType::TaskCreated, workspace.clone(), project.clone());
        let event = Event::new(
            EventType::TaskCreated,
            workspace,
            Some(project),
            Some(f.user),
            example.data,
        );
        sqlx::query("INSERT INTO domain_events(id,workspace_id,project_id,event_type,occurred_at,raw_body) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(event.id).bind(f.workspace).bind(f.project).bind(event.kind.as_str()).bind(event.occurred_at).bind(serde_json::to_string(&event).unwrap()).execute(&mut *tx).await.unwrap();
        sqlx::query("INSERT INTO domain_event_outbox(event_id,consumer) VALUES ($1,'webhooks')")
            .bind(event.id)
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), pending)
                .await
                .unwrap()
                .unwrap()
                .0,
            StatusCode::OK
        );
        dispatch_events(&f.state).await.unwrap();
        assert!(recent(&f, id).await.as_array().unwrap().is_empty());
    }
    task(&f, f.project).await;
    dispatch_events(&f.state).await.unwrap();
    assert_eq!(recent(&f, id).await.as_array().unwrap().len(), 1);
}

#[sqlx::test]
async fn project_membership_changes_follow_comment_workspace_lock_order(pool: PgPool) {
    let f = fixture(pool).await;
    let task = task(&f, f.project).await;
    let (_, user, _) = register(&f.app, "contributor@example.com").await;
    sqlx::query(
        "INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'member')",
    )
    .bind(f.workspace)
    .bind(user)
    .execute(&f.state.pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO project_memberships(workspace_id,project_id,user_id,role) VALUES ($1,$2,$3,'contributor')").bind(f.workspace).bind(f.project).bind(user).execute(&f.state.pool).await.unwrap();
    for method in ["PATCH", "DELETE"] {
        let mut tx = f.state.pool.begin().await.unwrap();
        sqlx::query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE")
            .bind(f.workspace)
            .execute(&mut *tx)
            .await
            .unwrap();
        let app = f.app.clone();
        let token = f.token.clone();
        let path = format!(
            "/api/workspaces/{}/projects/{}/members/{user}",
            f.workspace, f.project
        );
        let pending = tokio::spawn(async move {
            request(
                &app,
                &token,
                method,
                &path,
                if method == "PATCH" {
                    Some(json!({"role":"commenter"}))
                } else {
                    None
                },
            )
            .await
        });
        wait_for_workspace_fence(
            &f.state.pool,
            "SELECT id FROM workspaces WHERE id = $1 FOR UPDATE",
        )
        .await;
        // Comment producers need the Project FK while holding the Workspace fence.
        sqlx::query("SELECT id FROM projects WHERE id=$1 FOR KEY SHARE")
            .bind(f.project)
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), pending)
                .await
                .unwrap()
                .unwrap()
                .0,
            if method == "PATCH" {
                StatusCode::OK
            } else {
                StatusCode::NO_CONTENT
            }
        );
    }
    assert_eq!(
        request(
            &f.app,
            &f.token,
            "POST",
            &format!("/api/workspaces/{}/tasks/{task}/comments", f.workspace),
            Some(json!({"body":"Membership changes completed"}))
        )
        .await
        .0,
        StatusCode::CREATED
    );
}

#[sqlx::test]
async fn planning_changes_and_dispatch_respect_the_workspace_fence(pool: PgPool) {
    let f = fixture(pool).await;
    let id = hook_id(&create(&f, input("http://127.0.0.1:9/receive")).await);
    task(&f, f.project).await;
    sqlx::query("UPDATE projects SET cycles_enabled=true WHERE id=$1")
        .bind(f.project)
        .execute(&f.state.pool)
        .await
        .unwrap();
    let mut tx = f.state.pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE")
        .bind(f.workspace)
        .execute(&mut *tx)
        .await
        .unwrap();
    let app = f.app.clone();
    let token = f.token.clone();
    let path = format!(
        "/api/workspaces/{}/projects/{}/cycles",
        f.workspace, f.project
    );
    let pending = tokio::spawn(async move {
        request(&app,&token,"POST",&path,Some(json!({"name":"Automation cycle","start_date":"2026-01-01","due_date":"2026-01-07"}))).await
    });
    wait_for_workspace_fence(
        &f.state.pool,
        "SELECT id FROM workspaces WHERE id = $1 FOR UPDATE",
    )
    .await;
    sqlx::query("SELECT id FROM projects WHERE id=$1 FOR KEY SHARE")
        .bind(f.project)
        .execute(&mut *tx)
        .await
        .unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), dispatch_events(&f.state))
            .await
            .unwrap()
            .unwrap(),
        0
    );
    tx.commit().await.unwrap();
    let result = tokio::time::timeout(Duration::from_secs(2), pending)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(result.0, StatusCode::CREATED, "{}", result.1);
    dispatch_events(&f.state).await.unwrap();
    let delivery = recent(&f, id).await[0]["id"].as_str().unwrap().to_owned();
    assert_eq!(
        request(
            &f.app,
            &f.token,
            "GET",
            &format!("{}/deliveries/{delivery}", hook_path(&f, id)),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let foreign = hook_id(&create(&f, input("http://127.0.0.1:9/receive")).await);
    assert_eq!(
        request(
            &f.app,
            &f.token,
            "GET",
            &format!("{}/deliveries/{delivery}", hook_path(&f, foreign)),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query(
        "UPDATE workspace_memberships SET role='member' WHERE workspace_id=$1 AND user_id=$2",
    )
    .bind(f.workspace)
    .bind(f.user)
    .execute(&f.state.pool)
    .await
    .unwrap();
    assert_eq!(
        request(
            &f.app,
            &f.token,
            "GET",
            &format!("{}/deliveries/{delivery}", hook_path(&f, id)),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}

#[sqlx::test]
async fn invalid_receiver_status_still_consumes_bounded_attempts(pool: PgPool) {
    let f = fixture(pool).await;
    let receiver = receiver(StatusCode::from_u16(777).unwrap(), Duration::ZERO).await;
    let id = hook_id(&create(&f, input(&receiver.url)).await);
    task(&f, f.project).await;
    dispatch_events(&f.state).await.unwrap();
    for attempt in 1..=6 {
        assert!(process_delivery(&f.state).await.unwrap());
        let deliveries = recent(&f, id).await;
        assert_eq!(deliveries[0]["attempt_count"], attempt);
        assert_eq!(deliveries[0]["http_status"], Value::Null);
        assert_eq!(
            deliveries[0]["last_error"],
            "Endpoint returned an invalid HTTP status"
        );
        assert_eq!(
            deliveries[0]["status"],
            if attempt < 6 { "pending" } else { "failed" }
        );
        assert!(!process_delivery(&f.state).await.unwrap());
        sqlx::query("UPDATE webhook_deliveries SET next_attempt_at=now() WHERE webhook_id=$1")
            .bind(id)
            .execute(&f.state.pool)
            .await
            .unwrap();
    }
    assert_eq!(receiver.count.load(Ordering::SeqCst), 6);
    request(
        &f.app,
        &f.token,
        "POST",
        &format!("{}/test", hook_path(&f, id)),
        None,
    )
    .await;
    assert!(process_delivery(&f.state).await.unwrap());
    assert_eq!(recent(&f, id).await[0]["status"], "failed");
    assert_eq!(recent(&f, id).await[0]["attempt_count"], 1);
}
