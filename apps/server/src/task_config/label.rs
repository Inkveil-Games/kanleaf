use std::collections::HashSet;

use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection, rejection::PathRejection},
    http::StatusCode,
};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    domain::{ConfigurationDescription, HexColor, ResourceName},
    error::{AppError, is_unique_violation},
    task::{enqueue_projection, project_many},
    workspace::require_workspace_admin,
};

use super::TaskLabelResponse;

#[derive(Deserialize)]
pub(super) struct CreateLabelRequest {
    name: String,
    color: String,
    #[serde(default)]
    description: String,
}

#[derive(Deserialize)]
pub(super) struct UpdateLabelRequest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    archived: Option<bool>,
}

#[derive(Deserialize)]
pub(super) struct ReorderLabelsRequest {
    ids: Vec<Uuid>,
}

pub(super) async fn list(
    pool: &PgPool,
    workspace_id: Uuid,
) -> Result<Vec<TaskLabelResponse>, AppError> {
    Ok(sqlx::query_as(
        r#"
        SELECT id, workspace_id, name, color, description, position,
               archived_at, created_at, updated_at
        FROM task_labels
        WHERE workspace_id = $1
        ORDER BY archived_at NULLS FIRST, position, id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await?)
}

pub(super) async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<CreateLabelRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<TaskLabelResponse>), AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let name = ResourceName::new(&request.name)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let color =
        HexColor::new(&request.color).map_err(|error| AppError::Validation(error.to_string()))?;
    let description = ConfigurationDescription::new(&request.description)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;

    let mut transaction = state.pool.begin().await?;
    super::state::lock_workspace_for_values(&mut transaction, workspace_id).await?;
    let position: i32 = sqlx::query_scalar(
        "SELECT COALESCE(max(position) + 1, 0) FROM task_labels WHERE workspace_id = $1 AND archived_at IS NULL",
    )
    .bind(workspace_id)
    .fetch_one(&mut *transaction)
    .await?;
    let created = sqlx::query_as::<_, TaskLabelResponse>(
        r#"
        INSERT INTO task_labels
            (id, workspace_id, name, color, description, position)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, workspace_id, name, color, description, position,
                  archived_at, created_at, updated_at
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(workspace_id)
    .bind(name.as_str())
    .bind(color.as_str())
    .bind(description.as_str())
    .bind(position)
    .fetch_one(&mut *transaction)
    .await;
    let created = match created {
        Ok(created) => created,
        Err(error) if is_unique_violation(&error) => {
            return Err(AppError::Conflict(
                "An active label already uses this name".to_owned(),
            ));
        }
        Err(error) => return Err(error.into()),
    };
    transaction.commit().await?;
    Ok((StatusCode::CREATED, Json(created)))
}

pub(super) async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<UpdateLabelRequest>, JsonRejection>,
) -> Result<Json<TaskLabelResponse>, AppError> {
    let Path((workspace_id, label_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    if request.name.is_none()
        && request.color.is_none()
        && request.description.is_none()
        && request.archived.is_none()
    {
        return Err(AppError::Validation(
            "Provide at least one label field to update".to_owned(),
        ));
    }
    let name = request
        .name
        .as_deref()
        .map(ResourceName::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let color = request
        .color
        .as_deref()
        .map(HexColor::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let description = request
        .description
        .as_deref()
        .map(ConfigurationDescription::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;

    let mut transaction = state.pool.begin().await?;
    super::state::lock_workspace_for_values(&mut transaction, workspace_id).await?;
    let was_archived: bool = sqlx::query_scalar(
        "SELECT archived_at IS NOT NULL FROM task_labels WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
    )
    .bind(label_id)
    .bind(workspace_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Task label not found".to_owned()))?;
    let new_position: Option<i32> = if request.archived == Some(false) && was_archived {
        Some(
            sqlx::query_scalar(
                "SELECT COALESCE(max(position) + 1, 0) FROM task_labels WHERE workspace_id = $1 AND archived_at IS NULL",
            )
            .bind(workspace_id)
            .fetch_one(&mut *transaction)
            .await?,
        )
    } else {
        None
    };
    let updated = sqlx::query_as::<_, TaskLabelResponse>(
        r#"
        UPDATE task_labels
        SET name = COALESCE($1, name),
            color = COALESCE($2, color),
            description = COALESCE($3, description),
            archived_at = CASE
                WHEN $4::boolean IS NULL THEN archived_at
                WHEN $4 THEN now()
                ELSE NULL
            END,
            position = COALESCE($5, position),
            updated_at = now()
        WHERE id = $6 AND workspace_id = $7
        RETURNING id, workspace_id, name, color, description, position,
                  archived_at, created_at, updated_at
        "#,
    )
    .bind(name.as_ref().map(ResourceName::as_str))
    .bind(color.as_ref().map(HexColor::as_str))
    .bind(description.as_ref().map(ConfigurationDescription::as_str))
    .bind(request.archived)
    .bind(new_position)
    .bind(label_id)
    .bind(workspace_id)
    .fetch_optional(&mut *transaction)
    .await;
    let updated = match updated {
        Ok(Some(updated)) => updated,
        Ok(None) => return Err(AppError::NotFound("Task label not found".to_owned())),
        Err(error) if is_unique_violation(&error) => {
            return Err(AppError::Conflict(
                "An active label already uses this name".to_owned(),
            ));
        }
        Err(error) => return Err(error.into()),
    };
    let task_ids = if name.is_some() {
        assigned_task_ids(&mut transaction, workspace_id, label_id).await?
    } else {
        Vec::new()
    };
    enqueue_projection(&mut transaction, workspace_id, &task_ids).await?;
    transaction.commit().await?;
    project_many(&state, workspace_id, &task_ids).await;
    Ok(Json(updated))
}

pub(super) async fn reorder(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<ReorderLabelsRequest>, JsonRejection>,
) -> Result<StatusCode, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let mut transaction = state.pool.begin().await?;
    super::state::lock_workspace_for_values(&mut transaction, workspace_id).await?;
    let current: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM task_labels WHERE workspace_id = $1 AND archived_at IS NULL FOR UPDATE",
    )
    .bind(workspace_id)
    .fetch_all(&mut *transaction)
    .await?;
    validate_reorder_ids(&request.ids, &current)?;
    let shift = i32::try_from(current.len() + 1)
        .map_err(|_| AppError::Validation("Too many labels to reorder".to_owned()))?;
    sqlx::query(
        "UPDATE task_labels SET position = position + $1 WHERE workspace_id = $2 AND archived_at IS NULL",
    )
    .bind(shift)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await?;
    for (position, label_id) in request.ids.into_iter().enumerate() {
        sqlx::query(
            "UPDATE task_labels SET position = $1, updated_at = now() WHERE id = $2 AND workspace_id = $3",
        )
        .bind(position as i32)
        .bind(label_id)
        .bind(workspace_id)
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn remove(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, label_id)) = path.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let mut transaction = state.pool.begin().await?;
    super::state::lock_workspace_for_values(&mut transaction, workspace_id).await?;
    let task_ids = assigned_task_ids(&mut transaction, workspace_id, label_id).await?;
    let result = sqlx::query("DELETE FROM task_labels WHERE id = $1 AND workspace_id = $2")
        .bind(label_id)
        .bind(workspace_id)
        .execute(&mut *transaction)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Task label not found".to_owned()));
    }
    enqueue_projection(&mut transaction, workspace_id, &task_ids).await?;
    transaction.commit().await?;
    project_many(&state, workspace_id, &task_ids).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn assigned_task_ids(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    workspace_id: Uuid,
    label_id: Uuid,
) -> Result<Vec<Uuid>, AppError> {
    Ok(sqlx::query_scalar(
        r#"
        SELECT task_id FROM task_label_assignments
        WHERE workspace_id = $1 AND label_id = $2
        ORDER BY task_id
        "#,
    )
    .bind(workspace_id)
    .bind(label_id)
    .fetch_all(&mut **transaction)
    .await?)
}

fn validate_reorder_ids(ids: &[Uuid], current: &[Uuid]) -> Result<(), AppError> {
    let requested: HashSet<_> = ids.iter().copied().collect();
    let existing: HashSet<_> = current.iter().copied().collect();
    if requested.len() != ids.len() || requested != existing {
        return Err(AppError::Validation(
            "Reorder every active label exactly once".to_owned(),
        ));
    }
    Ok(())
}
