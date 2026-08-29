use anyhow::{Context, bail};

use crate::{
    AppState,
    vault::{PendingLibraryOperation, PendingLibraryOperationKind},
};

use super::persistence::library_path;

pub async fn recover_library_operations(state: &AppState) -> anyhow::Result<()> {
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
