use anyhow::Context;
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    AppState,
    error::AppError,
    task::task_vault_row,
    vault::{LibraryPath, ProjectPath, TaskMigrationFile, WikiMigrationFile, WorkspacePath},
};

#[derive(FromRow)]
struct WorkspaceMigrationRow {
    id: Uuid,
    identifier: String,
    vault_layout_version: i16,
}

#[derive(FromRow)]
struct ProjectMigrationRow {
    identifier: String,
}

#[derive(FromRow)]
struct DocumentMigrationRow {
    segments: Vec<String>,
    project_storage_name: Option<String>,
    project_identifier: Option<String>,
}

pub async fn register_workspace_vault_paths(state: &AppState) -> anyhow::Result<()> {
    let workspaces = sqlx::query_as::<_, WorkspaceMigrationRow>(
        "SELECT id, identifier, vault_layout_version FROM workspaces WHERE vault_layout_version = 3 ORDER BY id",
    )
    .fetch_all(&state.pool)
    .await
    .context("failed to list canonical Workspace vault paths")?;
    for workspace in workspaces {
        let path = WorkspacePath::parse(workspace.id, &workspace.identifier)
            .context("database contains an invalid Workspace identifier")?;
        state.vault.register_workspace_path(&path);
    }
    Ok(())
}

pub async fn migrate_workspace_vaults(state: &AppState) -> anyhow::Result<()> {
    recover_workspace_migrations(state).await?;
    let workspaces = sqlx::query_as::<_, WorkspaceMigrationRow>(
        "SELECT id, identifier, vault_layout_version FROM workspaces WHERE vault_layout_version IN (0, 2) ORDER BY id",
    )
    .fetch_all(&state.pool)
    .await
    .context("failed to list legacy Workspace vaults")?;
    for workspace in workspaces {
        let workspace_id = workspace.id;
        migrate_workspace(state, workspace)
            .await
            .with_context(|| format!("failed to migrate Workspace {workspace_id} vault"))?;
    }
    Ok(())
}

async fn migrate_workspace(
    state: &AppState,
    requested: WorkspaceMigrationRow,
) -> Result<(), AppError> {
    let mut transaction = state.pool.begin().await?;
    let workspace = sqlx::query_as::<_, WorkspaceMigrationRow>(
        "SELECT id, identifier, vault_layout_version FROM workspaces WHERE id = $1 FOR UPDATE",
    )
    .bind(requested.id)
    .fetch_optional(&mut *transaction)
    .await?;
    let Some(workspace) = workspace else {
        transaction.commit().await?;
        return Ok(());
    };
    if !matches!(workspace.vault_layout_version, 0 | 2) {
        transaction.commit().await?;
        return Ok(());
    }
    let workspace_path =
        WorkspacePath::parse(workspace.id, &workspace.identifier).map_err(AppError::internal)?;
    let projects = project_migrations(&mut transaction, workspace.id).await?;
    let tasks = task_migrations(
        state,
        &mut transaction,
        workspace.id,
        workspace.vault_layout_version,
    )
    .await?;
    let library = library_migrations(
        &mut transaction,
        workspace.id,
        workspace.vault_layout_version,
    )
    .await?;
    let project_paths = projects
        .iter()
        .map(|project| ProjectPath::parse(&project.identifier).map_err(AppError::internal))
        .collect::<Result<Vec<_>, _>>()?;
    let staged = state
        .vault
        .stage_workspace_layout_v3(
            &workspace_path,
            workspace.vault_layout_version,
            &tasks,
            &library,
            &project_paths,
        )
        .await
        .map_err(AppError::internal)?;
    let migration = state
        .vault
        .activate_workspace_layout_v3(staged)
        .await
        .map_err(AppError::internal)?;
    let update = sqlx::query(
        "UPDATE workspaces SET vault_layout_version = 3, updated_at = now() WHERE id = $1 AND vault_layout_version = $2",
    )
    .bind(workspace.id)
    .bind(workspace.vault_layout_version)
    .execute(&mut *transaction)
    .await;
    if let Err(error) = update {
        state
            .vault
            .rollback_workspace_layout_v3(&migration)
            .await
            .map_err(AppError::internal)?;
        return Err(error.into());
    }
    if let Err(error) = transaction.commit().await {
        // A lost commit response does not prove rollback. Keep the manifest if
        // PostgreSQL cannot establish which tree is authoritative.
        let mut reconciliation = state.pool.begin().await?;
        let version: Option<i16> = sqlx::query_scalar(
            "SELECT vault_layout_version FROM workspaces WHERE id = $1 FOR UPDATE",
        )
        .bind(workspace.id)
        .fetch_optional(&mut *reconciliation)
        .await?;
        reconciliation.commit().await?;
        if version == Some(workspace.vault_layout_version) {
            state
                .vault
                .rollback_workspace_layout_v3(&migration)
                .await
                .map_err(AppError::internal)?;
            return Err(error.into());
        }
        if version != Some(3) {
            return Err(AppError::internal(anyhow::anyhow!(
                "Workspace vault migration commit outcome could not be reconciled"
            )));
        }
    }
    state.vault.register_workspace_path(&workspace_path);
    state
        .vault
        .finish_workspace_layout_v3(&migration)
        .await
        .map_err(AppError::internal)?;
    Ok(())
}

async fn task_migrations(
    state: &AppState,
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    source_layout_version: i16,
) -> Result<Vec<TaskMigrationFile>, AppError> {
    let task_ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM tasks WHERE workspace_id = $1 ORDER BY id")
            .bind(workspace_id)
            .fetch_all(&mut **transaction)
            .await?;
    let mut tasks = Vec::with_capacity(task_ids.len());
    for task_id in task_ids {
        let row = task_vault_row(transaction, workspace_id, task_id, true).await?;
        let content = if source_layout_version == 0 {
            let body = state
                .vault
                .read_legacy_task_body(workspace_id, task_id)
                .await
                .map_err(AppError::internal)?;
            row.source_with_body(&body)
        } else {
            state
                .vault
                .read_layout_v2_task(
                    workspace_id,
                    row.legacy_project_storage_name(),
                    row.legacy_storage_name(),
                )
                .await
                .map_err(AppError::internal)?
        };
        tasks.push(TaskMigrationFile {
            destination: row.path()?,
            content,
        });
    }
    Ok(tasks)
}

async fn project_migrations(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
) -> Result<Vec<ProjectMigrationRow>, AppError> {
    Ok(sqlx::query_as::<_, ProjectMigrationRow>(
        "SELECT identifier FROM projects WHERE workspace_id = $1 ORDER BY id",
    )
    .bind(workspace_id)
    .fetch_all(&mut **transaction)
    .await?)
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
            .recover_workspace_layout_migration(
                &operation,
                version == Some(operation.target_layout_version),
            )
            .await
            .context("failed to recover an interrupted Workspace vault migration")?;
    }
    Ok(())
}

async fn library_migrations(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    source_layout_version: i16,
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
        SELECT paths.segments,
               projects.storage_name AS project_storage_name,
               projects.identifier AS project_identifier
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
            let destination = LibraryPath::parse_scoped(
                document.project_identifier.as_deref(),
                document.segments.iter().map(String::as_str),
            )
            .map_err(AppError::internal)?;
            Ok(WikiMigrationFile {
                source_project_storage_name: (source_layout_version == 2)
                    .then_some(document.project_storage_name)
                    .flatten(),
                source_segments: document.segments,
                destination,
            })
        })
        .collect()
}
