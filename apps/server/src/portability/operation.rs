use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::error::AppError;

const OPERATION_TTL_SECONDS: f64 = 30.0 * 60.0;

#[derive(Clone, Debug, FromRow)]
pub(super) struct OperationRow {
    pub id: Uuid,
    pub workspace_id: Option<Uuid>,
    pub state: String,
    pub revision: Uuid,
    pub result: Value,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub(super) async fn create(
    pool: &PgPool,
    actor_id: Uuid,
    workspace_id: Uuid,
    kind: &str,
    result: &impl Serialize,
) -> Result<OperationRow, AppError> {
    let result = serde_json::to_value(result).map_err(AppError::internal)?;
    Ok(sqlx::query_as(
        r#"
        INSERT INTO workspace_operations (
            id, actor_id, workspace_id, kind, state, revision, result,
            staging_key, expires_at
        )
        VALUES (
            $1, $2, $3, $4, 'ready', $5, $6, $7,
            now() + make_interval(secs => $8)
        )
        RETURNING id, workspace_id, state, revision, result,
                  expires_at, created_at, updated_at
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(actor_id)
    .bind(workspace_id)
    .bind(kind)
    .bind(Uuid::new_v4())
    .bind(result)
    .bind(Uuid::new_v4())
    .bind(OPERATION_TTL_SECONDS)
    .fetch_one(pool)
    .await?)
}

pub(super) async fn load_scoped(
    pool: &PgPool,
    operation_id: Uuid,
    actor_id: Uuid,
    workspace_id: Uuid,
    kind: &str,
) -> Result<OperationRow, AppError> {
    sqlx::query_as(
        r#"
        SELECT id, workspace_id, state, revision, result,
               expires_at, created_at, updated_at
        FROM workspace_operations
        WHERE id = $1 AND actor_id = $2 AND workspace_id = $3 AND kind = $4
          AND expires_at > now()
        "#,
    )
    .bind(operation_id)
    .bind(actor_id)
    .bind(workspace_id)
    .bind(kind)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Workspace operation not found".to_owned()))
}

pub(super) async fn set_state(
    pool: &PgPool,
    operation_id: Uuid,
    actor_id: Uuid,
    expected_state: &str,
    state: &str,
    result: &impl Serialize,
) -> Result<OperationRow, AppError> {
    let result = serde_json::to_value(result).map_err(AppError::internal)?;
    sqlx::query_as(
        r#"
        UPDATE workspace_operations
        SET state = $4, result = $5, revision = $6, updated_at = now()
        WHERE id = $1 AND actor_id = $2 AND state = $3 AND expires_at > now()
        RETURNING id, workspace_id, state, revision, result,
                  expires_at, created_at, updated_at
        "#,
    )
    .bind(operation_id)
    .bind(actor_id)
    .bind(expected_state)
    .bind(state)
    .bind(result)
    .bind(Uuid::new_v4())
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::Conflict("Workspace operation state changed".to_owned()))
}

pub(super) async fn delete_scoped(
    pool: &PgPool,
    operation_id: Uuid,
    actor_id: Uuid,
    workspace_id: Uuid,
    kind: &str,
) -> Result<(), AppError> {
    let deleted = sqlx::query(
        r#"
        DELETE FROM workspace_operations
        WHERE id = $1 AND actor_id = $2 AND workspace_id = $3 AND kind = $4
          AND state <> 'applying'
        "#,
    )
    .bind(operation_id)
    .bind(actor_id)
    .bind(workspace_id)
    .bind(kind)
    .execute(pool)
    .await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound(
            "Workspace operation not found".to_owned(),
        ));
    }
    Ok(())
}

pub async fn recover_workspace_operations(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE workspace_operations
        SET state = 'failed',
            result = jsonb_set(
                result,
                '{error}',
                to_jsonb('Vault sync was interrupted; create a new preview'::text),
                true
            ),
            updated_at = now()
        WHERE kind = 'vault_sync' AND state = 'applying'
        "#,
    )
    .execute(pool)
    .await?;
    sqlx::query("DELETE FROM workspace_operations WHERE expires_at <= now()")
        .execute(pool)
        .await?;
    Ok(())
}
