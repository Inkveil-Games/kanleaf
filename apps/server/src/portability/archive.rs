use std::{
    collections::HashSet,
    fs::OpenOptions,
    io::{Read, Write},
    path::PathBuf,
    time::Duration,
};

use anyhow::Context;
use axum::{
    Json, Router,
    body::Body,
    extract::{Path, State, rejection::PathRejection},
    http::{Response, StatusCode, header},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio_util::io::ReaderStream;
use tracing::warn;
use uuid::Uuid;
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

use crate::{
    AppState,
    auth::AuthenticatedUser,
    domain::VaultStorageName,
    error::AppError,
    task::project_many,
    vault::{ExportExclusion, ManagedExportFile},
    workspace::require_workspace_admin,
};

use super::{
    config::{LiveManifest, project_now as project_config_now},
    operation::{self, OperationRow},
};

const EXPORT_KIND: &str = "workspace_export";
const EXPORT_CLEANUP_BATCH_SIZE: i64 = 100;

#[derive(Clone, Debug, Deserialize, Serialize)]
struct StoredExportResult {
    file_name: String,
    file_count: usize,
    content_bytes: u64,
    archive_bytes: Option<u64>,
    exclusions: Vec<ExportExclusionResponse>,
    error: Option<ExportError>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ExportExclusionResponse {
    path: String,
    reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ExportError {
    code: String,
    message: String,
}

#[derive(Serialize)]
struct ExportOperationResponse {
    id: Uuid,
    workspace_id: Uuid,
    state: String,
    revision: Uuid,
    expires_at: DateTime<Utc>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    file_name: String,
    file_count: usize,
    content_bytes: u64,
    archive_bytes: Option<u64>,
    exclusions: Vec<ExportExclusionResponse>,
    error: Option<ExportError>,
    download_url: Option<String>,
}

#[derive(Serialize)]
#[serde(deny_unknown_fields)]
struct ArchiveManifest {
    format_version: u16,
    exported_at: DateTime<Utc>,
    source: LiveManifest,
    files: Vec<ArchiveFile>,
    relations: Vec<ArchiveRelation>,
    exclusions: Vec<ExportExclusionResponse>,
    omitted: ArchiveOmissions,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ArchiveRelation {
    task_a_id: Uuid,
    task_b_id: Uuid,
    relation_type: String,
    task_a_blocks: Option<bool>,
}

#[derive(Serialize)]
#[serde(deny_unknown_fields)]
struct ArchiveFile {
    path: String,
    size: u64,
    media_type: &'static str,
    sha256: String,
}

#[derive(Serialize)]
#[serde(deny_unknown_fields)]
struct ArchiveOmissions {
    authentication: bool,
    invitations: bool,
    account_preferences: bool,
    notifications: bool,
    comments_and_activity: bool,
}

enum ExportFailure {
    Projection,
    WorkspaceChanged,
    Storage,
    Database,
}

impl ExportFailure {
    const fn response(&self) -> (&'static str, &'static str) {
        match self {
            Self::Projection => (
                "projection_conflict",
                "Pending Markdown or configuration projections must be resolved before export",
            ),
            Self::WorkspaceChanged => (
                "workspace_changed",
                "The Workspace changed while the archive was being prepared; try again",
            ),
            Self::Storage => (
                "vault_unavailable",
                "Workspace storage is temporarily unavailable",
            ),
            Self::Database => (
                "database_unavailable",
                "The Workspace snapshot could not be prepared",
            ),
        }
    }
}

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/workspaces/{workspace_id}/exports", post(start_export))
        .route(
            "/api/workspace-exports/{operation_id}",
            get(get_export).delete(cancel_export),
        )
        .route(
            "/api/workspace-exports/{operation_id}/download",
            get(download_export),
        )
}

async fn start_export(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<(StatusCode, Json<ExportOperationResponse>), AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let workspace: (String, i64) =
        sqlx::query_as("SELECT name, config_version FROM workspaces WHERE id = $1")
            .bind(workspace_id)
            .fetch_one(&state.pool)
            .await?;
    let file_name = format!(
        "{}.kanleaf.zip",
        VaultStorageName::from_initial_name(&workspace.0, workspace_id).as_str()
    );
    let result = StoredExportResult {
        file_name,
        file_count: 0,
        content_bytes: 0,
        archive_bytes: None,
        exclusions: Vec::new(),
        error: None,
    };
    let operation = operation::create_preparing(
        &state.pool,
        auth.user.id,
        workspace_id,
        EXPORT_KIND,
        &result,
    )
    .await?;
    let response = operation_response(operation.clone(), result.clone())?;
    tokio::spawn(async move {
        prepare_in_background(state, auth.user.id, workspace_id, operation, result).await;
    });
    Ok((StatusCode::ACCEPTED, Json(response)))
}

async fn get_export(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<ExportOperationResponse>, AppError> {
    let Path(operation_id) = path.map_err(AppError::from)?;
    let operation = load_visible_export(&state.pool, operation_id, auth.user.id).await?;
    let workspace_id = operation_workspace(&operation)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let result = parse_result(&operation)?;
    Ok(Json(operation_response(operation, result)?))
}

async fn cancel_export(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path(operation_id) = path.map_err(AppError::from)?;
    let operation = load_visible_export(&state.pool, operation_id, auth.user.id).await?;
    let workspace_id = operation_workspace(&operation)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let (staging_key, worker_may_publish) =
        mark_export_canceled(&state.pool, operation_id, auth.user.id).await?;
    if let Some(staging_key) = staging_key {
        state
            .vault
            .remove_export_artifact(staging_key)
            .await
            .map_err(|_| AppError::VaultUnavailable)?;
    }
    if (!worker_may_publish || staging_key.is_none())
        && let Err(error) =
            delete_canceled_export_marker(&state.pool, operation_id, auth.user.id, staging_key)
                .await
    {
        warn!(%operation_id, %error, "failed to remove completed Workspace export cancellation marker");
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn download_export(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Response<Body>, AppError> {
    let Path(operation_id) = path.map_err(AppError::from)?;
    let operation = load_visible_export(&state.pool, operation_id, auth.user.id).await?;
    let workspace_id = operation_workspace(&operation)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    if operation.state != "ready" {
        return Err(AppError::Conflict(
            "Workspace export is not ready to download".to_owned(),
        ));
    }
    let result = parse_result(&operation)?;
    let staging_key = operation.staging_key.ok_or_else(|| {
        AppError::internal(anyhow::anyhow!("Workspace export has no staging key"))
    })?;
    let (file, size) = state
        .vault
        .export_artifact(staging_key)
        .await
        .map_err(|_| AppError::VaultUnavailable)?;
    let disposition = format!("attachment; filename=\"{}\"", result.file_name);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/zip")
        .header(header::CONTENT_LENGTH, size)
        .header(header::CONTENT_DISPOSITION, disposition)
        .body(Body::from_stream(ReaderStream::new(file)))
        .map_err(AppError::internal)
}

async fn load_visible_export(
    pool: &sqlx::PgPool,
    operation_id: Uuid,
    actor_id: Uuid,
) -> Result<OperationRow, AppError> {
    let operation = operation::load_actor(pool, operation_id, actor_id, EXPORT_KIND).await?;
    if operation.state == "canceled" {
        return Err(AppError::NotFound(
            "Workspace operation not found".to_owned(),
        ));
    }
    Ok(operation)
}

async fn mark_export_canceled(
    pool: &sqlx::PgPool,
    operation_id: Uuid,
    actor_id: Uuid,
) -> Result<(Option<Uuid>, bool), AppError> {
    let mut transaction = pool.begin().await?;
    let operation: OperationRow = sqlx::query_as(
        r#"
        SELECT id, workspace_id, state, revision, result, staging_key,
               expires_at, created_at, updated_at
        FROM workspace_operations
        WHERE id = $1 AND actor_id = $2 AND kind = $3
        FOR UPDATE
        "#,
    )
    .bind(operation_id)
    .bind(actor_id)
    .bind(EXPORT_KIND)
    .fetch_optional(&mut *transaction)
    .await?
    .filter(|operation: &OperationRow| {
        operation.state != "applying" && operation.state != "canceled"
    })
    .ok_or_else(|| AppError::NotFound("Workspace operation not found".to_owned()))?;
    sqlx::query(
        r#"
        UPDATE workspace_operations
        SET state = 'canceled', revision = $2, updated_at = now()
        WHERE id = $1 AND actor_id = $3 AND kind = $4 AND state = $5
        "#,
    )
    .bind(operation_id)
    .bind(Uuid::new_v4())
    .bind(actor_id)
    .bind(EXPORT_KIND)
    .bind(&operation.state)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok((operation.staging_key, operation.state == "preparing"))
}

async fn delete_canceled_export_marker(
    pool: &sqlx::PgPool,
    operation_id: Uuid,
    actor_id: Uuid,
    staging_key: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        DELETE FROM workspace_operations
        WHERE id = $1 AND actor_id = $2 AND kind = $3 AND state = 'canceled'
          AND staging_key IS NOT DISTINCT FROM $4
        "#,
    )
    .bind(operation_id)
    .bind(actor_id)
    .bind(EXPORT_KIND)
    .bind(staging_key)
    .execute(pool)
    .await?;
    Ok(())
}

async fn cleanup_canceled_export_after_worker(
    state: &AppState,
    operation_id: Uuid,
    actor_id: Uuid,
    staging_key: Uuid,
) {
    if let Err(error) = state.vault.remove_export_artifact(staging_key).await {
        warn!(%operation_id, %error, "failed to remove canceled Workspace export artifact");
        return;
    }
    if let Err(error) =
        delete_canceled_export_marker(&state.pool, operation_id, actor_id, Some(staging_key)).await
    {
        warn!(%operation_id, %error, "failed to remove Workspace export cancellation marker");
    }
}

async fn prepare_in_background(
    state: AppState,
    actor_id: Uuid,
    workspace_id: Uuid,
    operation: OperationRow,
    mut result: StoredExportResult,
) {
    let staging_key = match operation.staging_key {
        Some(staging_key) => staging_key,
        None => {
            warn!(operation_id = %operation.id, "Workspace export has no staging key");
            return;
        }
    };
    match prepare_export(&state, workspace_id, staging_key).await {
        Ok(prepared) => result = prepared,
        Err(error) => {
            let (code, message) = error.response();
            result.error = Some(ExportError {
                code: code.to_owned(),
                message: message.to_owned(),
            });
            let artifact_removed = match state.vault.remove_export_artifact(staging_key).await {
                Ok(()) => true,
                Err(cleanup_error) => {
                    warn!(operation_id = %operation.id, %cleanup_error, "failed to remove unsuccessful Workspace export artifact");
                    false
                }
            };
            if let Err(state_error) = operation::set_state(
                &state.pool,
                operation.id,
                actor_id,
                "preparing",
                "failed",
                &result,
            )
            .await
            {
                if artifact_removed
                    && let Err(cleanup_error) = delete_canceled_export_marker(
                        &state.pool,
                        operation.id,
                        actor_id,
                        Some(staging_key),
                    )
                    .await
                {
                    warn!(operation_id = %operation.id, %cleanup_error, "failed to remove Workspace export cancellation marker");
                }
                warn!(operation_id = %operation.id, %state_error, "failed to record Workspace export failure");
            }
            return;
        }
    }
    if let Err(error) = operation::set_state(
        &state.pool,
        operation.id,
        actor_id,
        "preparing",
        "ready",
        &result,
    )
    .await
    {
        cleanup_canceled_export_after_worker(&state, operation.id, actor_id, staging_key).await;
        warn!(operation_id = %operation.id, %error, "Workspace export was canceled before publication");
    }
}

async fn prepare_export(
    state: &AppState,
    workspace_id: Uuid,
    staging_key: Uuid,
) -> Result<StoredExportResult, ExportFailure> {
    let task_ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM tasks WHERE workspace_id = $1 ORDER BY id")
            .bind(workspace_id)
            .fetch_all(&state.pool)
            .await
            .map_err(|_| ExportFailure::Database)?;
    project_many(state, workspace_id, &task_ids).await;
    project_config_now(state, workspace_id).await;

    // Keep permanent deletion behind the complete archive publication window.
    // If deletion won the race before this lock, no artifact is created; if
    // export won, deletion waits and records the artifact's staging key.
    let deletion_fence = lock_workspace_for_export(&state.pool, workspace_id).await?;

    let pending_tasks: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM task_projection_jobs WHERE workspace_id = $1)",
    )
    .bind(workspace_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ExportFailure::Database)?;
    let workspace: Option<(String, i64, i64)> = sqlx::query_as(
        "SELECT name, config_version, projected_config_version FROM workspaces WHERE id = $1",
    )
    .bind(workspace_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ExportFailure::Database)?;
    let Some((workspace_name, config_version, projected_config_version)) = workspace else {
        return Err(ExportFailure::WorkspaceChanged);
    };
    if pending_tasks || config_version != projected_config_version {
        return Err(ExportFailure::Projection);
    }

    let expected_paths = expected_paths(state, workspace_id)
        .await
        .map_err(|_| ExportFailure::Database)?;
    let scan = state
        .vault
        .scan_workspace_export(workspace_id, &expected_paths)
        .await
        .map_err(|_| ExportFailure::Storage)?;
    if !scan.missing.is_empty() {
        return Err(ExportFailure::Projection);
    }
    let source: LiveManifest = serde_json::from_str(
        &state
            .vault
            .read_live_manifest(workspace_id)
            .await
            .map_err(|_| ExportFailure::Storage)?,
    )
    .map_err(|_| ExportFailure::Projection)?;
    if source.config_version != config_version {
        return Err(ExportFailure::WorkspaceChanged);
    }
    let exclusions = scan
        .exclusions
        .iter()
        .map(exclusion_response)
        .collect::<Vec<_>>();
    let relations = sqlx::query_as::<_, (Uuid, Uuid, String, Option<bool>)>(
        r#"
        SELECT task_a_id, task_b_id, relation_type, task_a_blocks
        FROM task_relations WHERE workspace_id = $1
        ORDER BY task_a_id, task_b_id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ExportFailure::Database)?
    .into_iter()
    .map(
        |(task_a_id, task_b_id, relation_type, task_a_blocks)| ArchiveRelation {
            task_a_id,
            task_b_id,
            relation_type,
            task_a_blocks,
        },
    )
    .collect();
    let manifest = ArchiveManifest {
        format_version: 1,
        exported_at: Utc::now(),
        source,
        files: scan
            .files
            .iter()
            .map(|file| ArchiveFile {
                path: file.relative_path.clone(),
                size: file.size,
                media_type: media_type(&file.relative_path),
                sha256: file.sha256.clone(),
            })
            .collect(),
        relations,
        exclusions: exclusions.clone(),
        omitted: ArchiveOmissions {
            authentication: true,
            invitations: true,
            account_preferences: true,
            notifications: true,
            comments_and_activity: true,
        },
    };
    let mut manifest_json =
        serde_json::to_string_pretty(&manifest).map_err(|_| ExportFailure::Database)?;
    manifest_json.push('\n');
    let artifact = state
        .vault
        .prepare_export_artifact(staging_key)
        .await
        .map_err(|_| ExportFailure::Storage)?;
    write_archive(artifact.clone(), scan.files.clone(), manifest_json)
        .await
        .map_err(|_| ExportFailure::Storage)?;
    state
        .vault
        .sync_export_artifact_directory()
        .await
        .map_err(|_| ExportFailure::Storage)?;

    if !state
        .vault
        .export_files_unchanged(&scan.files)
        .await
        .map_err(|_| ExportFailure::Storage)?
    {
        return Err(ExportFailure::WorkspaceChanged);
    }
    let unchanged: Option<bool> = sqlx::query_scalar(
        r#"
        SELECT config_version = $2 AND projected_config_version = $2
          AND NOT EXISTS(
              SELECT 1 FROM task_projection_jobs WHERE workspace_id = $1
          )
        FROM workspaces WHERE id = $1
        "#,
    )
    .bind(workspace_id)
    .bind(config_version)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ExportFailure::Database)?;
    if unchanged != Some(true) {
        return Err(ExportFailure::WorkspaceChanged);
    }
    let archive_bytes = tokio::fs::metadata(&artifact)
        .await
        .map_err(|_| ExportFailure::Storage)?
        .len();
    deletion_fence
        .commit()
        .await
        .map_err(|_| ExportFailure::Database)?;
    Ok(StoredExportResult {
        file_name: format!(
            "{}.kanleaf.zip",
            VaultStorageName::from_initial_name(&workspace_name, workspace_id).as_str()
        ),
        file_count: manifest.files.len() + 1,
        content_bytes: manifest.files.iter().map(|file| file.size).sum(),
        archive_bytes: Some(archive_bytes),
        exclusions,
        error: None,
    })
}

async fn lock_workspace_for_export(
    pool: &sqlx::PgPool,
    workspace_id: Uuid,
) -> Result<sqlx::Transaction<'_, sqlx::Postgres>, ExportFailure> {
    let mut transaction = pool.begin().await.map_err(|_| ExportFailure::Database)?;
    let workspace_exists: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM workspaces WHERE id = $1 FOR SHARE")
            .bind(workspace_id)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|_| ExportFailure::Database)?;
    if workspace_exists.is_none() {
        return Err(ExportFailure::WorkspaceChanged);
    }
    Ok(transaction)
}

async fn expected_paths(
    state: &AppState,
    workspace_id: Uuid,
) -> Result<HashSet<String>, sqlx::Error> {
    let mut paths = sqlx::query_scalar::<_, String>(
        r#"
        SELECT CASE
            WHEN tasks.project_id IS NULL THEN 'Todo/' || tasks.storage_name || '.md'
            ELSE 'Projects/' || projects.storage_name || '/Todo/' || tasks.storage_name || '.md'
        END
        FROM tasks
        LEFT JOIN projects ON projects.id = tasks.project_id
        WHERE tasks.workspace_id = $1
        ORDER BY tasks.id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .collect::<HashSet<_>>();
    let document_paths: Vec<String> = sqlx::query_scalar(
        r#"
        WITH RECURSIVE tree AS (
            SELECT documents.id, documents.project_id, documents.storage_name::text AS path
            FROM documents
            WHERE documents.workspace_id = $1 AND documents.parent_id IS NULL
            UNION ALL
            SELECT children.id, children.project_id,
                   tree.path || '/' || children.storage_name
            FROM documents AS children
            JOIN tree ON tree.id = children.parent_id
            WHERE children.workspace_id = $1
        )
        SELECT CASE
            WHEN tree.project_id IS NULL THEN 'Wiki/' || tree.path || '.md'
            ELSE 'Projects/' || projects.storage_name || '/Wiki/' || tree.path || '.md'
        END
        FROM tree
        LEFT JOIN projects ON projects.id = tree.project_id
        ORDER BY tree.id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&state.pool)
    .await?;
    paths.extend(document_paths);
    paths.extend([
        ".kanleaf/workspace.json".to_owned(),
        ".kanleaf/task-config.json".to_owned(),
        ".kanleaf/views.json".to_owned(),
    ]);
    let project_ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM projects WHERE workspace_id = $1 ORDER BY id")
            .bind(workspace_id)
            .fetch_all(&state.pool)
            .await?;
    paths.extend(
        project_ids
            .into_iter()
            .map(|project_id| format!(".kanleaf/projects/{project_id}.json")),
    );
    Ok(paths)
}

async fn write_archive(
    artifact: PathBuf,
    files: Vec<ManagedExportFile>,
    manifest: String,
) -> anyhow::Result<()> {
    tokio::task::spawn_blocking(move || {
        let output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&artifact)
            .with_context(|| format!("failed to create {}", artifact.display()))?;
        let mut archive = ZipWriter::new(output);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o644);
        let mut buffer = vec![0_u8; 64 * 1024];
        for entry in files {
            archive.start_file(&entry.relative_path, options)?;
            let mut source = std::fs::File::open(&entry.source)?;
            loop {
                let read = source.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                archive.write_all(&buffer[..read])?;
            }
        }
        archive.start_file(".kanleaf/manifest.json", options)?;
        archive.write_all(manifest.as_bytes())?;
        let output = archive.finish()?;
        output.sync_all()?;
        Ok::<(), anyhow::Error>(())
    })
    .await
    .context("Workspace export task stopped")??;
    Ok(())
}

fn exclusion_response(exclusion: &ExportExclusion) -> ExportExclusionResponse {
    ExportExclusionResponse {
        path: exclusion.relative_path.clone(),
        reason: exclusion.reason.to_owned(),
    }
}

fn media_type(path: &str) -> &'static str {
    if path.ends_with(".md") {
        "text/markdown"
    } else {
        "application/json"
    }
}

fn parse_result(operation: &OperationRow) -> Result<StoredExportResult, AppError> {
    serde_json::from_value(operation.result.clone()).map_err(AppError::internal)
}

fn operation_workspace(operation: &OperationRow) -> Result<Uuid, AppError> {
    operation
        .workspace_id
        .ok_or_else(|| AppError::internal(anyhow::anyhow!("Workspace export has no Workspace")))
}

fn operation_response(
    operation: OperationRow,
    result: StoredExportResult,
) -> Result<ExportOperationResponse, AppError> {
    let workspace_id = operation_workspace(&operation)?;
    let download_url = (operation.state == "ready")
        .then(|| format!("/api/workspace-exports/{}/download", operation.id));
    Ok(ExportOperationResponse {
        id: operation.id,
        workspace_id,
        state: operation.state,
        revision: operation.revision,
        expires_at: operation.expires_at,
        created_at: operation.created_at,
        updated_at: operation.updated_at,
        file_name: result.file_name,
        file_count: result.file_count,
        content_bytes: result.content_bytes,
        archive_bytes: result.archive_bytes,
        exclusions: result.exclusions,
        error: result.error,
        download_url,
    })
}

pub async fn recover_export_operations(state: &AppState) -> anyhow::Result<()> {
    // Startup runs before the listener and no worker from the prior process can
    // still publish, so canceled markers are now safe to acknowledge.
    cleanup_canceled_exports(state).await?;

    let interrupted: Vec<Option<Uuid>> = sqlx::query_scalar(
        r#"
        UPDATE workspace_operations
        SET state = 'failed',
            result = jsonb_set(
                result,
                '{error}',
                '{"code":"interrupted","message":"Workspace export was interrupted; start a new export"}'::jsonb,
                true
            ),
            updated_at = now()
        WHERE kind = 'workspace_export' AND state = 'preparing'
        RETURNING staging_key
        "#,
    )
    .fetch_all(&state.pool)
    .await?;
    for staging_key in interrupted.into_iter().flatten() {
        state.vault.remove_export_artifact(staging_key).await?;
    }

    cleanup_expired_exports(state).await
}

async fn cleanup_canceled_exports(state: &AppState) -> anyhow::Result<()> {
    let canceled: Vec<(Uuid, Option<Uuid>)> = sqlx::query_as(
        r#"
        SELECT id, staging_key FROM workspace_operations
        WHERE kind = 'workspace_export' AND state = 'canceled'
        ORDER BY id
        "#,
    )
    .fetch_all(&state.pool)
    .await?;
    for (operation_id, staging_key) in canceled {
        if let Some(staging_key) = staging_key {
            state.vault.remove_export_artifact(staging_key).await?;
        }
        sqlx::query(
            "DELETE FROM workspace_operations WHERE id = $1 AND kind = 'workspace_export' AND state = 'canceled'",
        )
        .bind(operation_id)
        .execute(&state.pool)
        .await?;
    }
    Ok(())
}

async fn cleanup_expired_exports(state: &AppState) -> anyhow::Result<()> {
    // Preparing and canceled exports can still have live workers. Retain their
    // staging keys so a late artifact remains recoverable after a crash; the
    // worker or startup recovery owns their cleanup.
    let expired: Vec<(Uuid, Option<Uuid>)> = sqlx::query_as(
        r#"
        SELECT id, staging_key FROM workspace_operations
        WHERE kind = 'workspace_export'
          AND state NOT IN ('preparing', 'canceled')
          AND expires_at <= now()
        ORDER BY id
        LIMIT $1
        "#,
    )
    .bind(EXPORT_CLEANUP_BATCH_SIZE)
    .fetch_all(&state.pool)
    .await?;
    cleanup_selected_expired_exports(state, expired).await?;
    Ok(())
}

async fn cleanup_selected_expired_exports(
    state: &AppState,
    expired: Vec<(Uuid, Option<Uuid>)>,
) -> anyhow::Result<()> {
    for (operation_id, staging_key) in expired {
        if let Some(staging_key) = staging_key {
            state.vault.remove_export_artifact(staging_key).await?;
        }
        sqlx::query(
            r#"
            DELETE FROM workspace_operations
            WHERE id = $1
              AND kind = 'workspace_export'
              AND state NOT IN ('preparing', 'canceled')
              AND expires_at <= now()
            "#,
        )
        .bind(operation_id)
        .execute(&state.pool)
        .await?;
    }
    Ok(())
}

pub fn spawn_export_cleanup_worker(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5 * 60));
        interval.tick().await;
        loop {
            interval.tick().await;
            if let Err(error) = cleanup_expired_exports(&state).await {
                warn!(%error, "Workspace export cleanup worker failed");
            }
        }
    });
}

#[cfg(all(test, feature = "postgres-tests"))]
mod tests {
    use std::{fs, time::Duration};

    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode, header},
    };
    use http::HeaderValue;
    use serde_json::{Value, json};
    use sqlx::PgPool;
    use tempfile::TempDir;
    use tower::ServiceExt;
    use uuid::Uuid;

    use crate::{AppState, router};

    use super::{
        EXPORT_CLEANUP_BATCH_SIZE, cleanup_expired_exports, cleanup_selected_expired_exports,
        lock_workspace_for_export, recover_export_operations,
    };

    async fn send(
        app: &axum::Router,
        method: &str,
        uri: &str,
        body: Value,
        token: Option<&str>,
    ) -> axum::response::Response {
        let mut request = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(token) = token {
            request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        app.clone()
            .oneshot(request.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap()
    }

    async fn json(response: axum::response::Response) -> Value {
        let bytes = to_bytes(response.into_body(), 128 * 1024).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn workspace_export_fence_blocks_deletion_until_publication_finishes(pool: PgPool) {
        let data_dir = TempDir::new().unwrap();
        let app = router(
            AppState::new(
                pool.clone(),
                data_dir.path().to_owned(),
                Duration::from_secs(3600),
            ),
            vec![HeaderValue::from_static("http://127.0.0.1:1420")],
        );
        let registered = send(
            &app,
            "POST",
            "/api/auth/register",
            json!({"email": "fence@example.com", "password": "correct horse battery"}),
            None,
        )
        .await;
        assert_eq!(registered.status(), StatusCode::CREATED);
        let registered = json(registered).await;
        let token = registered["token"].as_str().unwrap();
        let setup = send(
            &app,
            "PATCH",
            "/api/account/setup",
            json!({"display_name": "Fence Owner"}),
            Some(token),
        )
        .await;
        assert_eq!(setup.status(), StatusCode::OK);
        let created = send(
            &app,
            "POST",
            "/api/workspaces",
            json!({"name": "Fence", "identifier": "export-fence"}),
            Some(token),
        )
        .await;
        assert_eq!(created.status(), StatusCode::CREATED);
        let workspace_id: Uuid = json(created).await["id"].as_str().unwrap().parse().unwrap();

        let fence = match lock_workspace_for_export(&pool, workspace_id).await {
            Ok(fence) => fence,
            Err(_) => panic!("Workspace export fence should lock a live Workspace"),
        };
        let delete_pool = pool.clone();
        let mut deletion = tokio::spawn(async move {
            sqlx::query("DELETE FROM workspaces WHERE id = $1")
                .bind(workspace_id)
                .execute(&delete_pool)
                .await
                .unwrap()
                .rows_affected()
        });

        assert!(
            tokio::time::timeout(Duration::from_millis(100), &mut deletion)
                .await
                .is_err(),
            "permanent deletion must wait while an export can still publish its artifact"
        );
        fence.commit().await.unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), deletion)
                .await
                .unwrap()
                .unwrap(),
            1
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn periodic_cleanup_preserves_expired_preparing_export_for_startup_recovery(
        pool: PgPool,
    ) {
        let data_dir = TempDir::new().unwrap();
        let state = AppState::new(
            pool.clone(),
            data_dir.path().to_owned(),
            Duration::from_secs(3600),
        );
        let app = router(
            state.clone(),
            vec![HeaderValue::from_static("http://127.0.0.1:1420")],
        );
        let registered = send(
            &app,
            "POST",
            "/api/auth/register",
            json!({"email": "expired-worker@example.com", "password": "correct horse battery"}),
            None,
        )
        .await;
        assert_eq!(registered.status(), StatusCode::CREATED);
        let registered = json(registered).await;
        let token = registered["token"].as_str().unwrap();
        let actor_id: Uuid = registered["user"]["id"].as_str().unwrap().parse().unwrap();
        let setup = send(
            &app,
            "PATCH",
            "/api/account/setup",
            json!({"display_name": "Expired Worker"}),
            Some(token),
        )
        .await;
        assert_eq!(setup.status(), StatusCode::OK);
        let created = send(
            &app,
            "POST",
            "/api/workspaces",
            json!({"name": "Late Export", "identifier": "late-export"}),
            Some(token),
        )
        .await;
        assert_eq!(created.status(), StatusCode::CREATED);
        let workspace_id: Uuid = json(created).await["id"].as_str().unwrap().parse().unwrap();
        let operation_id = Uuid::new_v4();
        let staging_key = Uuid::new_v4();
        sqlx::query(
            r#"
            INSERT INTO workspace_operations (
                id, actor_id, workspace_id, kind, state, revision, result,
                staging_key, expires_at
            ) VALUES (
                $1, $2, $3, 'workspace_export', 'preparing', $4, $5, $6,
                now() - interval '1 minute'
            )
            "#,
        )
        .bind(operation_id)
        .bind(actor_id)
        .bind(workspace_id)
        .bind(Uuid::new_v4())
        .bind(json!({
            "file_name": "late-export.kanleaf.zip",
            "file_count": 0,
            "content_bytes": 0,
            "archive_bytes": null,
            "exclusions": [],
            "error": null
        }))
        .bind(staging_key)
        .execute(&pool)
        .await
        .unwrap();

        cleanup_expired_exports(&state).await.unwrap();

        let preparing: Option<(String, Option<Uuid>)> =
            sqlx::query_as("SELECT state, staging_key FROM workspace_operations WHERE id = $1")
                .bind(operation_id)
                .fetch_optional(&pool)
                .await
                .unwrap();
        assert_eq!(
            preparing,
            Some(("preparing".to_owned(), Some(staging_key))),
            "periodic expiry must retain the recovery key while a worker can still publish"
        );

        let operations = data_dir.path().join("operations");
        fs::create_dir_all(&operations).unwrap();
        let artifact = operations.join(format!("{staging_key}.kanleaf.zip"));
        fs::write(&artifact, "artifact published after periodic cleanup").unwrap();

        recover_export_operations(&state).await.unwrap();

        assert!(!artifact.exists());
        let operation_exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workspace_operations WHERE id = $1)")
                .bind(operation_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(!operation_exists);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn periodic_cleanup_uses_a_stable_bounded_selection(pool: PgPool) {
        let data_dir = TempDir::new().unwrap();
        let state = AppState::new(
            pool.clone(),
            data_dir.path().to_owned(),
            Duration::from_secs(3600),
        );
        let app = router(
            state.clone(),
            vec![HeaderValue::from_static("http://127.0.0.1:1420")],
        );
        let registered = send(
            &app,
            "POST",
            "/api/auth/register",
            json!({"email": "expiry-race@example.com", "password": "correct horse battery"}),
            None,
        )
        .await;
        assert_eq!(registered.status(), StatusCode::CREATED);
        let registered = json(registered).await;
        let token = registered["token"].as_str().unwrap();
        let actor_id: Uuid = registered["user"]["id"].as_str().unwrap().parse().unwrap();
        let setup = send(
            &app,
            "PATCH",
            "/api/account/setup",
            json!({"display_name": "Expiry Race"}),
            Some(token),
        )
        .await;
        assert_eq!(setup.status(), StatusCode::OK);
        let created = send(
            &app,
            "POST",
            "/api/workspaces",
            json!({"name": "Expiry Race", "identifier": "expiry-race"}),
            Some(token),
        )
        .await;
        assert_eq!(created.status(), StatusCode::CREATED);
        let workspace_id: Uuid = json(created).await["id"].as_str().unwrap().parse().unwrap();
        let operation_id = Uuid::new_v4();
        let staging_key = Uuid::new_v4();
        sqlx::query(
            r#"
            INSERT INTO workspace_operations (
                id, actor_id, workspace_id, kind, state, revision, result,
                staging_key, expires_at
            ) VALUES (
                $1, $2, $3, 'workspace_export', 'preparing', $4, $5, $6,
                now() - interval '1 minute'
            )
            "#,
        )
        .bind(operation_id)
        .bind(actor_id)
        .bind(workspace_id)
        .bind(Uuid::new_v4())
        .bind(json!({
            "file_name": "expiry-race.kanleaf.zip",
            "file_count": 0,
            "content_bytes": 0,
            "archive_bytes": null,
            "exclusions": [],
            "error": null
        }))
        .bind(staging_key)
        .execute(&pool)
        .await
        .unwrap();

        let selected: Vec<(Uuid, Option<Uuid>)> = sqlx::query_as(
            r#"
            SELECT id, staging_key FROM workspace_operations
            WHERE kind = 'workspace_export'
              AND state NOT IN ('preparing', 'canceled')
              AND expires_at <= now()
            ORDER BY id
            "#,
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(selected.is_empty());

        sqlx::query("UPDATE workspace_operations SET state = 'ready' WHERE id = $1")
            .bind(operation_id)
            .execute(&pool)
            .await
            .unwrap();
        let operations = data_dir.path().join("operations");
        fs::create_dir_all(&operations).unwrap();
        let artifact = operations.join(format!("{staging_key}.kanleaf.zip"));
        fs::write(&artifact, "published after cleanup selected its batch").unwrap();

        cleanup_selected_expired_exports(&state, selected)
            .await
            .unwrap();

        assert!(artifact.exists());
        let operation_exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workspace_operations WHERE id = $1)")
                .bind(operation_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(operation_exists);

        cleanup_expired_exports(&state).await.unwrap();

        assert!(!artifact.exists());
        let operation_exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workspace_operations WHERE id = $1)")
                .bind(operation_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(!operation_exists);

        for _ in 0..=EXPORT_CLEANUP_BATCH_SIZE {
            sqlx::query(
                r#"
                INSERT INTO workspace_operations (
                    id, actor_id, workspace_id, kind, state, revision, result,
                    staging_key, expires_at
                ) VALUES (
                    $1, $2, $3, 'workspace_export', 'ready', $4, '{}'::jsonb,
                    NULL, now() - interval '1 minute'
                )
                "#,
            )
            .bind(Uuid::new_v4())
            .bind(actor_id)
            .bind(workspace_id)
            .bind(Uuid::new_v4())
            .execute(&pool)
            .await
            .unwrap();
        }
        let expected_remaining: Vec<Uuid> = sqlx::query_scalar(
            r#"
            SELECT id FROM workspace_operations
            WHERE kind = 'workspace_export'
            ORDER BY id
            OFFSET $1
            "#,
        )
        .bind(EXPORT_CLEANUP_BATCH_SIZE)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(expected_remaining.len(), 1);

        cleanup_expired_exports(&state).await.unwrap();

        let remaining: Vec<Uuid> = sqlx::query_scalar(
            "SELECT id FROM workspace_operations WHERE kind = 'workspace_export' ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(remaining, expected_remaining);
    }
}
