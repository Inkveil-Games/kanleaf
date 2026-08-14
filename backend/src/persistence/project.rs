use std::time::SystemTime;

use sqlx::{FromRow, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::{
    project::{Project, ProjectId},
    user::UserId,
    workspace::WorkspaceId,
};

#[derive(Debug, FromRow)]
struct ProjectRow {
    id: Uuid,
    workspace_id: Uuid,
    name: String,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

pub async fn list_for_user(
    pool: &PgPool,
    user_id: UserId,
    workspace_id: WorkspaceId,
) -> Result<Vec<Project>, sqlx::Error> {
    let rows = sqlx::query_as::<_, ProjectRow>(
        "SELECT p.id, p.workspace_id, p.name, p.created_at, p.updated_at \
         FROM projects p \
         JOIN workspace_memberships m ON m.workspace_id = p.workspace_id \
         WHERE p.workspace_id = $1 AND m.user_id = $2 \
         ORDER BY p.created_at, p.id",
    )
    .bind(Uuid::from(workspace_id))
    .bind(Uuid::from(user_id))
    .fetch_all(pool)
    .await?;

    rows.into_iter().map(restore).collect()
}

pub async fn create_for_user(
    pool: &PgPool,
    user_id: UserId,
    project: &Project,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "INSERT INTO projects (id, workspace_id, name, created_at, updated_at) \
         SELECT $1, $2, $3, $4, $5 \
         FROM workspace_memberships \
         WHERE workspace_id = $2 AND user_id = $6",
    )
    .bind(Uuid::from(project.id()))
    .bind(Uuid::from(project.workspace_id()))
    .bind(project.name())
    .bind(OffsetDateTime::from(project.created_at()))
    .bind(OffsetDateTime::from(project.updated_at()))
    .bind(Uuid::from(user_id))
    .execute(pool)
    .await?;

    Ok(result.rows_affected() == 1)
}

pub async fn rename_for_user(
    pool: &PgPool,
    user_id: UserId,
    workspace_id: WorkspaceId,
    project_id: ProjectId,
    name: &str,
    updated_at: SystemTime,
) -> Result<Option<Project>, sqlx::Error> {
    let row = sqlx::query_as::<_, ProjectRow>(
        "UPDATE projects p \
         SET name = $4, updated_at = $5 \
         FROM workspace_memberships m \
         WHERE p.id = $1 AND p.workspace_id = $2 \
           AND m.workspace_id = p.workspace_id AND m.user_id = $3 \
         RETURNING p.id, p.workspace_id, p.name, p.created_at, p.updated_at",
    )
    .bind(Uuid::from(project_id))
    .bind(Uuid::from(workspace_id))
    .bind(Uuid::from(user_id))
    .bind(name)
    .bind(OffsetDateTime::from(updated_at))
    .fetch_optional(pool)
    .await?;

    row.map(restore).transpose()
}

fn restore(row: ProjectRow) -> Result<Project, sqlx::Error> {
    Project::restore(
        row.id.into(),
        row.workspace_id.into(),
        row.name,
        row.created_at.into(),
        row.updated_at.into(),
    )
    .map_err(|error| sqlx::Error::Decode(Box::new(error)))
}
