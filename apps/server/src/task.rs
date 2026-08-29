mod model;
mod planning;
mod query_engine;

use std::collections::HashSet;

use axum::{
    Json,
    extract::{
        Path, Query, State, rejection::JsonRejection, rejection::PathRejection,
        rejection::QueryRejection,
    },
    http::StatusCode,
};
use chrono::NaiveDate;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use tracing::warn;
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    collaboration::{notify_assignments, notify_task_change, record_activity, subscribe},
    domain::{TaskPriority, TaskTitle},
    error::{AppError, is_unique_violation},
    project::{require_project_access, require_project_editor},
    task_config::{
        lock_workspace_for_assignment, resolve_task_defaults, validate_state_assignment,
        validate_task_type_assignment,
    },
    workspace::{require_workspace_member, workspace_role},
};

use self::model::{TaskResponse, TaskRow, hydrate_tasks};
use self::planning::{
    cycle_id as task_cycle_id, delete_cycle as delete_cycle_assignment,
    delete_modules as delete_module_assignments, module_ids as task_module_ids, replace_cycle,
    replace_modules, validate_assignments as validate_planning_assignments,
    validate_cycle as validate_cycle_assignment, validate_modules as validate_module_assignments,
};
pub(crate) use self::query_engine::TaskQuery;

const MAX_SEARCH_LENGTH: usize = 200;
const MAX_DOCUMENT_BYTES: usize = 5 * 1024 * 1024;

#[derive(Deserialize)]
pub(crate) struct CreateTaskRequest {
    title: String,
    #[serde(default)]
    project_id: Option<Uuid>,
    #[serde(default)]
    state_id: Option<Uuid>,
    #[serde(default)]
    task_type_id: Option<Uuid>,
    #[serde(default)]
    priority: TaskPriority,
    #[serde(default)]
    assignee_ids: Option<Vec<Uuid>>,
    #[serde(default)]
    label_ids: Vec<Uuid>,
    #[serde(default)]
    start_date: Option<NaiveDate>,
    #[serde(default)]
    due_date: Option<NaiveDate>,
    #[serde(default)]
    estimate: Option<i32>,
    #[serde(default)]
    parent_id: Option<Uuid>,
    #[serde(default)]
    cycle_id: Option<Uuid>,
    #[serde(default)]
    module_ids: Vec<Uuid>,
}

#[derive(Deserialize)]
pub(crate) struct UpdateTaskRequest {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    state_id: Option<Uuid>,
    #[serde(default)]
    task_type_id: Option<Uuid>,
    #[serde(default)]
    priority: Option<TaskPriority>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    project_id: Option<Option<Uuid>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    start_date: Option<Option<NaiveDate>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    due_date: Option<Option<NaiveDate>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    estimate: Option<Option<i32>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    parent_id: Option<Option<Uuid>>,
    #[serde(default)]
    assignee_ids: Option<Vec<Uuid>>,
    #[serde(default)]
    label_ids: Option<Vec<Uuid>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    cycle_id: Option<Option<Uuid>>,
    #[serde(default)]
    module_ids: Option<Vec<Uuid>>,
    #[serde(default)]
    cleanup_invalid: bool,
}

#[derive(Deserialize, Default)]
pub(crate) struct TaskFilters {
    project_id: Option<Uuid>,
    #[serde(default)]
    inbox: bool,
    #[serde(default)]
    my_work: bool,
    query: Option<String>,
    state_id: Option<Uuid>,
    task_type_id: Option<Uuid>,
    priority: Option<TaskPriority>,
    assignee_id: Option<Uuid>,
    label_id: Option<Uuid>,
    cycle_id: Option<Uuid>,
    module_id: Option<Uuid>,
    due_before: Option<NaiveDate>,
    due_after: Option<NaiveDate>,
}

#[derive(Deserialize)]
pub(crate) struct ReorderTasksRequest {
    task_ids: Vec<Uuid>,
}

#[derive(Deserialize)]
pub(crate) struct BulkUpdateTaskRequest {
    task_ids: Vec<Uuid>,
    #[serde(default)]
    state_id: Option<Uuid>,
    #[serde(default)]
    priority: Option<TaskPriority>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    project_id: Option<Option<Uuid>>,
    #[serde(default)]
    cleanup_invalid: bool,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TaskRelationType {
    Blocking,
    BlockedBy,
    RelatesTo,
    Duplicate,
}

#[derive(Deserialize)]
pub(crate) struct CreateRelationRequest {
    task_id: Uuid,
    relation_type: TaskRelationType,
}

#[derive(FromRow)]
struct CurrentTask {
    title: String,
    project_id: Option<Uuid>,
    state_id: Uuid,
    task_type_id: Uuid,
    priority: String,
    start_date: Option<NaiveDate>,
    due_date: Option<NaiveDate>,
    estimate: Option<i32>,
    parent_id: Option<Uuid>,
}

#[derive(Deserialize)]
pub(crate) struct DeleteTaskRequest {
    reference: String,
}

#[derive(Deserialize)]
pub(crate) struct DocumentRequest {
    content: String,
}

#[derive(Serialize)]
pub(crate) struct DocumentResponse {
    content: String,
}

pub(crate) async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    filters: Result<Query<TaskFilters>, QueryRejection>,
) -> Result<Json<Vec<TaskResponse>>, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Query(filters) = filters.map_err(AppError::from)?;
    let scope_count = usize::from(filters.inbox)
        + usize::from(filters.my_work)
        + usize::from(filters.project_id.is_some())
        + usize::from(filters.cycle_id.is_some())
        + usize::from(filters.module_id.is_some());
    if scope_count > 1 {
        return Err(AppError::Validation(
            "Task collection scope filters cannot be combined".to_owned(),
        ));
    }
    let role = require_workspace_member(&state.pool, auth.user.id, workspace_id).await?;
    if filters.inbox && !role.can_access_content() {
        return Err(AppError::Forbidden);
    }
    if let Some(project_id) = filters.project_id {
        require_project_access(&state.pool, auth.user.id, workspace_id, project_id).await?;
    }

    let query = TaskQuery::from_legacy(filters);
    Ok(Json(
        query_engine::run(&state.pool, auth.user.id, workspace_id, role, query).await?,
    ))
}

pub(crate) async fn query(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<TaskQuery>, JsonRejection>,
) -> Result<Json<Vec<TaskResponse>>, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(query) = payload.map_err(AppError::from)?;
    let role = require_workspace_member(&state.pool, auth.user.id, workspace_id).await?;
    Ok(Json(
        query_engine::run(&state.pool, auth.user.id, workspace_id, role, query).await?,
    ))
}

pub(crate) async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<CreateTaskRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<TaskResponse>), AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let title =
        TaskTitle::new(&request.title).map_err(|error| AppError::Validation(error.to_string()))?;
    validate_schedule(request.start_date, request.due_date, request.estimate)?;
    let label_ids = unique_ids(&request.label_ids, "Task labels cannot contain duplicates")?;
    let module_ids = unique_ids(
        &request.module_ids,
        "Task Modules cannot contain duplicates",
    )?;
    authorize_task_location(
        &state.pool,
        auth.user.id,
        workspace_id,
        request.project_id,
        true,
    )
    .await?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace_for_assignment(&mut transaction, workspace_id).await?;
    let defaults =
        resolve_task_defaults(&mut transaction, workspace_id, request.project_id).await?;
    let state_id = request.state_id.unwrap_or(defaults.0);
    let task_type_id = request.task_type_id.unwrap_or(defaults.1);
    validate_state_assignment(&mut transaction, workspace_id, state_id).await?;
    validate_task_type_assignment(
        &mut transaction,
        workspace_id,
        request.project_id,
        task_type_id,
    )
    .await?;
    let assignee_ids = match request.assignee_ids {
        Some(ids) => unique_ids(&ids, "Task assignees cannot contain duplicates")?,
        None => default_assignees(&mut transaction, workspace_id, request.project_id).await?,
    };
    validate_assignees(
        &mut transaction,
        workspace_id,
        request.project_id,
        &assignee_ids,
    )
    .await?;
    validate_labels(&mut transaction, workspace_id, &label_ids).await?;
    validate_parent(
        &mut transaction,
        workspace_id,
        request.project_id,
        None,
        request.parent_id,
    )
    .await?;
    validate_planning_assignments(
        &mut transaction,
        workspace_id,
        request.project_id,
        request.cycle_id,
        &module_ids,
    )
    .await?;

    let task_number: i64 = sqlx::query_scalar(
        r#"
        UPDATE workspaces
        SET next_task_number = next_task_number + 1
        WHERE id = $1
        RETURNING next_task_number - 1
        "#,
    )
    .bind(workspace_id)
    .fetch_one(&mut *transaction)
    .await?;

    let task_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO tasks
            (id, workspace_id, project_id, task_number, title, state_id,
             task_type_id, priority, start_date, due_date, estimate, parent_id, position)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        "#,
    )
    .bind(task_id)
    .bind(workspace_id)
    .bind(request.project_id)
    .bind(task_number)
    .bind(title.as_str())
    .bind(state_id)
    .bind(task_type_id)
    .bind(request.priority.as_str())
    .bind(request.start_date)
    .bind(request.due_date)
    .bind(request.estimate)
    .bind(request.parent_id)
    .bind(task_number * 1024)
    .execute(&mut *transaction)
    .await?;
    replace_assignees(&mut transaction, workspace_id, task_id, &assignee_ids).await?;
    replace_labels(&mut transaction, workspace_id, task_id, &label_ids).await?;
    replace_cycle(
        &mut transaction,
        workspace_id,
        request.project_id,
        task_id,
        request.cycle_id,
    )
    .await?;
    replace_modules(
        &mut transaction,
        workspace_id,
        request.project_id,
        task_id,
        &module_ids,
    )
    .await?;
    subscribe(&mut transaction, workspace_id, task_id, auth.user.id).await?;
    notify_assignments(
        &mut transaction,
        workspace_id,
        task_id,
        auth.user.id,
        &assignee_ids,
    )
    .await?;
    record_activity(
        &mut transaction,
        workspace_id,
        task_id,
        auth.user.id,
        "task_created",
        json!({}),
    )
    .await?;

    state
        .vault
        .create_document(workspace_id, task_id)
        .await
        .map_err(AppError::internal)?;
    transaction.commit().await?;
    let task = find_task(&state.pool, workspace_id, task_id).await?;
    Ok((StatusCode::CREATED, Json(task)))
}

pub(crate) async fn get(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<TaskResponse>, AppError> {
    let Path((workspace_id, task_id)) = path.map_err(AppError::from)?;
    let mut transaction = state.pool.begin().await?;
    let project_id = lock_task_location(&mut transaction, workspace_id, task_id, false).await?;
    authorize_task_location(&state.pool, auth.user.id, workspace_id, project_id, false).await?;
    transaction.commit().await?;
    Ok(Json(find_task(&state.pool, workspace_id, task_id).await?))
}

pub(crate) async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<UpdateTaskRequest>, JsonRejection>,
) -> Result<Json<TaskResponse>, AppError> {
    let Path((workspace_id, task_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    if request.title.is_none()
        && request.state_id.is_none()
        && request.task_type_id.is_none()
        && request.priority.is_none()
        && request.project_id.is_none()
        && request.start_date.is_none()
        && request.due_date.is_none()
        && request.estimate.is_none()
        && request.parent_id.is_none()
        && request.assignee_ids.is_none()
        && request.label_ids.is_none()
        && request.cycle_id.is_none()
        && request.module_ids.is_none()
    {
        return Err(AppError::Validation(
            "Provide at least one task field to update".to_owned(),
        ));
    }
    let title = request
        .title
        .as_deref()
        .map(TaskTitle::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace_for_assignment(&mut transaction, workspace_id).await?;
    let current: CurrentTask = sqlx::query_as(
        r#"
        SELECT title, project_id, state_id, task_type_id, priority,
               start_date, due_date, estimate, parent_id
        FROM tasks
        WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL
        FOR UPDATE
        "#,
    )
    .bind(task_id)
    .bind(workspace_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Task not found".to_owned()))?;
    authorize_task_location(
        &state.pool,
        auth.user.id,
        workspace_id,
        current.project_id,
        true,
    )
    .await?;
    let target_project = request.project_id.unwrap_or(current.project_id);
    let project_changed = target_project != current.project_id;
    if project_changed {
        authorize_task_location(
            &state.pool,
            auth.user.id,
            workspace_id,
            target_project,
            true,
        )
        .await?;
    }
    if let Some(state_id) = request.state_id {
        validate_state_assignment(&mut transaction, workspace_id, state_id).await?;
    }
    let mut target_task_type = request.task_type_id.unwrap_or(current.task_type_id);
    if request.task_type_id.is_some() || project_changed {
        let task_type_result = validate_task_type_assignment(
            &mut transaction,
            workspace_id,
            target_project,
            target_task_type,
        )
        .await;
        match task_type_result {
            Ok(()) => {}
            Err(AppError::Validation(_)) if project_changed && request.cleanup_invalid => {
                target_task_type =
                    resolve_task_defaults(&mut transaction, workspace_id, target_project)
                        .await?
                        .1;
            }
            Err(error) => return Err(error),
        }
    }

    let target_start_date = request.start_date.unwrap_or(current.start_date);
    let target_due_date = request.due_date.unwrap_or(current.due_date);
    let target_estimate = request.estimate.unwrap_or(current.estimate);
    validate_schedule(target_start_date, target_due_date, target_estimate)?;

    let current_assignees = task_assignee_ids(&mut transaction, workspace_id, task_id).await?;
    let mut target_assignees = request
        .assignee_ids
        .as_ref()
        .map(|ids| unique_ids(ids, "Task assignees cannot contain duplicates"))
        .transpose()?
        .unwrap_or_else(|| current_assignees.clone());
    let valid_assignees = valid_assignees(
        &mut transaction,
        workspace_id,
        target_project,
        &target_assignees,
    )
    .await?;
    if valid_assignees.len() != target_assignees.len() {
        if !project_changed || !request.cleanup_invalid {
            return Err(AppError::Validation(
                "One or more assignees cannot be assigned in the target location".to_owned(),
            ));
        }
        target_assignees = valid_assignees;
    }

    let current_labels = task_label_ids(&mut transaction, workspace_id, task_id).await?;
    let target_labels = request
        .label_ids
        .as_ref()
        .map(|ids| unique_ids(ids, "Task labels cannot contain duplicates"))
        .transpose()?
        .unwrap_or_else(|| current_labels.clone());
    if request.label_ids.is_some() {
        validate_labels(&mut transaction, workspace_id, &target_labels).await?;
    }

    let current_cycle = task_cycle_id(&mut transaction, workspace_id, task_id).await?;
    let current_modules = task_module_ids(&mut transaction, workspace_id, task_id).await?;
    if project_changed && !request.cleanup_invalid {
        if current_cycle.is_some() && request.cycle_id.is_none() {
            return Err(AppError::Validation(
                "Task move would invalidate its Cycle; clear it or retry with cleanup enabled"
                    .to_owned(),
            ));
        }
        if !current_modules.is_empty() && request.module_ids.is_none() {
            return Err(AppError::Validation(
                "Task move would invalidate its Modules; clear them or retry with cleanup enabled"
                    .to_owned(),
            ));
        }
    }
    let replace_cycle_requested =
        request.cycle_id.is_some() || (project_changed && current_cycle.is_some());
    let target_cycle = if project_changed && request.cycle_id.is_none() {
        None
    } else {
        request.cycle_id.unwrap_or(current_cycle)
    };
    if replace_cycle_requested {
        validate_cycle_assignment(&mut transaction, workspace_id, target_project, target_cycle)
            .await?;
    }
    let replace_modules_requested =
        request.module_ids.is_some() || (project_changed && !current_modules.is_empty());
    let target_modules = if project_changed && request.module_ids.is_none() {
        Vec::new()
    } else {
        request
            .module_ids
            .as_ref()
            .map(|ids| unique_ids(ids, "Task Modules cannot contain duplicates"))
            .transpose()?
            .unwrap_or_else(|| current_modules.clone())
    };
    if replace_modules_requested {
        validate_module_assignments(
            &mut transaction,
            workspace_id,
            target_project,
            &target_modules,
        )
        .await?;
    }

    let mut target_parent = request.parent_id.unwrap_or(current.parent_id);
    let parent_invalid = match validate_parent(
        &mut transaction,
        workspace_id,
        target_project,
        Some(task_id),
        target_parent,
    )
    .await
    {
        Ok(()) => false,
        Err(AppError::Validation(_)) => true,
        Err(error) => return Err(error),
    };
    if parent_invalid {
        if !project_changed || !request.cleanup_invalid {
            return Err(AppError::Validation(
                "Parent Task must be in the same location and cannot create a cycle".to_owned(),
            ));
        }
        target_parent = None;
    }
    if project_changed {
        let incompatible_children: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM tasks
                WHERE workspace_id = $1 AND parent_id = $2
                  AND project_id IS DISTINCT FROM $3
                  AND archived_at IS NULL
            )
            "#,
        )
        .bind(workspace_id)
        .bind(task_id)
        .bind(target_project)
        .fetch_one(&mut *transaction)
        .await?;
        if incompatible_children && !request.cleanup_invalid {
            return Err(AppError::Validation(
                "Move the subtasks too or allow cleanup before moving this Task".to_owned(),
            ));
        }
        if incompatible_children {
            sqlx::query(
                "UPDATE tasks SET parent_id = NULL, updated_at = now() WHERE workspace_id = $1 AND parent_id = $2",
            )
            .bind(workspace_id)
            .bind(task_id)
            .execute(&mut *transaction)
            .await?;
        }
    }

    if replace_cycle_requested {
        delete_cycle_assignment(&mut transaction, workspace_id, task_id).await?;
    }
    if replace_modules_requested {
        delete_module_assignments(&mut transaction, workspace_id, task_id).await?;
    }

    let result = sqlx::query(
        r#"
        UPDATE tasks
        SET title = COALESCE($1, title),
            state_id = COALESCE($2, state_id),
            task_type_id = $3,
            priority = COALESCE($4, priority),
            project_id = CASE WHEN $5 THEN $6 ELSE project_id END,
            start_date = CASE WHEN $7 THEN $8 ELSE start_date END,
            due_date = CASE WHEN $9 THEN $10 ELSE due_date END,
            estimate = CASE WHEN $11 THEN $12 ELSE estimate END,
            parent_id = CASE WHEN $13 THEN $14 ELSE parent_id END,
            updated_at = now()
        WHERE id = $15 AND workspace_id = $16 AND archived_at IS NULL
        "#,
    )
    .bind(title.as_ref().map(TaskTitle::as_str))
    .bind(request.state_id)
    .bind(target_task_type)
    .bind(request.priority.map(TaskPriority::as_str))
    .bind(project_changed)
    .bind(target_project)
    .bind(request.start_date.is_some())
    .bind(target_start_date)
    .bind(request.due_date.is_some())
    .bind(target_due_date)
    .bind(request.estimate.is_some())
    .bind(target_estimate)
    .bind(request.parent_id.is_some() || (project_changed && target_parent != current.parent_id))
    .bind(target_parent)
    .bind(task_id)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Task not found".to_owned()));
    }
    if request.assignee_ids.is_some()
        || target_assignees != task_assignee_ids(&mut transaction, workspace_id, task_id).await?
    {
        replace_assignees(&mut transaction, workspace_id, task_id, &target_assignees).await?;
    }
    if request.label_ids.is_some() {
        replace_labels(&mut transaction, workspace_id, task_id, &target_labels).await?;
    }
    if replace_cycle_requested {
        replace_cycle(
            &mut transaction,
            workspace_id,
            target_project,
            task_id,
            target_cycle,
        )
        .await?;
    }
    if replace_modules_requested {
        replace_modules(
            &mut transaction,
            workspace_id,
            target_project,
            task_id,
            &target_modules,
        )
        .await?;
    }
    let mut changed_fields = Vec::new();
    if title
        .as_ref()
        .is_some_and(|value| value.as_str() != current.title)
    {
        changed_fields.push("title");
    }
    let state_changed = request
        .state_id
        .is_some_and(|state_id| state_id != current.state_id);
    if state_changed {
        changed_fields.push("state");
    }
    if target_task_type != current.task_type_id {
        changed_fields.push("task_type");
    }
    if request
        .priority
        .is_some_and(|priority| priority.as_str() != current.priority)
    {
        changed_fields.push("priority");
    }
    if project_changed {
        changed_fields.push("project");
    }
    if target_start_date != current.start_date {
        changed_fields.push("start_date");
    }
    if target_due_date != current.due_date {
        changed_fields.push("due_date");
    }
    if target_estimate != current.estimate {
        changed_fields.push("estimate");
    }
    if target_parent != current.parent_id {
        changed_fields.push("parent");
    }
    if target_assignees != current_assignees {
        changed_fields.push("assignees");
    }
    if target_labels != current_labels {
        changed_fields.push("labels");
    }
    if target_cycle != current_cycle {
        changed_fields.push("cycle");
    }
    if target_modules != current_modules {
        changed_fields.push("modules");
    }
    if !changed_fields.is_empty() {
        record_activity(
            &mut transaction,
            workspace_id,
            task_id,
            auth.user.id,
            "task_updated",
            json!({ "fields": changed_fields }),
        )
        .await?;
        let newly_assigned = target_assignees
            .iter()
            .copied()
            .filter(|user_id| !current_assignees.contains(user_id))
            .collect::<Vec<_>>();
        notify_task_change(
            &mut transaction,
            workspace_id,
            task_id,
            auth.user.id,
            state_changed,
            changed_fields.iter().any(|field| *field != "state"),
        )
        .await?;
        notify_assignments(
            &mut transaction,
            workspace_id,
            task_id,
            auth.user.id,
            &newly_assigned,
        )
        .await?;
    }
    transaction.commit().await?;
    Ok(Json(find_task(&state.pool, workspace_id, task_id).await?))
}

pub(crate) async fn archive(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, task_id)) = path.map_err(AppError::from)?;
    let mut transaction = state.pool.begin().await?;
    let project_id = lock_task_location(&mut transaction, workspace_id, task_id, true).await?;
    authorize_task_location(&state.pool, auth.user.id, workspace_id, project_id, true).await?;
    let result = sqlx::query(
        "UPDATE tasks SET archived_at = now(), updated_at = now() WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL",
    )
    .bind(task_id)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Task not found".to_owned()));
    }
    sqlx::query(
        "UPDATE tasks SET parent_id = NULL, updated_at = now() WHERE workspace_id = $1 AND parent_id = $2",
    )
    .bind(workspace_id)
    .bind(task_id)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "DELETE FROM task_relations WHERE workspace_id = $1 AND (task_a_id = $2 OR task_b_id = $2)",
    )
    .bind(workspace_id)
    .bind(task_id)
    .execute(&mut *transaction)
    .await?;
    delete_cycle_assignment(&mut transaction, workspace_id, task_id).await?;
    delete_module_assignments(&mut transaction, workspace_id, task_id).await?;
    record_activity(
        &mut transaction,
        workspace_id,
        task_id,
        auth.user.id,
        "task_archived",
        json!({}),
    )
    .await?;
    notify_task_change(
        &mut transaction,
        workspace_id,
        task_id,
        auth.user.id,
        false,
        true,
    )
    .await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn delete_permanently(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<DeleteTaskRequest>, JsonRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, task_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let mut transaction = state.pool.begin().await?;
    let project_id = lock_task_location(&mut transaction, workspace_id, task_id, true).await?;
    authorize_task_location(&state.pool, auth.user.id, workspace_id, project_id, true).await?;
    let task = find_task_in_transaction(&mut transaction, workspace_id, task_id).await?;
    if request.reference.trim() != task.reference {
        return Err(AppError::Validation(
            "Enter the Task reference exactly to delete it".to_owned(),
        ));
    }

    let trash = state
        .vault
        .trash_task(workspace_id, task_id)
        .await
        .map_err(AppError::internal)?;
    let deletion = async {
        sqlx::query(
            "UPDATE tasks SET parent_id = NULL, updated_at = now() WHERE workspace_id = $1 AND parent_id = $2",
        )
        .bind(workspace_id)
        .bind(task_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query("DELETE FROM tasks WHERE workspace_id = $1 AND id = $2")
            .bind(workspace_id)
            .bind(task_id)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await
    }
    .await;
    if let Err(error) = deletion {
        if let Some(trash) = &trash {
            state
                .vault
                .restore_task(trash)
                .await
                .map_err(AppError::internal)?;
        }
        return Err(error.into());
    }
    if let Some(trash) = &trash
        && let Err(error) = state.vault.purge_task_trash(trash).await
    {
        // The database deletion is already durable. Leaving unreachable trash is
        // safer than reporting a failure that could make clients retry the delete.
        warn!(task_id = %task_id, %error, "failed to purge deleted Task document");
    }
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn reorder(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<ReorderTasksRequest>, JsonRejection>,
) -> Result<StatusCode, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let task_ids = unique_ids(&request.task_ids, "Task order cannot contain duplicates")?;
    if task_ids.is_empty() || task_ids.len() > 500 {
        return Err(AppError::Validation(
            "Task order must contain between 1 and 500 Tasks".to_owned(),
        ));
    }
    let mut transaction = state.pool.begin().await?;
    lock_workspace_for_assignment(&mut transaction, workspace_id).await?;
    let locations: Vec<(Uuid, Option<Uuid>)> = sqlx::query_as(
        r#"
        SELECT id, project_id FROM tasks
        WHERE workspace_id = $1 AND id = ANY($2) AND archived_at IS NULL
        FOR UPDATE
        "#,
    )
    .bind(workspace_id)
    .bind(&task_ids)
    .fetch_all(&mut *transaction)
    .await?;
    if locations.len() != task_ids.len() {
        return Err(AppError::NotFound("Task not found".to_owned()));
    }
    let location = locations[0].1;
    if locations
        .iter()
        .any(|(_, candidate)| *candidate != location)
    {
        return Err(AppError::Validation(
            "Only Tasks in the same collection can be reordered".to_owned(),
        ));
    }
    let collection_size: i64 = sqlx::query_scalar(
        r#"
        SELECT count(*) FROM tasks
        WHERE workspace_id = $1
          AND project_id IS NOT DISTINCT FROM $2
          AND archived_at IS NULL
        "#,
    )
    .bind(workspace_id)
    .bind(location)
    .fetch_one(&mut *transaction)
    .await?;
    if collection_size != task_ids.len() as i64 {
        return Err(AppError::Validation(
            "Task order must include the complete collection".to_owned(),
        ));
    }
    authorize_task_location(&state.pool, auth.user.id, workspace_id, location, true).await?;
    for (index, task_id) in task_ids.iter().enumerate() {
        sqlx::query(
            "UPDATE tasks SET position = $1, updated_at = now() WHERE workspace_id = $2 AND id = $3",
        )
        .bind((index as i64 + 1) * 1024)
        .bind(workspace_id)
        .bind(task_id)
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn bulk_update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<BulkUpdateTaskRequest>, JsonRejection>,
) -> Result<Json<Vec<TaskResponse>>, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let task_ids = unique_ids(
        &request.task_ids,
        "Bulk selection cannot contain duplicates",
    )?;
    if task_ids.is_empty() || task_ids.len() > 100 {
        return Err(AppError::Validation(
            "Bulk updates must contain between 1 and 100 Tasks".to_owned(),
        ));
    }
    if request.state_id.is_none() && request.priority.is_none() && request.project_id.is_none() {
        return Err(AppError::Validation(
            "Provide at least one Task field to update".to_owned(),
        ));
    }
    let mut transaction = state.pool.begin().await?;
    lock_workspace_for_assignment(&mut transaction, workspace_id).await?;
    if let Some(state_id) = request.state_id {
        validate_state_assignment(&mut transaction, workspace_id, state_id).await?;
    }

    for task_id in &task_ids {
        let (current_project, task_type_id): (Option<Uuid>, Uuid) = sqlx::query_as(
            r#"
            SELECT project_id, task_type_id FROM tasks
            WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL
            FOR UPDATE
            "#,
        )
        .bind(workspace_id)
        .bind(task_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| AppError::NotFound("Task not found".to_owned()))?;
        authorize_task_location(
            &state.pool,
            auth.user.id,
            workspace_id,
            current_project,
            true,
        )
        .await?;
        let target_project = request.project_id.unwrap_or(current_project);
        let project_changed = target_project != current_project;
        if project_changed {
            authorize_task_location(
                &state.pool,
                auth.user.id,
                workspace_id,
                target_project,
                true,
            )
            .await?;
        }
        let mut target_type = task_type_id;
        if project_changed {
            let type_result = validate_task_type_assignment(
                &mut transaction,
                workspace_id,
                target_project,
                target_type,
            )
            .await;
            match type_result {
                Ok(()) => {}
                Err(AppError::Validation(_)) if request.cleanup_invalid => {
                    target_type =
                        resolve_task_defaults(&mut transaction, workspace_id, target_project)
                            .await?
                            .1;
                }
                Err(error) => return Err(error),
            }
            cleanup_or_reject_move(
                &mut transaction,
                workspace_id,
                *task_id,
                target_project,
                &task_ids,
                request.cleanup_invalid,
            )
            .await?;
        }
        sqlx::query(
            r#"
            UPDATE tasks
            SET state_id = COALESCE($1, state_id),
                priority = COALESCE($2, priority),
                project_id = CASE WHEN $3 THEN $4 ELSE project_id END,
                task_type_id = $5,
                updated_at = now()
            WHERE workspace_id = $6 AND id = $7
            "#,
        )
        .bind(request.state_id)
        .bind(request.priority.map(TaskPriority::as_str))
        .bind(project_changed)
        .bind(target_project)
        .bind(target_type)
        .bind(workspace_id)
        .bind(task_id)
        .execute(&mut *transaction)
        .await?;
        let fields = [
            request.state_id.map(|_| "state"),
            request.priority.map(|_| "priority"),
            request.project_id.map(|_| "project"),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
        record_activity(
            &mut transaction,
            workspace_id,
            *task_id,
            auth.user.id,
            "task_updated",
            json!({ "fields": fields }),
        )
        .await?;
        notify_task_change(
            &mut transaction,
            workspace_id,
            *task_id,
            auth.user.id,
            request.state_id.is_some(),
            request.priority.is_some() || request.project_id.is_some(),
        )
        .await?;
    }
    transaction.commit().await?;
    let mut tasks = find_tasks(&state.pool, workspace_id, &task_ids).await?;
    hydrate_tasks(&state.pool, workspace_id, &mut tasks).await?;
    Ok(Json(tasks))
}

pub(crate) async fn add_relation(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<CreateRelationRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<TaskResponse>), AppError> {
    let Path((workspace_id, task_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    if task_id == request.task_id {
        return Err(AppError::Validation(
            "A Task cannot relate to itself".to_owned(),
        ));
    }
    let mut transaction = state.pool.begin().await?;
    let project_id = lock_task_location(&mut transaction, workspace_id, task_id, true).await?;
    let related_project =
        lock_task_location(&mut transaction, workspace_id, request.task_id, true).await?;
    authorize_task_location(&state.pool, auth.user.id, workspace_id, project_id, true).await?;
    authorize_task_location(
        &state.pool,
        auth.user.id,
        workspace_id,
        related_project,
        true,
    )
    .await?;
    let (task_a_id, task_b_id, current_is_a) = if task_id < request.task_id {
        (task_id, request.task_id, true)
    } else {
        (request.task_id, task_id, false)
    };
    let (relation_type, task_a_blocks) = match request.relation_type {
        TaskRelationType::Blocking => ("blocks", Some(current_is_a)),
        TaskRelationType::BlockedBy => ("blocks", Some(!current_is_a)),
        TaskRelationType::RelatesTo => ("relates_to", None),
        TaskRelationType::Duplicate => ("duplicate", None),
    };
    let inserted = sqlx::query(
        r#"
        INSERT INTO task_relations
            (workspace_id, task_a_id, task_b_id, relation_type, task_a_blocks)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(workspace_id)
    .bind(task_a_id)
    .bind(task_b_id)
    .bind(relation_type)
    .bind(task_a_blocks)
    .execute(&mut *transaction)
    .await;
    match inserted {
        Ok(_) => {}
        Err(error) if is_unique_violation(&error) => {
            return Err(AppError::Conflict(
                "These Tasks already have a relation".to_owned(),
            ));
        }
        Err(error) => return Err(error.into()),
    }
    record_activity(
        &mut transaction,
        workspace_id,
        task_id,
        auth.user.id,
        "relation_added",
        json!({ "related_task_id": request.task_id }),
    )
    .await?;
    notify_task_change(
        &mut transaction,
        workspace_id,
        task_id,
        auth.user.id,
        false,
        true,
    )
    .await?;
    transaction.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(find_task(&state.pool, workspace_id, task_id).await?),
    ))
}

pub(crate) async fn remove_relation(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, task_id, related_task_id)) = path.map_err(AppError::from)?;
    let mut transaction = state.pool.begin().await?;
    let project_id = lock_task_location(&mut transaction, workspace_id, task_id, true).await?;
    let related_project =
        lock_task_location(&mut transaction, workspace_id, related_task_id, true).await?;
    authorize_task_location(&state.pool, auth.user.id, workspace_id, project_id, true).await?;
    authorize_task_location(
        &state.pool,
        auth.user.id,
        workspace_id,
        related_project,
        true,
    )
    .await?;
    let (task_a_id, task_b_id) = if task_id < related_task_id {
        (task_id, related_task_id)
    } else {
        (related_task_id, task_id)
    };
    let result = sqlx::query(
        "DELETE FROM task_relations WHERE workspace_id = $1 AND task_a_id = $2 AND task_b_id = $3",
    )
    .bind(workspace_id)
    .bind(task_a_id)
    .bind(task_b_id)
    .execute(&mut *transaction)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Task relation not found".to_owned()));
    }
    record_activity(
        &mut transaction,
        workspace_id,
        task_id,
        auth.user.id,
        "relation_removed",
        json!({ "related_task_id": related_task_id }),
    )
    .await?;
    notify_task_change(
        &mut transaction,
        workspace_id,
        task_id,
        auth.user.id,
        false,
        true,
    )
    .await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn read_document(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<DocumentResponse>, AppError> {
    let Path((workspace_id, task_id)) = path.map_err(AppError::from)?;
    let mut transaction = state.pool.begin().await?;
    let project_id = lock_task_location(&mut transaction, workspace_id, task_id, false).await?;
    authorize_task_location(&state.pool, auth.user.id, workspace_id, project_id, false).await?;

    let content = state
        .vault
        .read_document(workspace_id, task_id)
        .await
        .map_err(AppError::internal)?;
    transaction.commit().await?;
    Ok(Json(DocumentResponse { content }))
}

pub(crate) async fn write_document(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<DocumentRequest>, JsonRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, task_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    if request.content.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::Validation(
            "Markdown documents cannot exceed 5 MiB".to_owned(),
        ));
    }

    let mut transaction = state.pool.begin().await?;
    let project_id = lock_task_location(&mut transaction, workspace_id, task_id, false).await?;
    // Authorization is held by a shared task lock before constructing a vault path.
    authorize_task_location(&state.pool, auth.user.id, workspace_id, project_id, true).await?;
    state
        .vault
        .write_document(workspace_id, task_id, &request.content)
        .await
        .map_err(AppError::internal)?;
    record_activity(
        &mut transaction,
        workspace_id,
        task_id,
        auth.user.id,
        "document_updated",
        json!({}),
    )
    .await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn authorize_task_location(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    edit: bool,
) -> Result<(), AppError> {
    if let Some(project_id) = project_id {
        if edit {
            require_project_editor(pool, user_id, workspace_id, project_id).await?;
        } else {
            require_project_access(pool, user_id, workspace_id, project_id).await?;
        }
        return Ok(());
    }
    let role = workspace_role(pool, user_id, workspace_id).await?;
    if !role.can_access_content() {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

async fn lock_task_location(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
    update: bool,
) -> Result<Option<Uuid>, AppError> {
    let query = if update {
        "SELECT project_id FROM tasks WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL FOR UPDATE"
    } else {
        "SELECT project_id FROM tasks WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL FOR SHARE"
    };
    sqlx::query_scalar(query)
        .bind(task_id)
        .bind(workspace_id)
        .fetch_optional(&mut **transaction)
        .await?
        .ok_or_else(|| AppError::NotFound("Task not found".to_owned()))
}

async fn find_task_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
) -> Result<TaskResponse, AppError> {
    let row = select_task_query()
        .bind(task_id)
        .bind(workspace_id)
        .fetch_optional(&mut **transaction)
        .await?
        .ok_or_else(|| AppError::NotFound("Task not found".to_owned()))?;
    Ok(TaskResponse::from(row))
}

async fn find_task(
    pool: &PgPool,
    workspace_id: Uuid,
    task_id: Uuid,
) -> Result<TaskResponse, AppError> {
    let mut tasks = find_tasks(pool, workspace_id, &[task_id]).await?;
    hydrate_tasks(pool, workspace_id, &mut tasks).await?;
    tasks
        .pop()
        .ok_or_else(|| AppError::NotFound("Task not found".to_owned()))
}

async fn find_tasks(
    pool: &PgPool,
    workspace_id: Uuid,
    task_ids: &[Uuid],
) -> Result<Vec<TaskResponse>, AppError> {
    let rows = sqlx::query_as::<_, TaskRow>(
        r#"
        SELECT tasks.id, tasks.workspace_id, tasks.project_id, tasks.title,
               projects.identifier AS project_identifier, tasks.task_number,
               states.id AS state_id, states.name AS state_name,
               states.color AS state_color, states.state_group,
               task_types.id AS task_type_id, task_types.name AS task_type_name,
               task_types.icon AS task_type_icon, task_types.color AS task_type_color,
               tasks.priority, tasks.start_date, tasks.due_date, tasks.estimate,
               tasks.position, tasks.archived_at, tasks.created_at, tasks.updated_at
        FROM tasks
        LEFT JOIN projects ON projects.id = tasks.project_id
        JOIN task_states AS states
          ON states.workspace_id = tasks.workspace_id AND states.id = tasks.state_id
        JOIN task_types
          ON task_types.workspace_id = tasks.workspace_id
         AND task_types.id = tasks.task_type_id
        WHERE tasks.workspace_id = $1
          AND tasks.id = ANY($2)
          AND tasks.archived_at IS NULL
        ORDER BY array_position($2, tasks.id)
        "#,
    )
    .bind(workspace_id)
    .bind(task_ids)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(TaskResponse::from).collect())
}

fn select_task_query()
-> sqlx::query::QueryAs<'static, Postgres, TaskRow, sqlx::postgres::PgArguments> {
    sqlx::query_as(
        r#"
        SELECT tasks.id, tasks.workspace_id, tasks.project_id, tasks.title,
               projects.identifier AS project_identifier, tasks.task_number,
               states.id AS state_id, states.name AS state_name,
               states.color AS state_color, states.state_group,
               task_types.id AS task_type_id, task_types.name AS task_type_name,
               task_types.icon AS task_type_icon, task_types.color AS task_type_color,
               tasks.priority, tasks.start_date, tasks.due_date, tasks.estimate,
               tasks.position, tasks.archived_at, tasks.created_at, tasks.updated_at
        FROM tasks
        LEFT JOIN projects ON projects.id = tasks.project_id
        JOIN task_states AS states
          ON states.workspace_id = tasks.workspace_id AND states.id = tasks.state_id
        JOIN task_types
          ON task_types.workspace_id = tasks.workspace_id
         AND task_types.id = tasks.task_type_id
        WHERE tasks.id = $1 AND tasks.workspace_id = $2 AND tasks.archived_at IS NULL
        "#,
    )
}

fn validate_schedule(
    start_date: Option<NaiveDate>,
    due_date: Option<NaiveDate>,
    estimate: Option<i32>,
) -> Result<(), AppError> {
    if start_date
        .zip(due_date)
        .is_some_and(|(start, due)| start > due)
    {
        return Err(AppError::Validation(
            "Task due date cannot be before its start date".to_owned(),
        ));
    }
    if estimate.is_some_and(|value| value < 0) {
        return Err(AppError::Validation(
            "Task estimate cannot be negative".to_owned(),
        ));
    }
    Ok(())
}

fn unique_ids(ids: &[Uuid], message: &str) -> Result<Vec<Uuid>, AppError> {
    let mut seen = HashSet::with_capacity(ids.len());
    if ids.iter().any(|id| !seen.insert(*id)) {
        return Err(AppError::Validation(message.to_owned()));
    }
    Ok(ids.to_vec())
}

async fn default_assignees(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
) -> Result<Vec<Uuid>, AppError> {
    let Some(project_id) = project_id else {
        return Ok(Vec::new());
    };
    let default_assignee: Option<Uuid> = sqlx::query_scalar(
        "SELECT default_assignee_id FROM projects WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL",
    )
    .bind(workspace_id)
    .bind(project_id)
    .fetch_optional(&mut **transaction)
    .await?
    .flatten();
    Ok(default_assignee.into_iter().collect())
}

async fn valid_assignees(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    assignee_ids: &[Uuid],
) -> Result<Vec<Uuid>, AppError> {
    if assignee_ids.is_empty() {
        return Ok(Vec::new());
    }
    sqlx::query_scalar(
        r#"
        SELECT memberships.user_id
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
        ORDER BY memberships.user_id
        "#,
    )
    .bind(workspace_id)
    .bind(assignee_ids)
    .bind(project_id)
    .fetch_all(&mut **transaction)
    .await
    .map_err(AppError::from)
}

async fn validate_assignees(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    assignee_ids: &[Uuid],
) -> Result<(), AppError> {
    if valid_assignees(transaction, workspace_id, project_id, assignee_ids)
        .await?
        .len()
        != assignee_ids.len()
    {
        return Err(AppError::Validation(
            "One or more assignees cannot be assigned in this Task location".to_owned(),
        ));
    }
    Ok(())
}

async fn task_assignee_ids(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
) -> Result<Vec<Uuid>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT user_id FROM task_assignees WHERE workspace_id = $1 AND task_id = $2 ORDER BY user_id",
    )
    .bind(workspace_id)
    .bind(task_id)
    .fetch_all(&mut **transaction)
    .await?)
}

async fn task_label_ids(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
) -> Result<Vec<Uuid>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT label_id FROM task_label_assignments WHERE workspace_id = $1 AND task_id = $2 ORDER BY label_id",
    )
    .bind(workspace_id)
    .bind(task_id)
    .fetch_all(&mut **transaction)
    .await?)
}

async fn replace_assignees(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
    assignee_ids: &[Uuid],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM task_assignees WHERE workspace_id = $1 AND task_id = $2")
        .bind(workspace_id)
        .bind(task_id)
        .execute(&mut **transaction)
        .await?;
    if !assignee_ids.is_empty() {
        sqlx::query(
            r#"
            INSERT INTO task_assignees (workspace_id, task_id, user_id)
            SELECT $1, $2, user_id FROM unnest($3::uuid[]) AS user_id
            "#,
        )
        .bind(workspace_id)
        .bind(task_id)
        .bind(assignee_ids)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

async fn validate_labels(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    label_ids: &[Uuid],
) -> Result<(), AppError> {
    if label_ids.is_empty() {
        return Ok(());
    }
    let count: i64 = sqlx::query_scalar(
        r#"
        SELECT count(*) FROM task_labels
        WHERE workspace_id = $1 AND id = ANY($2) AND archived_at IS NULL
        "#,
    )
    .bind(workspace_id)
    .bind(label_ids)
    .fetch_one(&mut **transaction)
    .await?;
    if count as usize != label_ids.len() {
        return Err(AppError::Validation(
            "One or more Task labels are unavailable".to_owned(),
        ));
    }
    Ok(())
}

async fn replace_labels(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
    label_ids: &[Uuid],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM task_label_assignments WHERE workspace_id = $1 AND task_id = $2")
        .bind(workspace_id)
        .bind(task_id)
        .execute(&mut **transaction)
        .await?;
    if !label_ids.is_empty() {
        sqlx::query(
            r#"
            INSERT INTO task_label_assignments (workspace_id, task_id, label_id)
            SELECT $1, $2, label_id FROM unnest($3::uuid[]) AS label_id
            "#,
        )
        .bind(workspace_id)
        .bind(task_id)
        .bind(label_ids)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

async fn validate_parent(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    task_id: Option<Uuid>,
    parent_id: Option<Uuid>,
) -> Result<(), AppError> {
    let Some(parent_id) = parent_id else {
        return Ok(());
    };
    if task_id == Some(parent_id) {
        return Err(AppError::Validation(
            "A Task cannot be its own parent".to_owned(),
        ));
    }
    let valid_location: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM tasks
            WHERE workspace_id = $1 AND id = $2
              AND project_id IS NOT DISTINCT FROM $3
              AND archived_at IS NULL
        )
        "#,
    )
    .bind(workspace_id)
    .bind(parent_id)
    .bind(project_id)
    .fetch_one(&mut **transaction)
    .await?;
    if !valid_location {
        return Err(AppError::Validation(
            "Parent Task must be in the same Task location".to_owned(),
        ));
    }
    if let Some(task_id) = task_id {
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
        .fetch_one(&mut **transaction)
        .await?;
        if creates_cycle {
            return Err(AppError::Validation(
                "Task hierarchy cannot contain a cycle".to_owned(),
            ));
        }
    }
    Ok(())
}

async fn cleanup_or_reject_move(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
    target_project: Option<Uuid>,
    moving_task_ids: &[Uuid],
    cleanup: bool,
) -> Result<(), AppError> {
    let current_assignees = task_assignee_ids(transaction, workspace_id, task_id).await?;
    let valid = valid_assignees(
        transaction,
        workspace_id,
        target_project,
        &current_assignees,
    )
    .await?;
    let parent: Option<(Uuid, Option<Uuid>)> = sqlx::query_as(
        r#"
        SELECT parent.id, parent.project_id
        FROM tasks AS child
        JOIN tasks AS parent
          ON parent.workspace_id = child.workspace_id AND parent.id = child.parent_id
        WHERE child.workspace_id = $1 AND child.id = $2
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .fetch_optional(&mut **transaction)
    .await?;
    let parent_invalid = parent.is_some_and(|(parent_id, parent_project)| {
        parent_project != target_project && !moving_task_ids.contains(&parent_id)
    });
    let child_invalid: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM tasks
            WHERE workspace_id = $1 AND parent_id = $2
              AND project_id IS DISTINCT FROM $3
              AND NOT (id = ANY($4))
              AND archived_at IS NULL
        )
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(target_project)
    .bind(moving_task_ids)
    .fetch_one(&mut **transaction)
    .await?;
    let has_planning_links: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM task_cycle_assignments
            WHERE workspace_id = $1 AND task_id = $2
            UNION ALL
            SELECT 1 FROM task_module_assignments
            WHERE workspace_id = $1 AND task_id = $2
        )
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .fetch_one(&mut **transaction)
    .await?;
    if valid.len() != current_assignees.len()
        || parent_invalid
        || child_invalid
        || has_planning_links
    {
        if !cleanup {
            return Err(AppError::Validation(
                "Task move would invalidate assignees, hierarchy, or planning links; retry with cleanup enabled".to_owned(),
            ));
        }
        if valid.len() != current_assignees.len() {
            replace_assignees(transaction, workspace_id, task_id, &valid).await?;
        }
        if parent_invalid {
            sqlx::query(
                "UPDATE tasks SET parent_id = NULL, updated_at = now() WHERE workspace_id = $1 AND id = $2",
            )
            .bind(workspace_id)
            .bind(task_id)
            .execute(&mut **transaction)
            .await?;
        }
        if child_invalid {
            sqlx::query(
                "UPDATE tasks SET parent_id = NULL, updated_at = now() WHERE workspace_id = $1 AND parent_id = $2",
            )
            .bind(workspace_id)
            .bind(task_id)
            .execute(&mut **transaction)
            .await?;
        }
        if has_planning_links {
            delete_cycle_assignment(transaction, workspace_id, task_id).await?;
            delete_module_assignments(transaction, workspace_id, task_id).await?;
        }
    }
    Ok(())
}

pub(super) fn search_pattern(value: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.chars().count() > MAX_SEARCH_LENGTH {
        return Err(AppError::Validation(
            "Task search cannot exceed 200 characters".to_owned(),
        ));
    }
    let escaped = value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    Ok(format!("%{escaped}%"))
}

pub(crate) fn deserialize_nullable<'de, D, T>(
    deserializer: D,
) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::{UpdateTaskRequest, search_pattern};

    #[test]
    fn treats_search_wildcards_as_literal_characters() {
        assert_eq!(search_pattern("  100%_done  ").unwrap(), "%100\\%\\_done%");
    }

    #[test]
    fn distinguishes_an_omitted_project_from_clearing_it() {
        let omitted = UpdateTaskRequest::deserialize(serde_json::json!({})).unwrap();
        let cleared =
            UpdateTaskRequest::deserialize(serde_json::json!({"project_id": null})).unwrap();
        let assigned = UpdateTaskRequest::deserialize(
            serde_json::json!({"project_id": "2d236d11-6099-47c6-981b-b29a06be87af"}),
        )
        .unwrap();

        assert_eq!(omitted.project_id, None);
        assert_eq!(cleared.project_id, Some(None));
        assert!(assigned.project_id.flatten().is_some());
    }
}
