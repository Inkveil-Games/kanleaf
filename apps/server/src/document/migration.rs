use std::collections::{HashMap, HashSet};

use anyhow::{Context, bail};
use sqlx::FromRow;
use tracing::info;
use uuid::Uuid;

use crate::{
    AppState,
    domain::LibraryStorageName,
    vault::{LegacyLibraryMove, LibraryPath},
};

#[derive(FromRow)]
struct LegacyDocument {
    id: Uuid,
    parent_id: Option<Uuid>,
    title: String,
    storage_name: String,
    storage_layout_version: i16,
}

pub async fn migrate_legacy_library(state: &AppState) -> anyhow::Result<()> {
    let workspace_ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT workspace_id FROM documents WHERE storage_layout_version = 0 ORDER BY workspace_id",
    )
    .fetch_all(&state.pool)
    .await
    .context("failed to find legacy Page vaults")?;

    let mut migrated = 0_usize;
    for workspace_id in workspace_ids {
        migrated += migrate_workspace(state, workspace_id).await?;
    }
    if migrated > 0 {
        info!(
            document_count = migrated,
            "migrated legacy Pages into the Library vault"
        );
    }
    Ok(())
}

async fn migrate_workspace(state: &AppState, workspace_id: Uuid) -> anyhow::Result<usize> {
    let mut movements = Vec::new();
    let result = apply_workspace_migration(state, workspace_id, &mut movements).await;
    if let Err(error) = result {
        for movement in movements.iter().rev() {
            state
                .vault
                .rollback_legacy_library_move(movement)
                .await
                .with_context(|| {
                    format!(
                        "failed to roll back legacy Library migration for Workspace {workspace_id}; original error: {error:#}"
                    )
                })?;
        }
        return Err(error);
    }

    for movement in &movements {
        state
            .vault
            .finish_legacy_library_move(movement)
            .await
            .context("failed to finish legacy Library migration cleanup")?;
    }
    Ok(movements.len())
}

async fn apply_workspace_migration(
    state: &AppState,
    workspace_id: Uuid,
    movements: &mut Vec<LegacyLibraryMove>,
) -> anyhow::Result<()> {
    let mut transaction = state.pool.begin().await?;
    let workspace: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE")
            .bind(workspace_id)
            .fetch_optional(&mut *transaction)
            .await?;
    if workspace.is_none() {
        bail!("legacy Library migration references missing Workspace {workspace_id}");
    }

    let documents = sqlx::query_as::<_, LegacyDocument>(
        r#"
        WITH RECURSIVE tree AS (
            SELECT id, parent_id, title, storage_name, storage_layout_version,
                   created_at, 1::integer AS depth
            FROM documents
            WHERE workspace_id = $1 AND parent_id IS NULL
            UNION ALL
            SELECT child.id, child.parent_id, child.title, child.storage_name,
                   child.storage_layout_version, child.created_at, parent.depth + 1
            FROM documents AS child
            JOIN tree AS parent ON child.parent_id = parent.id
            WHERE child.workspace_id = $1
        )
        SELECT id, parent_id, title, storage_name, storage_layout_version
        FROM tree
        ORDER BY depth, created_at, id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&mut *transaction)
    .await?;
    let document_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM documents WHERE workspace_id = $1")
            .bind(workspace_id)
            .fetch_one(&mut *transaction)
            .await?;
    if documents.len() as i64 != document_count {
        bail!("Workspace {workspace_id} contains a document tree without a valid root");
    }

    let mut occupied: HashMap<Option<Uuid>, HashSet<String>> = HashMap::new();
    for document in documents
        .iter()
        .filter(|document| document.storage_layout_version == 1)
    {
        LibraryStorageName::parse(&document.storage_name).with_context(|| {
            format!(
                "document {} has an invalid Library storage name",
                document.id
            )
        })?;
        occupied
            .entry(document.parent_id)
            .or_default()
            .insert(document.storage_name.clone());
    }

    let mut paths: HashMap<Uuid, Vec<String>> = HashMap::new();
    for document in documents {
        let storage_name = if document.storage_layout_version == 0 {
            available_name(
                &mut occupied,
                document.parent_id,
                LibraryStorageName::from_title(&document.title),
            )?
        } else {
            LibraryStorageName::parse(&document.storage_name)?
        };
        let mut segments = match document.parent_id {
            Some(parent_id) => paths.get(&parent_id).cloned().with_context(|| {
                format!("document {} has an unresolved Library parent", document.id)
            })?,
            None => Vec::new(),
        };
        segments.push(storage_name.as_str().to_owned());
        let path = LibraryPath::parse(segments.iter().map(String::as_str)).with_context(|| {
            format!(
                "document {} exceeds the supported Library path",
                document.id
            )
        })?;

        if document.storage_layout_version == 0 {
            let movement = state
                .vault
                .migrate_legacy_page(workspace_id, document.id, &path)
                .await
                .with_context(|| format!("failed to migrate legacy Page {}", document.id))?;
            movements.push(movement);
            sqlx::query(
                "UPDATE documents SET storage_name = $3, storage_layout_version = 1 WHERE workspace_id = $1 AND id = $2",
            )
            .bind(workspace_id)
            .bind(document.id)
            .bind(storage_name.as_str())
            .execute(&mut *transaction)
            .await?;
        }
        occupied
            .entry(document.parent_id)
            .or_default()
            .insert(storage_name.as_str().to_owned());
        paths.insert(document.id, segments);
    }
    transaction.commit().await?;
    Ok(())
}

fn available_name(
    occupied: &mut HashMap<Option<Uuid>, HashSet<String>>,
    parent_id: Option<Uuid>,
    base: LibraryStorageName,
) -> anyhow::Result<LibraryStorageName> {
    let siblings = occupied.entry(parent_id).or_default();
    for sequence in 1..=10_000 {
        let candidate = base.candidate(sequence);
        if !siblings.contains(candidate.as_str()) {
            return Ok(candidate);
        }
    }
    bail!("no portable Library filename is available for a legacy Page")
}
