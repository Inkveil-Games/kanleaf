use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection, rejection::PathRejection},
    http::StatusCode,
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    domain::{ProjectRole, ProjectVisibility},
    error::{AppError, is_unique_violation},
    workspace::{WorkspaceRole, workspace_role},
};

use super::access::{require_project_access, require_project_admin};

#[derive(Serialize, FromRow)]
pub(super) struct ProjectMemberResponse {
    user_id: Uuid,
    email: String,
    display_name: String,
    role: String,
    implicit: bool,
    joined_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct AddMemberRequest {
    user_id: Uuid,
    role: ProjectRole,
}

#[derive(Deserialize)]
struct UpdateMemberRequest {
    role: ProjectRole,
}

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/workspaces/{workspace_id}/projects/{project_id}/members",
            get(list).post(add),
        )
        .route(
            "/api/workspaces/{workspace_id}/projects/{project_id}/members/{user_id}",
            axum::routing::patch(update).delete(remove),
        )
        .route(
            "/api/workspaces/{workspace_id}/projects/{project_id}/join",
            post(join),
        )
}

async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<Vec<ProjectMemberResponse>>, AppError> {
    let Path((workspace_id, project_id)) = path.map_err(AppError::from)?;
    require_project_access(&state.pool, auth.user.id, workspace_id, project_id).await?;
    let members = sqlx::query_as::<_, ProjectMemberResponse>(
        r#"
        SELECT * FROM (
            SELECT users.id AS user_id, users.email, users.display_name,
                   'admin'::text AS role, true AS implicit,
                   memberships.created_at AS joined_at, memberships.updated_at
            FROM workspace_memberships AS memberships
            JOIN users ON users.id = memberships.user_id
            WHERE memberships.workspace_id = $1
              AND memberships.role IN ('owner', 'admin')
            UNION ALL
            SELECT users.id AS user_id, users.email, users.display_name,
                   project_memberships.role, false AS implicit,
                   project_memberships.created_at AS joined_at,
                   project_memberships.updated_at
            FROM project_memberships
            JOIN users ON users.id = project_memberships.user_id
            JOIN workspace_memberships
              ON workspace_memberships.workspace_id = project_memberships.workspace_id
             AND workspace_memberships.user_id = project_memberships.user_id
            WHERE project_memberships.workspace_id = $1
              AND project_memberships.project_id = $2
              AND workspace_memberships.role NOT IN ('owner', 'admin')
        ) AS members
        ORDER BY implicit DESC,
                 CASE role
                    WHEN 'admin' THEN 0
                    WHEN 'contributor' THEN 1
                    WHEN 'commenter' THEN 2
                    ELSE 3
                 END,
                 lower(display_name), user_id
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(members))
}

async fn add(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<AddMemberRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ProjectMemberResponse>), AppError> {
    let Path((workspace_id, project_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    require_project_admin(&state.pool, auth.user.id, workspace_id, project_id).await?;
    validate_explicit_role(
        workspace_role(&state.pool, request.user_id, workspace_id).await?,
        request.role,
    )?;
    let created = sqlx::query(
        r#"
        INSERT INTO project_memberships
            (workspace_id, project_id, user_id, role)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(request.user_id)
    .bind(request.role.as_str())
    .execute(&state.pool)
    .await;
    match created {
        Ok(_) => Ok((
            StatusCode::CREATED,
            Json(select_member(&state.pool, workspace_id, project_id, request.user_id).await?),
        )),
        Err(error) if is_unique_violation(&error) => Err(AppError::Conflict(
            "This user is already a Project member".to_owned(),
        )),
        Err(error) => Err(error.into()),
    }
}

async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<UpdateMemberRequest>, JsonRejection>,
) -> Result<Json<ProjectMemberResponse>, AppError> {
    let Path((workspace_id, project_id, user_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    require_project_admin(&state.pool, auth.user.id, workspace_id, project_id).await?;
    let workspace_role = workspace_role(&state.pool, user_id, workspace_id).await?;
    validate_explicit_role(workspace_role, request.role)?;

    let mut transaction = state.pool.begin().await?;
    lock_project(&mut transaction, workspace_id, project_id).await?;
    if request.role != ProjectRole::Admin {
        reject_lead_change(&mut transaction, workspace_id, project_id, user_id, false).await?;
    }
    let result = sqlx::query(
        r#"
        UPDATE project_memberships
        SET role = $1, updated_at = now()
        WHERE workspace_id = $2 AND project_id = $3 AND user_id = $4
        "#,
    )
    .bind(request.role.as_str())
    .bind(workspace_id)
    .bind(project_id)
    .bind(user_id)
    .execute(&mut *transaction)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Project member not found".to_owned()));
    }
    transaction.commit().await?;
    Ok(Json(
        select_member(&state.pool, workspace_id, project_id, user_id).await?,
    ))
}

async fn remove(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, project_id, user_id)) = path.map_err(AppError::from)?;
    require_project_admin(&state.pool, auth.user.id, workspace_id, project_id).await?;
    let mut transaction = state.pool.begin().await?;
    lock_project(&mut transaction, workspace_id, project_id).await?;
    reject_lead_change(&mut transaction, workspace_id, project_id, user_id, true).await?;
    sqlx::query(
        r#"
        UPDATE projects SET default_assignee_id = NULL, updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND default_assignee_id = $3
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(user_id)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        r#"
        DELETE FROM task_assignees
        USING tasks
        WHERE task_assignees.workspace_id = $1
          AND task_assignees.user_id = $3
          AND task_assignees.task_id = tasks.id
          AND tasks.workspace_id = $1
          AND tasks.project_id = $2
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(user_id)
    .execute(&mut *transaction)
    .await?;
    let result = sqlx::query(
        "DELETE FROM project_memberships WHERE workspace_id = $1 AND project_id = $2 AND user_id = $3",
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(user_id)
    .execute(&mut *transaction)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Project member not found".to_owned()));
    }
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn join(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, project_id)) = path.map_err(AppError::from)?;
    if workspace_role(&state.pool, auth.user.id, workspace_id).await? != WorkspaceRole::Member {
        return Err(AppError::Forbidden);
    }
    let visibility: Option<String> = sqlx::query_scalar(
        "SELECT visibility FROM projects WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL",
    )
    .bind(workspace_id)
    .bind(project_id)
    .fetch_optional(&state.pool)
    .await?;
    if visibility.as_deref() != Some(ProjectVisibility::Open.as_str()) {
        return Err(AppError::NotFound("Project not found".to_owned()));
    }
    let result = sqlx::query(
        r#"
        INSERT INTO project_memberships
            (workspace_id, project_id, user_id, role)
        VALUES ($1, $2, $3, 'contributor')
        ON CONFLICT (project_id, user_id) DO NOTHING
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(auth.user.id)
    .execute(&state.pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "You already belong to this Project".to_owned(),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

fn validate_explicit_role(
    workspace_role: WorkspaceRole,
    project_role: ProjectRole,
) -> Result<(), AppError> {
    if workspace_role.can_manage() {
        return Err(AppError::Validation(
            "Workspace Owners and Admins already have implicit Project Admin access".to_owned(),
        ));
    }
    if workspace_role == WorkspaceRole::Guest && project_role == ProjectRole::Admin {
        return Err(AppError::Validation(
            "Workspace Guests cannot become Project Admins".to_owned(),
        ));
    }
    Ok(())
}

async fn lock_project(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Uuid,
) -> Result<(), AppError> {
    let found: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM projects WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL FOR UPDATE",
    )
    .bind(workspace_id)
    .bind(project_id)
    .fetch_optional(&mut **transaction)
    .await?;
    found
        .map(|_| ())
        .ok_or_else(|| AppError::NotFound("Project not found".to_owned()))
}

async fn reject_lead_change(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Uuid,
    user_id: Uuid,
    include_modules: bool,
) -> Result<(), AppError> {
    let is_lead: bool = sqlx::query_scalar(
        r#"
        SELECT COALESCE(projects.lead_user_id = $3, false) OR ($4 AND EXISTS(
            SELECT 1 FROM project_modules
            WHERE project_modules.workspace_id = projects.workspace_id
              AND project_modules.project_id = projects.id
              AND project_modules.lead_user_id = $3
              AND project_modules.archived_at IS NULL
        ))
        FROM projects
        WHERE projects.workspace_id = $1 AND projects.id = $2
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(user_id)
    .bind(include_modules)
    .fetch_one(&mut **transaction)
    .await?;
    if is_lead {
        let message = if include_modules {
            "Choose another Project or Module lead before removing this member"
        } else {
            "Choose another Project lead before changing this Admin"
        };
        return Err(AppError::Validation(message.to_owned()));
    }
    Ok(())
}

async fn select_member(
    pool: &sqlx::PgPool,
    workspace_id: Uuid,
    project_id: Uuid,
    user_id: Uuid,
) -> Result<ProjectMemberResponse, AppError> {
    sqlx::query_as::<_, ProjectMemberResponse>(
        r#"
        SELECT users.id AS user_id, users.email, users.display_name,
               project_memberships.role, false AS implicit,
               project_memberships.created_at AS joined_at,
               project_memberships.updated_at
        FROM project_memberships
        JOIN users ON users.id = project_memberships.user_id
        WHERE project_memberships.workspace_id = $1
          AND project_memberships.project_id = $2
          AND project_memberships.user_id = $3
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Project member not found".to_owned()))
}
