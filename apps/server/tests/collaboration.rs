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

async fn send(
    app: &Router,
    method: &str,
    uri: &str,
    body: Option<Value>,
    token: &str,
) -> axum::response::Response {
    let mut builder = Request::builder().method(method).uri(uri);
    if !token.is_empty() {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    app.clone()
        .oneshot(
            builder
                .body(body.map_or_else(Body::empty, |value| Body::from(value.to_string())))
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn body(response: axum::response::Response) -> Value {
    serde_json::from_slice(
        &to_bytes(response.into_body(), 2 * 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap()
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
    let payload = body(response).await;
    (
        payload["token"].as_str().unwrap().to_owned(),
        payload["user"]["id"].as_str().unwrap().parse().unwrap(),
        payload["user"]["active_workspace_id"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap(),
    )
}

async fn create(app: &Router, token: &str, uri: &str, payload: Value) -> Value {
    let response = send(app, "POST", uri, Some(payload), token).await;
    assert_eq!(response.status(), StatusCode::CREATED);
    body(response).await
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

async fn add_project_member(
    pool: &PgPool,
    workspace_id: Uuid,
    project_id: Uuid,
    user_id: Uuid,
    role: &str,
) {
    sqlx::query(
        "INSERT INTO project_memberships (workspace_id, project_id, user_id, role) VALUES ($1, $2, $3, $4)",
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(user_id)
    .bind(role)
    .execute(pool)
    .await
    .unwrap();
}

async fn project_task(
    app: &Router,
    owner_token: &str,
    workspace_id: Uuid,
    assignee_ids: &[Uuid],
) -> (Uuid, Uuid) {
    let project = create(
        app,
        owner_token,
        &format!("/api/workspaces/{workspace_id}/projects"),
        json!({"name": "Collaboration"}),
    )
    .await;
    let project_id = project["id"].as_str().unwrap().parse().unwrap();
    let task = create(
        app,
        owner_token,
        &format!("/api/workspaces/{workspace_id}/tasks"),
        json!({
            "title": "Discuss notifications",
            "project_id": project_id,
            "assignee_ids": assignee_ids
        }),
    )
    .await;
    (project_id, task["id"].as_str().unwrap().parse().unwrap())
}

#[sqlx::test(migrations = "./migrations")]
async fn equivalent_consecutive_activity_is_coalesced(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, _, workspace_id) = register(&app, "activity-owner@example.com").await;
    let (member_token, member_id, _) = register(&app, "activity-member@example.com").await;
    add_workspace_member(&pool, workspace_id, member_id, "member").await;
    let (project_id, task_id) = project_task(&app, &owner_token, workspace_id, &[]).await;
    add_project_member(&pool, workspace_id, project_id, member_id, "contributor").await;
    let task_uri = format!("/api/workspaces/{workspace_id}/tasks/{task_id}");

    for title in ["First title", "Second title"] {
        assert_eq!(
            send(
                &app,
                "PATCH",
                &task_uri,
                Some(json!({"title": title})),
                &owner_token,
            )
            .await
            .status(),
            StatusCode::OK
        );
    }
    let activity_ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM task_activity WHERE task_id = $1 AND event_type = 'task_updated' ORDER BY created_at, id",
    )
    .bind(task_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(activity_ids.len(), 1);
    let first_activity_id = activity_ids[0];

    sqlx::query(
        "UPDATE task_activity SET created_at = now() - interval '2 minutes' WHERE task_id = $1 AND id <> $2",
    )
    .bind(task_id)
    .bind(first_activity_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE task_activity SET created_at = now() - interval '50 seconds' WHERE id = $1",
    )
    .bind(first_activity_id)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        send(
            &app,
            "PATCH",
            &task_uri,
            Some(json!({"title": "Third title"})),
            &owner_token,
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert!(
        sqlx::query_scalar::<_, bool>(
            "SELECT created_at > now() - interval '5 seconds' FROM task_activity WHERE id = $1",
        )
        .bind(first_activity_id)
        .fetch_one(&pool)
        .await
        .unwrap()
    );

    create(
        &app,
        &owner_token,
        &format!("{task_uri}/comments"),
        json!({"body": "This comment ends the activity chain"}),
    )
    .await;
    assert_eq!(
        send(
            &app,
            "PATCH",
            &task_uri,
            Some(json!({"title": "Fourth title"})),
            &owner_token,
        )
        .await
        .status(),
        StatusCode::OK
    );

    sqlx::query(
        r#"
        UPDATE task_activity
        SET created_at = now() - interval '61 seconds'
        WHERE id = (
            SELECT id FROM task_activity
            WHERE task_id = $1 AND event_type = 'task_updated'
            ORDER BY created_at DESC, id DESC
            LIMIT 1
        )
        "#,
    )
    .bind(task_id)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        send(
            &app,
            "PATCH",
            &task_uri,
            Some(json!({"title": "Fifth title"})),
            &owner_token,
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        send(
            &app,
            "PATCH",
            &task_uri,
            Some(json!({"priority": "high"})),
            &owner_token,
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        send(
            &app,
            "PATCH",
            &task_uri,
            Some(json!({"title": "Sixth title"})),
            &owner_token,
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        send(
            &app,
            "PATCH",
            &task_uri,
            Some(json!({"title": "Member title"})),
            &member_token,
        )
        .await
        .status(),
        StatusCode::OK
    );

    let rows: Vec<(Uuid, Option<Uuid>, Value)> = sqlx::query_as(
        r#"
        SELECT id, actor_id, data
        FROM task_activity
        WHERE task_id = $1 AND event_type = 'task_updated'
        ORDER BY created_at, id
        "#,
    )
    .bind(task_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 6);
    assert!(rows.iter().any(|row| row.0 == first_activity_id));
    assert_eq!(rows.last().unwrap().1, Some(member_id));
    assert_eq!(rows.last().unwrap().2, json!({"fields": ["title"]}));
}

#[sqlx::test(migrations = "./migrations")]
async fn comments_enforce_roles_reply_depth_revisions_and_tombstones(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, owner_id, workspace_id) = register(&app, "comment-owner@example.com").await;
    let (commenter_token, commenter_id, _) = register(&app, "commenter@example.com").await;
    let (viewer_token, viewer_id, _) = register(&app, "viewer@example.com").await;
    add_workspace_member(&pool, workspace_id, commenter_id, "member").await;
    add_workspace_member(&pool, workspace_id, viewer_id, "member").await;
    let (project_id, task_id) = project_task(&app, &owner_token, workspace_id, &[]).await;
    add_project_member(&pool, workspace_id, project_id, commenter_id, "commenter").await;
    add_project_member(&pool, workspace_id, project_id, viewer_id, "viewer").await;
    let comments_uri = format!("/api/workspaces/{workspace_id}/tasks/{task_id}/comments");

    let forbidden = send(
        &app,
        "POST",
        &comments_uri,
        Some(json!({"body": "Viewer cannot write"})),
        &viewer_token,
    )
    .await;
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

    let comment = create(
        &app,
        &commenter_token,
        &comments_uri,
        json!({"body": "**First** comment", "mention_ids": [owner_id]}),
    )
    .await;
    let comment_id = comment["id"].as_str().unwrap();
    assert_eq!(comment["body"], "**First** comment");
    assert_eq!(comment["mentions"][0]["id"], owner_id.to_string());

    let reply = create(
        &app,
        &owner_token,
        &comments_uri,
        json!({"body": "One-level reply", "parent_id": comment_id}),
    )
    .await;
    let nested = send(
        &app,
        "POST",
        &comments_uri,
        Some(json!({
            "body": "Too deep",
            "parent_id": reply["id"]
        })),
        &commenter_token,
    )
    .await;
    assert_eq!(nested.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let comment_uri = format!("{comments_uri}/{comment_id}");
    let edited = send(
        &app,
        "PATCH",
        &comment_uri,
        Some(json!({"body": "Edited source", "mention_ids": []})),
        &commenter_token,
    )
    .await;
    assert_eq!(edited.status(), StatusCode::OK);
    assert!(body(edited).await["edited_at"].is_string());
    let revisions = send(
        &app,
        "GET",
        &format!("{comment_uri}/revisions"),
        None,
        &viewer_token,
    )
    .await;
    assert_eq!(revisions.status(), StatusCode::OK);
    assert_eq!(body(revisions).await[0]["body"], "**First** comment");

    let deleted = send(&app, "DELETE", &comment_uri, None, &owner_token).await;
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    let feed = send(
        &app,
        "GET",
        &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/activity"),
        None,
        &viewer_token,
    )
    .await;
    assert_eq!(feed.status(), StatusCode::OK);
    let feed = body(feed).await;
    assert!(feed["comments"][0]["body"].is_null());
    assert!(feed["comments"][0]["deleted_at"].is_string());
    assert_eq!(feed["comments"][1]["parent_id"], comment_id);
}

#[sqlx::test(migrations = "./migrations")]
async fn subscriptions_mentions_preferences_and_notification_isolation(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool.clone(), &data_dir);
    let (owner_token, owner_id, workspace_id) = register(&app, "notify-owner@example.com").await;
    let (member_token, member_id, _) = register(&app, "notify-member@example.com").await;
    let (outsider_token, outsider_id, outsider_workspace) =
        register(&app, "notify-outsider@example.com").await;
    add_workspace_member(&pool, workspace_id, member_id, "member").await;
    let (project_id, task_id) = project_task(&app, &owner_token, workspace_id, &[]).await;
    add_project_member(&pool, workspace_id, project_id, member_id, "contributor").await;

    let update = send(
        &app,
        "PATCH",
        &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
        Some(json!({"assignee_ids": [member_id]})),
        &owner_token,
    )
    .await;
    assert_eq!(update.status(), StatusCode::OK);
    let member_notifications = send(
        &app,
        "GET",
        "/api/notifications?unread=true",
        None,
        &member_token,
    )
    .await;
    assert_eq!(member_notifications.status(), StatusCode::OK);
    let member_notifications = body(member_notifications).await;
    assert_eq!(member_notifications[0]["notification_type"], "assignment");
    let notification_id = member_notifications[0]["id"].as_str().unwrap();
    assert_eq!(
        send(
            &app,
            "PATCH",
            &format!("/api/notifications/{notification_id}/read"),
            None,
            &member_token,
        )
        .await
        .status(),
        StatusCode::NO_CONTENT
    );

    let subscription_uri = format!("/api/workspaces/{workspace_id}/tasks/{task_id}/subscription");
    assert_eq!(
        send(&app, "DELETE", &subscription_uri, None, &member_token)
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
    let feed_uri = format!("/api/workspaces/{workspace_id}/tasks/{task_id}/activity");
    assert_eq!(
        body(send(&app, "GET", &feed_uri, None, &member_token).await).await["watched"],
        false
    );
    assert_eq!(
        send(&app, "POST", &subscription_uri, None, &member_token)
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        body(send(&app, "GET", &feed_uri, None, &member_token).await).await["watched"],
        true
    );

    let comments_uri = format!("/api/workspaces/{workspace_id}/tasks/{task_id}/comments");
    let invalid_mention = send(
        &app,
        "POST",
        &comments_uri,
        Some(json!({"body": "Hidden mention", "mention_ids": [outsider_id]})),
        &member_token,
    )
    .await;
    assert_eq!(invalid_mention.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body(send(&app, "GET", &feed_uri, None, &member_token).await).await["comments"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    create(
        &app,
        &member_token,
        &comments_uri,
        json!({"body": "Mentioning the owner", "mention_ids": [owner_id]}),
    )
    .await;
    let owner_notifications = body(
        send(
            &app,
            "GET",
            "/api/notifications?unread=true",
            None,
            &owner_token,
        )
        .await,
    )
    .await;
    assert_eq!(owner_notifications.as_array().unwrap().len(), 1);
    assert_eq!(owner_notifications[0]["notification_type"], "mention");

    let preferences = send(
        &app,
        "PATCH",
        "/api/account/notification-preferences",
        Some(json!({"notify_comments": false, "notify_metadata": false})),
        &owner_token,
    )
    .await;
    assert_eq!(preferences.status(), StatusCode::OK);
    assert_eq!(body(preferences).await["notify_comments"], false);
    assert_eq!(
        send(
            &app,
            "POST",
            "/api/notifications/read-all",
            None,
            &owner_token
        )
        .await
        .status(),
        StatusCode::NO_CONTENT
    );
    create(
        &app,
        &member_token,
        &comments_uri,
        json!({"body": "Muted comment"}),
    )
    .await;
    assert!(
        body(
            send(
                &app,
                "GET",
                "/api/notifications?unread=true",
                None,
                &owner_token
            )
            .await
        )
        .await
        .as_array()
        .unwrap()
        .is_empty()
    );
    create(
        &app,
        &member_token,
        &comments_uri,
        json!({"body": "Mentions stay enabled", "mention_ids": [owner_id]}),
    )
    .await;
    assert_eq!(
        body(
            send(
                &app,
                "GET",
                "/api/notifications?unread=true",
                None,
                &owner_token
            )
            .await
        )
        .await[0]["notification_type"],
        "mention"
    );

    let document_uri = format!("/api/workspaces/{workspace_id}/tasks/{task_id}/document");
    let mut revision =
        body(send(&app, "GET", &document_uri, None, &owner_token).await).await["revision"]
            .as_str()
            .unwrap()
            .to_owned();
    for source in ["First save", "Second save"] {
        let saved = send(
            &app,
            "PUT",
            &document_uri,
            Some(json!({"content": source, "base_revision": revision})),
            &owner_token,
        )
        .await;
        assert_eq!(saved.status(), StatusCode::OK);
        revision = body(saved).await["revision"].as_str().unwrap().to_owned();
    }
    let activity = body(send(&app, "GET", &feed_uri, None, &owner_token).await).await;
    let event_types = activity["activity"]
        .as_array()
        .unwrap()
        .iter()
        .map(|event| event["event_type"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert!(event_types.contains(&"task_created"));
    assert!(event_types.contains(&"task_updated"));
    assert_eq!(
        event_types
            .iter()
            .filter(|event_type| **event_type == "document_updated")
            .count(),
        1
    );

    let forbidden = send(
        &app,
        "GET",
        &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/activity"),
        None,
        &outsider_token,
    )
    .await;
    assert_eq!(forbidden.status(), StatusCode::NOT_FOUND);
    assert!(
        body(send(&app, "GET", "/api/notifications", None, &outsider_token).await)
            .await
            .as_array()
            .unwrap()
            .is_empty()
    );
    let outsider_task = create(
        &app,
        &outsider_token,
        &format!("/api/workspaces/{outsider_workspace}/tasks"),
        json!({"title": "Other tenant"}),
    )
    .await;
    assert_ne!(outsider_task["workspace_id"], workspace_id.to_string());
}

#[sqlx::test(migrations = "./migrations")]
async fn existing_accounts_receive_invitation_notifications(pool: PgPool) {
    let data_dir = TempDir::new().unwrap();
    let app = test_app(pool, &data_dir);
    let (owner_token, _, workspace_id) = register(&app, "invite-owner@example.com").await;
    let (invitee_token, _, _) = register(&app, "invitee@example.com").await;
    create(
        &app,
        &owner_token,
        &format!("/api/workspaces/{workspace_id}/invitations"),
        json!({"email": "invitee@example.com", "role": "member"}),
    )
    .await;
    let notifications = body(
        send(
            &app,
            "GET",
            "/api/notifications?unread=true",
            None,
            &invitee_token,
        )
        .await,
    )
    .await;
    assert_eq!(notifications[0]["notification_type"], "invitation");
    assert_eq!(notifications[0]["workspace_id"], workspace_id.to_string());
    assert!(notifications[0]["invitation_id"].is_string());
}
