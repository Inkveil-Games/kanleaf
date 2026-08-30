use anyhow::Context;
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    AppState,
    error::AppError,
    task::task_vault_row,
    vault::{LibraryPath, TaskMigrationFile, WikiMigrationFile},
};

#[derive(FromRow)]
struct DocumentMigrationRow {
    segments: Vec<String>,
    project_storage_name: Option<String>,
}

pub async fn migrate_workspace_vaults(state: &AppState) -> anyhow::Result<()> {
    recover_workspace_migrations(state).await?;
    let workspace_ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM workspaces WHERE vault_layout_version = 0 ORDER BY id")
            .fetch_all(&state.pool)
            .await
            .context("failed to list legacy Workspace vaults")?;
    for workspace_id in workspace_ids {
        migrate_workspace(state, workspace_id)
            .await
            .with_context(|| format!("failed to migrate Workspace {workspace_id} vault"))?;
    }
    Ok(())
}

async fn migrate_workspace(state: &AppState, workspace_id: Uuid) -> Result<(), AppError> {
    let mut transaction = state.pool.begin().await?;
    let version: Option<i16> =
        sqlx::query_scalar("SELECT vault_layout_version FROM workspaces WHERE id = $1 FOR UPDATE")
            .bind(workspace_id)
            .fetch_optional(&mut *transaction)
            .await?;
    if version != Some(0) {
        transaction.commit().await?;
        return Ok(());
    }

    let tasks = task_migrations(state, &mut transaction, workspace_id).await?;
    let wiki = wiki_migrations(&mut transaction, workspace_id).await?;
    let staged = state
        .vault
        .stage_workspace_layout_v2(workspace_id, &tasks, &wiki)
        .await
        .map_err(AppError::internal)?;
    let migration = state
        .vault
        .activate_workspace_layout_v2(staged)
        .await
        .map_err(AppError::internal)?;
    let update = sqlx::query(
        "UPDATE workspaces SET vault_layout_version = 2, updated_at = now() WHERE id = $1 AND vault_layout_version = 0",
    )
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await;
    if let Err(error) = update {
        state
            .vault
            .rollback_workspace_layout_v2(&migration)
            .await
            .map_err(AppError::internal)?;
        return Err(error.into());
    }
    if let Err(error) = transaction.commit().await {
        state
            .vault
            .rollback_workspace_layout_v2(&migration)
            .await
            .map_err(AppError::internal)?;
        return Err(error.into());
    }
    state
        .vault
        .finish_workspace_layout_v2(&migration)
        .await
        .map_err(AppError::internal)?;
    Ok(())
}

async fn task_migrations(
    state: &AppState,
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
) -> Result<Vec<TaskMigrationFile>, AppError> {
    let task_ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM tasks WHERE workspace_id = $1 ORDER BY id")
            .bind(workspace_id)
            .fetch_all(&mut **transaction)
            .await?;
    let mut tasks = Vec::with_capacity(task_ids.len());
    for task_id in task_ids {
        let row = task_vault_row(transaction, workspace_id, task_id, true).await?;
        let body = state
            .vault
            .read_legacy_task_body(workspace_id, task_id)
            .await
            .map_err(AppError::internal)?;
        tasks.push(TaskMigrationFile {
            destination: row.path()?,
            content: row.source_with_body(&body),
        });
    }
    Ok(tasks)
}

async fn recover_workspace_migrations(state: &AppState) -> anyhow::Result<()> {
    for operation in state
        .vault
        .pending_workspace_layout_migrations()
        .await
        .context("failed to read pending Workspace vault migrations")?
    {
        let version: Option<i16> =
            sqlx::query_scalar("SELECT vault_layout_version FROM workspaces WHERE id = $1")
                .bind(operation.workspace_id)
                .fetch_optional(&state.pool)
                .await
                .context("failed to inspect a pending Workspace vault migration")?;
        state
            .vault
            .recover_workspace_layout_migration(&operation, version == Some(2))
            .await
            .context("failed to recover an interrupted Workspace vault migration")?;
    }
    Ok(())
}

async fn wiki_migrations(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
) -> Result<Vec<WikiMigrationFile>, AppError> {
    let documents = sqlx::query_as::<_, DocumentMigrationRow>(
        r#"
        WITH RECURSIVE paths AS (
            SELECT id, parent_id, project_id, ARRAY[storage_name]::text[] AS segments
            FROM documents
            WHERE workspace_id = $1 AND parent_id IS NULL
            UNION ALL
            SELECT child.id, child.parent_id, child.project_id,
                   parent.segments || child.storage_name
            FROM documents AS child
            JOIN paths AS parent ON child.parent_id = parent.id
            WHERE child.workspace_id = $1
        )
        SELECT paths.segments, projects.storage_name AS project_storage_name
        FROM paths
        LEFT JOIN projects
          ON projects.workspace_id = $1 AND projects.id = paths.project_id
        ORDER BY paths.segments
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&mut **transaction)
    .await?;
    documents
        .into_iter()
        .map(|document| {
            let segments = document.segments.iter().map(String::as_str);
            let source = LibraryPath::parse(segments.clone()).map_err(AppError::internal)?;
            let destination =
                LibraryPath::parse_scoped(document.project_storage_name.as_deref(), segments)
                    .map_err(AppError::internal)?;
            Ok(WikiMigrationFile {
                source,
                destination,
            })
        })
        .collect()
}
