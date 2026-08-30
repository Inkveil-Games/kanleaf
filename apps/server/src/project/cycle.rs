use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection, rejection::PathRejection},
    http::StatusCode,
    routing::{get, post},
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    domain::{ProjectDescription, ResourceName},
    error::{AppError, is_unique_violation},
    project::{require_project_access, require_project_admin, require_project_editor},
    task::{enqueue_projection, project_many},
};

use super::planning::{PlanningFeature, lock_feature, require_feature};

#[derive(Serialize)]
pub(crate) struct CycleResponse {
    id: Uuid,
    workspace_id: Uuid,
    project_id: Uuid,
    name: String,
    description: String,
    start_date: NaiveDate,
    due_date: NaiveDate,
    status: &'static str,
    total_tasks: i64,
    completed_tasks: i64,
    total_estimate: i64,
    completed_estimate: i64,
    completed_at: Option<DateTime<Utc>>,
    archived_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct CycleRow {
    id: Uuid,
    workspace_id: Uuid,
    project_id: Uuid,
    name: String,
    description: String,
    start_date: NaiveDate,
    due_date: NaiveDate,
    total_tasks: i64,
    completed_tasks: i64,
    total_estimate: i64,
    completed_estimate: i64,
    completed_at: Option<DateTime<Utc>>,
    archived_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl CycleRow {
    fn into_response(self) -> CycleResponse {
        let status = if self.completed_at.is_some() {
            "completed"
        } else if Utc::now().date_naive() < self.start_date {
            "upcoming"
        } else {
            "active"
        };
        CycleResponse {
            id: self.id,
            workspace_id: self.workspace_id,
            project_id: self.project_id,
            name: self.name,
            description: self.description,
            start_date: self.start_date,
            due_date: self.due_date,
            status,
            total_tasks: self.total_tasks,
            completed_tasks: self.completed_tasks,
            total_estimate: self.total_estimate,
            completed_estimate: self.completed_estimate,
            completed_at: self.completed_at,
            archived_at: self.archived_at,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

#[derive(Deserialize)]
struct CreateCycleRequest {
    name: String,
    #[serde(default)]
    description: String,
    start_date: NaiveDate,
    due_date: NaiveDate,
}

#[derive(Deserialize)]
struct UpdateCycleRequest {
    name: Option<String>,
    description: Option<String>,
    start_date: Option<NaiveDate>,
    due_date: Option<NaiveDate>,
}

#[derive(Deserialize)]
struct CompleteCycleRequest {
    #[serde(default)]
    transfer_cycle_id: Option<Uuid>,
}

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/workspaces/{workspace_id}/projects/{project_id}/cycles",
            get(list).post(create),
        )
        .route(
            "/api/workspaces/{workspace_id}/projects/{project_id}/cycles/{cycle_id}",
            get(detail).patch(update).delete(archive),
        )
        .route(
            "/api/workspaces/{workspace_id}/projects/{project_id}/cycles/{cycle_id}/complete",
            post(complete),
        )
}

async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<Vec<CycleResponse>>, AppError> {
    let Path((workspace_id, project_id)) = path.map_err(AppError::from)?;
    require_project_access(&state.pool, auth.user.id, workspace_id, project_id).await?;
    require_feature(
        &state.pool,
        workspace_id,
        project_id,
        PlanningFeature::Cycles,
    )
    .await?;
    let rows = sqlx::query_as::<_, CycleRow>(
        r#"
        SELECT cycles.id, cycles.workspace_id, cycles.project_id, cycles.name,
               cycles.description, cycles.start_date, cycles.due_date,
               (SELECT count(*) FROM task_cycle_assignments AS assignments
                WHERE assignments.cycle_id = cycles.id) AS total_tasks,
               (SELECT count(*) FROM task_cycle_assignments AS assignments
                JOIN tasks ON tasks.id = assignments.task_id
                JOIN task_states AS states ON states.id = tasks.state_id
                WHERE assignments.cycle_id = cycles.id
                  AND states.state_group IN ('done', 'canceled')) AS completed_tasks,
               (SELECT COALESCE(sum(tasks.estimate), 0) FROM task_cycle_assignments AS assignments
                JOIN tasks ON tasks.id = assignments.task_id
                WHERE assignments.cycle_id = cycles.id) AS total_estimate,
               (SELECT COALESCE(sum(tasks.estimate), 0) FROM task_cycle_assignments AS assignments
                JOIN tasks ON tasks.id = assignments.task_id
                JOIN task_states AS states ON states.id = tasks.state_id
                WHERE assignments.cycle_id = cycles.id
                  AND states.state_group IN ('done', 'canceled')) AS completed_estimate,
               cycles.completed_at, cycles.archived_at,
               cycles.created_at, cycles.updated_at
        FROM project_cycles AS cycles
        WHERE cycles.workspace_id = $1 AND cycles.project_id = $2
          AND cycles.archived_at IS NULL
        ORDER BY cycles.start_date, cycles.id
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(
        rows.into_iter().map(CycleRow::into_response).collect(),
    ))
}

async fn detail(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
) -> Result<Json<CycleResponse>, AppError> {
    let Path((workspace_id, project_id, cycle_id)) = path.map_err(AppError::from)?;
    require_project_access(&state.pool, auth.user.id, workspace_id, project_id).await?;
    require_feature(
        &state.pool,
        workspace_id,
        project_id,
        PlanningFeature::Cycles,
    )
    .await?;
    Ok(Json(
        find_cycle(&state.pool, workspace_id, project_id, cycle_id).await?,
    ))
}

async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<CreateCycleRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<CycleResponse>), AppError> {
    let Path((workspace_id, project_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    require_project_editor(&state.pool, auth.user.id, workspace_id, project_id).await?;
    let name = ResourceName::new(&request.name)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let description = ProjectDescription::new(&request.description)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    validate_dates(request.start_date, request.due_date)?;

    let cycle_id = Uuid::new_v4();
    let mut transaction = state.pool.begin().await?;
    lock_feature(
        &mut transaction,
        workspace_id,
        project_id,
        PlanningFeature::Cycles,
    )
    .await?;
    reject_overlap(
        &mut transaction,
        workspace_id,
        project_id,
        None,
        request.start_date,
        request.due_date,
    )
    .await?;
    let result = sqlx::query(
        r#"
        INSERT INTO project_cycles
            (id, workspace_id, project_id, name, description, start_date, due_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(cycle_id)
    .bind(workspace_id)
    .bind(project_id)
    .bind(name.as_str())
    .bind(description.as_str())
    .bind(request.start_date)
    .bind(request.due_date)
    .execute(&mut *transaction)
    .await;
    map_unique_result(result, "Cycle name is already in use")?;
    transaction.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(find_cycle(&state.pool, workspace_id, project_id, cycle_id).await?),
    ))
}

async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<UpdateCycleRequest>, JsonRejection>,
) -> Result<Json<CycleResponse>, AppError> {
    let Path((workspace_id, project_id, cycle_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    if request.name.is_none()
        && request.description.is_none()
        && request.start_date.is_none()
        && request.due_date.is_none()
    {
        return Err(AppError::Validation(
            "Provide at least one Cycle field to update".to_owned(),
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
        PlanningFeature::Cycles,
    )
    .await?;
    let current: (NaiveDate, NaiveDate, Option<DateTime<Utc>>) = sqlx::query_as(
        r#"
        SELECT start_date, due_date, completed_at FROM project_cycles
        WHERE workspace_id = $1 AND project_id = $2 AND id = $3
          AND archived_at IS NULL
        FOR UPDATE
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(cycle_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Cycle not found".to_owned()))?;
    if current.2.is_some() {
        return Err(AppError::Validation(
            "Completed Cycles cannot be edited".to_owned(),
        ));
    }
    let start_date = request.start_date.unwrap_or(current.0);
    let due_date = request.due_date.unwrap_or(current.1);
    validate_dates(start_date, due_date)?;
    reject_overlap(
        &mut transaction,
        workspace_id,
        project_id,
        Some(cycle_id),
        start_date,
        due_date,
    )
    .await?;
    let result = sqlx::query(
        r#"
        UPDATE project_cycles
        SET name = COALESCE($1, name), description = COALESCE($2, description),
            start_date = $3, due_date = $4, updated_at = now()
        WHERE workspace_id = $5 AND project_id = $6 AND id = $7
          AND archived_at IS NULL
        "#,
    )
    .bind(name.as_ref().map(ResourceName::as_str))
    .bind(description.as_ref().map(ProjectDescription::as_str))
    .bind(start_date)
    .bind(due_date)
    .bind(workspace_id)
    .bind(project_id)
    .bind(cycle_id)
    .execute(&mut *transaction)
    .await;
    map_unique_result(result, "Cycle name is already in use")?;
    let task_ids = if name.is_some() {
        sqlx::query_scalar(
            r#"
            SELECT task_id FROM task_cycle_assignments
            WHERE workspace_id = $1 AND project_id = $2 AND cycle_id = $3
            ORDER BY task_id
            "#,
        )
        .bind(workspace_id)
        .bind(project_id)
        .bind(cycle_id)
        .fetch_all(&mut *transaction)
        .await?
    } else {
        Vec::new()
    };
    enqueue_projection(&mut transaction, workspace_id, &task_ids).await?;
    transaction.commit().await?;
    project_many(&state, workspace_id, &task_ids).await;
    Ok(Json(
        find_cycle(&state.pool, workspace_id, project_id, cycle_id).await?,
    ))
}

async fn complete(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<CompleteCycleRequest>, JsonRejection>,
) -> Result<Json<CycleResponse>, AppError> {
    let Path((workspace_id, project_id, cycle_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    require_project_editor(&state.pool, auth.user.id, workspace_id, project_id).await?;
    if request.transfer_cycle_id == Some(cycle_id) {
        return Err(AppError::Validation(
            "A Cycle cannot transfer work to itself".to_owned(),
        ));
    }
    let mut transaction = state.pool.begin().await?;
    lock_feature(
        &mut transaction,
        workspace_id,
        project_id,
        PlanningFeature::Cycles,
    )
    .await?;
    let source_due_date: NaiveDate = sqlx::query_scalar(
        r#"
        SELECT due_date FROM project_cycles
        WHERE workspace_id = $1 AND project_id = $2 AND id = $3
          AND archived_at IS NULL AND completed_at IS NULL
        FOR UPDATE
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(cycle_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Active Cycle not found".to_owned()))?;
    let task_ids: Vec<Uuid> = sqlx::query_scalar(
        r#"
        SELECT assignments.task_id
        FROM task_cycle_assignments AS assignments
        JOIN tasks ON tasks.id = assignments.task_id
        JOIN task_states AS states ON states.id = tasks.state_id
        WHERE assignments.workspace_id = $1
          AND assignments.project_id = $2
          AND assignments.cycle_id = $3
          AND states.state_group NOT IN ('done', 'canceled')
        ORDER BY assignments.task_id
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(cycle_id)
    .fetch_all(&mut *transaction)
    .await?;

    if let Some(target_id) = request.transfer_cycle_id {
        let target_start_date: NaiveDate = sqlx::query_scalar(
            r#"
            SELECT start_date FROM project_cycles
            WHERE workspace_id = $1 AND project_id = $2 AND id = $3
              AND archived_at IS NULL AND completed_at IS NULL
            FOR UPDATE
            "#,
        )
        .bind(workspace_id)
        .bind(project_id)
        .bind(target_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| AppError::Validation("Transfer Cycle is not available".to_owned()))?;
        if target_start_date <= source_due_date {
            return Err(AppError::Validation(
                "Incomplete work can only transfer to a future Cycle".to_owned(),
            ));
        }
        sqlx::query(
            r#"
            UPDATE task_cycle_assignments AS assignments
            SET cycle_id = $1
            FROM tasks
            JOIN task_states AS states ON states.id = tasks.state_id
            WHERE assignments.workspace_id = $2
              AND assignments.project_id = $3
              AND assignments.cycle_id = $4
              AND tasks.id = assignments.task_id
              AND states.state_group NOT IN ('done', 'canceled')
            "#,
        )
        .bind(target_id)
        .bind(workspace_id)
        .bind(project_id)
        .bind(cycle_id)
        .execute(&mut *transaction)
        .await?;
    } else {
        sqlx::query(
            r#"
            DELETE FROM task_cycle_assignments AS assignments
            USING tasks, task_states AS states
            WHERE assignments.workspace_id = $1
              AND assignments.project_id = $2
              AND assignments.cycle_id = $3
              AND tasks.id = assignments.task_id
              AND states.id = tasks.state_id
              AND states.state_group NOT IN ('done', 'canceled')
            "#,
        )
        .bind(workspace_id)
        .bind(project_id)
        .bind(cycle_id)
        .execute(&mut *transaction)
        .await?;
    }
    sqlx::query(
        "UPDATE project_cycles SET completed_at = now(), updated_at = now() WHERE workspace_id = $1 AND project_id = $2 AND id = $3",
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(cycle_id)
    .execute(&mut *transaction)
    .await?;
    enqueue_projection(&mut transaction, workspace_id, &task_ids).await?;
    transaction.commit().await?;
    project_many(&state, workspace_id, &task_ids).await;
    Ok(Json(
        find_cycle(&state.pool, workspace_id, project_id, cycle_id).await?,
    ))
}

async fn archive(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, project_id, cycle_id)) = path.map_err(AppError::from)?;
    require_project_admin(&state.pool, auth.user.id, workspace_id, project_id).await?;
    let mut transaction = state.pool.begin().await?;
    lock_feature(
        &mut transaction,
        workspace_id,
        project_id,
        PlanningFeature::Cycles,
    )
    .await?;
    let task_ids: Vec<Uuid> = sqlx::query_scalar(
        r#"
        SELECT task_id FROM task_cycle_assignments
        WHERE workspace_id = $1 AND project_id = $2 AND cycle_id = $3
        ORDER BY task_id
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(cycle_id)
    .fetch_all(&mut *transaction)
    .await?;
    sqlx::query(
        "DELETE FROM task_cycle_assignments WHERE workspace_id = $1 AND project_id = $2 AND cycle_id = $3",
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(cycle_id)
    .execute(&mut *transaction)
    .await?;
    let result = sqlx::query(
        "UPDATE project_cycles SET archived_at = now(), updated_at = now() WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND archived_at IS NULL",
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(cycle_id)
    .execute(&mut *transaction)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Cycle not found".to_owned()));
    }
    enqueue_projection(&mut transaction, workspace_id, &task_ids).await?;
    transaction.commit().await?;
    project_many(&state, workspace_id, &task_ids).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn find_cycle(
    pool: &PgPool,
    workspace_id: Uuid,
    project_id: Uuid,
    cycle_id: Uuid,
) -> Result<CycleResponse, AppError> {
    let row = sqlx::query_as::<_, CycleRow>(
        r#"
        SELECT cycles.id, cycles.workspace_id, cycles.project_id, cycles.name,
               cycles.description, cycles.start_date, cycles.due_date,
               (SELECT count(*) FROM task_cycle_assignments AS assignments
                WHERE assignments.cycle_id = cycles.id) AS total_tasks,
               (SELECT count(*) FROM task_cycle_assignments AS assignments
                JOIN tasks ON tasks.id = assignments.task_id
                JOIN task_states AS states ON states.id = tasks.state_id
                WHERE assignments.cycle_id = cycles.id
                  AND states.state_group IN ('done', 'canceled')) AS completed_tasks,
               (SELECT COALESCE(sum(tasks.estimate), 0) FROM task_cycle_assignments AS assignments
                JOIN tasks ON tasks.id = assignments.task_id
                WHERE assignments.cycle_id = cycles.id) AS total_estimate,
               (SELECT COALESCE(sum(tasks.estimate), 0) FROM task_cycle_assignments AS assignments
                JOIN tasks ON tasks.id = assignments.task_id
                JOIN task_states AS states ON states.id = tasks.state_id
                WHERE assignments.cycle_id = cycles.id
                  AND states.state_group IN ('done', 'canceled')) AS completed_estimate,
               cycles.completed_at, cycles.archived_at,
               cycles.created_at, cycles.updated_at
        FROM project_cycles AS cycles
        WHERE cycles.workspace_id = $1 AND cycles.project_id = $2
          AND cycles.id = $3 AND cycles.archived_at IS NULL
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(cycle_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Cycle not found".to_owned()))?;
    Ok(row.into_response())
}

async fn reject_overlap(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Uuid,
    excluded_cycle_id: Option<Uuid>,
    start_date: NaiveDate,
    due_date: NaiveDate,
) -> Result<(), AppError> {
    let overlaps: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM project_cycles
            WHERE workspace_id = $1 AND project_id = $2
              AND archived_at IS NULL AND completed_at IS NULL
              AND ($3::uuid IS NULL OR id <> $3)
              AND daterange(start_date, due_date, '[]') && daterange($4, $5, '[]')
        )
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(excluded_cycle_id)
    .bind(start_date)
    .bind(due_date)
    .fetch_one(&mut **transaction)
    .await?;
    if overlaps {
        return Err(AppError::Validation(
            "Active Cycles in a Project cannot overlap".to_owned(),
        ));
    }
    Ok(())
}

fn validate_dates(start_date: NaiveDate, due_date: NaiveDate) -> Result<(), AppError> {
    if start_date > due_date {
        return Err(AppError::Validation(
            "Cycle due date cannot be before its start date".to_owned(),
        ));
    }
    Ok(())
}

fn map_unique_result(
    result: Result<sqlx::postgres::PgQueryResult, sqlx::Error>,
    message: &str,
) -> Result<sqlx::postgres::PgQueryResult, AppError> {
    match result {
        Ok(result) => Ok(result),
        Err(error) if is_unique_violation(&error) => Err(AppError::Conflict(message.to_owned())),
        Err(error) => Err(error.into()),
    }
}
