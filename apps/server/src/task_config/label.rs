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

pub(super) async fn list(
    pool: &PgPool,
    workspace_id: Uuid,
) -> Result<Vec<TaskLabelResponse>, AppError> {
    Ok(sqlx::query_as(
        r#"
        SELECT id, workspace_id, name, color, description,
               archived_at, created_at, updated_at
        FROM task_labels
        WHERE workspace_id = $1
        ORDER BY archived_at NULLS FIRST, lower(name), id
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

    let created = sqlx::query_as::<_, TaskLabelResponse>(
        r#"
        INSERT INTO task_labels
            (id, workspace_id, name, color, description)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, workspace_id, name, color, description,
                  archived_at, created_at, updated_at
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(workspace_id)
    .bind(name.as_str())
    .bind(color.as_str())
    .bind(description.as_str())
    .fetch_one(&state.pool)
    .await;
    match created {
        Ok(created) => Ok((StatusCode::CREATED, Json(created))),
        Err(error) if is_unique_violation(&error) => Err(AppError::Conflict(
            "An active label already uses this name".to_owned(),
        )),
        Err(error) => Err(error.into()),
    }
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
            updated_at = now()
        WHERE id = $5 AND workspace_id = $6
        RETURNING id, workspace_id, name, color, description,
                  archived_at, created_at, updated_at
        "#,
    )
    .bind(name.as_ref().map(ResourceName::as_str))
    .bind(color.as_ref().map(HexColor::as_str))
    .bind(description.as_ref().map(ConfigurationDescription::as_str))
    .bind(request.archived)
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
        sqlx::query_scalar(
            r#"
            SELECT task_id FROM task_label_assignments
            WHERE workspace_id = $1 AND label_id = $2
            ORDER BY task_id
            "#,
        )
        .bind(workspace_id)
        .bind(label_id)
        .fetch_all(&mut *transaction)
        .await?
    } else {
        Vec::new()
    };
    enqueue_projection(&mut transaction, workspace_id, &task_ids).await?;
    transaction.commit().await?;
    project_many(&state, workspace_id, &task_ids).await;
    Ok(Json(updated))
}

pub(super) async fn remove(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, label_id)) = path.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let mut transaction = state.pool.begin().await?;
    let task_ids: Vec<Uuid> = sqlx::query_scalar(
        r#"
        SELECT task_id FROM task_label_assignments
        WHERE workspace_id = $1 AND label_id = $2
        ORDER BY task_id
        "#,
    )
    .bind(workspace_id)
    .bind(label_id)
    .fetch_all(&mut *transaction)
    .await?;
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
