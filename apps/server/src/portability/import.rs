use std::{collections::HashMap, path::PathBuf, time::Duration};

use axum::{
    Json, Router,
    extract::{
        DefaultBodyLimit, Multipart, Path, State,
        rejection::{JsonRejection, PathRejection},
    },
    http::StatusCode,
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Postgres, Transaction};
use tokio::io::AsyncWriteExt;
use tracing::warn;
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    domain::{TaskPriority, WorkspaceIdentifier},
    error::AppError,
    task::{IdFilter, TaskProperties, TaskQuery, TaskQueryScope, remap_task_identity},
    workspace::{require_account_details, reserve_workspace_identifier},
};

use super::{
    config::project_now as project_config_now,
    import_archive::{
        ImportArchiveError, ImportSummary, ValidatedImport, extract_and_validate, validate_staging,
    },
    operation::{self, OperationRow},
};

const IMPORT_KIND: &str = "workspace_import";
const MAX_UPLOAD_BYTES: u64 = 128 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
struct StoredImportResult {
    summary: Option<ImportSummary>,
    target_workspace_id: Option<Uuid>,
    error: Option<ImportErrorResponse>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ImportErrorResponse {
    code: String,
    message: String,
}

#[derive(Serialize)]
struct ImportOperationResponse {
    id: Uuid,
    state: String,
    revision: Uuid,
    expires_at: DateTime<Utc>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    summary: Option<ImportSummary>,
    workspace_id: Option<Uuid>,
    error: Option<ImportErrorResponse>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ApplyImportRequest {
    revision: Uuid,
}

#[derive(Default)]
struct IdMaps {
    states: HashMap<Uuid, Uuid>,
    types: HashMap<Uuid, Uuid>,
    labels: HashMap<Uuid, Uuid>,
    projects: HashMap<Uuid, Uuid>,
    cycles: HashMap<Uuid, Uuid>,
    modules: HashMap<Uuid, Uuid>,
    tasks: HashMap<Uuid, Uuid>,
    documents: HashMap<Uuid, Uuid>,
}

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/workspace-imports/preview", post(preview_import))
        .route(
            "/api/workspace-imports/{operation_id}",
            get(get_import).delete(cancel_import),
        )
        .route(
            "/api/workspace-imports/{operation_id}/apply",
            post(apply_import),
        )
        .layer(DefaultBodyLimit::max(
            MAX_UPLOAD_BYTES as usize + 1024 * 1024,
        ))
}

async fn preview_import(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<ImportOperationResponse>), AppError> {
    let initial = StoredImportResult {
        summary: None,
        target_workspace_id: None,
        error: None,
    };
    let operation =
        operation::create_import_preparing(&state.pool, auth.user.id, IMPORT_KIND, &initial)
            .await?;
    let staging_key = operation.staging_key.ok_or_else(|| {
        AppError::internal(anyhow::anyhow!("Workspace import has no staging key"))
    })?;
    let (upload, staging_vault) = match state.vault.prepare_import_staging(staging_key).await {
        Ok(staging) => staging,
        Err(_) => {
            let result = StoredImportResult {
                summary: None,
                target_workspace_id: None,
                error: Some(ImportErrorResponse {
                    code: "vault_unavailable".to_owned(),
                    message: "Import staging storage is unavailable".to_owned(),
                }),
            };
            let operation = operation::set_state(
                &state.pool,
                operation.id,
                auth.user.id,
                "preparing",
                "failed",
                &result,
            )
            .await?;
            return Ok((
                StatusCode::CREATED,
                Json(operation_response(operation, result)?),
            ));
        }
    };

    let preview = async {
        receive_upload(&mut multipart, &upload).await?;
        let upload_for_validation = upload.clone();
        let staging_for_validation = staging_vault.clone();
        tokio::task::spawn_blocking(move || {
            extract_and_validate(&upload_for_validation, &staging_for_validation)
        })
        .await
        .map_err(|_| ImportArchiveError::Storage)?
    }
    .await;
    let _ = tokio::fs::remove_file(&upload).await;
    let (state_name, result) = match preview {
        Ok(validated) => (
            "ready",
            StoredImportResult {
                summary: Some(validated.summary),
                target_workspace_id: None,
                error: None,
            },
        ),
        Err(error) => {
            let _ = state.vault.remove_import_staging(staging_key).await;
            (
                "failed",
                StoredImportResult {
                    summary: None,
                    target_workspace_id: None,
                    error: Some(ImportErrorResponse {
                        code: error.code().to_owned(),
                        message: error.to_string(),
                    }),
                },
            )
        }
    };
    let operation = operation::set_state(
        &state.pool,
        operation.id,
        auth.user.id,
        "preparing",
        state_name,
        &result,
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(operation_response(operation, result)?),
    ))
}

async fn get_import(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<ImportOperationResponse>, AppError> {
    let Path(operation_id) = path.map_err(AppError::from)?;
    let operation =
        operation::load_actor(&state.pool, operation_id, auth.user.id, IMPORT_KIND).await?;
    let result = parse_result(&operation)?;
    Ok(Json(operation_response(operation, result)?))
}

async fn cancel_import(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path(operation_id) = path.map_err(AppError::from)?;
    let deleted =
        operation::delete_actor(&state.pool, operation_id, auth.user.id, IMPORT_KIND).await?;
    if let Some(staging_key) = deleted.staging_key {
        state
            .vault
            .remove_import_staging(staging_key)
            .await
            .map_err(|_| AppError::VaultUnavailable)?;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn apply_import(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<ApplyImportRequest>, JsonRejection>,
) -> Result<Json<ImportOperationResponse>, AppError> {
    let Path(operation_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let operation =
        operation::load_actor(&state.pool, operation_id, auth.user.id, IMPORT_KIND).await?;
    if operation.state != "ready" || operation.revision != request.revision {
        return Err(AppError::StalePreview(
            "Workspace import preview changed or expired".to_owned(),
        ));
    }
    require_account_details(&auth.user.setup_stage)?;
    let mut result = parse_result(&operation)?;
    let staging_key = operation.staging_key.ok_or_else(|| {
        AppError::internal(anyhow::anyhow!("Workspace import has no staging key"))
    })?;
    let target_workspace_id = Uuid::new_v4();
    result.target_workspace_id = Some(target_workspace_id);
    let applying = operation::set_state(
        &state.pool,
        operation_id,
        auth.user.id,
        "ready",
        "applying",
        &result,
    )
    .await?;

    let staging = state
        .vault
        .import_staging_vault(staging_key)
        .await
        .map_err(|_| AppError::VaultUnavailable)?;
    let validation_path = staging.clone();
    let validated = tokio::task::spawn_blocking(move || validate_staging(&validation_path))
        .await
        .map_err(AppError::internal)?;
    let validated = match validated {
        Ok(validated) => validated,
        Err(error) => {
            result.error = Some(ImportErrorResponse {
                code: error.code().to_owned(),
                message: error.to_string(),
            });
            let failed = operation::set_state(
                &state.pool,
                operation_id,
                auth.user.id,
                "applying",
                "failed",
                &result,
            )
            .await?;
            let _ = state.vault.remove_import_staging(staging_key).await;
            return Ok(Json(operation_response(failed, result)?));
        }
    };
    result.summary = Some(validated.summary.clone());
    match apply_validated(
        &state,
        auth.user.id,
        target_workspace_id,
        staging_key,
        validated,
    )
    .await
    {
        Ok(()) => {
            result.error = None;
            let completed = operation::set_state(
                &state.pool,
                applying.id,
                auth.user.id,
                "applying",
                "completed",
                &result,
            )
            .await?;
            project_config_now(&state, target_workspace_id).await;
            Ok(Json(operation_response(completed, result)?))
        }
        Err(error) => {
            result.error = Some(ImportErrorResponse {
                code: "invalid_metadata".to_owned(),
                message: "The Workspace could not be restored from this archive".to_owned(),
            });
            warn!(operation_id = %operation_id, %error, "Workspace import apply failed");
            let failed = operation::set_state(
                &state.pool,
                operation_id,
                auth.user.id,
                "applying",
                "failed",
                &result,
            )
            .await?;
            let _ = state.vault.remove_import_staging(staging_key).await;
            Ok(Json(operation_response(failed, result)?))
        }
    }
}

async fn receive_upload(
    multipart: &mut Multipart,
    destination: &PathBuf,
) -> Result<(), ImportArchiveError> {
    let mut found = false;
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .await
        .map_err(|_| ImportArchiveError::Storage)?;
    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|_| ImportArchiveError::InvalidArchive)?
    {
        if field.name() != Some("archive") || found {
            return Err(ImportArchiveError::InvalidArchive);
        }
        found = true;
        let mut size = 0_u64;
        while let Some(chunk) = field
            .chunk()
            .await
            .map_err(|_| ImportArchiveError::InvalidArchive)?
        {
            size = size
                .checked_add(chunk.len() as u64)
                .filter(|size| *size <= MAX_UPLOAD_BYTES)
                .ok_or(ImportArchiveError::LimitExceeded)?;
            file.write_all(&chunk)
                .await
                .map_err(|_| ImportArchiveError::Storage)?;
        }
    }
    if !found {
        return Err(ImportArchiveError::InvalidArchive);
    }
    file.flush()
        .await
        .map_err(|_| ImportArchiveError::Storage)?;
    file.sync_all()
        .await
        .map_err(|_| ImportArchiveError::Storage)
}

async fn apply_validated(
    state: &AppState,
    actor_id: Uuid,
    workspace_id: Uuid,
    staging_key: Uuid,
    validated: ValidatedImport,
) -> anyhow::Result<()> {
    let mut transaction = state.pool.begin().await?;
    sqlx::query("SET CONSTRAINTS ALL DEFERRED")
        .execute(&mut *transaction)
        .await?;
    let mut maps = IdMaps::default();
    map_ids(&validated, &mut maps);
    insert_workspace(&mut transaction, actor_id, workspace_id, &validated, &maps).await?;
    insert_task_configuration(&mut transaction, workspace_id, &validated, &maps).await?;
    insert_projects(&mut transaction, workspace_id, &validated, &maps).await?;
    insert_tasks(&mut transaction, workspace_id, &validated, &maps).await?;
    insert_documents(&mut transaction, workspace_id, &validated, &maps).await?;
    insert_views(&mut transaction, actor_id, workspace_id, &validated, &maps).await?;
    rewrite_task_files(state, staging_key, &validated, &maps).await?;
    state.vault.remove_imported_config(staging_key).await?;
    let activation = state
        .vault
        .activate_imported_workspace(staging_key, workspace_id)
        .await?;
    if let Err(error) = transaction.commit().await {
        state.vault.rollback_import_activation(&activation).await?;
        return Err(error.into());
    }
    if let Err(error) = state.vault.finish_import_activation(staging_key).await {
        warn!(%workspace_id, %error, "failed to remove completed Workspace import staging");
    }
    Ok(())
}

fn map_ids(validated: &ValidatedImport, maps: &mut IdMaps) {
    maps.states.extend(
        validated
            .task_config
            .states
            .iter()
            .map(|state| (state.id, Uuid::new_v4())),
    );
    maps.types.extend(
        validated
            .task_config
            .types
            .iter()
            .map(|task_type| (task_type.id, Uuid::new_v4())),
    );
    maps.labels.extend(
        validated
            .task_config
            .labels
            .iter()
            .map(|label| (label.id, Uuid::new_v4())),
    );
    for project in &validated.projects {
        maps.projects.insert(project.id, Uuid::new_v4());
        maps.cycles.extend(
            project
                .cycles
                .iter()
                .map(|cycle| (cycle.id, Uuid::new_v4())),
        );
        maps.modules.extend(
            project
                .modules
                .iter()
                .map(|module| (module.id, Uuid::new_v4())),
        );
    }
    maps.tasks.extend(
        validated
            .manifest
            .source
            .tasks
            .iter()
            .map(|task| (task.id, Uuid::new_v4())),
    );
    maps.documents.extend(
        validated
            .manifest
            .source
            .documents
            .iter()
            .map(|document| (document.id, Uuid::new_v4())),
    );
}

async fn insert_workspace(
    transaction: &mut Transaction<'_, Postgres>,
    actor_id: Uuid,
    workspace_id: Uuid,
    validated: &ValidatedImport,
    maps: &IdMaps,
) -> anyhow::Result<()> {
    let identifier = WorkspaceIdentifier::from_workspace_id(workspace_id);
    reserve_workspace_identifier(transaction, &identifier, workspace_id).await?;
    let max_number = validated
        .manifest
        .source
        .tasks
        .iter()
        .map(|task| task.number)
        .max()
        .unwrap_or(0);
    sqlx::query(
        r#"
        INSERT INTO workspaces (
            id, name, identifier, accent, default_inbox_state_id, default_task_type_id,
            next_task_number, vault_layout_version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 2)
        "#,
    )
    .bind(workspace_id)
    .bind(&validated.workspace.name)
    .bind(identifier.as_str())
    .bind(&validated.workspace.accent)
    .bind(mapped(&maps.states, validated.workspace.default_state_id)?)
    .bind(mapped(
        &maps.types,
        validated.workspace.default_task_type_id,
    )?)
    .bind(max_number + 1)
    .execute(&mut **transaction)
    .await?;
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
    )
    .bind(workspace_id)
    .bind(actor_id)
    .execute(&mut **transaction)
    .await?;
    sqlx::query(
        r#"
        UPDATE users
        SET active_workspace_id = $1,
            setup_stage = CASE
                WHEN setup_stage IN ('workspace', 'invite') THEN 'invite'
                ELSE setup_stage
            END,
            updated_at = now()
        WHERE id = $2
        "#,
    )
    .bind(workspace_id)
    .bind(actor_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn insert_task_configuration(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    validated: &ValidatedImport,
    maps: &IdMaps,
) -> anyhow::Result<()> {
    for state in &validated.task_config.states {
        sqlx::query(
            r#"
            INSERT INTO task_states (
                id, workspace_id, name, color, state_group, position, archived_at
            ) VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN now() END)
            "#,
        )
        .bind(mapped(&maps.states, state.id)?)
        .bind(workspace_id)
        .bind(&state.name)
        .bind(&state.color)
        .bind(&state.group)
        .bind(state.position)
        .bind(state.archived)
        .execute(&mut **transaction)
        .await?;
    }
    for task_type in &validated.task_config.types {
        sqlx::query(
            r#"
            INSERT INTO task_types (
                id, workspace_id, name, icon, color, description, position,
                is_protected, archived_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9 THEN now() END)
            "#,
        )
        .bind(mapped(&maps.types, task_type.id)?)
        .bind(workspace_id)
        .bind(&task_type.name)
        .bind(&task_type.icon)
        .bind(&task_type.color)
        .bind(&task_type.description)
        .bind(task_type.position)
        .bind(task_type.protected)
        .bind(task_type.archived)
        .execute(&mut **transaction)
        .await?;
    }
    for label in &validated.task_config.labels {
        sqlx::query(
            r#"
            INSERT INTO task_labels (
                id, workspace_id, name, color, description, archived_at
            ) VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() END)
            "#,
        )
        .bind(mapped(&maps.labels, label.id)?)
        .bind(workspace_id)
        .bind(&label.name)
        .bind(&label.color)
        .bind(&label.description)
        .bind(label.archived)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

async fn insert_projects(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    validated: &ValidatedImport,
    maps: &IdMaps,
) -> anyhow::Result<()> {
    for project in &validated.projects {
        let project_id = mapped(&maps.projects, project.id)?;
        sqlx::query(
            r#"
            INSERT INTO projects (
                id, workspace_id, name, storage_name, identifier, description,
                icon, visibility, default_state_id, default_task_type_id,
                cycles_enabled, modules_enabled, pages_enabled, views_enabled,
                archived_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, CASE WHEN $15 THEN now() END
            )
            "#,
        )
        .bind(project_id)
        .bind(workspace_id)
        .bind(&project.name)
        .bind(&project.storage_name)
        .bind(&project.identifier)
        .bind(&project.description)
        .bind(&project.icon)
        .bind(&project.visibility)
        .bind(mapped(&maps.states, project.default_state_id)?)
        .bind(mapped(&maps.types, project.default_task_type_id)?)
        .bind(project.features.cycles)
        .bind(project.features.modules)
        .bind(project.features.wiki)
        .bind(project.features.views)
        .bind(project.archived)
        .execute(&mut **transaction)
        .await?;
        for task_type_id in &project.enabled_task_type_ids {
            sqlx::query(
                "INSERT INTO project_task_types (workspace_id, project_id, task_type_id) VALUES ($1, $2, $3)",
            )
            .bind(workspace_id)
            .bind(project_id)
            .bind(mapped(&maps.types, *task_type_id)?)
            .execute(&mut **transaction)
            .await?;
        }
        for cycle in &project.cycles {
            sqlx::query(
                r#"
                INSERT INTO project_cycles (
                    id, workspace_id, project_id, name, description,
                    start_date, due_date, completed_at, archived_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7,
                    CASE WHEN $8 THEN now() END,
                    CASE WHEN $9 THEN now() END
                )
                "#,
            )
            .bind(mapped(&maps.cycles, cycle.id)?)
            .bind(workspace_id)
            .bind(project_id)
            .bind(&cycle.name)
            .bind(&cycle.description)
            .bind(cycle.start_date)
            .bind(cycle.due_date)
            .bind(cycle.completed)
            .bind(cycle.archived)
            .execute(&mut **transaction)
            .await?;
        }
        for module in &project.modules {
            sqlx::query(
                r#"
                INSERT INTO project_modules (
                    id, workspace_id, project_id, name, description, status,
                    start_date, due_date, archived_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8,
                    CASE WHEN $9 THEN now() END
                )
                "#,
            )
            .bind(mapped(&maps.modules, module.id)?)
            .bind(workspace_id)
            .bind(project_id)
            .bind(&module.name)
            .bind(&module.description)
            .bind(&module.status)
            .bind(module.start_date)
            .bind(module.due_date)
            .bind(module.archived)
            .execute(&mut **transaction)
            .await?;
        }
    }
    Ok(())
}

async fn insert_tasks(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    validated: &ValidatedImport,
    maps: &IdMaps,
) -> anyhow::Result<()> {
    let state_names = active_name_map(
        validated
            .task_config
            .states
            .iter()
            .filter(|state| !state.archived)
            .map(|state| (&state.name, mapped(&maps.states, state.id))),
    )?;
    let type_names = active_name_map(
        validated
            .task_config
            .types
            .iter()
            .filter(|task_type| !task_type.archived)
            .map(|task_type| (&task_type.name, mapped(&maps.types, task_type.id))),
    )?;
    let label_names = active_name_map(
        validated
            .task_config
            .labels
            .iter()
            .filter(|label| !label.archived)
            .map(|label| (&label.name, mapped(&maps.labels, label.id))),
    )?;
    let project_by_old = validated
        .projects
        .iter()
        .map(|project| (project.id, project))
        .collect::<HashMap<_, _>>();
    let mut references = HashMap::new();
    for task in validated.tasks.values() {
        references.insert(task.properties.reference.clone(), task.identity.id);
        let project_id = task
            .identity
            .project_id
            .map(|id| mapped(&maps.projects, id))
            .transpose()?;
        let state_id = by_name(&state_names, &task.properties.state)?;
        let task_type_id = by_name(&type_names, &task.properties.task_type)?;
        sqlx::query(
            r#"
            INSERT INTO tasks (
                id, workspace_id, project_id, title, priority, state_id,
                task_type_id, task_number, start_date, due_date, estimate,
                position, storage_name, archived_at,
                metadata_version, projected_metadata_version
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                $12, $13, CASE WHEN $14 THEN now() END, 1, 1
            )
            "#,
        )
        .bind(mapped(&maps.tasks, task.identity.id)?)
        .bind(workspace_id)
        .bind(project_id)
        .bind(&task.properties.title)
        .bind(priority_value(task.properties.priority.as_deref())?)
        .bind(state_id)
        .bind(task_type_id)
        .bind(task.identity.number)
        .bind(task.properties.start_date)
        .bind(task.properties.due_date)
        .bind(task.properties.estimate)
        .bind(task.identity.position)
        .bind(&task.identity.storage_name)
        .bind(task.identity.archived)
        .execute(&mut **transaction)
        .await?;

        for label in &task.properties.labels {
            sqlx::query(
                "INSERT INTO task_label_assignments (workspace_id, task_id, label_id) VALUES ($1, $2, $3)",
            )
            .bind(workspace_id)
            .bind(mapped(&maps.tasks, task.identity.id)?)
            .bind(by_name(&label_names, label)?)
            .execute(&mut **transaction)
            .await?;
        }
        if let Some(project) = task
            .identity
            .project_id
            .and_then(|id| project_by_old.get(&id).copied())
        {
            if let Some(cycle_name) = &task.properties.cycle {
                let old_cycle = project
                    .cycles
                    .iter()
                    .find(|cycle| !cycle.archived && name_eq(&cycle.name, cycle_name))
                    .ok_or_else(|| anyhow::anyhow!("Task Cycle is missing"))?;
                sqlx::query(
                    "INSERT INTO task_cycle_assignments (workspace_id, project_id, task_id, cycle_id) VALUES ($1, $2, $3, $4)",
                )
                .bind(workspace_id)
                .bind(project_id)
                .bind(mapped(&maps.tasks, task.identity.id)?)
                .bind(mapped(&maps.cycles, old_cycle.id)?)
                .execute(&mut **transaction)
                .await?;
            }
            for module_name in &task.properties.modules {
                let old_module = project
                    .modules
                    .iter()
                    .find(|module| !module.archived && name_eq(&module.name, module_name))
                    .ok_or_else(|| anyhow::anyhow!("Task Module is missing"))?;
                sqlx::query(
                    "INSERT INTO task_module_assignments (workspace_id, project_id, task_id, module_id) VALUES ($1, $2, $3, $4)",
                )
                .bind(workspace_id)
                .bind(project_id)
                .bind(mapped(&maps.tasks, task.identity.id)?)
                .bind(mapped(&maps.modules, old_module.id)?)
                .execute(&mut **transaction)
                .await?;
            }
        }
    }
    for task in validated.tasks.values() {
        let Some(parent_reference) = &task.properties.parent else {
            continue;
        };
        let old_parent_id = references
            .get(parent_reference)
            .copied()
            .ok_or_else(|| anyhow::anyhow!("Task Parent is missing"))?;
        sqlx::query("UPDATE tasks SET parent_id = $1 WHERE workspace_id = $2 AND id = $3")
            .bind(mapped(&maps.tasks, old_parent_id)?)
            .bind(workspace_id)
            .bind(mapped(&maps.tasks, task.identity.id)?)
            .execute(&mut **transaction)
            .await?;
    }
    for relation in &validated.manifest.relations {
        let old_a = relation.task_a_id;
        let old_b = relation.task_b_id;
        let new_a = mapped(&maps.tasks, old_a)?;
        let new_b = mapped(&maps.tasks, old_b)?;
        let (task_a_id, task_b_id, task_a_blocks) = if new_a < new_b {
            (new_a, new_b, relation.task_a_blocks)
        } else {
            (
                new_b,
                new_a,
                relation.task_a_blocks.map(|direction| !direction),
            )
        };
        sqlx::query(
            r#"
            INSERT INTO task_relations (
                workspace_id, task_a_id, task_b_id, relation_type, task_a_blocks
            ) VALUES ($1, $2, $3, $4, $5)
            "#,
        )
        .bind(workspace_id)
        .bind(task_a_id)
        .bind(task_b_id)
        .bind(&relation.relation_type)
        .bind(task_a_blocks)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

async fn insert_documents(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    validated: &ValidatedImport,
    maps: &IdMaps,
) -> anyhow::Result<()> {
    for document in &validated.manifest.source.documents {
        let project_id = document
            .project_id
            .map(|id| mapped(&maps.projects, id))
            .transpose()?;
        sqlx::query(
            r#"
            INSERT INTO documents (
                id, workspace_id, project_id, title, position, storage_name,
                storage_layout_version, archived_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, 1, CASE WHEN $7 THEN now() END
            )
            "#,
        )
        .bind(mapped(&maps.documents, document.id)?)
        .bind(workspace_id)
        .bind(project_id)
        .bind(&document.title)
        .bind(document.position)
        .bind(&document.storage_name)
        .bind(document.archived)
        .execute(&mut **transaction)
        .await?;
    }
    for document in &validated.manifest.source.documents {
        let Some(parent_id) = document.parent_id else {
            continue;
        };
        sqlx::query("UPDATE documents SET parent_id = $1 WHERE workspace_id = $2 AND id = $3")
            .bind(mapped(&maps.documents, parent_id)?)
            .bind(workspace_id)
            .bind(mapped(&maps.documents, document.id)?)
            .execute(&mut **transaction)
            .await?;
    }
    Ok(())
}

async fn insert_views(
    transaction: &mut Transaction<'_, Postgres>,
    actor_id: Uuid,
    workspace_id: Uuid,
    validated: &ValidatedImport,
    maps: &IdMaps,
) -> anyhow::Result<()> {
    for view in &validated.views.views {
        let project_id = view
            .project_id
            .map(|id| mapped(&maps.projects, id))
            .transpose()?;
        let query: TaskQuery = serde_json::from_value(view.query.clone())?;
        let query = remap_query(query, maps)?;
        sqlx::query(
            r#"
            INSERT INTO saved_views (
                id, workspace_id, project_id, owner_id, name, visibility,
                query_version, query, layout
            ) VALUES ($1, $2, $3, $4, $5, 'shared', 1, $6, $7)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(workspace_id)
        .bind(project_id)
        .bind(actor_id)
        .bind(&view.name)
        .bind(sqlx::types::Json(query))
        .bind(&view.layout)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

async fn rewrite_task_files(
    state: &AppState,
    staging_key: Uuid,
    validated: &ValidatedImport,
    maps: &IdMaps,
) -> anyhow::Result<()> {
    let staging = state.vault.import_staging_vault(staging_key).await?;
    for task in validated.tasks.values() {
        let source = tokio::fs::read_to_string(staging.join(task.path.display())).await?;
        let mut properties: TaskProperties = task.properties.clone();
        properties.kanleaf_id = mapped(&maps.tasks, task.identity.id)?;
        properties.assignees.clear();
        let patched = remap_task_identity(&source, task.identity.id, &properties)?;
        state
            .vault
            .write_imported_task(staging_key, &task.path, &patched)
            .await?;
    }
    Ok(())
}

fn remap_query(mut query: TaskQuery, maps: &IdMaps) -> anyhow::Result<TaskQuery> {
    query.scope = match query.scope {
        TaskQueryScope::Project { project_id } => TaskQueryScope::Project {
            project_id: mapped(&maps.projects, project_id)?,
        },
        TaskQueryScope::Cycle { cycle_id } => TaskQueryScope::Cycle {
            cycle_id: mapped(&maps.cycles, cycle_id)?,
        },
        TaskQueryScope::Module { module_id } => TaskQueryScope::Module {
            module_id: mapped(&maps.modules, module_id)?,
        },
        scope => scope,
    };
    remap_filter(&mut query.filters.states, &maps.states)?;
    remap_filter(&mut query.filters.task_types, &maps.types)?;
    remap_filter(&mut query.filters.labels, &maps.labels)?;
    remap_filter(&mut query.filters.projects, &maps.projects)?;
    remap_filter(&mut query.filters.cycles, &maps.cycles)?;
    remap_filter(&mut query.filters.modules, &maps.modules)?;
    query.filters.assignees.values.clear();
    Ok(query)
}

fn remap_filter(filter: &mut IdFilter, map: &HashMap<Uuid, Uuid>) -> anyhow::Result<()> {
    filter.values = filter
        .values
        .iter()
        .map(|id| mapped(map, *id))
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(())
}

fn active_name_map<'a>(
    values: impl Iterator<Item = (&'a String, anyhow::Result<Uuid>)>,
) -> anyhow::Result<HashMap<String, Uuid>> {
    values
        .map(|(name, id)| Ok((name.trim().to_lowercase(), id?)))
        .collect()
}

fn by_name(values: &HashMap<String, Uuid>, name: &str) -> anyhow::Result<Uuid> {
    values
        .get(&name.trim().to_lowercase())
        .copied()
        .ok_or_else(|| anyhow::anyhow!("Portable vocabulary name is missing"))
}

fn priority_value(priority: Option<&str>) -> anyhow::Result<&'static str> {
    let priority = match priority.map(str::trim).map(str::to_lowercase).as_deref() {
        None | Some("none") => TaskPriority::None,
        Some("low") => TaskPriority::Low,
        Some("medium") => TaskPriority::Medium,
        Some("high") => TaskPriority::High,
        Some("urgent") => TaskPriority::Urgent,
        Some(_) => return Err(anyhow::anyhow!("Portable Task Priority is invalid")),
    };
    Ok(match priority {
        TaskPriority::None => "none",
        TaskPriority::Low => "low",
        TaskPriority::Medium => "medium",
        TaskPriority::High => "high",
        TaskPriority::Urgent => "urgent",
    })
}

fn mapped(map: &HashMap<Uuid, Uuid>, id: Uuid) -> anyhow::Result<Uuid> {
    map.get(&id)
        .copied()
        .ok_or_else(|| anyhow::anyhow!("Portable identity is missing"))
}

fn name_eq(left: &str, right: &str) -> bool {
    left.trim().eq_ignore_ascii_case(right.trim())
}

fn parse_result(operation: &OperationRow) -> Result<StoredImportResult, AppError> {
    serde_json::from_value(operation.result.clone()).map_err(AppError::internal)
}

fn operation_response(
    operation: OperationRow,
    result: StoredImportResult,
) -> Result<ImportOperationResponse, AppError> {
    Ok(ImportOperationResponse {
        id: operation.id,
        state: operation.state,
        revision: operation.revision,
        expires_at: operation.expires_at,
        created_at: operation.created_at,
        updated_at: operation.updated_at,
        summary: result.summary,
        workspace_id: result.target_workspace_id,
        error: result.error,
    })
}

pub async fn recover_import_operations(state: &AppState) -> anyhow::Result<()> {
    let interrupted: Vec<(Uuid, String, Option<Uuid>, Value)> = sqlx::query_as(
        r#"
        SELECT id, state, staging_key, result
        FROM workspace_operations
        WHERE kind = 'workspace_import' AND state IN ('preparing', 'applying')
        "#,
    )
    .fetch_all(&state.pool)
    .await?;
    for (operation_id, operation_state, staging_key, value) in interrupted {
        let mut result: StoredImportResult = serde_json::from_value(value)?;
        let exists = match (operation_state.as_str(), result.target_workspace_id) {
            ("preparing", _) | ("applying", None) => false,
            ("applying", Some(workspace_id)) => {
                let database_exists: bool =
                    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = $1)")
                        .bind(workspace_id)
                        .fetch_one(&state.pool)
                        .await?;
                let vault_exists = state.vault.imported_workspace_exists(workspace_id).await?;
                if database_exists && !vault_exists {
                    anyhow::bail!("restored Workspace is missing its vault");
                }
                if !database_exists && vault_exists {
                    state
                        .vault
                        .remove_orphaned_import_workspace(workspace_id)
                        .await?;
                }
                database_exists && vault_exists
            }
            _ => false,
        };
        if let Some(staging_key) = staging_key {
            state.vault.remove_import_staging(staging_key).await?;
        }
        let target_state = if exists { "completed" } else { "failed" };
        if !exists {
            result.error = Some(ImportErrorResponse {
                code: "interrupted".to_owned(),
                message: "Workspace import was interrupted; upload the archive again".to_owned(),
            });
        }
        operation::recover_state(
            &state.pool,
            operation_id,
            &operation_state,
            target_state,
            &result,
        )
        .await?;
    }
    cleanup_expired_imports(state).await
}

async fn cleanup_expired_imports(state: &AppState) -> anyhow::Result<()> {
    let expired: Vec<Option<Uuid>> = sqlx::query_scalar(
        r#"
        SELECT staging_key FROM workspace_operations
        WHERE kind = 'workspace_import' AND expires_at <= now()
        "#,
    )
    .fetch_all(&state.pool)
    .await?;
    for staging_key in expired.into_iter().flatten() {
        state.vault.remove_import_staging(staging_key).await?;
    }
    sqlx::query(
        "DELETE FROM workspace_operations WHERE kind = 'workspace_import' AND expires_at <= now()",
    )
    .execute(&state.pool)
    .await?;
    Ok(())
}

pub fn spawn_import_cleanup_worker(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5 * 60));
        interval.tick().await;
        loop {
            interval.tick().await;
            if let Err(error) = cleanup_expired_imports(&state).await {
                warn!(%error, "Workspace import cleanup worker failed");
            }
        }
    });
}
