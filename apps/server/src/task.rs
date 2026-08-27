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
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    domain::{TaskPriority, TaskTitle},
    error::AppError,
    task_config::{
        lock_workspace_for_assignment, resolve_task_defaults, validate_state_assignment,
        validate_task_type_assignment,
    },
    workspace::require_workspace_content_access,
};

const MAX_SEARCH_LENGTH: usize = 200;
const MAX_DOCUMENT_BYTES: usize = 5 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct TaskStateSummary {
    pub id: Uuid,
    pub name: String,
    pub color: String,
    pub state_group: String,
}

#[derive(Debug, Serialize)]
pub struct TaskTypeSummary {
    pub id: Uuid,
    pub name: String,
    pub icon: String,
    pub color: String,
}

#[derive(Debug, Serialize)]
pub struct TaskResponse {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub project_id: Option<Uuid>,
    pub title: String,
    pub state: TaskStateSummary,
    pub task_type: TaskTypeSummary,
    pub priority: String,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct TaskRow {
    id: Uuid,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    title: String,
    state_id: Uuid,
    state_name: String,
    state_color: String,
    state_group: String,
    task_type_id: Uuid,
    task_type_name: String,
    task_type_icon: String,
    task_type_color: String,
    priority: String,
    archived_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<TaskRow> for TaskResponse {
    fn from(row: TaskRow) -> Self {
        Self {
            id: row.id,
            workspace_id: row.workspace_id,
            project_id: row.project_id,
            title: row.title,
            state: TaskStateSummary {
                id: row.state_id,
                name: row.state_name,
                color: row.state_color,
                state_group: row.state_group,
            },
            task_type: TaskTypeSummary {
                id: row.task_type_id,
                name: row.task_type_name,
                icon: row.task_type_icon,
                color: row.task_type_color,
            },
            priority: row.priority,
            archived_at: row.archived_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(Deserialize)]
pub(crate) struct CreateTaskRequest {
    title: String,
    #[serde(default)]
    project_id: Option<Uuid>,
    #[serde(default)]
    state_id: Option<Uuid>,
    #[serde(default)]
    task_type_id: Option<Uuid>,
    #[serde(default)]
    priority: TaskPriority,
}

#[derive(Deserialize)]
pub(crate) struct UpdateTaskRequest {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    state_id: Option<Uuid>,
    #[serde(default)]
    task_type_id: Option<Uuid>,
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
    require_workspace_content_access(&state.pool, auth.user.id, workspace_id).await?;

    let rows = sqlx::query_as::<_, TaskRow>(
        r#"
        SELECT tasks.id, tasks.workspace_id, tasks.project_id, tasks.title,
               states.id AS state_id, states.name AS state_name,
               states.color AS state_color, states.state_group,
               task_types.id AS task_type_id, task_types.name AS task_type_name,
               task_types.icon AS task_type_icon, task_types.color AS task_type_color,
               tasks.priority, tasks.archived_at, tasks.created_at, tasks.updated_at
        FROM tasks
        JOIN task_states AS states
          ON states.workspace_id = tasks.workspace_id AND states.id = tasks.state_id
        JOIN task_types
          ON task_types.workspace_id = tasks.workspace_id
         AND task_types.id = tasks.task_type_id
        WHERE tasks.workspace_id = $1
          AND tasks.archived_at IS NULL
          AND ($2::uuid IS NULL OR tasks.project_id = $2)
          AND (NOT $3 OR tasks.project_id IS NULL)
          AND ($4::text IS NULL OR tasks.title ILIKE $4 ESCAPE '\')
        ORDER BY tasks.updated_at DESC, tasks.id
        "#,
    )
    .bind(workspace_id)
    .bind(filters.project_id)
    .bind(filters.inbox)
    .bind(search)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows.into_iter().map(TaskResponse::from).collect()))
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
    require_workspace_content_access(&state.pool, auth.user.id, workspace_id).await?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace_for_assignment(&mut transaction, workspace_id).await?;
    let defaults =
        resolve_task_defaults(&mut transaction, workspace_id, request.project_id).await?;
    let state_id = request.state_id.unwrap_or(defaults.0);
    let task_type_id = request.task_type_id.unwrap_or(defaults.1);
    validate_state_assignment(&mut transaction, workspace_id, state_id).await?;
    validate_task_type_assignment(
        &mut transaction,
        workspace_id,
        request.project_id,
        task_type_id,
    )
    .await?;

    let task_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO tasks
            (id, workspace_id, project_id, title, state_id, task_type_id, priority)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(task_id)
    .bind(workspace_id)
    .bind(request.project_id)
    .bind(title.as_str())
    .bind(state_id)
    .bind(task_type_id)
    .bind(request.priority.as_str())
    .execute(&mut *transaction)
    .await?;
    let task = find_task_in_transaction(&mut transaction, workspace_id, task_id).await?;

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
    require_workspace_content_access(&state.pool, auth.user.id, workspace_id).await?;
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
        && request.state_id.is_none()
        && request.task_type_id.is_none()
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
    require_workspace_content_access(&state.pool, auth.user.id, workspace_id).await?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace_for_assignment(&mut transaction, workspace_id).await?;
    let current: (Option<Uuid>, Uuid, Uuid) = sqlx::query_as(
        r#"
        SELECT project_id, state_id, task_type_id
        FROM tasks
        WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL
        "#,
    )
    .bind(task_id)
    .bind(workspace_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Task not found".to_owned()))?;
    let target_project = request.project_id.unwrap_or(current.0);
    if request.project_id.is_some() {
        resolve_task_defaults(&mut transaction, workspace_id, target_project).await?;
    }
    if let Some(state_id) = request.state_id {
        validate_state_assignment(&mut transaction, workspace_id, state_id).await?;
    }
    let target_task_type = request.task_type_id.unwrap_or(current.2);
    if request.task_type_id.is_some() || request.project_id.is_some() {
        validate_task_type_assignment(
            &mut transaction,
            workspace_id,
            target_project,
            target_task_type,
        )
        .await?;
    }

    let project_changed = request.project_id.is_some();
    let project_id = request.project_id.flatten();
    let result = sqlx::query(
        r#"
        UPDATE tasks
        SET title = COALESCE($1, title),
            state_id = COALESCE($2, state_id),
            task_type_id = COALESCE($3, task_type_id),
            priority = COALESCE($4, priority),
            project_id = CASE WHEN $5 THEN $6 ELSE project_id END,
            updated_at = now()
        WHERE id = $7 AND workspace_id = $8 AND archived_at IS NULL
        "#,
    )
    .bind(title.as_ref().map(TaskTitle::as_str))
    .bind(request.state_id)
    .bind(request.task_type_id)
    .bind(request.priority.map(TaskPriority::as_str))
    .bind(project_changed)
    .bind(project_id)
    .bind(task_id)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Task not found".to_owned()));
    }
    let task = find_task_in_transaction(&mut transaction, workspace_id, task_id).await?;
    transaction.commit().await?;
    Ok(Json(task))
}

pub(crate) async fn archive(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, task_id)) = path.map_err(AppError::from)?;
    require_workspace_content_access(&state.pool, auth.user.id, workspace_id).await?;
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
    require_workspace_content_access(&state.pool, auth.user.id, workspace_id).await?;
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
    require_workspace_content_access(&state.pool, auth.user.id, workspace_id).await?;
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
    let row = select_task_query()
        .bind(task_id)
        .bind(workspace_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Task not found".to_owned()))?;
    Ok(TaskResponse::from(row))
}

async fn find_task_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
) -> Result<TaskResponse, AppError> {
    let row = select_task_query()
        .bind(task_id)
        .bind(workspace_id)
        .fetch_optional(&mut **transaction)
        .await?
        .ok_or_else(|| AppError::NotFound("Task not found".to_owned()))?;
    Ok(TaskResponse::from(row))
}

fn select_task_query()
-> sqlx::query::QueryAs<'static, Postgres, TaskRow, sqlx::postgres::PgArguments> {
    sqlx::query_as(
        r#"
        SELECT tasks.id, tasks.workspace_id, tasks.project_id, tasks.title,
               states.id AS state_id, states.name AS state_name,
               states.color AS state_color, states.state_group,
               task_types.id AS task_type_id, task_types.name AS task_type_name,
               task_types.icon AS task_type_icon, task_types.color AS task_type_color,
               tasks.priority, tasks.archived_at, tasks.created_at, tasks.updated_at
        FROM tasks
        JOIN task_states AS states
          ON states.workspace_id = tasks.workspace_id AND states.id = tasks.state_id
        JOIN task_types
          ON task_types.workspace_id = tasks.workspace_id
         AND task_types.id = tasks.task_type_id
        WHERE tasks.id = $1 AND tasks.workspace_id = $2 AND tasks.archived_at IS NULL
        "#,
    )
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
