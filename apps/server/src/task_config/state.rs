use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;

use super::TaskStateResponse;

pub(super) async fn list(
    pool: &PgPool,
    workspace_id: Uuid,
) -> Result<Vec<TaskStateResponse>, AppError> {
    Ok(sqlx::query_as(
        r#"
        SELECT id, workspace_id, name, color, description, system_role,
               position, archived_at, created_at, updated_at
        FROM task_states
        WHERE workspace_id = $1
        ORDER BY position, id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await?)
}

pub(super) async fn lock_workspace_for_values(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    workspace_id: Uuid,
) -> Result<(), AppError> {
    let found: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE")
            .bind(workspace_id)
            .fetch_optional(&mut **transaction)
            .await?;
    found
        .map(|_| ())
        .ok_or_else(|| AppError::NotFound("Workspace not found".to_owned()))
}
