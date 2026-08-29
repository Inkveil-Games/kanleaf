use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection, rejection::PathRejection},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    error::AppError,
    task::{map_vault_write_error, validate_document_revision},
};

use super::persistence::{authorize_scope, library_path, lock_document};

const MAX_DOCUMENT_BYTES: usize = 5 * 1024 * 1024;

#[derive(Deserialize)]
pub(super) struct MarkdownWriteRequest {
    content: String,
    base_revision: String,
}

#[derive(Serialize)]
pub(super) struct MarkdownResponse {
    content: String,
    revision: String,
}

pub(super) async fn read(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<MarkdownResponse>, AppError> {
    let Path((workspace_id, document_id)) = path.map_err(AppError::from)?;
    let mut transaction = state.pool.begin().await?;
    let current = lock_document(&mut transaction, workspace_id, document_id, false).await?;
    authorize_scope(
        &state,
        auth.user.id,
        workspace_id,
        current.project_id,
        false,
    )
    .await?;
    let path = library_path(&mut transaction, workspace_id, document_id).await?;
    let document = state
        .vault
        .read_page_document(workspace_id, &path)
        .await
        .map_err(AppError::internal)?;
    transaction.commit().await?;
    Ok(Json(MarkdownResponse {
        content: document.content,
        revision: document.revision,
    }))
}

pub(super) async fn write(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<MarkdownWriteRequest>, JsonRejection>,
) -> Result<Json<MarkdownResponse>, AppError> {
    let Path((workspace_id, document_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    if request.content.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::Validation(
            "Markdown documents cannot exceed 5 MiB".to_owned(),
        ));
    }
    validate_document_revision(&request.base_revision)?;

    let mut transaction = state.pool.begin().await?;
    let current = lock_document(&mut transaction, workspace_id, document_id, false).await?;
    authorize_scope(&state, auth.user.id, workspace_id, current.project_id, true).await?;
    let path = library_path(&mut transaction, workspace_id, document_id).await?;
    let revision = state
        .vault
        .write_page_document(
            workspace_id,
            &path,
            &request.content,
            &request.base_revision,
        )
        .await
        .map_err(map_vault_write_error)?;
    sqlx::query("UPDATE documents SET updated_at = now() WHERE workspace_id = $1 AND id = $2")
        .bind(workspace_id)
        .bind(document_id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(Json(MarkdownResponse {
        content: request.content,
        revision,
    }))
}
