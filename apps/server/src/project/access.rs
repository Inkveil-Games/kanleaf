use anyhow::anyhow;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{domain::ProjectRole, error::AppError, workspace::WorkspaceRole};

pub(crate) async fn require_project_access(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
    project_id: Uuid,
) -> Result<ProjectRole, AppError> {
    let access: Option<(String, Option<String>)> = sqlx::query_as(
        r#"
        SELECT workspace_memberships.role, project_memberships.role
        FROM projects
        JOIN workspace_memberships
          ON workspace_memberships.workspace_id = projects.workspace_id
         AND workspace_memberships.user_id = $1
        LEFT JOIN project_memberships
          ON project_memberships.workspace_id = projects.workspace_id
         AND project_memberships.project_id = projects.id
         AND project_memberships.user_id = $1
        WHERE projects.workspace_id = $2
          AND projects.id = $3
          AND projects.archived_at IS NULL
        "#,
    )
    .bind(user_id)
    .bind(workspace_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await?;
    let Some((workspace_role, project_role)) = access else {
        return Err(AppError::NotFound("Project not found".to_owned()));
    };
    let workspace_role = WorkspaceRole::from_database(&workspace_role)?;
    if workspace_role.can_manage() {
        return Ok(ProjectRole::Admin);
    }
    let role = project_role.ok_or_else(|| AppError::NotFound("Project not found".to_owned()))?;
    ProjectRole::from_database(&role)
        .ok_or_else(|| AppError::internal(anyhow!("database contains invalid project role")))
}

pub(crate) async fn require_project_editor(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
    project_id: Uuid,
) -> Result<ProjectRole, AppError> {
    let role = require_project_access(pool, user_id, workspace_id, project_id).await?;
    if !role.can_edit() {
        return Err(AppError::Forbidden);
    }
    Ok(role)
}

pub(crate) async fn require_project_commenter(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
    project_id: Uuid,
) -> Result<ProjectRole, AppError> {
    let role = require_project_access(pool, user_id, workspace_id, project_id).await?;
    if role == ProjectRole::Viewer {
        return Err(AppError::Forbidden);
    }
    Ok(role)
}

pub(crate) async fn require_project_admin(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
    project_id: Uuid,
) -> Result<(), AppError> {
    let role = require_project_access(pool, user_id, workspace_id, project_id).await?;
    if !role.can_manage() {
        return Err(AppError::Forbidden);
    }
    Ok(())
}
