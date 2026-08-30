use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection, rejection::PathRejection},
    http::StatusCode,
    routing::get,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    domain::{ProjectDescription, ResourceName},
    error::{AppError, is_unique_violation},
    project::{require_project_access, require_project_admin, require_project_editor},
    task::{enqueue_projection, project_many},
};

use super::planning::{PlanningFeature, lock_feature, require_feature, validate_lead};

#[derive(Serialize, FromRow)]
pub(crate) struct ModuleResponse {
    id: Uuid,
    workspace_id: Uuid,
    project_id: Uuid,
    name: String,
    description: String,
    lead_user_id: Option<Uuid>,
    status: String,
    start_date: Option<NaiveDate>,
    due_date: Option<NaiveDate>,
    total_tasks: i64,
    completed_tasks: i64,
    total_estimate: i64,
    completed_estimate: i64,
    archived_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ModuleStatus {
    Backlog,
    Planned,
    InProgress,
    Paused,
    Completed,
    Canceled,
}

impl ModuleStatus {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Backlog => "backlog",
            Self::Planned => "planned",
            Self::InProgress => "in_progress",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Canceled => "canceled",
        }
    }
}

#[derive(Deserialize)]
struct CreateModuleRequest {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    lead_user_id: Option<Uuid>,
    #[serde(default)]
    status: Option<ModuleStatus>,
    #[serde(default)]
    start_date: Option<NaiveDate>,
    #[serde(default)]
    due_date: Option<NaiveDate>,
}

#[derive(Deserialize)]
struct UpdateModuleRequest {
    name: Option<String>,
    description: Option<String>,
    #[serde(default, deserialize_with = "crate::task::deserialize_nullable")]
    lead_user_id: Option<Option<Uuid>>,
    status: Option<ModuleStatus>,
    #[serde(default, deserialize_with = "crate::task::deserialize_nullable")]
    start_date: Option<Option<NaiveDate>>,
    #[serde(default, deserialize_with = "crate::task::deserialize_nullable")]
    due_date: Option<Option<NaiveDate>>,
}

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/workspaces/{workspace_id}/projects/{project_id}/modules",
            get(list).post(create),
        )
        .route(
            "/api/workspaces/{workspace_id}/projects/{project_id}/modules/{module_id}",
            get(detail).patch(update).delete(archive),
        )
}

async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<Vec<ModuleResponse>>, AppError> {
    let Path((workspace_id, project_id)) = path.map_err(AppError::from)?;
    require_project_access(&state.pool, auth.user.id, workspace_id, project_id).await?;
    require_feature(
        &state.pool,
        workspace_id,
        project_id,
        PlanningFeature::Modules,
    )
    .await?;
    let modules = sqlx::query_as::<_, ModuleResponse>(&format!(
        "{} WHERE modules.workspace_id = $1 AND modules.project_id = $2 AND modules.archived_at IS NULL ORDER BY modules.created_at, modules.id",
        MODULE_SELECT
    ))
    .bind(workspace_id)
    .bind(project_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(modules))
}

async fn detail(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
) -> Result<Json<ModuleResponse>, AppError> {
    let Path((workspace_id, project_id, module_id)) = path.map_err(AppError::from)?;
    require_project_access(&state.pool, auth.user.id, workspace_id, project_id).await?;
    require_feature(
        &state.pool,
        workspace_id,
        project_id,
        PlanningFeature::Modules,
    )
    .await?;
    Ok(Json(
        find_module(&state.pool, workspace_id, project_id, module_id).await?,
    ))
}

async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<CreateModuleRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ModuleResponse>), AppError> {
    let Path((workspace_id, project_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    require_project_editor(&state.pool, auth.user.id, workspace_id, project_id).await?;
    let name = ResourceName::new(&request.name)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let description = ProjectDescription::new(&request.description)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    validate_dates(request.start_date, request.due_date)?;

    let module_id = Uuid::new_v4();
    let mut transaction = state.pool.begin().await?;
    lock_feature(
        &mut transaction,
        workspace_id,
        project_id,
        PlanningFeature::Modules,
    )
    .await?;
    validate_lead(
        &mut transaction,
        workspace_id,
        project_id,
        request.lead_user_id,
    )
    .await?;
    let result = sqlx::query(
        r#"
        INSERT INTO project_modules
            (id, workspace_id, project_id, name, description, lead_user_id,
             status, start_date, due_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(module_id)
    .bind(workspace_id)
    .bind(project_id)
    .bind(name.as_str())
    .bind(description.as_str())
    .bind(request.lead_user_id)
    .bind(request.status.unwrap_or(ModuleStatus::Backlog).as_str())
    .bind(request.start_date)
    .bind(request.due_date)
    .execute(&mut *transaction)
    .await;
    map_unique_result(result)?;
    transaction.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(find_module(&state.pool, workspace_id, project_id, module_id).await?),
    ))
}

async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<UpdateModuleRequest>, JsonRejection>,
) -> Result<Json<ModuleResponse>, AppError> {
    let Path((workspace_id, project_id, module_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    if request.name.is_none()
        && request.description.is_none()
        && request.lead_user_id.is_none()
        && request.status.is_none()
        && request.start_date.is_none()
        && request.due_date.is_none()
    {
        return Err(AppError::Validation(
            "Provide at least one Module field to update".to_owned(),
        ));
    }
    require_project_editor(&state.pool, auth.user.id, workspace_id, project_id).await?;
    let name = request
        .name
        .as_deref()
        .map(ResourceName::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let description = request
        .description
        .as_deref()
        .map(ProjectDescription::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;

    let mut transaction = state.pool.begin().await?;
    lock_feature(
        &mut transaction,
        workspace_id,
        project_id,
        PlanningFeature::Modules,
    )
    .await?;
    let task_ids = if name.is_some() {
        sqlx::query_scalar(
            r#"
            SELECT task_id FROM task_module_assignments
            WHERE workspace_id = $1 AND project_id = $2 AND module_id = $3
            ORDER BY task_id
            "#,
        )
        .bind(workspace_id)
        .bind(project_id)
        .bind(module_id)
        .fetch_all(&mut *transaction)
        .await?
    } else {
        Vec::new()
    };
    let current: (Option<Uuid>, Option<NaiveDate>, Option<NaiveDate>) = sqlx::query_as(
        r#"
        SELECT lead_user_id, start_date, due_date FROM project_modules
        WHERE workspace_id = $1 AND project_id = $2 AND id = $3
          AND archived_at IS NULL
        FOR UPDATE
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(module_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Module not found".to_owned()))?;
    let lead_user_id = request.lead_user_id.unwrap_or(current.0);
    let start_date = request.start_date.unwrap_or(current.1);
    let due_date = request.due_date.unwrap_or(current.2);
    validate_dates(start_date, due_date)?;
    validate_lead(&mut transaction, workspace_id, project_id, lead_user_id).await?;
    let result = sqlx::query(
        r#"
        UPDATE project_modules
        SET name = COALESCE($1, name), description = COALESCE($2, description),
            lead_user_id = $3, status = COALESCE($4, status),
            start_date = $5, due_date = $6, updated_at = now()
        WHERE workspace_id = $7 AND project_id = $8 AND id = $9
          AND archived_at IS NULL
        "#,
    )
    .bind(name.as_ref().map(ResourceName::as_str))
    .bind(description.as_ref().map(ProjectDescription::as_str))
    .bind(lead_user_id)
    .bind(request.status.map(ModuleStatus::as_str))
    .bind(start_date)
    .bind(due_date)
    .bind(workspace_id)
    .bind(project_id)
    .bind(module_id)
    .execute(&mut *transaction)
    .await;
    map_unique_result(result)?;
    enqueue_projection(&mut transaction, workspace_id, &task_ids).await?;
    transaction.commit().await?;
    project_many(&state, workspace_id, &task_ids).await;
    Ok(Json(
        find_module(&state.pool, workspace_id, project_id, module_id).await?,
    ))
}

async fn archive(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, project_id, module_id)) = path.map_err(AppError::from)?;
    require_project_admin(&state.pool, auth.user.id, workspace_id, project_id).await?;
    let mut transaction = state.pool.begin().await?;
    lock_feature(
        &mut transaction,
        workspace_id,
        project_id,
        PlanningFeature::Modules,
    )
    .await?;
    let task_ids: Vec<Uuid> = sqlx::query_scalar(
        r#"
        SELECT task_id FROM task_module_assignments
        WHERE workspace_id = $1 AND project_id = $2 AND module_id = $3
        ORDER BY task_id
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(module_id)
    .fetch_all(&mut *transaction)
    .await?;
    sqlx::query(
        "DELETE FROM task_module_assignments WHERE workspace_id = $1 AND project_id = $2 AND module_id = $3",
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(module_id)
    .execute(&mut *transaction)
    .await?;
    let result = sqlx::query(
        "UPDATE project_modules SET archived_at = now(), updated_at = now() WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND archived_at IS NULL",
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(module_id)
    .execute(&mut *transaction)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Module not found".to_owned()));
    }
    enqueue_projection(&mut transaction, workspace_id, &task_ids).await?;
    transaction.commit().await?;
    project_many(&state, workspace_id, &task_ids).await;
    Ok(StatusCode::NO_CONTENT)
}

const MODULE_SELECT: &str = r#"
    SELECT modules.id, modules.workspace_id, modules.project_id, modules.name,
           modules.description, modules.lead_user_id, modules.status,
           modules.start_date, modules.due_date,
           (SELECT count(*) FROM task_module_assignments AS assignments
            WHERE assignments.module_id = modules.id) AS total_tasks,
           (SELECT count(*) FROM task_module_assignments AS assignments
            JOIN tasks ON tasks.id = assignments.task_id
            JOIN task_states AS states ON states.id = tasks.state_id
            WHERE assignments.module_id = modules.id
              AND states.state_group IN ('done', 'canceled')) AS completed_tasks,
           (SELECT COALESCE(sum(tasks.estimate), 0) FROM task_module_assignments AS assignments
            JOIN tasks ON tasks.id = assignments.task_id
            WHERE assignments.module_id = modules.id) AS total_estimate,
           (SELECT COALESCE(sum(tasks.estimate), 0) FROM task_module_assignments AS assignments
            JOIN tasks ON tasks.id = assignments.task_id
            JOIN task_states AS states ON states.id = tasks.state_id
            WHERE assignments.module_id = modules.id
              AND states.state_group IN ('done', 'canceled')) AS completed_estimate,
           modules.archived_at, modules.created_at, modules.updated_at
    FROM project_modules AS modules
"#;

async fn find_module(
    pool: &PgPool,
    workspace_id: Uuid,
    project_id: Uuid,
    module_id: Uuid,
) -> Result<ModuleResponse, AppError> {
    sqlx::query_as::<_, ModuleResponse>(&format!(
        "{MODULE_SELECT} WHERE modules.workspace_id = $1 AND modules.project_id = $2 AND modules.id = $3 AND modules.archived_at IS NULL"
    ))
    .bind(workspace_id)
    .bind(project_id)
    .bind(module_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Module not found".to_owned()))
}

fn validate_dates(
    start_date: Option<NaiveDate>,
    due_date: Option<NaiveDate>,
) -> Result<(), AppError> {
    if start_date
        .zip(due_date)
        .is_some_and(|(start, due)| start > due)
    {
        return Err(AppError::Validation(
            "Module due date cannot be before its start date".to_owned(),
        ));
    }
    Ok(())
}

fn map_unique_result(
    result: Result<sqlx::postgres::PgQueryResult, sqlx::Error>,
) -> Result<sqlx::postgres::PgQueryResult, AppError> {
    match result {
        Ok(result) => Ok(result),
        Err(error) if is_unique_violation(&error) => Err(AppError::Conflict(
            "Module name is already in use".to_owned(),
        )),
        Err(error) => Err(error.into()),
    }
}
