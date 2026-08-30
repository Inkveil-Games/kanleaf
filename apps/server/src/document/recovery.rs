use anyhow::{Context, bail};

use crate::{
    AppState,
    vault::{PendingLibraryOperation, PendingLibraryOperationKind, PendingTaskMove, TaskPath},
};

use super::persistence::library_path;

pub async fn recover_library_operations(state: &AppState) -> anyhow::Result<()> {
    for operation in state
        .vault
        .pending_task_moves()
        .await
        .context("failed to read pending Task moves")?
    {
        recover_task_move(state, &operation).await?;
    }
    for operation in state
        .vault
        .pending_library_operations()
        .await
        .context("failed to read pending Library operations")?
    {
        recover_operation(state, &operation).await?;
    }
    Ok(())
}

async fn recover_task_move(state: &AppState, operation: &PendingTaskMove) -> anyhow::Result<()> {
    let current: Option<(String, Option<String>)> = sqlx::query_as(
        r#"
        SELECT tasks.storage_name, projects.storage_name
        FROM tasks
        LEFT JOIN projects
          ON projects.workspace_id = tasks.workspace_id AND projects.id = tasks.project_id
        WHERE tasks.workspace_id = $1 AND tasks.id = $2
        "#,
    )
    .bind(operation.workspace_id)
    .bind(operation.task_id)
    .fetch_optional(&state.pool)
    .await
    .context("failed to inspect a pending Task move")?;
    let (storage_name, project_storage_name) =
        current.ok_or_else(|| anyhow::anyhow!("pending Task move references a missing Task"))?;
    let current = TaskPath::parse(project_storage_name.as_deref(), &storage_name)
        .context("pending Task move contains an invalid database path")?;
    let keep_destination = if current == operation.destination {
        true
    } else if current == operation.source {
        false
    } else {
        bail!(
            "pending Task move does not match the database path for Task {}",
            operation.task_id
        );
    };
    state
        .vault
        .recover_task_move(operation, keep_destination)
        .await
        .context("failed to recover an interrupted Task move")
}

async fn recover_operation(
    state: &AppState,
    operation: &PendingLibraryOperation,
) -> anyhow::Result<()> {
    let document_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM documents WHERE workspace_id = $1 AND id = $2)",
    )
    .bind(operation.workspace_id)
    .bind(operation.document_id)
    .fetch_one(&state.pool)
    .await
    .context("failed to inspect a pending Library operation")?;

    match &operation.kind {
        PendingLibraryOperationKind::Move {
            source,
            destination,
        } => {
            if !document_exists {
                bail!(
                    "pending Library move references missing document {}",
                    operation.document_id
                );
            }
            let mut transaction = state.pool.begin().await?;
            let current = library_path(
                &mut transaction,
                operation.workspace_id,
                operation.document_id,
            )
            .await
            .context("failed to resolve the database path for a pending Library move")?;
            transaction.commit().await?;
            let keep_destination = if current == *destination {
                true
            } else if current == *source {
                false
            } else {
                bail!(
                    "pending Library move does not match the database path for document {}",
                    operation.document_id
                );
            };
            state
                .vault
                .recover_library_move(operation, keep_destination)
                .await
                .context("failed to recover an interrupted Library move")?;
        }
        PendingLibraryOperationKind::Delete { .. } => {
            state
                .vault
                .recover_library_delete(operation, document_exists)
                .await
                .context("failed to recover an interrupted Library deletion")?;
        }
        PendingLibraryOperationKind::Legacy { .. } => {
            state
                .vault
                .recover_legacy_library_move(operation)
                .await
                .context("failed to recover an interrupted legacy Page migration")?;
        }
    }
    Ok(())
}
