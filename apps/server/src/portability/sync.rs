use std::collections::{HashMap, HashSet};

use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection, rejection::PathRejection},
    http::StatusCode,
    routing::post,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    domain::{NormalizedEmail, TaskPriority, TaskTitle},
    error::AppError,
    task::{TaskProperties, UpdateTaskRequest, read_task_properties, task_vault_row, update_task},
    vault::{ScannedTaskFile, TaskVaultScanIssueKind},
    workspace::require_workspace_admin,
};

use super::operation::{self, OperationRow};

const SYNC_KIND: &str = "vault_sync";

#[derive(Clone, Debug, Deserialize, Serialize)]
struct StoredSyncResult {
    items: Vec<StoredSyncItem>,
    issues: Vec<SyncIssue>,
    applied_task_ids: Vec<Uuid>,
    error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct StoredSyncItem {
    task_id: Uuid,
    reference: String,
    title: String,
    path: Option<String>,
    status: SyncItemStatus,
    changes: Vec<String>,
    message: Option<String>,
    source_revision: Option<String>,
    metadata_version: i64,
    update: Option<ResolvedTaskUpdate>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum SyncItemStatus {
    Valid,
    Unchanged,
    Invalid,
    Conflict,
    Missing,
    Moved,
    Duplicate,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ResolvedTaskUpdate {
    title: String,
    state_id: Uuid,
    task_type_id: Uuid,
    priority: TaskPriority,
    project_id: Option<Uuid>,
    start_date: Option<NaiveDate>,
    due_date: Option<NaiveDate>,
    estimate: Option<i32>,
    parent_id: Option<Uuid>,
    assignee_ids: Vec<Uuid>,
    label_ids: Vec<Uuid>,
    cycle_id: Option<Uuid>,
    module_ids: Vec<Uuid>,
}

impl ResolvedTaskUpdate {
    fn into_request(self) -> UpdateTaskRequest {
        UpdateTaskRequest {
            title: Some(self.title),
            state_id: Some(self.state_id),
            task_type_id: Some(self.task_type_id),
            priority: Some(self.priority),
            project_id: Some(self.project_id),
            start_date: Some(self.start_date),
            due_date: Some(self.due_date),
            estimate: Some(self.estimate),
            parent_id: Some(self.parent_id),
            assignee_ids: Some(self.assignee_ids),
            label_ids: Some(self.label_ids),
            cycle_id: Some(self.cycle_id),
            module_ids: Some(self.module_ids),
            cleanup_invalid: false,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct SyncIssue {
    kind: String,
    path: String,
    message: String,
}

#[derive(Serialize)]
struct SyncOperationResponse {
    id: Uuid,
    workspace_id: Uuid,
    state: String,
    revision: Uuid,
    expires_at: DateTime<Utc>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    items: Vec<SyncItemResponse>,
    issues: Vec<SyncIssue>,
    applied_task_ids: Vec<Uuid>,
    error: Option<String>,
}

#[derive(Serialize)]
struct SyncItemResponse {
    task_id: Uuid,
    reference: String,
    title: String,
    path: Option<String>,
    status: SyncItemStatus,
    changes: Vec<String>,
    message: Option<String>,
    source_revision: Option<String>,
    metadata_version: i64,
}

#[derive(Deserialize)]
struct ApplySyncRequest {
    revision: Uuid,
    task_ids: Vec<Uuid>,
}

#[derive(FromRow)]
struct TaskVersionRow {
    id: Uuid,
    metadata_version: i64,
    projected_metadata_version: i64,
    archived_at: Option<DateTime<Utc>>,
}

struct ScannedProperties {
    file: ScannedTaskFile,
    properties: TaskProperties,
}

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/workspaces/{workspace_id}/vault-syncs/preview",
            post(preview),
        )
        .route(
            "/api/workspaces/{workspace_id}/vault-syncs/{operation_id}",
            axum::routing::get(get_operation).delete(cancel),
        )
        .route(
            "/api/workspaces/{workspace_id}/vault-syncs/{operation_id}/apply",
            post(apply),
        )
}

async fn preview(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<(StatusCode, Json<SyncOperationResponse>), AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let result = build_preview(&state, workspace_id).await?;
    let operation =
        operation::create(&state.pool, auth.user.id, workspace_id, SYNC_KIND, &result).await?;
    Ok((
        StatusCode::CREATED,
        Json(operation_response(operation, result)?),
    ))
}

async fn get_operation(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<SyncOperationResponse>, AppError> {
    let Path((workspace_id, operation_id)) = path.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let operation = operation::load_scoped(
        &state.pool,
        operation_id,
        auth.user.id,
        workspace_id,
        SYNC_KIND,
    )
    .await?;
    let result = parse_result(&operation)?;
    Ok(Json(operation_response(operation, result)?))
}

async fn cancel(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, operation_id)) = path.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    operation::delete_scoped(
        &state.pool,
        operation_id,
        auth.user.id,
        workspace_id,
        SYNC_KIND,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn apply(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<ApplySyncRequest>, JsonRejection>,
) -> Result<Json<SyncOperationResponse>, AppError> {
    let Path((workspace_id, operation_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let operation = operation::load_scoped(
        &state.pool,
        operation_id,
        auth.user.id,
        workspace_id,
        SYNC_KIND,
    )
    .await?;
    if operation.state != "ready" || operation.revision != request.revision {
        return Err(AppError::StalePreview(
            "Vault sync preview changed or expired".to_owned(),
        ));
    }
    let mut result = parse_result(&operation)?;
    let selected = unique_selection(&request.task_ids)?;
    let selected_items = selected
        .iter()
        .map(|task_id| {
            result
                .items
                .iter()
                .find(|item| item.task_id == *task_id && item.status == SyncItemStatus::Valid)
                .cloned()
                .ok_or_else(|| {
                    AppError::Validation(
                        "Only valid Tasks from this preview can be selected".to_owned(),
                    )
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    recheck_selection(&state, workspace_id, &selected_items).await?;

    let applying = operation::set_state(
        &state.pool,
        operation_id,
        auth.user.id,
        "ready",
        "applying",
        &result,
    )
    .await?;
    for item in selected_items {
        let update = item.update.ok_or_else(|| {
            AppError::internal(anyhow::anyhow!("valid sync item has no resolved update"))
        })?;
        if update_task(
            &state,
            auth.user.id,
            workspace_id,
            item.task_id,
            update.into_request(),
        )
        .await
        .is_err()
        {
            result.error = Some("A selected Task could not be applied".to_owned());
            let failed = operation::set_state(
                &state.pool,
                operation_id,
                auth.user.id,
                "applying",
                "failed",
                &result,
            )
            .await?;
            return Ok(Json(operation_response(failed, result)?));
        }
        result.applied_task_ids.push(item.task_id);
    }
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
    Ok(Json(operation_response(completed, result)?))
}

async fn build_preview(state: &AppState, workspace_id: Uuid) -> Result<StoredSyncResult, AppError> {
    let project_storage_names: Vec<String> = sqlx::query_scalar(
        "SELECT storage_name FROM projects WHERE workspace_id = $1 ORDER BY storage_name",
    )
    .bind(workspace_id)
    .fetch_all(&state.pool)
    .await?;
    let scan = state
        .vault
        .scan_task_documents(workspace_id, &project_storage_names)
        .await
        .map_err(|_| AppError::VaultUnavailable)?;
    let mut issues = scan
        .issues
        .into_iter()
        .map(|issue| SyncIssue {
            kind: scan_issue_kind(issue.kind).to_owned(),
            path: issue.relative_path,
            message: "This entry is outside Kanleaf's managed Task layout".to_owned(),
        })
        .collect::<Vec<_>>();
    let mut files_by_id: HashMap<Uuid, Vec<ScannedProperties>> = HashMap::new();
    for file in scan.files {
        match read_task_properties(&file.document.content) {
            Ok(properties) => files_by_id
                .entry(properties.kanleaf_id)
                .or_default()
                .push(ScannedProperties { file, properties }),
            Err(_) => issues.push(SyncIssue {
                kind: "malformed_frontmatter".to_owned(),
                path: file.relative_path,
                message: "Task properties are not valid Kanleaf YAML".to_owned(),
            }),
        }
    }

    let versions = sqlx::query_as::<_, TaskVersionRow>(
        r#"
        SELECT id, metadata_version, projected_metadata_version, archived_at
        FROM tasks
        WHERE workspace_id = $1
        ORDER BY id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&state.pool)
    .await?;
    let expected_ids = versions.iter().map(|row| row.id).collect::<HashSet<_>>();
    for (task_id, files) in &files_by_id {
        if !expected_ids.contains(task_id) {
            for file in files {
                issues.push(SyncIssue {
                    kind: "unknown_task".to_owned(),
                    path: file.file.relative_path.clone(),
                    message: "No active Task owns this Kanleaf ID".to_owned(),
                });
            }
        }
    }

    let mut transaction = state.pool.begin().await?;
    let mut items = Vec::with_capacity(versions.len());
    for version in versions {
        let canonical_row =
            task_vault_row(&mut transaction, workspace_id, version.id, true).await?;
        let canonical = canonical_row.properties();
        let expected_path = canonical_row.path()?;
        let files = files_by_id.remove(&version.id).unwrap_or_default();
        let mut item = StoredSyncItem {
            task_id: version.id,
            reference: canonical.reference.clone(),
            title: canonical.title.clone(),
            path: Some(expected_path.display()),
            status: SyncItemStatus::Missing,
            changes: Vec::new(),
            message: Some("The canonical Task file is missing".to_owned()),
            source_revision: None,
            metadata_version: version.metadata_version,
            update: None,
        };
        if files.len() > 1 {
            item.status = SyncItemStatus::Duplicate;
            item.message = Some("Multiple files claim this Kanleaf ID".to_owned());
            item.path = None;
        } else if let Some(scanned) = files.into_iter().next() {
            item.path = Some(scanned.file.relative_path.clone());
            item.source_revision = Some(scanned.file.document.revision.clone());
            if scanned.file.path != expected_path {
                item.status = SyncItemStatus::Moved;
                item.message = Some("Task files cannot be moved manually".to_owned());
            } else if version.metadata_version != version.projected_metadata_version {
                item.status = SyncItemStatus::Conflict;
                item.message = Some("Kanleaf metadata has a pending projection".to_owned());
            } else if scanned.properties.reference != canonical.reference {
                item.status = SyncItemStatus::Conflict;
                item.message = Some("Reference is a Kanleaf-managed property".to_owned());
            } else {
                item.changes = changed_fields(&canonical, &scanned.properties);
                if item.changes.is_empty() {
                    item.status = SyncItemStatus::Unchanged;
                    item.message = None;
                } else if version.archived_at.is_some() {
                    item.status = SyncItemStatus::Invalid;
                    item.message = Some("Archived Tasks cannot import metadata".to_owned());
                } else {
                    match resolve_update(&state.pool, workspace_id, version.id, &scanned.properties)
                        .await
                    {
                        Ok(update) => {
                            item.status = SyncItemStatus::Valid;
                            item.message = None;
                            item.update = Some(update);
                        }
                        Err(message) => {
                            item.status = SyncItemStatus::Invalid;
                            item.message = Some(message);
                        }
                    }
                }
            }
        }
        items.push(item);
    }
    transaction.commit().await?;
    Ok(StoredSyncResult {
        items,
        issues,
        applied_task_ids: Vec::new(),
        error: None,
    })
}

async fn resolve_update(
    pool: &PgPool,
    workspace_id: Uuid,
    task_id: Uuid,
    properties: &TaskProperties,
) -> Result<ResolvedTaskUpdate, String> {
    let title = TaskTitle::new(&properties.title)
        .map_err(|error| error.to_string())?
        .as_str()
        .to_owned();
    if properties
        .start_date
        .zip(properties.due_date)
        .is_some_and(|(start, due)| start > due)
    {
        return Err("Due date cannot be before the start date".to_owned());
    }
    if properties.estimate.is_some_and(|estimate| estimate < 0) {
        return Err("Estimate cannot be negative".to_owned());
    }
    let project_id = resolve_optional_name(
        pool,
        "SELECT id FROM projects WHERE workspace_id = $1 AND lower(name) = lower($2) AND archived_at IS NULL",
        workspace_id,
        properties.project.as_deref(),
        "Project",
    )
    .await?;
    let state_id = resolve_required_name(
        pool,
        "SELECT id FROM task_states WHERE workspace_id = $1 AND lower(name) = lower($2) AND archived_at IS NULL",
        workspace_id,
        &properties.state,
        "State",
    )
    .await?;
    let task_type_id = resolve_required_name(
        pool,
        "SELECT id FROM task_types WHERE workspace_id = $1 AND lower(name) = lower($2) AND archived_at IS NULL",
        workspace_id,
        &properties.task_type,
        "Type",
    )
    .await?;
    if let Some(project_id) = project_id {
        let enabled: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM project_task_types
                WHERE workspace_id = $1 AND project_id = $2 AND task_type_id = $3
            )
            "#,
        )
        .bind(workspace_id)
        .bind(project_id)
        .bind(task_type_id)
        .fetch_one(pool)
        .await
        .map_err(|_| "Type availability could not be checked".to_owned())?;
        if !enabled {
            return Err("Type is not enabled in the selected Project".to_owned());
        }
    }
    let priority = parse_priority(properties.priority.as_deref())?;
    let assignee_ids = resolve_assignees(pool, workspace_id, &properties.assignees).await?;
    let valid_assignee_count: i64 = sqlx::query_scalar(
        r#"
        SELECT count(*)
        FROM workspace_memberships AS memberships
        WHERE memberships.workspace_id = $1
          AND memberships.user_id = ANY($2)
          AND (
              ($3::uuid IS NULL AND memberships.role <> 'guest')
              OR memberships.role IN ('owner', 'admin')
              OR EXISTS(
                  SELECT 1 FROM project_memberships
                  WHERE project_memberships.workspace_id = memberships.workspace_id
                    AND project_memberships.project_id = $3
                    AND project_memberships.user_id = memberships.user_id
              )
          )
        "#,
    )
    .bind(workspace_id)
    .bind(&assignee_ids)
    .bind(project_id)
    .fetch_one(pool)
    .await
    .map_err(|_| "Assignee availability could not be checked".to_owned())?;
    if usize::try_from(valid_assignee_count).ok() != Some(assignee_ids.len()) {
        return Err("An Assignee is not available in the selected Project".to_owned());
    }
    let label_ids = resolve_many_names(
        pool,
        "SELECT id FROM task_labels WHERE workspace_id = $1 AND lower(name) = lower($2) AND archived_at IS NULL",
        workspace_id,
        &properties.labels,
        "Label",
    )
    .await?;
    let cycle_id = match (project_id, properties.cycle.as_deref()) {
        (_, None) => None,
        (Some(project_id), Some(name)) => Some(
            sqlx::query_scalar(
                "SELECT id FROM project_cycles WHERE workspace_id = $1 AND project_id = $2 AND lower(name) = lower($3) AND archived_at IS NULL",
            )
            .bind(workspace_id)
            .bind(project_id)
            .bind(name)
            .fetch_optional(pool)
            .await
            .map_err(|_| "Cycle could not be resolved".to_owned())?
            .ok_or_else(|| "Cycle is not active in the selected Project".to_owned())?,
        ),
        (None, Some(_)) => return Err("Inbox Tasks cannot have a Cycle".to_owned()),
    };
    let module_ids = match project_id {
        Some(project_id) => {
            resolve_project_names(pool, workspace_id, project_id, &properties.modules).await?
        }
        None if properties.modules.is_empty() => Vec::new(),
        None => return Err("Inbox Tasks cannot have Modules".to_owned()),
    };
    let parent_id = resolve_parent(pool, workspace_id, properties.parent.as_deref()).await?;
    validate_parent_change(pool, workspace_id, task_id, project_id, parent_id).await?;
    let current_project_id: Option<Uuid> =
        sqlx::query_scalar("SELECT project_id FROM tasks WHERE workspace_id = $1 AND id = $2")
            .bind(workspace_id)
            .bind(task_id)
            .fetch_one(pool)
            .await
            .map_err(|_| "Task location could not be checked".to_owned())?;
    if current_project_id != project_id {
        let incompatible_children: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM tasks
                WHERE workspace_id = $1 AND parent_id = $2
                  AND project_id IS DISTINCT FROM $3 AND archived_at IS NULL
            )
            "#,
        )
        .bind(workspace_id)
        .bind(task_id)
        .bind(project_id)
        .fetch_one(pool)
        .await
        .map_err(|_| "Task hierarchy could not be checked".to_owned())?;
        if incompatible_children {
            return Err("Move subtasks before changing this Task's Project".to_owned());
        }
    }
    Ok(ResolvedTaskUpdate {
        title,
        state_id,
        task_type_id,
        priority,
        project_id,
        start_date: properties.start_date,
        due_date: properties.due_date,
        estimate: properties.estimate,
        parent_id,
        assignee_ids,
        label_ids,
        cycle_id,
        module_ids,
    })
}

async fn validate_parent_change(
    pool: &PgPool,
    workspace_id: Uuid,
    task_id: Uuid,
    project_id: Option<Uuid>,
    parent_id: Option<Uuid>,
) -> Result<(), String> {
    let Some(parent_id) = parent_id else {
        return Ok(());
    };
    if parent_id == task_id {
        return Err("A Task cannot be its own Parent".to_owned());
    }
    let valid_location: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM tasks
            WHERE workspace_id = $1 AND id = $2
              AND project_id IS NOT DISTINCT FROM $3 AND archived_at IS NULL
        )
        "#,
    )
    .bind(workspace_id)
    .bind(parent_id)
    .bind(project_id)
    .fetch_one(pool)
    .await
    .map_err(|_| "Parent location could not be checked".to_owned())?;
    if !valid_location {
        return Err("Parent must be in the selected Task location".to_owned());
    }
    let creates_cycle: bool = sqlx::query_scalar(
        r#"
        WITH RECURSIVE ancestors AS (
            SELECT id, parent_id FROM tasks
            WHERE workspace_id = $1 AND id = $2
            UNION ALL
            SELECT tasks.id, tasks.parent_id
            FROM tasks
            JOIN ancestors ON tasks.id = ancestors.parent_id
            WHERE tasks.workspace_id = $1
        )
        SELECT EXISTS(SELECT 1 FROM ancestors WHERE id = $3)
        "#,
    )
    .bind(workspace_id)
    .bind(parent_id)
    .bind(task_id)
    .fetch_one(pool)
    .await
    .map_err(|_| "Parent hierarchy could not be checked".to_owned())?;
    if creates_cycle {
        return Err("Parent would create a Task hierarchy cycle".to_owned());
    }
    Ok(())
}

async fn recheck_selection(
    state: &AppState,
    workspace_id: Uuid,
    items: &[StoredSyncItem],
) -> Result<(), AppError> {
    let mut transaction = state.pool.begin().await?;
    for item in items {
        let version: i64 = sqlx::query_scalar(
            "SELECT metadata_version FROM tasks WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL",
        )
        .bind(workspace_id)
        .bind(item.task_id)
        .fetch_optional(&mut *transaction)
        .await?
            .ok_or_else(|| AppError::StalePreview("A selected Task no longer exists".to_owned()))?;
        if version != item.metadata_version {
            return Err(AppError::StalePreview(
                "A selected Task changed after the preview".to_owned(),
            ));
        }
        let path = task_vault_row(&mut transaction, workspace_id, item.task_id, false)
            .await?
            .path()?;
        let document = state
            .vault
            .read_task_document(workspace_id, &path)
            .await
            .map_err(|_| AppError::VaultUnavailable)?;
        if item.source_revision.as_deref() != Some(document.revision.as_str()) {
            return Err(AppError::StalePreview(
                "A selected Task file changed after the preview".to_owned(),
            ));
        }
    }
    transaction.commit().await?;
    Ok(())
}

fn changed_fields(canonical: &TaskProperties, external: &TaskProperties) -> Vec<String> {
    let mut fields = Vec::new();
    if canonical.title != external.title {
        fields.push("title");
    }
    if !optional_name_eq(canonical.project.as_deref(), external.project.as_deref()) {
        fields.push("project");
    }
    if !name_eq(&canonical.state, &external.state) {
        fields.push("state");
    }
    if !name_eq(&canonical.task_type, &external.task_type) {
        fields.push("type");
    }
    if !optional_name_eq(canonical.priority.as_deref(), external.priority.as_deref()) {
        fields.push("priority");
    }
    if !name_lists_eq(&canonical.assignees, &external.assignees) {
        fields.push("assignees");
    }
    if !name_lists_eq(&canonical.labels, &external.labels) {
        fields.push("labels");
    }
    if !optional_name_eq(canonical.cycle.as_deref(), external.cycle.as_deref()) {
        fields.push("cycle");
    }
    if !name_lists_eq(&canonical.modules, &external.modules) {
        fields.push("modules");
    }
    if canonical.start_date != external.start_date {
        fields.push("start_date");
    }
    if canonical.due_date != external.due_date {
        fields.push("due_date");
    }
    if canonical.estimate != external.estimate {
        fields.push("estimate");
    }
    if !optional_name_eq(canonical.parent.as_deref(), external.parent.as_deref()) {
        fields.push("parent");
    }
    fields.into_iter().map(str::to_owned).collect()
}

fn name_eq(left: &str, right: &str) -> bool {
    left.trim().eq_ignore_ascii_case(right.trim())
}

fn optional_name_eq(left: Option<&str>, right: Option<&str>) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => name_eq(left, right),
        (None, None) => true,
        _ => false,
    }
}

fn name_lists_eq(left: &[String], right: &[String]) -> bool {
    let mut left = left
        .iter()
        .map(|value| value.trim().to_lowercase())
        .collect::<Vec<_>>();
    let mut right = right
        .iter()
        .map(|value| value.trim().to_lowercase())
        .collect::<Vec<_>>();
    left.sort_unstable();
    right.sort_unstable();
    left == right
}

async fn resolve_required_name(
    pool: &PgPool,
    query: &str,
    workspace_id: Uuid,
    value: &str,
    kind: &str,
) -> Result<Uuid, String> {
    sqlx::query_scalar(query)
        .bind(workspace_id)
        .bind(value)
        .fetch_optional(pool)
        .await
        .map_err(|_| format!("{kind} could not be resolved"))?
        .ok_or_else(|| format!("{kind} is not active in this Workspace"))
}

async fn resolve_optional_name(
    pool: &PgPool,
    query: &str,
    workspace_id: Uuid,
    value: Option<&str>,
    kind: &str,
) -> Result<Option<Uuid>, String> {
    match value {
        Some(value) => resolve_required_name(pool, query, workspace_id, value, kind)
            .await
            .map(Some),
        None => Ok(None),
    }
}

async fn resolve_many_names(
    pool: &PgPool,
    query: &str,
    workspace_id: Uuid,
    values: &[String],
    kind: &str,
) -> Result<Vec<Uuid>, String> {
    reject_duplicate_names(values, kind)?;
    let mut ids = Vec::with_capacity(values.len());
    for value in values {
        ids.push(resolve_required_name(pool, query, workspace_id, value, kind).await?);
    }
    Ok(ids)
}

async fn resolve_assignees(
    pool: &PgPool,
    workspace_id: Uuid,
    values: &[String],
) -> Result<Vec<Uuid>, String> {
    reject_duplicate_names(values, "Assignee")?;
    let mut ids = Vec::with_capacity(values.len());
    for value in values {
        let email =
            NormalizedEmail::new(value).map_err(|_| "Assignee email is invalid".to_owned())?;
        let id = sqlx::query_scalar(
            r#"
            SELECT users.id FROM users
            JOIN workspace_memberships AS memberships ON memberships.user_id = users.id
            WHERE memberships.workspace_id = $1 AND users.email = $2
            "#,
        )
        .bind(workspace_id)
        .bind(email.as_str())
        .fetch_optional(pool)
        .await
        .map_err(|_| "Assignee could not be resolved".to_owned())?
        .ok_or_else(|| "Assignee is not a Workspace member".to_owned())?;
        ids.push(id);
    }
    Ok(ids)
}

async fn resolve_project_names(
    pool: &PgPool,
    workspace_id: Uuid,
    project_id: Uuid,
    values: &[String],
) -> Result<Vec<Uuid>, String> {
    reject_duplicate_names(values, "Module")?;
    let mut ids = Vec::with_capacity(values.len());
    for value in values {
        let id = sqlx::query_scalar(
            r#"
            SELECT id FROM project_modules
            WHERE workspace_id = $1 AND project_id = $2
              AND lower(name) = lower($3) AND archived_at IS NULL
            "#,
        )
        .bind(workspace_id)
        .bind(project_id)
        .bind(value)
        .fetch_optional(pool)
        .await
        .map_err(|_| "Module could not be resolved".to_owned())?
        .ok_or_else(|| "Module is not active in the selected Project".to_owned())?;
        ids.push(id);
    }
    Ok(ids)
}

async fn resolve_parent(
    pool: &PgPool,
    workspace_id: Uuid,
    reference: Option<&str>,
) -> Result<Option<Uuid>, String> {
    let Some(reference) = reference else {
        return Ok(None);
    };
    sqlx::query_scalar(
        r#"
        SELECT tasks.id
        FROM tasks
        LEFT JOIN projects ON projects.id = tasks.project_id
        WHERE tasks.workspace_id = $1 AND tasks.archived_at IS NULL
          AND CASE WHEN projects.identifier IS NULL
                   THEN '#' || tasks.task_number::text
                   ELSE projects.identifier || '-' || tasks.task_number::text
              END = $2
        "#,
    )
    .bind(workspace_id)
    .bind(reference.trim())
    .fetch_optional(pool)
    .await
    .map_err(|_| "Parent could not be resolved".to_owned())?
    .map(Some)
    .ok_or_else(|| "Parent reference does not identify an active Task".to_owned())
}

fn parse_priority(value: Option<&str>) -> Result<TaskPriority, String> {
    match value.map(str::trim).map(str::to_lowercase).as_deref() {
        None | Some("none") => Ok(TaskPriority::None),
        Some("low") => Ok(TaskPriority::Low),
        Some("medium") => Ok(TaskPriority::Medium),
        Some("high") => Ok(TaskPriority::High),
        Some("urgent") => Ok(TaskPriority::Urgent),
        Some(_) => Err("Priority is not supported".to_owned()),
    }
}

fn reject_duplicate_names(values: &[String], kind: &str) -> Result<(), String> {
    let unique = values
        .iter()
        .map(|value| value.trim().to_lowercase())
        .collect::<HashSet<_>>();
    if unique.len() != values.len() {
        return Err(format!("{kind} values cannot contain duplicates"));
    }
    Ok(())
}

fn unique_selection(task_ids: &[Uuid]) -> Result<HashSet<Uuid>, AppError> {
    if task_ids.is_empty() || task_ids.len() > 100 {
        return Err(AppError::Validation(
            "Select between 1 and 100 Tasks to sync".to_owned(),
        ));
    }
    let unique = task_ids.iter().copied().collect::<HashSet<_>>();
    if unique.len() != task_ids.len() {
        return Err(AppError::Validation(
            "Vault sync selection cannot contain duplicates".to_owned(),
        ));
    }
    Ok(unique)
}

fn scan_issue_kind(kind: TaskVaultScanIssueKind) -> &'static str {
    match kind {
        TaskVaultScanIssueKind::InvalidEntry => "invalid_entry",
        TaskVaultScanIssueKind::UnmanagedEntry => "unmanaged_entry",
        TaskVaultScanIssueKind::UnknownProject => "unknown_project",
        TaskVaultScanIssueKind::OversizedFile => "oversized_file",
    }
}

fn parse_result(operation: &OperationRow) -> Result<StoredSyncResult, AppError> {
    serde_json::from_value(operation.result.clone()).map_err(AppError::internal)
}

fn operation_response(
    operation: OperationRow,
    result: StoredSyncResult,
) -> Result<SyncOperationResponse, AppError> {
    let workspace_id = operation.workspace_id.ok_or_else(|| {
        AppError::internal(anyhow::anyhow!("vault sync operation has no Workspace"))
    })?;
    Ok(SyncOperationResponse {
        id: operation.id,
        workspace_id,
        state: operation.state,
        revision: operation.revision,
        expires_at: operation.expires_at,
        created_at: operation.created_at,
        updated_at: operation.updated_at,
        items: result
            .items
            .into_iter()
            .map(|item| SyncItemResponse {
                task_id: item.task_id,
                reference: item.reference,
                title: item.title,
                path: item.path,
                status: item.status,
                changes: item.changes,
                message: item.message,
                source_revision: item.source_revision,
                metadata_version: item.metadata_version,
            })
            .collect(),
        issues: result.issues,
        applied_task_ids: result.applied_task_ids,
        error: result.error,
    })
}
