use axum::{
    Json,
    extract::{
        Path, Query, State, rejection::JsonRejection, rejection::PathRejection,
        rejection::QueryRejection,
    },
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    domain::{TaskPriority, TaskStatus, TaskTitle},
    error::AppError,
    workspace::require_workspace_member,
};

const MAX_SEARCH_LENGTH: usize = 200;
const MAX_DOCUMENT_BYTES: usize = 5 * 1024 * 1024;

#[derive(Debug, Serialize, FromRow)]
pub struct TaskResponse {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub project_id: Option<Uuid>,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub(crate) struct CreateTaskRequest {
    title: String,
    #[serde(default)]
    project_id: Option<Uuid>,
    #[serde(default)]
    status: TaskStatus,
    #[serde(default)]
    priority: TaskPriority,
}

#[derive(Deserialize)]
pub(crate) struct UpdateTaskRequest {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    status: Option<TaskStatus>,
    #[serde(default)]
    priority: Option<TaskPriority>,
    #[serde(default, deserialize_with = "deserialize_project_patch")]
    project_id: Option<Option<Uuid>>,
}

#[derive(Deserialize, Default)]
pub(crate) struct TaskFilters {
    project_id: Option<Uuid>,
    #[serde(default)]
    inbox: bool,
    query: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct DocumentRequest {
    content: String,
}

#[derive(Serialize)]
pub(crate) struct DocumentResponse {
    content: String,
}

pub(crate) async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    filters: Result<Query<TaskFilters>, QueryRejection>,
) -> Result<Json<Vec<TaskResponse>>, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Query(filters) = filters.map_err(AppError::from)?;
    if filters.inbox && filters.project_id.is_some() {
        return Err(AppError::Validation(
            "Inbox and project filters cannot be combined".to_owned(),
        ));
    }
    let search = filters.query.as_deref().map(search_pattern).transpose()?;
    require_workspace_member(&state.pool, auth.user.id, workspace_id).await?;

    let tasks = sqlx::query_as::<_, TaskResponse>(
        r#"
        SELECT id, workspace_id, project_id, title, status, priority,
               archived_at, created_at, updated_at
        FROM tasks
        WHERE workspace_id = $1
          AND archived_at IS NULL
          AND ($2::uuid IS NULL OR project_id = $2)
          AND (NOT $3 OR project_id IS NULL)
          AND ($4::text IS NULL OR title ILIKE $4 ESCAPE '\')
        ORDER BY updated_at DESC, id
        "#,
    )
    .bind(workspace_id)
    .bind(filters.project_id)
    .bind(filters.inbox)
    .bind(search)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(tasks))
}

pub(crate) async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<CreateTaskRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<TaskResponse>), AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let title =
        TaskTitle::new(&request.title).map_err(|error| AppError::Validation(error.to_string()))?;
    require_workspace_member(&state.pool, auth.user.id, workspace_id).await?;
    validate_project(&state.pool, workspace_id, request.project_id).await?;

    let task_id = Uuid::new_v4();
    let mut transaction = state.pool.begin().await?;
    let task = sqlx::query_as::<_, TaskResponse>(
        r#"
        INSERT INTO tasks (id, workspace_id, project_id, title, status, priority)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, workspace_id, project_id, title, status, priority,
                  archived_at, created_at, updated_at
        "#,
    )
    .bind(task_id)
    .bind(workspace_id)
    .bind(request.project_id)
    .bind(title.as_str())
    .bind(request.status.as_str())
    .bind(request.priority.as_str())
    .fetch_one(&mut *transaction)
    .await?;

    state
        .vault
        .create_document(workspace_id, task_id)
        .await
        .map_err(AppError::internal)?;
    transaction.commit().await?;
    Ok((StatusCode::CREATED, Json(task)))
}

pub(crate) async fn get(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<TaskResponse>, AppError> {
    let Path((workspace_id, task_id)) = path.map_err(AppError::from)?;
    require_workspace_member(&state.pool, auth.user.id, workspace_id).await?;
    Ok(Json(find_task(&state.pool, workspace_id, task_id).await?))
}

pub(crate) async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<UpdateTaskRequest>, JsonRejection>,
) -> Result<Json<TaskResponse>, AppError> {
    let Path((workspace_id, task_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    if request.title.is_none()
        && request.status.is_none()
        && request.priority.is_none()
        && request.project_id.is_none()
    {
        return Err(AppError::Validation(
            "Provide at least one task field to update".to_owned(),
        ));
    }
    let title = request
        .title
        .as_deref()
        .map(TaskTitle::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    require_workspace_member(&state.pool, auth.user.id, workspace_id).await?;
    if let Some(project_id) = request.project_id {
        validate_project(&state.pool, workspace_id, project_id).await?;
    }

    let project_changed = request.project_id.is_some();
    let project_id = request.project_id.flatten();
    let task = sqlx::query_as::<_, TaskResponse>(
        r#"
        UPDATE tasks
        SET title = COALESCE($1, title),
            status = COALESCE($2, status),
            priority = COALESCE($3, priority),
            project_id = CASE WHEN $4 THEN $5 ELSE project_id END,
            updated_at = now()
        WHERE id = $6 AND workspace_id = $7 AND archived_at IS NULL
        RETURNING id, workspace_id, project_id, title, status, priority,
                  archived_at, created_at, updated_at
        "#,
    )
    .bind(title.as_ref().map(TaskTitle::as_str))
    .bind(request.status.map(TaskStatus::as_str))
    .bind(request.priority.map(TaskPriority::as_str))
    .bind(project_changed)
    .bind(project_id)
    .bind(task_id)
    .bind(workspace_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Task not found".to_owned()))?;
    Ok(Json(task))
}

pub(crate) async fn archive(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, task_id)) = path.map_err(AppError::from)?;
    require_workspace_member(&state.pool, auth.user.id, workspace_id).await?;
    let result = sqlx::query(
        "UPDATE tasks SET archived_at = now(), updated_at = now() WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL",
    )
    .bind(task_id)
    .bind(workspace_id)
    .execute(&state.pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Task not found".to_owned()));
    }
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn read_document(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<DocumentResponse>, AppError> {
    let Path((workspace_id, task_id)) = path.map_err(AppError::from)?;
    require_workspace_member(&state.pool, auth.user.id, workspace_id).await?;
    find_task(&state.pool, workspace_id, task_id).await?;

    let content = state
        .vault
        .read_document(workspace_id, task_id)
        .await
        .map_err(AppError::internal)?;
    Ok(Json(DocumentResponse { content }))
}

pub(crate) async fn write_document(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<DocumentRequest>, JsonRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, task_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    if request.content.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::Validation(
            "Markdown documents cannot exceed 5 MiB".to_owned(),
        ));
    }

    // Membership and task ownership are resolved before constructing a vault path.
    require_workspace_member(&state.pool, auth.user.id, workspace_id).await?;
    find_task(&state.pool, workspace_id, task_id).await?;
    state
        .vault
        .write_document(workspace_id, task_id, &request.content)
        .await
        .map_err(AppError::internal)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn find_task(
    pool: &PgPool,
    workspace_id: Uuid,
    task_id: Uuid,
) -> Result<TaskResponse, AppError> {
    sqlx::query_as::<_, TaskResponse>(
        r#"
        SELECT id, workspace_id, project_id, title, status, priority,
               archived_at, created_at, updated_at
        FROM tasks
        WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL
        "#,
    )
    .bind(task_id)
    .bind(workspace_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Task not found".to_owned()))
}

async fn validate_project(
    pool: &PgPool,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
) -> Result<(), AppError> {
    let Some(project_id) = project_id else {
        return Ok(());
    };
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL)",
    )
    .bind(project_id)
    .bind(workspace_id)
    .fetch_one(pool)
    .await?;
    if !exists {
        return Err(AppError::NotFound("Project not found".to_owned()));
    }
    Ok(())
}

fn search_pattern(value: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.chars().count() > MAX_SEARCH_LENGTH {
        return Err(AppError::Validation(
            "Task search cannot exceed 200 characters".to_owned(),
        ));
    }
    let escaped = value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    Ok(format!("%{escaped}%"))
}

fn deserialize_project_patch<'de, D>(deserializer: D) -> Result<Option<Option<Uuid>>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<Uuid>::deserialize(deserializer).map(Some)
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::{UpdateTaskRequest, search_pattern};

    #[test]
    fn treats_search_wildcards_as_literal_characters() {
        assert_eq!(search_pattern("  100%_done  ").unwrap(), "%100\\%\\_done%");
    }

    #[test]
    fn distinguishes_an_omitted_project_from_clearing_it() {
        let omitted = UpdateTaskRequest::deserialize(serde_json::json!({})).unwrap();
        let cleared =
            UpdateTaskRequest::deserialize(serde_json::json!({"project_id": null})).unwrap();
        let assigned = UpdateTaskRequest::deserialize(
            serde_json::json!({"project_id": "2d236d11-6099-47c6-981b-b29a06be87af"}),
        )
        .unwrap();

        assert_eq!(omitted.project_id, None);
        assert_eq!(cleared.project_id, Some(None));
        assert!(assigned.project_id.flatten().is_some());
    }
}
