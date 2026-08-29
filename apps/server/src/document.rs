use std::collections::HashSet;

mod content;
mod migration;
mod persistence;
mod recovery;

pub use migration::migrate_legacy_library;
pub use recovery::recover_library_operations;

use axum::{
    Json, Router,
    extract::{
        Path, Query, State, rejection::JsonRejection, rejection::PathRejection,
        rejection::QueryRejection,
    },
    http::StatusCode,
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use sqlx::FromRow;
use tracing::warn;
use uuid::Uuid;

use crate::{
    AppState, auth::AuthenticatedUser, domain::DocumentTitle, error::AppError,
    project::require_project_access, workspace::workspace_role,
};

use persistence::{
    authorize_scope, available_storage_name, cleanup_unattached_page,
    ensure_storage_name_available, find_authorized_document, library_path, lock_document,
    lock_workspace_documents, map_vault_create_error, next_position, restore_library_trash,
    unique_ids, validate_parent,
};

#[derive(Debug, Serialize, FromRow)]
pub struct DocumentResponse {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub project_id: Option<Uuid>,
    pub parent_id: Option<Uuid>,
    pub title: String,
    pub storage_name: String,
    pub library_path: String,
    pub position: i64,
    pub can_edit: bool,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Deserialize, Default)]
struct ListDocumentsQuery {
    project_id: Option<Uuid>,
    #[serde(default)]
    archived: bool,
}

#[derive(Deserialize)]
struct CreateDocumentRequest {
    title: String,
    #[serde(default)]
    project_id: Option<Uuid>,
    #[serde(default)]
    parent_id: Option<Uuid>,
}

#[derive(Deserialize)]
struct UpdateDocumentRequest {
    #[serde(default)]
    title: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_uuid")]
    project_id: Option<Option<Uuid>>,
    #[serde(default, deserialize_with = "deserialize_nullable_uuid")]
    parent_id: Option<Option<Uuid>>,
    #[serde(default)]
    position: Option<i64>,
}

#[derive(Deserialize)]
struct ReorderDocumentsRequest {
    #[serde(default)]
    project_id: Option<Uuid>,
    #[serde(default)]
    parent_id: Option<Uuid>,
    document_ids: Vec<Uuid>,
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/workspaces/{workspace_id}/documents",
            get(list).post(create),
        )
        .route(
            "/api/workspaces/{workspace_id}/documents/reorder",
            axum::routing::put(reorder),
        )
        .route(
            "/api/workspaces/{workspace_id}/documents/{document_id}",
            get(detail).patch(update).delete(archive),
        )
        .route(
            "/api/workspaces/{workspace_id}/documents/{document_id}/delete",
            post(delete_permanently),
        )
        .route(
            "/api/workspaces/{workspace_id}/documents/{document_id}/content",
            get(content::read).put(content::write),
        )
}

async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    query: Result<Query<ListDocumentsQuery>, QueryRejection>,
) -> Result<Json<Vec<DocumentResponse>>, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Query(query) = query.map_err(AppError::from)?;
    workspace_role(&state.pool, auth.user.id, workspace_id).await?;
    if let Some(project_id) = query.project_id {
        require_project_access(&state.pool, auth.user.id, workspace_id, project_id).await?;
    }

    let documents = sqlx::query_as::<_, DocumentResponse>(
        r#"
        WITH RECURSIVE document_paths AS (
            SELECT id, workspace_id, storage_name::text AS relative_path
            FROM documents
            WHERE workspace_id = $2 AND parent_id IS NULL
            UNION ALL
            SELECT child.id, child.workspace_id,
                   parent.relative_path || '/' || child.storage_name
            FROM documents AS child
            JOIN document_paths AS parent ON child.parent_id = parent.id
            WHERE child.workspace_id = $2
        )
        SELECT documents.id, documents.workspace_id, documents.project_id,
               documents.parent_id, documents.title, documents.storage_name,
               'Library/' || document_paths.relative_path || '.md' AS library_path,
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
        JOIN document_paths ON document_paths.id = documents.id
        LEFT JOIN projects
          ON projects.workspace_id = documents.workspace_id
         AND projects.id = documents.project_id
        LEFT JOIN project_memberships
          ON project_memberships.workspace_id = documents.workspace_id
         AND project_memberships.project_id = documents.project_id
         AND project_memberships.user_id = $1
        WHERE documents.workspace_id = $2
          AND ($3::uuid IS NULL OR documents.project_id = $3)
          AND (($4 AND documents.archived_at IS NOT NULL)
               OR (NOT $4 AND documents.archived_at IS NULL))
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
        ORDER BY documents.project_id NULLS FIRST, documents.parent_id NULLS FIRST,
                 documents.position, documents.id
        "#,
    )
    .bind(auth.user.id)
    .bind(workspace_id)
    .bind(query.project_id)
    .bind(query.archived)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(documents))
}

async fn detail(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<DocumentResponse>, AppError> {
    let Path((workspace_id, document_id)) = path.map_err(AppError::from)?;
    let document =
        find_authorized_document(&state, auth.user.id, workspace_id, document_id).await?;
    Ok(Json(document))
}

async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<CreateDocumentRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<DocumentResponse>), AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let title = DocumentTitle::new(&request.title)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    authorize_scope(&state, auth.user.id, workspace_id, request.project_id, true).await?;

    let mut transaction = state.pool.begin().await?;
    lock_workspace_documents(&mut transaction, workspace_id).await?;
    validate_parent(
        &mut transaction,
        workspace_id,
        request.parent_id,
        request.project_id,
        None,
    )
    .await?;
    let position = next_position(
        &mut transaction,
        workspace_id,
        request.project_id,
        request.parent_id,
    )
    .await?;
    let storage_name = available_storage_name(
        &mut transaction,
        workspace_id,
        request.parent_id,
        title.as_str(),
    )
    .await?;
    let document_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO documents (
            id, workspace_id, project_id, parent_id, title, storage_name,
            storage_layout_version, position
        )
        VALUES ($1, $2, $3, $4, $5, $6, 1, $7)
        "#,
    )
    .bind(document_id)
    .bind(workspace_id)
    .bind(request.project_id)
    .bind(request.parent_id)
    .bind(title.as_str())
    .bind(storage_name.as_str())
    .bind(position)
    .execute(&mut *transaction)
    .await?;

    let path = library_path(&mut transaction, workspace_id, document_id).await?;

    state
        .vault
        .create_page_document(workspace_id, &path)
        .await
        .map_err(map_vault_create_error)?;
    if let Err(error) = transaction.commit().await {
        cleanup_unattached_page(&state, workspace_id, &path).await;
        return Err(error.into());
    }
    Ok((
        StatusCode::CREATED,
        Json(find_authorized_document(&state, auth.user.id, workspace_id, document_id).await?),
    ))
}

async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<UpdateDocumentRequest>, JsonRejection>,
) -> Result<Json<DocumentResponse>, AppError> {
    let Path((workspace_id, document_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    if request.title.is_none()
        && request.project_id.is_none()
        && request.parent_id.is_none()
        && request.position.is_none()
    {
        return Err(AppError::Validation(
            "Provide at least one document change".to_owned(),
        ));
    }
    let title = request
        .title
        .as_deref()
        .map(DocumentTitle::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    if request.position.is_some_and(|position| position < 0) {
        return Err(AppError::Validation(
            "Document position cannot be negative".to_owned(),
        ));
    }

    let mut transaction = state.pool.begin().await?;
    lock_workspace_documents(&mut transaction, workspace_id).await?;
    let current = lock_document(&mut transaction, workspace_id, document_id, false).await?;
    let source_path = library_path(&mut transaction, workspace_id, document_id).await?;
    authorize_scope(&state, auth.user.id, workspace_id, current.project_id, true).await?;
    let project_id = request.project_id.unwrap_or(current.project_id);
    if project_id != current.project_id {
        authorize_scope(&state, auth.user.id, workspace_id, project_id, true).await?;
    }
    let parent_id = request.parent_id.unwrap_or(current.parent_id);
    validate_parent(
        &mut transaction,
        workspace_id,
        parent_id,
        project_id,
        Some(document_id),
    )
    .await?;
    if parent_id != current.parent_id {
        ensure_storage_name_available(
            &mut transaction,
            workspace_id,
            document_id,
            parent_id,
            &current.storage_name,
        )
        .await?;
    }
    let moved = project_id != current.project_id || parent_id != current.parent_id;
    let position = match request.position {
        Some(position) => position,
        None if moved => {
            next_position(&mut transaction, workspace_id, project_id, parent_id).await?
        }
        None => current.position,
    };

    if project_id != current.project_id {
        sqlx::query(
            r#"
            WITH RECURSIVE subtree AS (
                SELECT id FROM documents WHERE workspace_id = $1 AND id = $2
                UNION ALL
                SELECT child.id
                FROM documents AS child
                JOIN subtree ON child.parent_id = subtree.id
                WHERE child.workspace_id = $1
            )
            UPDATE documents
            SET project_id = $3, updated_at = now()
            WHERE workspace_id = $1 AND id IN (SELECT id FROM subtree)
            "#,
        )
        .bind(workspace_id)
        .bind(document_id)
        .bind(project_id)
        .execute(&mut *transaction)
        .await?;
    }

    sqlx::query(
        r#"
        UPDATE documents
        SET title = COALESCE($3, title), parent_id = $4, position = $5, updated_at = now()
        WHERE workspace_id = $1 AND id = $2
        "#,
    )
    .bind(workspace_id)
    .bind(document_id)
    .bind(title.as_ref().map(DocumentTitle::as_str))
    .bind(parent_id)
    .bind(position)
    .execute(&mut *transaction)
    .await?;

    let destination_path = library_path(&mut transaction, workspace_id, document_id).await?;
    let movement = state
        .vault
        .move_library_tree(workspace_id, document_id, &source_path, &destination_path)
        .await
        .map_err(map_vault_create_error)?;
    if let Err(error) = transaction.commit().await {
        if let Some(movement) = &movement
            && let Err(rollback_error) = state.vault.rollback_library_move(movement).await
        {
            warn!(document_id = %document_id, %rollback_error, "failed to roll back Library move");
        }
        return Err(error.into());
    }
    if let Some(movement) = &movement
        && let Err(error) = state.vault.finish_library_move(movement).await
    {
        warn!(document_id = %document_id, %error, "failed to finish Library move cleanup");
    }

    Ok(Json(
        find_authorized_document(&state, auth.user.id, workspace_id, document_id).await?,
    ))
}

async fn reorder(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<ReorderDocumentsRequest>, JsonRejection>,
) -> Result<StatusCode, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    authorize_scope(&state, auth.user.id, workspace_id, request.project_id, true).await?;
    let requested = unique_ids(&request.document_ids)?;

    let mut transaction = state.pool.begin().await?;
    lock_workspace_documents(&mut transaction, workspace_id).await?;
    validate_parent(
        &mut transaction,
        workspace_id,
        request.parent_id,
        request.project_id,
        None,
    )
    .await?;
    let siblings: Vec<Uuid> = sqlx::query_scalar(
        r#"
        SELECT id FROM documents
        WHERE workspace_id = $1
          AND project_id IS NOT DISTINCT FROM $2
          AND parent_id IS NOT DISTINCT FROM $3
          AND archived_at IS NULL
        ORDER BY position, id
        FOR UPDATE
        "#,
    )
    .bind(workspace_id)
    .bind(request.project_id)
    .bind(request.parent_id)
    .fetch_all(&mut *transaction)
    .await?;
    if requested.len() != siblings.len()
        || requested.iter().copied().collect::<HashSet<_>>()
            != siblings.iter().copied().collect::<HashSet<_>>()
    {
        return Err(AppError::Validation(
            "Document reorder must include every active sibling exactly once".to_owned(),
        ));
    }
    for (position, document_id) in requested.into_iter().enumerate() {
        sqlx::query(
            "UPDATE documents SET position = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2",
        )
        .bind(workspace_id)
        .bind(document_id)
        .bind(position as i64)
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn archive(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, document_id)) = path.map_err(AppError::from)?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace_documents(&mut transaction, workspace_id).await?;
    let current = lock_document(&mut transaction, workspace_id, document_id, false).await?;
    authorize_scope(&state, auth.user.id, workspace_id, current.project_id, true).await?;
    sqlx::query(
        r#"
        WITH RECURSIVE subtree AS (
            SELECT id FROM documents WHERE workspace_id = $1 AND id = $2
            UNION ALL
            SELECT child.id
            FROM documents AS child
            JOIN subtree ON child.parent_id = subtree.id
            WHERE child.workspace_id = $1 AND child.archived_at IS NULL
        )
        UPDATE documents
        SET archived_at = now(), updated_at = now()
        WHERE workspace_id = $1 AND id IN (SELECT id FROM subtree)
        "#,
    )
    .bind(workspace_id)
    .bind(document_id)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_permanently(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, document_id)) = path.map_err(AppError::from)?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace_documents(&mut transaction, workspace_id).await?;
    let current = lock_document(&mut transaction, workspace_id, document_id, true).await?;
    authorize_scope(&state, auth.user.id, workspace_id, current.project_id, true).await?;
    if current.archived_at.is_none() {
        return Err(AppError::Validation(
            "Archive the document before deleting it permanently".to_owned(),
        ));
    }
    let ids: Vec<Uuid> = sqlx::query_scalar(
        r#"
        WITH RECURSIVE subtree AS (
            SELECT id, archived_at FROM documents WHERE workspace_id = $1 AND id = $2
            UNION ALL
            SELECT child.id, child.archived_at
            FROM documents AS child
            JOIN subtree ON child.parent_id = subtree.id
            WHERE child.workspace_id = $1
        )
        SELECT id FROM subtree WHERE archived_at IS NOT NULL ORDER BY id
        "#,
    )
    .bind(workspace_id)
    .bind(document_id)
    .fetch_all(&mut *transaction)
    .await?;
    let subtree_count: i64 = sqlx::query_scalar(
        r#"
        WITH RECURSIVE subtree AS (
            SELECT id FROM documents WHERE workspace_id = $1 AND id = $2
            UNION ALL
            SELECT child.id FROM documents AS child
            JOIN subtree ON child.parent_id = subtree.id
            WHERE child.workspace_id = $1
        )
        SELECT count(*) FROM subtree
        "#,
    )
    .bind(workspace_id)
    .bind(document_id)
    .fetch_one(&mut *transaction)
    .await?;
    if ids.len() as i64 != subtree_count {
        return Err(AppError::Validation(
            "Archive the complete document subtree before deleting it".to_owned(),
        ));
    }

    let root_path = library_path(&mut transaction, workspace_id, document_id).await?;
    let trash = state
        .vault
        .trash_library_tree(workspace_id, document_id, &root_path)
        .await
        .map_err(AppError::internal)?;
    let delete_result = sqlx::query("DELETE FROM documents WHERE workspace_id = $1 AND id = $2")
        .bind(workspace_id)
        .bind(document_id)
        .execute(&mut *transaction)
        .await;
    if let Err(error) = delete_result {
        restore_library_trash(&state, &trash).await;
        return Err(error.into());
    }
    if let Err(error) = transaction.commit().await {
        restore_library_trash(&state, &trash).await;
        return Err(error.into());
    }
    if let Err(error) = state.vault.purge_library_trash(&trash).await {
        warn!(document_id = %document_id, %error, "failed to purge deleted Library subtree");
    }
    Ok(StatusCode::NO_CONTENT)
}

fn deserialize_nullable_uuid<'de, D>(deserializer: D) -> Result<Option<Option<Uuid>>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<Uuid>::deserialize(deserializer).map(Some)
}
