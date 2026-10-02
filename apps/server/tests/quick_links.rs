#![cfg(feature = "postgres-tests")]

use std::time::Duration;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use http::HeaderValue;
use kanleaf_server::{AppState, router};
use serde_json::{Value, json};
use sqlx::PgPool;
use tempfile::TempDir;
use tower::ServiceExt;
use uuid::Uuid;

fn test_app(pool: PgPool, data_dir: &TempDir) -> Router {
    router(
        AppState::new(pool, data_dir.path().to_owned(), Duration::from_secs(3600)),
        vec![HeaderValue::from_static("http://127.0.0.1:1420")],
    )
}

fn request(method: &str, uri: &str, body: Option<Value>, token: &str) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(uri);
    if !token.is_empty() {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    builder
        .body(body.map_or_else(Body::empty, |value| Body::from(value.to_string())))
        .unwrap()
}

async fn send(
    app: &Router,
    method: &str,
    uri: &str,
    body: Option<Value>,
    token: &str,
) -> axum::response::Response {
    app.clone()
        .oneshot(request(method, uri, body, token))
        .await
        .unwrap()
}

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), 2 * 1024 * 1024)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn register(app: &Router, email: &str) -> (String, Uuid, Uuid) {
    let response = send(
        app,
        "POST",
        "/api/auth/register",
        Some(json!({"email": email, "password": "correct horse battery"})),
        "",
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    let body = json_body(response).await;
    let token = body["token"].as_str().unwrap().to_owned();
    let user_id = body["user"]["id"].as_str().unwrap().parse().unwrap();
    let setup = send(
        app,
        "PATCH",
        "/api/account/setup",
        Some(json!({"display_name": email.split('@').next().unwrap()})),
        &token,
    )
    .await;
    assert_eq!(setup.status(), StatusCode::OK);
    let workspace = create_json(app, &token, "/api/workspaces", json!({"name": "Personal"})).await;
    let workspace_id = workspace["id"].as_str().unwrap().parse().unwrap();
    (token, user_id, workspace_id)
}

async fn create_json(app: &Router, token: &str, uri: &str, body: Value) -> Value {
    let response = send(app, "POST", uri, Some(body), token).await;
    assert_eq!(response.status(), StatusCode::CREATED);
    json_body(response).await
}

async fn add_workspace_member(pool: &PgPool, workspace_id: Uuid, user_id: Uuid, role: &str) {
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)",
    )
    .bind(workspace_id)
    .bind(user_id)
    .bind(role)
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn shared_links_crud_order_and_membership(pool: PgPool) {
    let data = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data);
    let (owner, _, workspace) = register(&app, "owner@example.com").await;
    let (member, member_id, _) = register(&app, "member@example.com").await;
    let (outsider, _, _) = register(&app, "outsider@example.com").await;
    add_workspace_member(&pool, workspace, member_id, "member").await;
    let uri = format!("/api/workspaces/{workspace}/quick-links");
    let first = create_json(
        &app,
        &owner,
        &uri,
        json!({"kind":"external", "title":"Docs", "url":"https://example.com/docs"}),
    )
    .await;
    let second = create_json(
        &app,
        &owner,
        &uri,
        json!({"kind":"external", "title":"Help", "url":"http://example.com/help"}),
    )
    .await;
    assert_eq!(first["available"], true);
    assert_eq!(first["project_id"], Value::Null);
    assert_eq!(first["position"], 0);
    assert_eq!(second["position"], 1);
    assert_eq!(
        send(&app, "GET", &uri, None, "").await.status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        send(&app, "GET", &uri, None, &outsider).await.status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        json_body(send(&app, "GET", &uri, None, &member).await)
            .await
            .as_array()
            .unwrap()
            .len(),
        2
    );
    for (method, endpoint, body) in [
        (
            "POST",
            uri.clone(),
            Some(json!({"kind":"external", "title":"Bad", "url":"https://example.com"})),
        ),
        (
            "PUT",
            format!("{uri}/{}", first["id"].as_str().unwrap()),
            Some(json!({"kind":"external", "title":"Bad", "url":"https://example.com"})),
        ),
        (
            "DELETE",
            format!("{uri}/{}", first["id"].as_str().unwrap()),
            None,
        ),
        (
            "PUT",
            format!("{uri}/order"),
            Some(json!({"ids":[second["id"],first["id"]]})),
        ),
    ] {
        assert_eq!(
            send(&app, method, &endpoint, body, &member).await.status(),
            StatusCode::FORBIDDEN
        );
    }
    for ids in [
        json!([first["id"]]),
        json!([first["id"], first["id"]]),
        json!([first["id"], Uuid::new_v4()]),
    ] {
        assert_eq!(
            send(
                &app,
                "PUT",
                &format!("{uri}/order"),
                Some(json!({"ids":ids})),
                &owner
            )
            .await
            .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let reordered = send(
        &app,
        "PUT",
        &format!("{uri}/order"),
        Some(json!({"ids":[second["id"],first["id"]]})),
        &owner,
    )
    .await;
    assert_eq!(reordered.status(), StatusCode::OK);
    let list = json_body(send(&app, "GET", &uri, None, &owner).await).await;
    assert_eq!(list[0]["id"], second["id"]);
    let endpoint = format!("{uri}/{}", first["id"].as_str().unwrap());
    let updated = send(
        &app,
        "PUT",
        &endpoint,
        Some(json!({"kind":"external","title":"Renamed","url":"https://example.org"})),
        &owner,
    )
    .await;
    assert_eq!(updated.status(), StatusCode::OK);
    assert_eq!(json_body(updated).await["title"], "Renamed");
    assert_eq!(
        send(&app, "DELETE", &endpoint, None, &owner).await.status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        send(&app, "DELETE", &endpoint, None, &owner).await.status(),
        StatusCode::NOT_FOUND
    );
    let revision: i64 = sqlx::query_scalar("SELECT config_version FROM workspaces WHERE id=$1")
        .bind(workspace)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(revision > 1);
    sqlx::query("UPDATE workspace_quick_links SET position=$2 WHERE workspace_id=$1")
        .bind(workspace)
        .bind(i64::MAX)
        .execute(&pool)
        .await
        .unwrap();
    let overflow = send(
        &app,
        "POST",
        &uri,
        Some(json!({"kind":"external","title":"Overflow","url":"https://example.com"})),
        &owner,
    )
    .await;
    assert_eq!(overflow.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        send(
            &app,
            "PUT",
            &format!("{uri}/order"),
            Some(json!({"ids":[second["id"]]})),
            &owner
        )
        .await
        .status(),
        StatusCode::OK
    );
    let after_reorder = create_json(
        &app,
        &owner,
        &uri,
        json!({"kind":"external","title":"New","url":"https://example.com"}),
    )
    .await;
    assert_eq!(after_reorder["position"], 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn filters_internal_targets_and_preserves_unavailable_admin_links(pool: PgPool) {
    let data = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data);
    let (owner, _, workspace) = register(&app, "owner@example.com").await;
    let (member, member_id, _) = register(&app, "member@example.com").await;
    let (guest, guest_id, _) = register(&app, "guest@example.com").await;
    let (other, _, other_workspace) = register(&app, "other@example.com").await;
    add_workspace_member(&pool, workspace, member_id, "member").await;
    add_workspace_member(&pool, workspace, guest_id, "guest").await;
    let projects = format!("/api/workspaces/{workspace}/projects");
    let documents = format!("/api/workspaces/{workspace}/documents");
    let uri = format!("/api/workspaces/{workspace}/quick-links");
    let project = create_json(
        &app,
        &owner,
        &projects,
        json!({"name":"Secret Project","identifier":"secret","visibility":"private"}),
    )
    .await;
    let project_id: Uuid = project["id"].as_str().unwrap().parse().unwrap();
    let page = create_json(
        &app,
        &owner,
        &documents,
        json!({"title":"Private Page","project_id":project_id}),
    )
    .await;
    let page_id: Uuid = page["id"].as_str().unwrap().parse().unwrap();
    let workspace_page =
        create_json(&app, &owner, &documents, json!({"title":"Workspace Page"})).await;
    create_json(
        &app,
        &owner,
        &uri,
        json!({"kind":"project","project_id":project_id}),
    )
    .await;
    let page_link = create_json(
        &app,
        &owner,
        &uri,
        json!({"kind":"page","document_id":page_id}),
    )
    .await;
    assert_eq!(page_link["title"], "Private Page");
    assert_eq!(page_link["project_id"], project["id"]);
    assert_eq!(page_link["project_identifier"], project["identifier"]);
    assert_eq!(page_link["document_number"], page["document_number"]);
    create_json(
        &app,
        &owner,
        &uri,
        json!({"kind":"page","document_id":workspace_page["id"]}),
    )
    .await;
    create_json(
        &app,
        &owner,
        &uri,
        json!({"kind":"external","title":"Website","url":"https://example.com"}),
    )
    .await;
    let member_list = json_body(send(&app, "GET", &uri, None, &member).await).await;
    assert_eq!(member_list.as_array().unwrap().len(), 2);
    assert!(!member_list.to_string().contains("Secret"));
    assert!(!member_list.to_string().contains(&project_id.to_string()));
    assert_eq!(
        json_body(send(&app, "GET", &uri, None, &guest).await)
            .await
            .as_array()
            .unwrap()
            .len(),
        1
    );
    // Public discoverability does not grant effective Project membership.
    sqlx::query("UPDATE projects SET visibility='public' WHERE id=$1")
        .bind(project_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        json_body(send(&app, "GET", &uri, None, &member).await)
            .await
            .as_array()
            .unwrap()
            .len(),
        2
    );
    for user_id in [member_id, guest_id] {
        sqlx::query("INSERT INTO project_memberships(workspace_id,project_id,user_id,role) VALUES ($1,$2,$3,'viewer')").bind(workspace).bind(project_id).bind(user_id).execute(&pool).await.unwrap();
    }
    assert_eq!(
        json_body(send(&app, "GET", &uri, None, &member).await)
            .await
            .as_array()
            .unwrap()
            .len(),
        4
    );
    assert_eq!(
        json_body(send(&app, "GET", &uri, None, &guest).await)
            .await
            .as_array()
            .unwrap()
            .len(),
        3
    );
    sqlx::query("UPDATE documents SET title='Renamed Page' WHERE id=$1")
        .bind(page_id)
        .execute(&pool)
        .await
        .unwrap();
    let list = json_body(send(&app, "GET", &uri, None, &owner).await).await;
    assert_eq!(list[1]["title"], "Renamed Page");
    sqlx::query("UPDATE projects SET pages_enabled=false WHERE id=$1")
        .bind(project_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        json_body(send(&app, "GET", &uri, None, &member).await)
            .await
            .as_array()
            .unwrap()
            .len(),
        3
    );
    let list = json_body(send(&app, "GET", &uri, None, &owner).await).await;
    assert_eq!(list[1]["available"], false);
    let ids: Vec<Value> = list
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .map(|link| link["id"].clone())
        .collect();
    assert_eq!(
        send(
            &app,
            "PUT",
            &format!("{uri}/order"),
            Some(json!({"ids":ids})),
            &owner
        )
        .await
        .status(),
        StatusCode::OK
    );
    sqlx::query("UPDATE projects SET archived_at=now() WHERE id=$1")
        .bind(project_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        json_body(send(&app, "GET", &uri, None, &member).await)
            .await
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let list = json_body(send(&app, "GET", &uri, None, &owner).await).await;
    assert_eq!(list.as_array().unwrap().len(), 4);
    assert_eq!(list[2]["available"], false);
    assert_eq!(list[3]["available"], false);
    let other_project = create_json(
        &app,
        &other,
        &format!("/api/workspaces/{other_workspace}/projects"),
        json!({"name":"Other","identifier":"other"}),
    )
    .await;
    let other_page = create_json(
        &app,
        &other,
        &format!("/api/workspaces/{other_workspace}/documents"),
        json!({"title":"Other Page"}),
    )
    .await;
    for body in [
        json!({"kind":"project","project_id":other_project["id"]}),
        json!({"kind":"page","document_id":other_page["id"]}),
    ] {
        assert_eq!(
            send(&app, "POST", &uri, Some(body), &owner).await.status(),
            StatusCode::NOT_FOUND
        );
    }
    let invalid_fk = sqlx::query("INSERT INTO workspace_quick_links(id,workspace_id,kind,project_id,position) VALUES($1,$2,'project',$3,100)").bind(Uuid::new_v4()).bind(workspace).bind(other_project["id"].as_str().unwrap().parse::<Uuid>().unwrap()).execute(&pool).await;
    assert!(invalid_fk.is_err());
    sqlx::query("DELETE FROM documents WHERE id=$1")
        .bind(page_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        json_body(send(&app, "GET", &uri, None, &owner).await)
            .await
            .as_array()
            .unwrap()
            .len(),
        3
    );
    sqlx::query("DELETE FROM projects WHERE id=$1")
        .bind(project_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        json_body(send(&app, "GET", &uri, None, &owner).await)
            .await
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn rejects_dangerous_urls_and_invalid_tagged_targets(pool: PgPool) {
    let data = TempDir::new().unwrap();
    let app = test_app(pool, &data);
    let (owner, _, workspace) = register(&app, "owner@example.com").await;
    let uri = format!("/api/workspaces/{workspace}/quick-links");
    for url in [
        "javascript:alert(1)",
        "data:text/html,x",
        "file:///etc/passwd",
        "//example.com",
        "https://user:pass@example.com",
        "https://user@example.com",
        "https://example.com/\nsecret",
        "https://",
        "https:example.com",
        "https:/example.com",
        "https:///example.com",
        "https://@example.com",
        "https://example.com ",
        " https://example.com",
    ] {
        let response = send(
            &app,
            "POST",
            &uri,
            Some(json!({"kind":"external","title":"Bad","url":url})),
            &owner,
        )
        .await;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "accepted {url:?}"
        );
    }
    for body in [
        json!({"kind":"external","title":"","url":"https://example.com"}),
        json!({"kind":"external","title":"Long","url":format!("https://example.com/{}","a".repeat(2048))}),
        json!({"kind":"external","title":"Wrong","url":"https://example.com","project_id":Uuid::new_v4()}),
        json!({"kind":"page","document_id":Uuid::new_v4(),"title":"Stored title"}),
        json!({"kind":"project"}),
        json!({"kind":"unknown"}),
    ] {
        assert_eq!(
            send(&app, "POST", &uri, Some(body), &owner).await.status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn admin_mutations_serialize_and_recheck_revoked_roles(pool: PgPool) {
    let data = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data);
    let (owner, _, workspace) = register(&app, "owner@example.com").await;
    let (admin, admin_id, _) = register(&app, "admin@example.com").await;
    add_workspace_member(&pool, workspace, admin_id, "admin").await;
    let uri = format!("/api/workspaces/{workspace}/quick-links");
    let body = json!({"kind":"external","title":"Docs","url":"https://example.com"});
    let (first, second) = tokio::join!(
        send(&app, "POST", &uri, Some(body.clone()), &owner),
        send(&app, "POST", &uri, Some(body.clone()), &admin)
    );
    assert_eq!(first.status(), StatusCode::CREATED);
    assert_eq!(second.status(), StatusCode::CREATED);
    let positions = [
        json_body(first).await["position"].clone(),
        json_body(second).await["position"].clone(),
    ];
    assert_ne!(positions[0], positions[1]);

    let mut transaction = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE")
        .bind(workspace)
        .execute(&mut *transaction)
        .await
        .unwrap();
    let request_app = app.clone();
    let request_uri = uri.clone();
    let request_token = admin.clone();
    let pending = tokio::spawn(async move {
        send(
            &request_app,
            "POST",
            &request_uri,
            Some(body),
            &request_token,
        )
        .await
    });
    // Wait until the request has passed its initial role check and is waiting on our fence.
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let waiting: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM workspaces WHERE id = $1 FOR UPDATE%')",
            ).fetch_one(&pool).await.unwrap();
            if waiting { break; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }).await.unwrap();
    sqlx::query(
        "UPDATE workspace_memberships SET role='member' WHERE workspace_id=$1 AND user_id=$2",
    )
    .bind(workspace)
    .bind(admin_id)
    .execute(&mut *transaction)
    .await
    .unwrap();
    transaction.commit().await.unwrap();
    assert_eq!(pending.await.unwrap().status(), StatusCode::FORBIDDEN);
    assert_eq!(
        json_body(send(&app, "GET", &uri, None, &owner).await)
            .await
            .as_array()
            .unwrap()
            .len(),
        2
    );
    sqlx::query("DELETE FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2")
        .bind(workspace)
        .bind(admin_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        send(&app, "GET", &uri, None, &admin).await.status(),
        StatusCode::FORBIDDEN
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn membership_mutations_follow_the_quick_link_lock_order(pool: PgPool) {
    let data = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data);
    let (owner, _, workspace) = register(&app, "owner@example.com").await;
    let (admin, admin_id, _) = register(&app, "admin@example.com").await;
    let mut outcomes = Vec::new();
    for method in ["PATCH", "DELETE", "POST"] {
        sqlx::query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'admin') ON CONFLICT(workspace_id,user_id) DO UPDATE SET role='admin'")
            .bind(workspace).bind(admin_id).execute(&pool).await.unwrap();
        let mut transaction = pool.begin().await.unwrap();
        sqlx::query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE")
            .bind(workspace)
            .execute(&mut *transaction)
            .await
            .unwrap();
        let request_app = app.clone();
        let token = if method == "POST" {
            admin.clone()
        } else {
            owner.clone()
        };
        let uri = if method == "POST" {
            format!("/api/workspaces/{workspace}/leave")
        } else {
            format!("/api/workspaces/{workspace}/members/{admin_id}")
        };
        let body = (method == "PATCH").then(|| json!({"role":"member"}));
        let pending =
            tokio::spawn(async move { send(&request_app, method, &uri, body, &token).await });
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let waiting: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock')")
                    .fetch_one(&pool).await.unwrap();
                if waiting { break; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.unwrap();
        // Quick Links takes this membership lock after its Workspace lock. A membership
        // writer must still be waiting on the Workspace, without holding this row.
        sqlx::query("SET LOCAL lock_timeout='500ms'")
            .execute(&mut *transaction)
            .await
            .unwrap();
        let role: Result<String, sqlx::Error> = sqlx::query_scalar(
            "SELECT role FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2 FOR SHARE",
        )
        .bind(workspace)
        .bind(admin_id)
        .fetch_one(&mut *transaction)
        .await;
        transaction.rollback().await.unwrap();
        let response = pending.await.unwrap();
        assert_eq!(
            response.status(),
            if method == "PATCH" {
                StatusCode::OK
            } else {
                StatusCode::NO_CONTENT
            }
        );
        outcomes.push((method, role));
    }
    for (method, role) in outcomes {
        assert_eq!(
            role.unwrap_or_else(|error| panic!("{method} held inverse membership lock: {error}")),
            "admin"
        );
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn membership_management_rechecks_actor_after_workspace_lock(pool: PgPool) {
    let data = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data);
    let (_, _, workspace) = register(&app, "owner@example.com").await;
    let (admin, admin_id, _) = register(&app, "admin@example.com").await;
    let (_, member_id, _) = register(&app, "member@example.com").await;
    add_workspace_member(&pool, workspace, admin_id, "admin").await;
    add_workspace_member(&pool, workspace, member_id, "member").await;
    for method in ["PATCH", "DELETE"] {
        sqlx::query(
            "UPDATE workspace_memberships SET role='admin' WHERE workspace_id=$1 AND user_id=$2",
        )
        .bind(workspace)
        .bind(admin_id)
        .execute(&pool)
        .await
        .unwrap();
        let mut transaction = pool.begin().await.unwrap();
        sqlx::query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE")
            .bind(workspace)
            .execute(&mut *transaction)
            .await
            .unwrap();
        let request_app = app.clone();
        let request_token = admin.clone();
        let pending = tokio::spawn(async move {
            send(
                &request_app,
                method,
                &format!("/api/workspaces/{workspace}/members/{member_id}"),
                (method == "PATCH").then(|| json!({"role":"guest"})),
                &request_token,
            )
            .await
        });
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let waiting: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock')")
                    .fetch_one(&pool).await.unwrap();
                if waiting { break; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.unwrap();
        sqlx::query(
            "UPDATE workspace_memberships SET role='member' WHERE workspace_id=$1 AND user_id=$2",
        )
        .bind(workspace)
        .bind(admin_id)
        .execute(&mut *transaction)
        .await
        .unwrap();
        transaction.commit().await.unwrap();
        assert_eq!(pending.await.unwrap().status(), StatusCode::FORBIDDEN);
        let role: String = sqlx::query_scalar(
            "SELECT role FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2",
        )
        .bind(workspace)
        .bind(member_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(role, "member");
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn leaving_authorizes_membership_before_workspace_lookup(pool: PgPool) {
    let data = TempDir::new().unwrap();
    let app = test_app(pool, &data);
    let (_, _, workspace) = register(&app, "owner@example.com").await;
    let (outsider, _, _) = register(&app, "outsider@example.com").await;
    for workspace_id in [workspace, Uuid::new_v4()] {
        assert_eq!(
            send(
                &app,
                "POST",
                &format!("/api/workspaces/{workspace_id}/leave"),
                None,
                &outsider
            )
            .await
            .status(),
            StatusCode::FORBIDDEN
        );
    }
}
