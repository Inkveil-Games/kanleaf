use std::collections::HashSet;

use chrono::{DateTime, Utc};
use sqlx::{FromRow, Postgres, Transaction};
use tracing::warn;
use uuid::Uuid;

use crate::{
    AppState,
    domain::LibraryStorageName,
    error::AppError,
    project::{require_project_access, require_project_editor},
    vault::{LibraryPath, VaultError},
    workspace::workspace_role,
};

use super::DocumentResponse;

#[derive(FromRow)]
pub(super) struct LockedDocument {
    pub(super) project_id: Option<Uuid>,
    pub(super) parent_id: Option<Uuid>,
    pub(super) storage_name: String,
    pub(super) position: i64,
    pub(super) archived_at: Option<DateTime<Utc>>,
}

pub(super) async fn find_authorized_document(
    state: &AppState,
    user_id: Uuid,
    workspace_id: Uuid,
    document_id: Uuid,
) -> Result<DocumentResponse, AppError> {
    sqlx::query_as::<_, DocumentResponse>(
        r#"
        WITH RECURSIVE ancestors AS (
            SELECT id, parent_id, storage_name, ARRAY[storage_name]::text[] AS segments
            FROM documents
            WHERE workspace_id = $2 AND id = $3
            UNION ALL
            SELECT parent.id, parent.parent_id, parent.storage_name,
                   ARRAY[parent.storage_name]::text[] || child.segments
            FROM documents AS parent
            JOIN ancestors AS child ON child.parent_id = parent.id
            WHERE parent.workspace_id = $2
        ), resolved_path AS (
            SELECT array_to_string(segments, '/') AS relative_path
            FROM ancestors WHERE parent_id IS NULL
        )
        SELECT documents.id, documents.workspace_id, documents.project_id,
               documents.parent_id, documents.title, documents.storage_name,
               'Library/' || resolved_path.relative_path || '.md' AS library_path,
               documents.position,
               CASE
                   WHEN documents.project_id IS NULL THEN workspace_memberships.role <> 'guest'
                   WHEN workspace_memberships.role IN ('owner', 'admin') THEN true
                   ELSE project_memberships.role IN ('admin', 'contributor')
               END AS can_edit,
               documents.archived_at, documents.created_at, documents.updated_at
        FROM documents
        JOIN workspace_memberships
          ON workspace_memberships.workspace_id = documents.workspace_id
         AND workspace_memberships.user_id = $1
        LEFT JOIN projects
          ON projects.workspace_id = documents.workspace_id
         AND projects.id = documents.project_id
        LEFT JOIN project_memberships
          ON project_memberships.workspace_id = documents.workspace_id
         AND project_memberships.project_id = documents.project_id
         AND project_memberships.user_id = $1
        CROSS JOIN resolved_path
        WHERE documents.workspace_id = $2
          AND documents.id = $3
          AND documents.archived_at IS NULL
          AND (
              (documents.project_id IS NULL AND workspace_memberships.role <> 'guest')
              OR (
                  documents.project_id IS NOT NULL
                  AND projects.archived_at IS NULL
                  AND (
                      workspace_memberships.role IN ('owner', 'admin')
                      OR project_memberships.user_id IS NOT NULL
                  )
              )
          )
        "#,
    )
    .bind(user_id)
    .bind(workspace_id)
    .bind(document_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Document not found".to_owned()))
}

pub(super) async fn authorize_scope(
    state: &AppState,
    user_id: Uuid,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    edit: bool,
) -> Result<(), AppError> {
    if let Some(project_id) = project_id {
        if edit {
            require_project_editor(&state.pool, user_id, workspace_id, project_id).await?;
        } else {
            require_project_access(&state.pool, user_id, workspace_id, project_id).await?;
        }
        return Ok(());
    }
    let role = workspace_role(&state.pool, user_id, workspace_id).await?;
    if !role.can_access_content() {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

pub(super) async fn lock_workspace_documents(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
) -> Result<(), AppError> {
    let exists: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE")
            .bind(workspace_id)
            .fetch_optional(&mut **transaction)
            .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("Workspace not found".to_owned()));
    }
    Ok(())
}

pub(super) async fn lock_document(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    document_id: Uuid,
    include_archived: bool,
) -> Result<LockedDocument, AppError> {
    sqlx::query_as::<_, LockedDocument>(
        r#"
        SELECT project_id, parent_id, storage_name, position, archived_at
        FROM documents
        WHERE workspace_id = $1 AND id = $2
          AND ($3 OR archived_at IS NULL)
        FOR UPDATE
        "#,
    )
    .bind(workspace_id)
    .bind(document_id)
    .bind(include_archived)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Document not found".to_owned()))
}

pub(super) async fn library_path(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    document_id: Uuid,
) -> Result<LibraryPath, AppError> {
    let segments: Vec<String> = sqlx::query_scalar(
        r#"
        WITH RECURSIVE ancestors AS (
            SELECT id, parent_id, storage_name, ARRAY[storage_name]::text[] AS segments
            FROM documents
            WHERE workspace_id = $1 AND id = $2
            UNION ALL
            SELECT parent.id, parent.parent_id, parent.storage_name,
                   ARRAY[parent.storage_name]::text[] || child.segments
            FROM documents AS parent
            JOIN ancestors AS child ON child.parent_id = parent.id
            WHERE parent.workspace_id = $1
        )
        SELECT segments FROM ancestors WHERE parent_id IS NULL
        "#,
    )
    .bind(workspace_id)
    .bind(document_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Document not found".to_owned()))?;
    LibraryPath::parse(segments.iter().map(String::as_str)).map_err(|_| {
        AppError::Validation("The Library path exceeds the supported depth or length".to_owned())
    })
}

pub(super) async fn available_storage_name(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    parent_id: Option<Uuid>,
    title: &str,
) -> Result<LibraryStorageName, AppError> {
    let base = LibraryStorageName::from_title(title);
    for sequence in 1..=10_000 {
        let candidate = base.candidate(sequence);
        let occupied: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM documents
                WHERE workspace_id = $1
                  AND parent_id IS NOT DISTINCT FROM $2
                  AND storage_name = $3
            )
            "#,
        )
        .bind(workspace_id)
        .bind(parent_id)
        .bind(candidate.as_str())
        .fetch_one(&mut **transaction)
        .await?;
        if !occupied {
            return Ok(candidate);
        }
    }
    Err(AppError::Conflict(
        "No portable Library filename is available for this title".to_owned(),
    ))
}

pub(super) async fn ensure_storage_name_available(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    document_id: Uuid,
    parent_id: Option<Uuid>,
    storage_name: &str,
) -> Result<(), AppError> {
    let occupied: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM documents
            WHERE workspace_id = $1
              AND parent_id IS NOT DISTINCT FROM $2
              AND storage_name = $3
              AND id <> $4
        )
        "#,
    )
    .bind(workspace_id)
    .bind(parent_id)
    .bind(storage_name)
    .bind(document_id)
    .fetch_one(&mut **transaction)
    .await?;
    if occupied {
        return Err(AppError::Conflict(format!(
            "A Library note named {storage_name}.md already exists at that location"
        )));
    }
    Ok(())
}

pub(super) async fn validate_parent(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    parent_id: Option<Uuid>,
    project_id: Option<Uuid>,
    moving_document_id: Option<Uuid>,
) -> Result<(), AppError> {
    let Some(parent_id) = parent_id else {
        return Ok(());
    };
    let parent_project_id: Option<Option<Uuid>> = sqlx::query_scalar(
        "SELECT project_id FROM documents WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL",
    )
    .bind(workspace_id)
    .bind(parent_id)
    .fetch_optional(&mut **transaction)
    .await?;
    let Some(parent_project_id) = parent_project_id else {
        return Err(AppError::Validation(
            "Document parent must be an active document in this Workspace".to_owned(),
        ));
    };
    if parent_project_id != project_id {
        return Err(AppError::Validation(
            "Document parent must use the same Workspace or Project scope".to_owned(),
        ));
    }
    if let Some(document_id) = moving_document_id {
        let creates_cycle: bool = sqlx::query_scalar(
            r#"
            WITH RECURSIVE subtree AS (
                SELECT id FROM documents WHERE workspace_id = $1 AND id = $2
                UNION ALL
                SELECT child.id FROM documents AS child
                JOIN subtree ON child.parent_id = subtree.id
                WHERE child.workspace_id = $1
            )
            SELECT EXISTS(SELECT 1 FROM subtree WHERE id = $3)
            "#,
        )
        .bind(workspace_id)
        .bind(document_id)
        .bind(parent_id)
        .fetch_one(&mut **transaction)
        .await?;
        if creates_cycle {
            return Err(AppError::Validation(
                "A document cannot be moved inside its own subtree".to_owned(),
            ));
        }
    }
    Ok(())
}

pub(super) async fn next_position(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    parent_id: Option<Uuid>,
) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar(
        r#"
        SELECT COALESCE(max(position) + 1, 0)
        FROM documents
        WHERE workspace_id = $1
          AND project_id IS NOT DISTINCT FROM $2
          AND parent_id IS NOT DISTINCT FROM $3
          AND archived_at IS NULL
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(parent_id)
    .fetch_one(&mut **transaction)
    .await?)
}

pub(super) fn unique_ids(ids: &[Uuid]) -> Result<Vec<Uuid>, AppError> {
    let mut seen = HashSet::with_capacity(ids.len());
    if ids.iter().any(|id| !seen.insert(*id)) {
        return Err(AppError::Validation(
            "Document reorder cannot contain duplicates".to_owned(),
        ));
    }
    Ok(ids.to_vec())
}

pub(super) fn map_vault_create_error(error: VaultError) -> AppError {
    match error {
        VaultError::ExistingDocument => {
            AppError::Conflict("A Markdown file already exists for this document".to_owned())
        }
        error => AppError::internal(error),
    }
}

pub(super) async fn cleanup_unattached_page(
    state: &AppState,
    workspace_id: Uuid,
    path: &LibraryPath,
) {
    let _ = state
        .vault
        .remove_unattached_library_file(workspace_id, path)
        .await;
}

pub(super) async fn restore_library_trash(state: &AppState, trash: &crate::vault::LibraryTrash) {
    if let Err(error) = state.vault.restore_library_trash(trash).await {
        warn!(%error, "failed to restore Library subtree after transaction rollback");
    }
}

#[cfg(test)]
mod tests {
    use super::unique_ids;
    use uuid::Uuid;

    #[test]
    fn rejects_duplicate_reorder_ids() {
        let id = Uuid::new_v4();
        assert!(unique_ids(&[id, id]).is_err());
    }
}
