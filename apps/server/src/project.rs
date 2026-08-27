use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection, rejection::PathRejection},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    domain::ResourceName,
    error::{AppError, is_unique_violation},
    workspace::require_workspace_content_access,
};

#[derive(Debug, Serialize, FromRow)]
pub struct ProjectResponse {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub name: String,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub(crate) struct ProjectRequest {
    name: String,
}

pub(crate) async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<Vec<ProjectResponse>>, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    require_workspace_content_access(&state.pool, auth.user.id, workspace_id).await?;
    let projects = sqlx::query_as::<_, ProjectResponse>(
        r#"
        SELECT id, workspace_id, name, archived_at, created_at, updated_at
        FROM projects
        WHERE workspace_id = $1 AND archived_at IS NULL
        ORDER BY created_at, id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(projects))
}

pub(crate) async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<ProjectRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ProjectResponse>), AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let name = ResourceName::new(&request.name)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    require_workspace_content_access(&state.pool, auth.user.id, workspace_id).await?;

    let project = sqlx::query_as::<_, ProjectResponse>(
        r#"
        INSERT INTO projects (id, workspace_id, name)
        VALUES ($1, $2, $3)
        RETURNING id, workspace_id, name, archived_at, created_at, updated_at
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(workspace_id)
    .bind(name.as_str())
    .fetch_one(&state.pool)
    .await;

    match project {
        Ok(project) => Ok((StatusCode::CREATED, Json(project))),
        Err(error) if is_unique_violation(&error) => Err(AppError::Conflict(
            "An active project already uses this name".to_owned(),
        )),
        Err(error) => Err(error.into()),
    }
}

pub(crate) async fn rename(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<ProjectRequest>, JsonRejection>,
) -> Result<Json<ProjectResponse>, AppError> {
    let Path((workspace_id, project_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let name = ResourceName::new(&request.name)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    require_workspace_content_access(&state.pool, auth.user.id, workspace_id).await?;

    let project = sqlx::query_as::<_, ProjectResponse>(
        r#"
        UPDATE projects
        SET name = $1, updated_at = now()
        WHERE id = $2 AND workspace_id = $3 AND archived_at IS NULL
        RETURNING id, workspace_id, name, archived_at, created_at, updated_at
        "#,
    )
    .bind(name.as_str())
    .bind(project_id)
    .bind(workspace_id)
    .fetch_optional(&state.pool)
    .await;

    match project {
        Ok(Some(project)) => Ok(Json(project)),
        Ok(None) => Err(AppError::NotFound("Project not found".to_owned())),
        Err(error) if is_unique_violation(&error) => Err(AppError::Conflict(
            "An active project already uses this name".to_owned(),
        )),
        Err(error) => Err(error.into()),
    }
}

pub(crate) async fn archive(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, project_id)) = path.map_err(AppError::from)?;
    require_workspace_content_access(&state.pool, auth.user.id, workspace_id).await?;
    let mut transaction = state.pool.begin().await?;
    let result = sqlx::query(
        "UPDATE projects SET archived_at = now(), updated_at = now() WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL",
    )
    .bind(project_id)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Project not found".to_owned()));
    }

    // Keep active tasks reachable instead of stranding them behind archived navigation.
    sqlx::query(
        "UPDATE tasks SET project_id = NULL, updated_at = now() WHERE workspace_id = $1 AND project_id = $2 AND archived_at IS NULL",
    )
    .bind(workspace_id)
    .bind(project_id)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
