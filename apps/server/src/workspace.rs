use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection, rejection::PathRejection},
    http::StatusCode,
    routing::{get, patch, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::{AppState, auth::AuthenticatedUser, domain::ResourceName, error::AppError, project};

#[derive(Debug, Serialize, FromRow)]
pub struct WorkspaceResponse {
    pub id: Uuid,
    pub name: String,
    pub role: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct WorkspaceRequest {
    name: String,
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/workspaces", get(list).post(create))
        .route("/api/workspaces/{workspace_id}", patch(rename))
        .route("/api/workspaces/{workspace_id}/activate", post(activate))
        .route(
            "/api/workspaces/{workspace_id}/projects",
            get(project::list).post(project::create),
        )
        .route(
            "/api/workspaces/{workspace_id}/projects/{project_id}",
            patch(project::rename).delete(project::archive),
        )
}

async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<Json<Vec<WorkspaceResponse>>, AppError> {
    let workspaces = sqlx::query_as::<_, WorkspaceResponse>(
        r#"
        SELECT workspaces.id, workspaces.name, workspace_memberships.role,
               workspaces.created_at, workspaces.updated_at
        FROM workspaces
        JOIN workspace_memberships ON workspace_memberships.workspace_id = workspaces.id
        WHERE workspace_memberships.user_id = $1
        ORDER BY workspaces.created_at, workspaces.id
        "#,
    )
    .bind(auth.user.id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(workspaces))
}

async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    payload: Result<Json<WorkspaceRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<WorkspaceResponse>), AppError> {
    let Json(request) = payload.map_err(AppError::from)?;
    let name = ResourceName::new(&request.name)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let workspace_id = Uuid::new_v4();
    let mut transaction = state.pool.begin().await?;

    let workspace = sqlx::query_as::<_, WorkspaceResponse>(
        r#"
        INSERT INTO workspaces (id, name)
        VALUES ($1, $2)
        RETURNING id, name, 'owner'::text AS role, created_at, updated_at
        "#,
    )
    .bind(workspace_id)
    .bind(name.as_str())
    .fetch_one(&mut *transaction)
    .await?;
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
    )
    .bind(workspace_id)
    .bind(auth.user.id)
    .execute(&mut *transaction)
    .await?;
    sqlx::query("UPDATE users SET active_workspace_id = $1, updated_at = now() WHERE id = $2")
        .bind(workspace_id)
        .bind(auth.user.id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;

    Ok((StatusCode::CREATED, Json(workspace)))
}

async fn rename(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<WorkspaceRequest>, JsonRejection>,
) -> Result<Json<WorkspaceResponse>, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let name = ResourceName::new(&request.name)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    require_workspace_owner(&state.pool, auth.user.id, workspace_id).await?;

    let workspace = sqlx::query_as::<_, WorkspaceResponse>(
        r#"
        UPDATE workspaces
        SET name = $1, updated_at = now()
        WHERE id = $2
        RETURNING id, name, 'owner'::text AS role, created_at, updated_at
        "#,
    )
    .bind(name.as_str())
    .bind(workspace_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Workspace not found".to_owned()))?;
    Ok(Json(workspace))
}

async fn activate(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    require_workspace_member(&state.pool, auth.user.id, workspace_id).await?;
    sqlx::query("UPDATE users SET active_workspace_id = $1, updated_at = now() WHERE id = $2")
        .bind(workspace_id)
        .bind(auth.user.id)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn require_workspace_member(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
) -> Result<(), AppError> {
    let member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM workspace_memberships WHERE user_id = $1 AND workspace_id = $2)",
    )
    .bind(user_id)
    .bind(workspace_id)
    .fetch_one(pool)
    .await?;
    if !member {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

async fn require_workspace_owner(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
) -> Result<(), AppError> {
    let owner: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM workspace_memberships WHERE user_id = $1 AND workspace_id = $2 AND role = 'owner')",
    )
    .bind(user_id)
    .bind(workspace_id)
    .fetch_one(pool)
    .await?;
    if !owner {
        return Err(AppError::Forbidden);
    }
    Ok(())
}
