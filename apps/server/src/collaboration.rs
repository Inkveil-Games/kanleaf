use std::collections::HashSet;

use anyhow::anyhow;
use axum::{
    Json, Router,
    extract::{
        Path, Query, State, rejection::JsonRejection, rejection::PathRejection,
        rejection::QueryRejection,
    },
    http::StatusCode,
    routing::{get, patch, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, Transaction, types::Json as SqlJson};
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    domain::ProjectRole,
    error::AppError,
    project::{require_project_access, require_project_commenter},
    workspace::workspace_role,
};

const MAX_COMMENT_BYTES: usize = 50_000;
const MAX_MENTIONS: usize = 25;

#[derive(Debug, Serialize, FromRow)]
struct UserSummary {
    id: Uuid,
    email: String,
    display_name: String,
}

#[derive(Debug, Serialize)]
struct CommentResponse {
    id: Uuid,
    workspace_id: Uuid,
    task_id: Uuid,
    parent_id: Option<Uuid>,
    body: Option<String>,
    author: Option<UserSummary>,
    mentions: Vec<UserSummary>,
    edited_at: Option<DateTime<Utc>>,
    deleted_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct CommentRow {
    id: Uuid,
    workspace_id: Uuid,
    task_id: Uuid,
    parent_id: Option<Uuid>,
    body: String,
    author_id: Option<Uuid>,
    author_email: Option<String>,
    author_display_name: Option<String>,
    edited_at: Option<DateTime<Utc>>,
    deleted_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
struct ActivityResponse {
    id: Uuid,
    event_type: String,
    actor: Option<UserSummary>,
    data: Value,
    created_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct ActivityRow {
    id: Uuid,
    event_type: String,
    actor_id: Option<Uuid>,
    actor_email: Option<String>,
    actor_display_name: Option<String>,
    data: SqlJson<Value>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct TaskFeedResponse {
    comments: Vec<CommentResponse>,
    activity: Vec<ActivityResponse>,
    watched: bool,
}

#[derive(Debug, Serialize, FromRow)]
struct CommentRevisionResponse {
    id: Uuid,
    body: String,
    editor_id: Option<Uuid>,
    editor_email: Option<String>,
    editor_display_name: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CommentRequest {
    body: String,
    #[serde(default)]
    parent_id: Option<Uuid>,
    #[serde(default)]
    mention_ids: Vec<Uuid>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EditCommentRequest {
    body: String,
    #[serde(default)]
    mention_ids: Vec<Uuid>,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct NotificationFilters {
    #[serde(default)]
    unread: bool,
}

#[derive(Debug, Serialize, FromRow)]
struct NotificationResponse {
    id: Uuid,
    notification_type: String,
    workspace_id: Uuid,
    workspace_name: String,
    task_id: Option<Uuid>,
    task_reference: Option<String>,
    task_title: Option<String>,
    comment_id: Option<Uuid>,
    invitation_id: Option<Uuid>,
    actor_id: Option<Uuid>,
    actor_email: Option<String>,
    actor_display_name: Option<String>,
    read_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
struct NotificationPreferencesResponse {
    notify_comments: bool,
    notify_metadata: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NotificationPreferencesRequest {
    notify_comments: bool,
    notify_metadata: bool,
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/notifications", get(list_notifications))
        .route("/api/notifications/read-all", post(mark_all_read))
        .route(
            "/api/notifications/{notification_id}/read",
            patch(mark_read),
        )
        .route(
            "/api/account/notification-preferences",
            get(get_notification_preferences).patch(update_notification_preferences),
        )
        .route(
            "/api/workspaces/{workspace_id}/tasks/{task_id}/activity",
            get(task_feed),
        )
        .route(
            "/api/workspaces/{workspace_id}/tasks/{task_id}/comments",
            post(create_comment),
        )
        .route(
            "/api/workspaces/{workspace_id}/tasks/{task_id}/comments/{comment_id}",
            patch(edit_comment).delete(delete_comment),
        )
        .route(
            "/api/workspaces/{workspace_id}/tasks/{task_id}/comments/{comment_id}/revisions",
            get(comment_revisions),
        )
        .route(
            "/api/workspaces/{workspace_id}/tasks/{task_id}/mention-candidates",
            get(mention_candidates),
        )
        .route(
            "/api/workspaces/{workspace_id}/tasks/{task_id}/subscription",
            post(watch_task).delete(unwatch_task),
        )
}

async fn task_feed(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<TaskFeedResponse>, AppError> {
    let Path((workspace_id, task_id)) = path.map_err(AppError::from)?;
    authorize_task(&state.pool, auth.user.id, workspace_id, task_id, false).await?;
    let comments = comment_rows(&state.pool, workspace_id, task_id).await?;
    let activity = sqlx::query_as::<_, ActivityRow>(
        r#"
        SELECT activity.id, activity.event_type, activity.actor_id,
               users.email AS actor_email, users.display_name AS actor_display_name,
               activity.data, activity.created_at
        FROM task_activity AS activity
        LEFT JOIN users ON users.id = activity.actor_id
        WHERE activity.workspace_id = $1 AND activity.task_id = $2
        ORDER BY activity.created_at, activity.id
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .map(ActivityRow::into_response)
    .collect();
    let watched: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM task_subscriptions WHERE workspace_id = $1 AND task_id = $2 AND user_id = $3)",
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(auth.user.id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(TaskFeedResponse {
        comments: hydrate_comments(&state.pool, comments).await?,
        activity,
        watched,
    }))
}

async fn create_comment(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<CommentRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<CommentResponse>), AppError> {
    let Path((workspace_id, task_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    validate_comment_body(&request.body)?;
    let mention_ids = unique_mentions(&request.mention_ids)?;
    let project_id = authorize_task(&state.pool, auth.user.id, workspace_id, task_id, true).await?;
    let mut transaction = state.pool.begin().await?;
    sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM tasks WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
    )
    .bind(workspace_id)
    .bind(task_id)
    .fetch_one(&mut *transaction)
    .await?;
    if let Some(parent_id) = request.parent_id {
        let parent: Option<Option<Uuid>> = sqlx::query_scalar(
            "SELECT parent_id FROM task_comments WHERE workspace_id = $1 AND task_id = $2 AND id = $3 AND deleted_at IS NULL FOR SHARE",
        )
        .bind(workspace_id)
        .bind(task_id)
        .bind(parent_id)
        .fetch_optional(&mut *transaction)
        .await?;
        match parent {
            Some(None) => {}
            Some(Some(_)) => {
                return Err(AppError::Validation(
                    "Replies can only be one level deep".to_owned(),
                ));
            }
            None => return Err(AppError::NotFound("Parent comment not found".to_owned())),
        }
    }
    validate_mentions(&mut transaction, workspace_id, project_id, &mention_ids).await?;
    let comment_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO task_comments
            (id, workspace_id, task_id, author_id, parent_id, body)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(comment_id)
    .bind(workspace_id)
    .bind(task_id)
    .bind(auth.user.id)
    .bind(request.parent_id)
    .bind(&request.body)
    .execute(&mut *transaction)
    .await?;
    replace_mentions(
        &mut transaction,
        workspace_id,
        task_id,
        comment_id,
        &mention_ids,
    )
    .await?;
    subscribe(&mut transaction, workspace_id, task_id, auth.user.id).await?;
    for user_id in &mention_ids {
        subscribe(&mut transaction, workspace_id, task_id, *user_id).await?;
    }
    notify_comment(
        &mut transaction,
        workspace_id,
        task_id,
        comment_id,
        auth.user.id,
        request.parent_id.is_some(),
        &mention_ids,
    )
    .await?;
    transaction.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(find_comment(&state.pool, workspace_id, task_id, comment_id).await?),
    ))
}

async fn edit_comment(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<EditCommentRequest>, JsonRejection>,
) -> Result<Json<CommentResponse>, AppError> {
    let Path((workspace_id, task_id, comment_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    validate_comment_body(&request.body)?;
    let mention_ids = unique_mentions(&request.mention_ids)?;
    let project_id = authorize_task(&state.pool, auth.user.id, workspace_id, task_id, true).await?;
    let mut transaction = state.pool.begin().await?;
    let current: Option<(Option<Uuid>, String, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT author_id, body, deleted_at FROM task_comments WHERE workspace_id = $1 AND task_id = $2 AND id = $3 FOR UPDATE",
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(comment_id)
    .fetch_optional(&mut *transaction)
    .await?;
    let Some((author_id, current_body, deleted_at)) = current else {
        return Err(AppError::NotFound("Comment not found".to_owned()));
    };
    if deleted_at.is_some() {
        return Err(AppError::Conflict(
            "Deleted comments cannot be edited".to_owned(),
        ));
    }
    if author_id != Some(auth.user.id) {
        return Err(AppError::Forbidden);
    }
    validate_mentions(&mut transaction, workspace_id, project_id, &mention_ids).await?;
    let previous_mentions: Vec<Uuid> =
        sqlx::query_scalar("SELECT user_id FROM task_comment_mentions WHERE comment_id = $1")
            .bind(comment_id)
            .fetch_all(&mut *transaction)
            .await?;
    if current_body != request.body {
        sqlx::query(
            "INSERT INTO task_comment_revisions (id, workspace_id, task_id, comment_id, body, editor_id) VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(Uuid::new_v4())
        .bind(workspace_id)
        .bind(task_id)
        .bind(comment_id)
        .bind(current_body)
        .bind(auth.user.id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE task_comments SET body = $1, edited_at = now(), updated_at = now() WHERE id = $2",
        )
        .bind(&request.body)
        .bind(comment_id)
        .execute(&mut *transaction)
        .await?;
    }
    replace_mentions(
        &mut transaction,
        workspace_id,
        task_id,
        comment_id,
        &mention_ids,
    )
    .await?;
    let previous = previous_mentions.into_iter().collect::<HashSet<_>>();
    let new_mentions = mention_ids
        .iter()
        .copied()
        .filter(|user_id| !previous.contains(user_id))
        .collect::<Vec<_>>();
    for user_id in &new_mentions {
        subscribe(&mut transaction, workspace_id, task_id, *user_id).await?;
    }
    notify_mentions(
        &mut transaction,
        workspace_id,
        task_id,
        comment_id,
        auth.user.id,
        &new_mentions,
    )
    .await?;
    transaction.commit().await?;
    Ok(Json(
        find_comment(&state.pool, workspace_id, task_id, comment_id).await?,
    ))
}

async fn delete_comment(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, task_id, comment_id)) = path.map_err(AppError::from)?;
    let project_id =
        authorize_task(&state.pool, auth.user.id, workspace_id, task_id, false).await?;
    let mut transaction = state.pool.begin().await?;
    let current: Option<(Option<Uuid>, String, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT author_id, body, deleted_at FROM task_comments WHERE workspace_id = $1 AND task_id = $2 AND id = $3 FOR UPDATE",
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(comment_id)
    .fetch_optional(&mut *transaction)
    .await?;
    let Some((author_id, body, deleted_at)) = current else {
        return Err(AppError::NotFound("Comment not found".to_owned()));
    };
    if deleted_at.is_some() {
        return Ok(StatusCode::NO_CONTENT);
    }
    if author_id != Some(auth.user.id)
        && !can_moderate_comment(&state.pool, auth.user.id, workspace_id, project_id).await?
    {
        return Err(AppError::Forbidden);
    }
    sqlx::query(
        "INSERT INTO task_comment_revisions (id, workspace_id, task_id, comment_id, body, editor_id) VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(workspace_id)
    .bind(task_id)
    .bind(comment_id)
    .bind(body)
    .bind(auth.user.id)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "UPDATE task_comments SET body = '', deleted_at = now(), updated_at = now() WHERE id = $1",
    )
    .bind(comment_id)
    .execute(&mut *transaction)
    .await?;
    sqlx::query("DELETE FROM task_comment_mentions WHERE comment_id = $1")
        .bind(comment_id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn comment_revisions(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
) -> Result<Json<Vec<CommentRevisionResponse>>, AppError> {
    let Path((workspace_id, task_id, comment_id)) = path.map_err(AppError::from)?;
    authorize_task(&state.pool, auth.user.id, workspace_id, task_id, false).await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM task_comments WHERE workspace_id = $1 AND task_id = $2 AND id = $3)",
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(comment_id)
    .fetch_one(&state.pool)
    .await?;
    if !exists {
        return Err(AppError::NotFound("Comment not found".to_owned()));
    }
    let revisions = sqlx::query_as::<_, CommentRevisionResponse>(
        r#"
        SELECT revisions.id, revisions.body, revisions.editor_id,
               users.email AS editor_email, users.display_name AS editor_display_name,
               revisions.created_at
        FROM task_comment_revisions AS revisions
        LEFT JOIN users ON users.id = revisions.editor_id
        WHERE revisions.comment_id = $1
        ORDER BY revisions.created_at DESC, revisions.id DESC
        "#,
    )
    .bind(comment_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(revisions))
}

async fn mention_candidates(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<Vec<UserSummary>>, AppError> {
    let Path((workspace_id, task_id)) = path.map_err(AppError::from)?;
    let project_id =
        authorize_task(&state.pool, auth.user.id, workspace_id, task_id, false).await?;
    Ok(Json(
        accessible_users(&state.pool, workspace_id, project_id).await?,
    ))
}

async fn watch_task(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, task_id)) = path.map_err(AppError::from)?;
    authorize_task(&state.pool, auth.user.id, workspace_id, task_id, false).await?;
    let mut transaction = state.pool.begin().await?;
    subscribe(&mut transaction, workspace_id, task_id, auth.user.id).await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn unwatch_task(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, task_id)) = path.map_err(AppError::from)?;
    authorize_task(&state.pool, auth.user.id, workspace_id, task_id, false).await?;
    sqlx::query(
        "DELETE FROM task_subscriptions WHERE workspace_id = $1 AND task_id = $2 AND user_id = $3",
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(auth.user.id)
    .execute(&state.pool)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_notifications(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    filters: Result<Query<NotificationFilters>, QueryRejection>,
) -> Result<Json<Vec<NotificationResponse>>, AppError> {
    let Query(filters) = filters.map_err(AppError::from)?;
    let notifications = sqlx::query_as::<_, NotificationResponse>(
        r#"
        SELECT notifications.id, notifications.notification_type,
               notifications.workspace_id, workspaces.name AS workspace_name,
               notifications.task_id,
               CASE WHEN projects.identifier IS NULL THEN
                   CASE WHEN tasks.task_number IS NULL THEN NULL ELSE 'K-' || tasks.task_number END
               ELSE projects.identifier || '-' || tasks.task_number END AS task_reference,
               tasks.title AS task_title, notifications.comment_id,
               notifications.invitation_id, notifications.actor_id,
               actors.email AS actor_email, actors.display_name AS actor_display_name,
               notifications.read_at, notifications.created_at
        FROM notifications
        JOIN workspaces ON workspaces.id = notifications.workspace_id
        LEFT JOIN tasks
          ON tasks.workspace_id = notifications.workspace_id
         AND tasks.id = notifications.task_id
        LEFT JOIN projects ON projects.id = tasks.project_id
        LEFT JOIN users AS actors ON actors.id = notifications.actor_id
        WHERE notifications.recipient_id = $1
          AND (NOT $2 OR notifications.read_at IS NULL)
          AND (
              notifications.notification_type = 'invitation'
              OR EXISTS (
                  SELECT 1
                  FROM workspace_memberships
                  WHERE workspace_memberships.workspace_id = notifications.workspace_id
                    AND workspace_memberships.user_id = $1
                    AND (
                        workspace_memberships.role IN ('owner', 'admin')
                        OR (tasks.project_id IS NULL AND workspace_memberships.role <> 'guest')
                        OR EXISTS (
                            SELECT 1 FROM project_memberships
                            WHERE project_memberships.workspace_id = notifications.workspace_id
                              AND project_memberships.project_id = tasks.project_id
                              AND project_memberships.user_id = $1
                        )
                    )
              )
          )
        ORDER BY notifications.created_at DESC, notifications.id DESC
        LIMIT 100
        "#,
    )
    .bind(auth.user.id)
    .bind(filters.unread)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(notifications))
}

async fn mark_read(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path(notification_id) = path.map_err(AppError::from)?;
    let result = sqlx::query(
        "UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND recipient_id = $2",
    )
    .bind(notification_id)
    .bind(auth.user.id)
    .execute(&state.pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Notification not found".to_owned()));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn mark_all_read(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<StatusCode, AppError> {
    sqlx::query(
        "UPDATE notifications SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL",
    )
    .bind(auth.user.id)
    .execute(&state.pool)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_notification_preferences(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<Json<NotificationPreferencesResponse>, AppError> {
    Ok(Json(
        sqlx::query_as::<_, NotificationPreferencesResponse>(
            "SELECT notify_comments, notify_metadata FROM users WHERE id = $1",
        )
        .bind(auth.user.id)
        .fetch_one(&state.pool)
        .await?,
    ))
}

async fn update_notification_preferences(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    payload: Result<Json<NotificationPreferencesRequest>, JsonRejection>,
) -> Result<Json<NotificationPreferencesResponse>, AppError> {
    let Json(request) = payload.map_err(AppError::from)?;
    Ok(Json(
        sqlx::query_as::<_, NotificationPreferencesResponse>(
            r#"
            UPDATE users
            SET notify_comments = $1, notify_metadata = $2, updated_at = now()
            WHERE id = $3
            RETURNING notify_comments, notify_metadata
            "#,
        )
        .bind(request.notify_comments)
        .bind(request.notify_metadata)
        .bind(auth.user.id)
        .fetch_one(&state.pool)
        .await?,
    ))
}

pub(crate) async fn record_activity(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
    actor_id: Uuid,
    event_type: &str,
    data: Value,
) -> Result<(), AppError> {
    sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM tasks WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
    )
    .bind(workspace_id)
    .bind(task_id)
    .fetch_one(&mut **transaction)
    .await?;
    let coalesced = sqlx::query(
        r#"
        WITH latest AS (
            SELECT id, actor_id, event_type, data, created_at
            FROM task_activity
            WHERE workspace_id = $1 AND task_id = $2
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            FOR UPDATE
        )
        UPDATE task_activity AS activity
        SET created_at = statement_timestamp()
        FROM latest
        WHERE activity.id = latest.id
          AND latest.actor_id = $3
          AND latest.event_type = $4
          AND latest.data = $5
          AND latest.created_at > statement_timestamp() - interval '1 minute'
          AND NOT EXISTS (
              SELECT 1 FROM task_comments AS comment
              WHERE comment.workspace_id = $1 AND comment.task_id = $2
                AND comment.created_at >= latest.created_at
          )
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(actor_id)
    .bind(event_type)
    .bind(SqlJson(data.clone()))
    .execute(&mut **transaction)
    .await?;
    if coalesced.rows_affected() == 1 {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO task_activity (id, workspace_id, task_id, actor_id, event_type, data, created_at) VALUES ($1, $2, $3, $4, $5, $6, statement_timestamp())",
    )
    .bind(Uuid::new_v4())
    .bind(workspace_id)
    .bind(task_id)
    .bind(actor_id)
    .bind(event_type)
    .bind(SqlJson(data))
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

pub(crate) async fn subscribe(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT INTO task_subscriptions (workspace_id, task_id, user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (task_id, user_id) DO NOTHING
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(user_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

pub(crate) async fn notify_assignments(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
    actor_id: Uuid,
    assignee_ids: &[Uuid],
) -> Result<(), AppError> {
    for user_id in assignee_ids {
        subscribe(transaction, workspace_id, task_id, *user_id).await?;
    }
    sqlx::query(
        r#"
        INSERT INTO notifications
            (id, recipient_id, workspace_id, task_id, actor_id, notification_type)
        SELECT gen_random_uuid(), assignees.user_id, $1, $2, $3, 'assignment'
        FROM unnest($4::uuid[]) AS assignees(user_id)
        WHERE assignees.user_id <> $3
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(actor_id)
    .bind(assignee_ids)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

pub(crate) async fn notify_task_change(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
    actor_id: Uuid,
    state_changed: bool,
    metadata_changed: bool,
) -> Result<(), AppError> {
    if state_changed {
        insert_subscriber_notifications(
            transaction,
            workspace_id,
            task_id,
            actor_id,
            "state_change",
            true,
        )
        .await?;
    }
    if metadata_changed {
        insert_subscriber_notifications(
            transaction,
            workspace_id,
            task_id,
            actor_id,
            "metadata_change",
            true,
        )
        .await?;
    }
    Ok(())
}

pub(crate) async fn notify_invitation(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    invitation_id: Uuid,
    email: &str,
    actor_id: Uuid,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT INTO notifications
            (id, recipient_id, workspace_id, actor_id, invitation_id, notification_type)
        SELECT gen_random_uuid(), users.id, $1, $2, $3, 'invitation'
        FROM users
        WHERE users.email = $4 AND users.id <> $2
        "#,
    )
    .bind(workspace_id)
    .bind(actor_id)
    .bind(invitation_id)
    .bind(email)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn insert_subscriber_notifications(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
    actor_id: Uuid,
    notification_type: &str,
    metadata_preference: bool,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT INTO notifications
            (id, recipient_id, workspace_id, task_id, actor_id, notification_type)
        SELECT gen_random_uuid(), subscriptions.user_id, $1, $2, $3, $4
        FROM task_subscriptions AS subscriptions
        JOIN users ON users.id = subscriptions.user_id
        WHERE subscriptions.workspace_id = $1
          AND subscriptions.task_id = $2
          AND subscriptions.user_id <> $3
          AND (NOT $5 OR users.notify_metadata)
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(actor_id)
    .bind(notification_type)
    .bind(metadata_preference)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn notify_comment(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
    comment_id: Uuid,
    actor_id: Uuid,
    reply: bool,
    mention_ids: &[Uuid],
) -> Result<(), AppError> {
    notify_mentions(
        transaction,
        workspace_id,
        task_id,
        comment_id,
        actor_id,
        mention_ids,
    )
    .await?;
    let notification_type = if reply { "reply" } else { "comment" };
    sqlx::query(
        r#"
        INSERT INTO notifications
            (id, recipient_id, workspace_id, task_id, actor_id, comment_id, notification_type)
        SELECT gen_random_uuid(), subscriptions.user_id, $1, $2, $3, $4, $5
        FROM task_subscriptions AS subscriptions
        JOIN users ON users.id = subscriptions.user_id
        WHERE subscriptions.workspace_id = $1
          AND subscriptions.task_id = $2
          AND subscriptions.user_id <> $3
          AND users.notify_comments
          AND NOT (subscriptions.user_id = ANY($6))
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(actor_id)
    .bind(comment_id)
    .bind(notification_type)
    .bind(mention_ids)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn notify_mentions(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
    comment_id: Uuid,
    actor_id: Uuid,
    mention_ids: &[Uuid],
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT INTO notifications
            (id, recipient_id, workspace_id, task_id, actor_id, comment_id, notification_type)
        SELECT gen_random_uuid(), mentions.user_id, $1, $2, $3, $4, 'mention'
        FROM unnest($5::uuid[]) AS mentions(user_id)
        WHERE mentions.user_id <> $3
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(actor_id)
    .bind(comment_id)
    .bind(mention_ids)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn authorize_task(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
    task_id: Uuid,
    comment: bool,
) -> Result<Option<Uuid>, AppError> {
    let project_id: Option<Option<Uuid>> = sqlx::query_scalar(
        "SELECT project_id FROM tasks WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL",
    )
    .bind(workspace_id)
    .bind(task_id)
    .fetch_optional(pool)
    .await?;
    let project_id = project_id.ok_or_else(|| AppError::NotFound("Task not found".to_owned()))?;
    if let Some(project_id) = project_id {
        if comment {
            require_project_commenter(pool, user_id, workspace_id, project_id).await?;
        } else {
            require_project_access(pool, user_id, workspace_id, project_id).await?;
        }
    } else {
        let role = workspace_role(pool, user_id, workspace_id).await?;
        if !role.can_access_content() {
            return Err(AppError::Forbidden);
        }
    }
    Ok(project_id)
}

async fn can_moderate_comment(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
) -> Result<bool, AppError> {
    let role = workspace_role(pool, user_id, workspace_id).await?;
    if role.can_manage() {
        return Ok(true);
    }
    let Some(project_id) = project_id else {
        return Ok(false);
    };
    Ok(
        require_project_access(pool, user_id, workspace_id, project_id).await?
            == ProjectRole::Admin,
    )
}

async fn accessible_users(
    pool: &PgPool,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
) -> Result<Vec<UserSummary>, AppError> {
    Ok(sqlx::query_as::<_, UserSummary>(
        r#"
        SELECT users.id, users.email, users.display_name
        FROM workspace_memberships AS memberships
        JOIN users ON users.id = memberships.user_id
        WHERE memberships.workspace_id = $1
          AND (
              ($2::uuid IS NULL AND memberships.role <> 'guest')
              OR memberships.role IN ('owner', 'admin')
              OR EXISTS (
                  SELECT 1 FROM project_memberships
                  WHERE project_memberships.workspace_id = memberships.workspace_id
                    AND project_memberships.project_id = $2
                    AND project_memberships.user_id = memberships.user_id
              )
          )
        ORDER BY lower(users.display_name), users.id
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .fetch_all(pool)
    .await?)
}

async fn validate_mentions(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    mention_ids: &[Uuid],
) -> Result<(), AppError> {
    if mention_ids.is_empty() {
        return Ok(());
    }
    let count: i64 = sqlx::query_scalar(
        r#"
        SELECT count(*)
        FROM workspace_memberships AS memberships
        WHERE memberships.workspace_id = $1
          AND memberships.user_id = ANY($2)
          AND (
              ($3::uuid IS NULL AND memberships.role <> 'guest')
              OR memberships.role IN ('owner', 'admin')
              OR EXISTS (
                  SELECT 1 FROM project_memberships
                  WHERE project_memberships.workspace_id = memberships.workspace_id
                    AND project_memberships.project_id = $3
                    AND project_memberships.user_id = memberships.user_id
              )
          )
        "#,
    )
    .bind(workspace_id)
    .bind(mention_ids)
    .bind(project_id)
    .fetch_one(&mut **transaction)
    .await?;
    if count != mention_ids.len() as i64 {
        return Err(AppError::Validation(
            "One or more mentioned users cannot access this Task".to_owned(),
        ));
    }
    Ok(())
}

async fn replace_mentions(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
    comment_id: Uuid,
    mention_ids: &[Uuid],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM task_comment_mentions WHERE comment_id = $1")
        .bind(comment_id)
        .execute(&mut **transaction)
        .await?;
    sqlx::query(
        r#"
        INSERT INTO task_comment_mentions (workspace_id, task_id, comment_id, user_id)
        SELECT $1, $2, $3, mentions.user_id
        FROM unnest($4::uuid[]) AS mentions(user_id)
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(comment_id)
    .bind(mention_ids)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn comment_rows(
    pool: &PgPool,
    workspace_id: Uuid,
    task_id: Uuid,
) -> Result<Vec<CommentRow>, AppError> {
    Ok(sqlx::query_as::<_, CommentRow>(
        r#"
        SELECT comments.id, comments.workspace_id, comments.task_id,
               comments.parent_id, comments.body, comments.author_id,
               users.email AS author_email, users.display_name AS author_display_name,
               comments.edited_at, comments.deleted_at,
               comments.created_at, comments.updated_at
        FROM task_comments AS comments
        LEFT JOIN users ON users.id = comments.author_id
        WHERE comments.workspace_id = $1 AND comments.task_id = $2
        ORDER BY comments.created_at, comments.id
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .fetch_all(pool)
    .await?)
}

async fn hydrate_comments(
    pool: &PgPool,
    rows: Vec<CommentRow>,
) -> Result<Vec<CommentResponse>, AppError> {
    let mut comments = rows
        .into_iter()
        .map(CommentRow::into_response)
        .collect::<Vec<_>>();
    if comments.is_empty() {
        return Ok(comments);
    }
    let ids = comments
        .iter()
        .map(|comment| comment.id)
        .collect::<Vec<_>>();
    let mentions = sqlx::query_as::<_, MentionRow>(
        r#"
        SELECT mentions.comment_id, users.id, users.email, users.display_name
        FROM task_comment_mentions AS mentions
        JOIN users ON users.id = mentions.user_id
        WHERE mentions.comment_id = ANY($1)
        ORDER BY lower(users.display_name), users.id
        "#,
    )
    .bind(&ids)
    .fetch_all(pool)
    .await?;
    for mention in mentions {
        if let Some(comment) = comments
            .iter_mut()
            .find(|comment| comment.id == mention.comment_id)
        {
            comment.mentions.push(mention.into_user());
        }
    }
    Ok(comments)
}

async fn find_comment(
    pool: &PgPool,
    workspace_id: Uuid,
    task_id: Uuid,
    comment_id: Uuid,
) -> Result<CommentResponse, AppError> {
    let rows = comment_rows(pool, workspace_id, task_id).await?;
    let row = rows
        .into_iter()
        .find(|row| row.id == comment_id)
        .ok_or_else(|| AppError::NotFound("Comment not found".to_owned()))?;
    hydrate_comments(pool, vec![row])
        .await?
        .pop()
        .ok_or_else(|| AppError::internal(anyhow!("comment hydration returned no row")))
}

#[derive(FromRow)]
struct MentionRow {
    comment_id: Uuid,
    id: Uuid,
    email: String,
    display_name: String,
}

impl MentionRow {
    fn into_user(self) -> UserSummary {
        UserSummary {
            id: self.id,
            email: self.email,
            display_name: self.display_name,
        }
    }
}

impl CommentRow {
    fn into_response(self) -> CommentResponse {
        let author = self.author_id.map(|id| UserSummary {
            id,
            email: self.author_email.unwrap_or_default(),
            display_name: self.author_display_name.unwrap_or_default(),
        });
        CommentResponse {
            id: self.id,
            workspace_id: self.workspace_id,
            task_id: self.task_id,
            parent_id: self.parent_id,
            body: self.deleted_at.is_none().then_some(self.body),
            author,
            mentions: Vec::new(),
            edited_at: self.edited_at,
            deleted_at: self.deleted_at,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

impl ActivityRow {
    fn into_response(self) -> ActivityResponse {
        let actor = self.actor_id.map(|id| UserSummary {
            id,
            email: self.actor_email.unwrap_or_default(),
            display_name: self.actor_display_name.unwrap_or_default(),
        });
        ActivityResponse {
            id: self.id,
            event_type: self.event_type,
            actor,
            data: self.data.0,
            created_at: self.created_at,
        }
    }
}

fn validate_comment_body(body: &str) -> Result<(), AppError> {
    if body.trim().is_empty() {
        return Err(AppError::Validation(
            "Comment body cannot be empty".to_owned(),
        ));
    }
    if body.len() > MAX_COMMENT_BYTES {
        return Err(AppError::Validation(
            "Comments cannot exceed 50,000 bytes".to_owned(),
        ));
    }
    Ok(())
}

fn unique_mentions(mention_ids: &[Uuid]) -> Result<Vec<Uuid>, AppError> {
    if mention_ids.len() > MAX_MENTIONS {
        return Err(AppError::Validation(
            "A comment cannot mention more than 25 people".to_owned(),
        ));
    }
    let mut seen = HashSet::with_capacity(mention_ids.len());
    if mention_ids.iter().any(|user_id| !seen.insert(*user_id)) {
        return Err(AppError::Validation(
            "Comment mentions cannot contain duplicates".to_owned(),
        ));
    }
    Ok(mention_ids.to_vec())
}

#[cfg(test)]
mod tests {
    use super::{unique_mentions, validate_comment_body};
    use crate::error::AppError;
    use uuid::Uuid;

    #[test]
    fn validates_comment_source_without_rewriting_it() {
        let markdown = "# Note\n\n  keep spacing  \n";
        validate_comment_body(markdown).unwrap();
        assert!(matches!(
            validate_comment_body("  \n"),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn rejects_duplicate_mentions() {
        let id = Uuid::new_v4();
        assert!(unique_mentions(&[id, id]).is_err());
    }
}
