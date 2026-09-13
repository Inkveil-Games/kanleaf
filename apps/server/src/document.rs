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
    routing::{get, post, put},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use sqlx::{FromRow, Postgres, Transaction};
use tracing::warn;
use uuid::Uuid;

use crate::{
    AppState, auth::AuthenticatedUser, domain::DocumentTitle, error::AppError,
    project::require_project_access, workspace::workspace_role,
};

use persistence::{
    active_sibling_ids, authorize_scope, available_storage_name, cleanup_unattached_page,
    ensure_storage_name_available, find_authorized_document, library_path, lock_document,
    lock_workspace_documents, map_vault_create_error, next_position,
    resolve_authorized_document_number, restore_library_trash, set_sibling_order, validate_parent,
    validate_subtree_scope,
};

#[derive(Debug, Serialize, FromRow)]
pub struct DocumentResponse {
    pub id: Uuid,
    pub document_number: i64,
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
}

#[derive(Deserialize)]
struct MoveDocumentRequest {
    #[serde(default)]
    parent_id: Option<Uuid>,
    index: i64,
}

#[derive(Debug, Serialize, FromRow)]
struct MovedDocumentResponse {
    id: Uuid,
    parent_id: Option<Uuid>,
    position: i64,
    library_path: String,
    updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct MoveDocumentResponse {
    documents: Vec<MovedDocumentResponse>,
}

#[derive(Serialize)]
struct DeleteDocumentsResponse {
    deleted_ids: Vec<Uuid>,
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/workspaces/{workspace_id}/documents",
            get(list).post(create),
        )
        .route(
            "/api/workspaces/{workspace_id}/documents/by-number/{document_number}",
            get(detail_by_number),
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
            "/api/workspaces/{workspace_id}/documents/{document_id}/move",
            put(move_document),
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
        SELECT documents.id, documents.document_number, documents.workspace_id,
               documents.project_id,
               documents.parent_id, documents.title, documents.storage_name,
               CASE
                   WHEN documents.project_id IS NULL THEN 'Wiki/'
                   ELSE 'Projects/' || projects.storage_name || '/Wiki/'
               END || document_paths.relative_path || '.md' AS library_path,
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

async fn detail_by_number(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, i64)>, PathRejection>,
) -> Result<Json<DocumentResponse>, AppError> {
    let Path((workspace_id, document_number)) = path.map_err(AppError::from)?;
    if document_number <= 0 {
        return Err(AppError::NotFound("Document not found".to_owned()));
    }
    let document_id =
        resolve_authorized_document_number(&state, auth.user.id, workspace_id, document_number)
            .await?;
    Ok(Json(
        find_authorized_document(&state, auth.user.id, workspace_id, document_id).await?,
    ))
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
    let document_number: i64 = sqlx::query_scalar(
        r#"
        UPDATE workspaces
        SET next_document_number = next_document_number + 1
        WHERE id = $1
        RETURNING next_document_number - 1
        "#,
    )
    .bind(workspace_id)
    .fetch_one(&mut *transaction)
    .await?;
    sqlx::query(
        r#"
        INSERT INTO documents (
            id, workspace_id, project_id, parent_id, title, storage_name,
            storage_layout_version, position, document_number
        )
        VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8)
        "#,
    )
    .bind(document_id)
    .bind(workspace_id)
    .bind(request.project_id)
    .bind(request.parent_id)
    .bind(title.as_str())
    .bind(storage_name.as_str())
    .bind(position)
    .bind(document_number)
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
    if request.title.is_none() && request.project_id.is_none() && request.parent_id.is_none() {
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
    let position = if moved {
        next_position(&mut transaction, workspace_id, project_id, parent_id).await?
    } else {
        current.position
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

async fn move_document(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<MoveDocumentRequest>, JsonRejection>,
) -> Result<Json<MoveDocumentResponse>, AppError> {
    let Path((workspace_id, document_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let destination_index = usize::try_from(request.index).map_err(|_| {
        AppError::Validation("Document destination index cannot be negative".to_owned())
    })?;
    workspace_role(&state.pool, auth.user.id, workspace_id).await?;

    let mut transaction = state.pool.begin().await?;
    lock_workspace_documents(&mut transaction, workspace_id).await?;
    let current = lock_document(&mut transaction, workspace_id, document_id, false).await?;
    authorize_scope(&state, auth.user.id, workspace_id, current.project_id, true).await?;
    validate_subtree_scope(
        &mut transaction,
        workspace_id,
        document_id,
        current.project_id,
    )
    .await?;
    validate_parent(
        &mut transaction,
        workspace_id,
        request.parent_id,
        current.project_id,
        Some(document_id),
    )
    .await?;
    if request.parent_id != current.parent_id {
        ensure_storage_name_available(
            &mut transaction,
            workspace_id,
            document_id,
            request.parent_id,
            &current.storage_name,
        )
        .await?;
    }

    let source_path = library_path(&mut transaction, workspace_id, document_id).await?;
    let old_siblings = active_sibling_ids(
        &mut transaction,
        workspace_id,
        current.project_id,
        current.parent_id,
        document_id,
    )
    .await?;
    let mut destination_siblings = if request.parent_id == current.parent_id {
        old_siblings.clone()
    } else {
        active_sibling_ids(
            &mut transaction,
            workspace_id,
            current.project_id,
            request.parent_id,
            document_id,
        )
        .await?
    };
    if destination_index > destination_siblings.len() {
        return Err(AppError::Validation(
            "Document destination index is outside the sibling list".to_owned(),
        ));
    }
    if request.parent_id != current.parent_id {
        set_sibling_order(
            &mut transaction,
            workspace_id,
            current.parent_id,
            &old_siblings,
        )
        .await?;
    }
    destination_siblings.insert(destination_index, document_id);
    set_sibling_order(
        &mut transaction,
        workspace_id,
        request.parent_id,
        &destination_siblings,
    )
    .await?;

    let destination_path = library_path(&mut transaction, workspace_id, document_id).await?;
    let movement = state
        .vault
        .move_library_tree(workspace_id, document_id, &source_path, &destination_path)
        .await
        .map_err(map_vault_create_error)?;
    let documents = match moved_scope_documents(&mut transaction, workspace_id, current.project_id)
        .await
    {
        Ok(documents) => documents,
        Err(error) => {
            if let Some(movement) = &movement
                && let Err(rollback_error) = state.vault.rollback_library_move(movement).await
            {
                warn!(document_id = %document_id, %rollback_error, "failed to roll back Library move");
            }
            return Err(error);
        }
    };
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

    Ok(Json(MoveDocumentResponse { documents }))
}

async fn moved_scope_documents(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
) -> Result<Vec<MovedDocumentResponse>, AppError> {
    Ok(sqlx::query_as::<_, MovedDocumentResponse>(
        r#"
        WITH RECURSIVE document_paths AS (
            SELECT id, storage_name::text AS relative_path
            FROM documents
            WHERE workspace_id = $1
              AND project_id IS NOT DISTINCT FROM $2
              AND parent_id IS NULL
              AND archived_at IS NULL
            UNION ALL
            SELECT child.id, parent.relative_path || '/' || child.storage_name
            FROM documents AS child
            JOIN document_paths AS parent ON child.parent_id = parent.id
            WHERE child.workspace_id = $1
              AND child.project_id IS NOT DISTINCT FROM $2
              AND child.archived_at IS NULL
        )
        SELECT documents.id, documents.parent_id, documents.position,
               CASE
                   WHEN documents.project_id IS NULL THEN 'Wiki/'
                   ELSE 'Projects/' || projects.storage_name || '/Wiki/'
               END || document_paths.relative_path || '.md' AS library_path,
               documents.updated_at
        FROM documents
        JOIN document_paths ON document_paths.id = documents.id
        LEFT JOIN projects
          ON projects.workspace_id = documents.workspace_id
         AND projects.id = documents.project_id
        WHERE documents.workspace_id = $1
          AND documents.project_id IS NOT DISTINCT FROM $2
          AND documents.archived_at IS NULL
        ORDER BY documents.parent_id NULLS FIRST, documents.position, documents.id
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .fetch_all(&mut **transaction)
    .await?)
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
) -> Result<Json<DeleteDocumentsResponse>, AppError> {
    let Path((workspace_id, document_id)) = path.map_err(AppError::from)?;
    workspace_role(&state.pool, auth.user.id, workspace_id).await?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace_documents(&mut transaction, workspace_id).await?;
    let current = lock_document(&mut transaction, workspace_id, document_id, true).await?;
    authorize_scope(&state, auth.user.id, workspace_id, current.project_id, true).await?;
    validate_subtree_scope(
        &mut transaction,
        workspace_id,
        document_id,
        current.project_id,
    )
    .await?;
    let ids: Vec<Uuid> = sqlx::query_scalar(
        r#"
        WITH RECURSIVE subtree AS (
            SELECT id FROM documents WHERE workspace_id = $1 AND id = $2
            UNION ALL
            SELECT child.id
            FROM documents AS child
            JOIN subtree ON child.parent_id = subtree.id
            WHERE child.workspace_id = $1
        )
        SELECT id FROM subtree ORDER BY id
        "#,
    )
    .bind(workspace_id)
    .bind(document_id)
    .fetch_all(&mut *transaction)
    .await?;

    let root_path = library_path(&mut transaction, workspace_id, document_id).await?;
    let trash = state
        .vault
        .trash_library_tree(workspace_id, document_id, &root_path)
        .await
        .map_err(AppError::internal)?;
    let database_result: Result<(), AppError> = async {
        sqlx::query("DELETE FROM documents WHERE workspace_id = $1 AND id = $2")
            .bind(workspace_id)
            .bind(document_id)
            .execute(&mut *transaction)
            .await?;
        let siblings = active_sibling_ids(
            &mut transaction,
            workspace_id,
            current.project_id,
            current.parent_id,
            document_id,
        )
        .await?;
        set_sibling_order(&mut transaction, workspace_id, current.parent_id, &siblings).await?;
        Ok(())
    }
    .await;
    if let Err(error) = database_result {
        restore_library_trash(&state, &trash).await;
        return Err(error);
    }
    if let Err(error) = transaction.commit().await {
        restore_library_trash(&state, &trash).await;
        return Err(error.into());
    }
    if let Err(error) = state.vault.purge_library_trash(&trash).await {
        warn!(document_id = %document_id, %error, "failed to purge deleted Library subtree");
    }
    Ok(Json(DeleteDocumentsResponse { deleted_ids: ids }))
}

fn deserialize_nullable_uuid<'de, D>(deserializer: D) -> Result<Option<Option<Uuid>>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<Uuid>::deserialize(deserializer).map(Some)
}
