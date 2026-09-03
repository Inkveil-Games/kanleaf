use std::time::Duration;

use serde::Serialize;
use sqlx::{FromRow, Postgres, Transaction};
use thiserror::Error;
use tracing::warn;
use uuid::Uuid;

use crate::{AppState, vault::VaultError};

use super::{frontmatter, task_vault_row};

const PROJECTION_BATCH_SIZE: i64 = 50;
const RETRY_DELAY_SECONDS: f64 = 30.0;

#[derive(Clone, Debug, Serialize)]
pub(crate) struct ProjectionHealth {
    status: &'static str,
    metadata_version: i64,
    projected_metadata_version: i64,
    message: Option<&'static str>,
}

#[derive(FromRow)]
struct ProjectionState {
    metadata_version: i64,
    projected_metadata_version: i64,
    projection_error: Option<String>,
}

#[derive(Debug, Error)]
enum ProjectionFailure {
    #[error("Task properties conflict with the canonical identity")]
    Properties,
    #[error("Task Markdown storage is temporarily unavailable")]
    Storage,
    #[error("Task projection database operation failed")]
    Database(#[from] sqlx::Error),
    #[error("Task projection application query failed")]
    Application(#[source] crate::error::AppError),
}

impl ProjectionFailure {
    const fn code(&self) -> &'static str {
        match self {
            Self::Properties => "properties_conflict",
            Self::Storage => "storage_unavailable",
            Self::Database(_) | Self::Application(_) => "database_unavailable",
        }
    }
}

pub(crate) async fn initialize(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO task_projection_jobs (workspace_id, task_id, metadata_version)
        SELECT workspace_id, id, metadata_version
        FROM tasks WHERE workspace_id = $1 AND id = $2
        ON CONFLICT (workspace_id, task_id) DO UPDATE
        SET metadata_version = EXCLUDED.metadata_version,
            attempts = 0, next_attempt_at = now(), last_error = NULL,
            updated_at = now()
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

pub(crate) async fn enqueue(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_ids: &[Uuid],
) -> Result<(), sqlx::Error> {
    if task_ids.is_empty() {
        return Ok(());
    }
    sqlx::query(
        r#"
        WITH changed AS (
            UPDATE tasks
            SET metadata_version = metadata_version + 1
            WHERE workspace_id = $1 AND id = ANY($2)
            RETURNING workspace_id, id, metadata_version
        )
        INSERT INTO task_projection_jobs (workspace_id, task_id, metadata_version)
        SELECT workspace_id, id, metadata_version FROM changed
        ON CONFLICT (workspace_id, task_id) DO UPDATE
        SET metadata_version = EXCLUDED.metadata_version,
            attempts = 0, next_attempt_at = now(), last_error = NULL,
            updated_at = now()
        "#,
    )
    .bind(workspace_id)
    .bind(task_ids)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

pub(crate) async fn project_now(
    state: &AppState,
    workspace_id: Uuid,
    task_id: Uuid,
) -> ProjectionHealth {
    if let Err(error) = apply(state, workspace_id, task_id).await
        && let Err(record_error) = record_failure(state, workspace_id, task_id, &error).await
    {
        warn!(%workspace_id, %task_id, %record_error, "failed to record Task projection failure");
    }
    health(state, workspace_id, task_id)
        .await
        .unwrap_or(ProjectionHealth {
            status: "pending",
            metadata_version: 0,
            projected_metadata_version: 0,
            message: Some("Task properties are waiting to be saved"),
        })
}

pub(crate) async fn project_many(state: &AppState, workspace_id: Uuid, task_ids: &[Uuid]) {
    for task_id in task_ids {
        project_now(state, workspace_id, *task_id).await;
    }
}

async fn apply(
    state: &AppState,
    workspace_id: Uuid,
    task_id: Uuid,
) -> Result<(), ProjectionFailure> {
    let mut transaction = state.pool.begin().await?;
    let projection: Option<(i64, Vec<String>)> = sqlx::query_as(
        r#"
        SELECT tasks.metadata_version, jobs.cleanup_property_names
        FROM tasks
        JOIN task_projection_jobs AS jobs
          ON jobs.workspace_id = tasks.workspace_id AND jobs.task_id = tasks.id
        WHERE tasks.workspace_id = $1 AND tasks.id = $2
        FOR UPDATE OF tasks, jobs
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .fetch_optional(&mut *transaction)
    .await?;
    let Some((metadata_version, mut cleanup_property_names)) = projection else {
        transaction.commit().await?;
        return Ok(());
    };
    let defined_property_names: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM custom_property_definitions WHERE workspace_id = $1 ORDER BY id",
    )
    .bind(workspace_id)
    .fetch_all(&mut *transaction)
    .await?;
    cleanup_property_names.extend(defined_property_names);
    let row = task_vault_row(&mut transaction, workspace_id, task_id, true)
        .await
        .map_err(ProjectionFailure::Application)?;
    let path = row.path().map_err(|_| ProjectionFailure::Storage)?;
    let current = state
        .vault
        .read_task_document(workspace_id, &path)
        .await
        .map_err(|_| ProjectionFailure::Storage)?;
    let patched = frontmatter::patch_with_cleanup(
        &current.content,
        &row.properties(),
        &cleanup_property_names,
    )
    .map_err(|_| ProjectionFailure::Properties)?;
    if patched != current.content {
        state
            .vault
            .write_task_document(workspace_id, &path, &patched, &current.revision)
            .await
            .map_err(map_storage_error)?;
    }
    sqlx::query(
        r#"
        UPDATE tasks
        SET projected_metadata_version = $3, projection_error = NULL,
            projection_attempted_at = now()
        WHERE workspace_id = $1 AND id = $2 AND metadata_version = $3
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(metadata_version)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "DELETE FROM task_projection_jobs WHERE workspace_id = $1 AND task_id = $2 AND metadata_version <= $3",
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(metadata_version)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(())
}

fn map_storage_error(_: VaultError) -> ProjectionFailure {
    ProjectionFailure::Storage
}

async fn record_failure(
    state: &AppState,
    workspace_id: Uuid,
    task_id: Uuid,
    error: &ProjectionFailure,
) -> Result<(), sqlx::Error> {
    let code = error.code();
    let mut transaction = state.pool.begin().await?;
    sqlx::query(
        r#"
        UPDATE tasks
        SET projection_error = $3, projection_attempted_at = now()
        WHERE workspace_id = $1 AND id = $2
          AND EXISTS (
              SELECT 1 FROM task_projection_jobs AS jobs
              WHERE jobs.workspace_id = $1 AND jobs.task_id = $2
          )
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(code)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        r#"
        UPDATE task_projection_jobs
        SET attempts = attempts + 1,
            next_attempt_at = now() + make_interval(secs => $3),
            last_error = $4, updated_at = now()
        WHERE workspace_id = $1 AND task_id = $2
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(RETRY_DELAY_SECONDS)
    .bind(code)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(())
}

pub(crate) async fn health(
    state: &AppState,
    workspace_id: Uuid,
    task_id: Uuid,
) -> Result<ProjectionHealth, sqlx::Error> {
    let current = sqlx::query_as::<_, ProjectionState>(
        r#"
        SELECT metadata_version, projected_metadata_version, projection_error
        FROM tasks WHERE workspace_id = $1 AND id = $2
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .fetch_one(&state.pool)
    .await?;
    let (status, message) = if current.projection_error.is_some() {
        (
            "error",
            Some("Task properties could not be saved; the Markdown body is unchanged"),
        )
    } else if current.projected_metadata_version < current.metadata_version {
        ("pending", Some("Task properties are waiting to be saved"))
    } else {
        ("saved", None)
    };
    Ok(ProjectionHealth {
        status,
        metadata_version: current.metadata_version,
        projected_metadata_version: current.projected_metadata_version,
        message,
    })
}

pub async fn recover_projection_jobs(state: &AppState) -> Result<(), sqlx::Error> {
    let task_ids: Vec<(Uuid, Uuid)> = sqlx::query_as(
        r#"
        SELECT workspace_id, task_id FROM task_projection_jobs
        ORDER BY next_attempt_at, updated_at
        "#,
    )
    .fetch_all(&state.pool)
    .await?;
    for (workspace_id, task_id) in task_ids {
        project_now(state, workspace_id, task_id).await;
    }
    Ok(())
}

async fn drain_due(state: &AppState) -> Result<(), sqlx::Error> {
    let task_ids: Vec<(Uuid, Uuid)> = sqlx::query_as(
        r#"
        SELECT workspace_id, task_id FROM task_projection_jobs
        WHERE next_attempt_at <= now()
        ORDER BY next_attempt_at, updated_at
        LIMIT $1
        "#,
    )
    .bind(PROJECTION_BATCH_SIZE)
    .fetch_all(&state.pool)
    .await?;
    for (workspace_id, task_id) in task_ids {
        project_now(state, workspace_id, task_id).await;
    }
    Ok(())
}

pub fn spawn_projection_worker(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(15));
        interval.tick().await;
        loop {
            interval.tick().await;
            if let Err(error) = drain_due(&state).await {
                warn!(%error, "Task projection worker could not load pending jobs");
            }
        }
    });
}
