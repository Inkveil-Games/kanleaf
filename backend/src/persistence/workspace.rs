use std::time::SystemTime;

use sqlx::{FromRow, PgPool, Postgres, Transaction};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::{
    user::UserId,
    workspace::{Workspace, WorkspaceId, WorkspaceRole},
};

#[derive(Debug, FromRow)]
struct WorkspaceRow {
    id: Uuid,
    name: String,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

pub async fn list_for_user(pool: &PgPool, user_id: UserId) -> Result<Vec<Workspace>, sqlx::Error> {
    let rows = sqlx::query_as::<_, WorkspaceRow>(
        "SELECT w.id, w.name, w.created_at, w.updated_at \
         FROM workspaces w \
         JOIN workspace_memberships m ON m.workspace_id = w.id \
         WHERE m.user_id = $1 \
         ORDER BY w.created_at, w.id",
    )
    .bind(Uuid::from(user_id))
    .fetch_all(pool)
    .await?;

    rows.into_iter().map(restore).collect()
}

pub async fn active_workspace_id(
    pool: &PgPool,
    user_id: UserId,
) -> Result<Option<WorkspaceId>, sqlx::Error> {
    sqlx::query_scalar::<_, Uuid>(
        "SELECT workspace_id FROM user_active_workspaces WHERE user_id = $1",
    )
    .bind(Uuid::from(user_id))
    .fetch_optional(pool)
    .await
    .map(|id| id.map(Into::into))
}

pub async fn create_for_user(
    pool: &PgPool,
    user_id: UserId,
    workspace: &Workspace,
) -> Result<(), sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let user_id = Uuid::from(user_id);
    let workspace_id = Uuid::from(workspace.id());

    insert_workspace(&mut transaction, workspace).await?;
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) \
         VALUES ($1, $2, $3)",
    )
    .bind(workspace_id)
    .bind(user_id)
    .bind(WorkspaceRole::Owner.as_str())
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "INSERT INTO user_active_workspaces (user_id, workspace_id) VALUES ($1, $2) \
         ON CONFLICT (user_id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id",
    )
    .bind(user_id)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await
}

pub async fn rename_for_user(
    pool: &PgPool,
    user_id: UserId,
    workspace_id: WorkspaceId,
    name: &str,
    updated_at: SystemTime,
) -> Result<Option<Workspace>, sqlx::Error> {
    let row = sqlx::query_as::<_, WorkspaceRow>(
        "UPDATE workspaces w \
         SET name = $3, updated_at = $4 \
         FROM workspace_memberships m \
         WHERE w.id = $1 AND m.workspace_id = w.id AND m.user_id = $2 \
         RETURNING w.id, w.name, w.created_at, w.updated_at",
    )
    .bind(Uuid::from(workspace_id))
    .bind(Uuid::from(user_id))
    .bind(name)
    .bind(OffsetDateTime::from(updated_at))
    .fetch_optional(pool)
    .await?;

    row.map(restore).transpose()
}

pub async fn activate_for_user(
    pool: &PgPool,
    user_id: UserId,
    workspace_id: WorkspaceId,
) -> Result<Option<Workspace>, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let workspace = find_for_user(&mut transaction, user_id, workspace_id).await?;
    let Some(workspace) = workspace else {
        transaction.rollback().await?;
        return Ok(None);
    };

    sqlx::query(
        "INSERT INTO user_active_workspaces (user_id, workspace_id) VALUES ($1, $2) \
         ON CONFLICT (user_id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id",
    )
    .bind(Uuid::from(user_id))
    .bind(Uuid::from(workspace_id))
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;

    Ok(Some(workspace))
}

pub async fn has_membership(
    pool: &PgPool,
    user_id: UserId,
    workspace_id: WorkspaceId,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS(\
            SELECT 1 FROM workspace_memberships \
            WHERE workspace_id = $1 AND user_id = $2\
        )",
    )
    .bind(Uuid::from(workspace_id))
    .bind(Uuid::from(user_id))
    .fetch_one(pool)
    .await
}

async fn insert_workspace(
    transaction: &mut Transaction<'_, Postgres>,
    workspace: &Workspace,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ($1, $2, $3, $4)",
    )
    .bind(Uuid::from(workspace.id()))
    .bind(workspace.name())
    .bind(OffsetDateTime::from(workspace.created_at()))
    .bind(OffsetDateTime::from(workspace.updated_at()))
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn find_for_user(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: UserId,
    workspace_id: WorkspaceId,
) -> Result<Option<Workspace>, sqlx::Error> {
    let row = sqlx::query_as::<_, WorkspaceRow>(
        "SELECT w.id, w.name, w.created_at, w.updated_at \
         FROM workspaces w \
         JOIN workspace_memberships m ON m.workspace_id = w.id \
         WHERE w.id = $1 AND m.user_id = $2",
    )
    .bind(Uuid::from(workspace_id))
    .bind(Uuid::from(user_id))
    .fetch_optional(&mut **transaction)
    .await?;

    row.map(restore).transpose()
}

fn restore(row: WorkspaceRow) -> Result<Workspace, sqlx::Error> {
    Workspace::restore(
        row.id.into(),
        row.name,
        row.created_at.into(),
        row.updated_at.into(),
    )
    .map_err(|error| sqlx::Error::Decode(Box::new(error)))
}
