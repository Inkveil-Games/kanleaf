use std::collections::HashSet;

use axum::{
    Json,
    extract::{
        Path, Query, State, rejection::JsonRejection, rejection::PathRejection,
        rejection::QueryRejection,
    },
    http::StatusCode,
};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    domain::{ConfigurationDescription, HexColor, ResourceName, TaskTypeIcon},
    error::{AppError, is_unique_violation},
    task::{enqueue_projection, project_many},
    workspace::require_workspace_admin,
};

use super::TaskTypeResponse;

#[derive(Deserialize)]
pub(super) struct CreateTaskTypeRequest {
    name: String,
    icon: String,
    color: String,
    #[serde(default)]
    description: String,
}

#[derive(Deserialize)]
pub(super) struct UpdateTaskTypeRequest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    archived: Option<bool>,
}

#[derive(Deserialize)]
pub(super) struct ReorderTaskTypesRequest {
    ids: Vec<Uuid>,
}

#[derive(Deserialize, Default)]
pub(super) struct ReplacementQuery {
    replacement_id: Option<Uuid>,
}

pub(super) async fn list(
    pool: &PgPool,
    workspace_id: Uuid,
) -> Result<Vec<TaskTypeResponse>, AppError> {
    Ok(sqlx::query_as(
        r#"
        SELECT id, workspace_id, name, icon, color, description, position,
               is_protected, archived_at, created_at, updated_at
        FROM task_types
        WHERE workspace_id = $1
        ORDER BY archived_at NULLS FIRST, position, id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await?)
}

pub(super) async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<CreateTaskTypeRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<TaskTypeResponse>), AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let name = ResourceName::new(&request.name)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let icon = TaskTypeIcon::new(&request.icon)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let color =
        HexColor::new(&request.color).map_err(|error| AppError::Validation(error.to_string()))?;
    let description = ConfigurationDescription::new(&request.description)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;

    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    let position: i32 = sqlx::query_scalar(
        "SELECT COALESCE(max(position) + 1, 0) FROM task_types WHERE workspace_id = $1 AND archived_at IS NULL",
    )
    .bind(workspace_id)
    .fetch_one(&mut *transaction)
    .await?;
    let task_type_id = Uuid::new_v4();
    let created = sqlx::query_as::<_, TaskTypeResponse>(
        r#"
        INSERT INTO task_types
            (id, workspace_id, name, icon, color, description, position)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, workspace_id, name, icon, color, description, position,
                  is_protected, archived_at, created_at, updated_at
        "#,
    )
    .bind(task_type_id)
    .bind(workspace_id)
    .bind(name.as_str())
    .bind(icon.as_str())
    .bind(color.as_str())
    .bind(description.as_str())
    .bind(position)
    .fetch_one(&mut *transaction)
    .await;
    let created = match created {
        Ok(created) => created,
        Err(error) if is_unique_violation(&error) => {
            return Err(AppError::Conflict(
                "An active task type already uses this name".to_owned(),
            ));
        }
        Err(error) => return Err(error.into()),
    };
    sqlx::query(
        r#"
        INSERT INTO project_task_types (workspace_id, project_id, task_type_id)
        SELECT workspace_id, id, $1
        FROM projects
        WHERE workspace_id = $2 AND archived_at IS NULL
        "#,
    )
    .bind(task_type_id)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok((StatusCode::CREATED, Json(created)))
}

pub(super) async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<UpdateTaskTypeRequest>, JsonRejection>,
) -> Result<Json<TaskTypeResponse>, AppError> {
    let Path((workspace_id, task_type_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    if request.name.is_none()
        && request.icon.is_none()
        && request.color.is_none()
        && request.description.is_none()
        && request.archived.is_none()
    {
        return Err(AppError::Validation(
            "Provide at least one task type field to update".to_owned(),
        ));
    }
    let name = request
        .name
        .as_deref()
        .map(ResourceName::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let icon = request
        .icon
        .as_deref()
        .map(TaskTypeIcon::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let color = request
        .color
        .as_deref()
        .map(HexColor::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let description = request
        .description
        .as_deref()
        .map(ConfigurationDescription::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;

    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    let (is_protected, is_archived): (bool, bool) = sqlx::query_as(
        r#"
        SELECT is_protected, archived_at IS NOT NULL
        FROM task_types
        WHERE id = $1 AND workspace_id = $2
        FOR UPDATE
        "#,
    )
    .bind(task_type_id)
    .bind(workspace_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Task type not found".to_owned()))?;
    if is_protected && request.archived == Some(true) {
        return Err(AppError::Validation(
            "The protected Task type cannot be archived".to_owned(),
        ));
    }
    if request.archived == Some(true) {
        let is_default: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM workspaces
                WHERE id = $1 AND default_task_type_id = $2
                UNION ALL
                SELECT 1 FROM projects
                WHERE workspace_id = $1 AND default_task_type_id = $2
                  AND archived_at IS NULL
            )
            "#,
        )
        .bind(workspace_id)
        .bind(task_type_id)
        .fetch_one(&mut *transaction)
        .await?;
        if is_default {
            return Err(AppError::Validation(
                "Choose replacement defaults before archiving this task type".to_owned(),
            ));
        }
    }
    let new_position: Option<i32> = if request.archived == Some(false) && is_archived {
        Some(
            sqlx::query_scalar::<_, i32>(
                "SELECT COALESCE(max(position) + 1, 0) FROM task_types WHERE workspace_id = $1 AND archived_at IS NULL",
            )
            .bind(workspace_id)
            .fetch_one(&mut *transaction)
            .await?,
        )
    } else {
        None
    };

    let updated = sqlx::query_as::<_, TaskTypeResponse>(
        r#"
        UPDATE task_types
        SET name = COALESCE($1, name),
            icon = COALESCE($2, icon),
            color = COALESCE($3, color),
            description = COALESCE($4, description),
            archived_at = CASE
                WHEN $5::boolean IS NULL THEN archived_at
                WHEN $5 THEN now()
                ELSE NULL
            END,
            position = COALESCE($6, position),
            updated_at = now()
        WHERE id = $7 AND workspace_id = $8
        RETURNING id, workspace_id, name, icon, color, description, position,
                  is_protected, archived_at, created_at, updated_at
        "#,
    )
    .bind(name.as_ref().map(ResourceName::as_str))
    .bind(icon.as_ref().map(TaskTypeIcon::as_str))
    .bind(color.as_ref().map(HexColor::as_str))
    .bind(description.as_ref().map(ConfigurationDescription::as_str))
    .bind(request.archived)
    .bind(new_position)
    .bind(task_type_id)
    .bind(workspace_id)
    .fetch_one(&mut *transaction)
    .await;
    let updated = match updated {
        Ok(updated) => updated,
        Err(error) if is_unique_violation(&error) => {
            return Err(AppError::Conflict(
                "An active task type already uses this name".to_owned(),
            ));
        }
        Err(error) => return Err(error.into()),
    };
    let task_ids = if name.is_some() {
        sqlx::query_scalar(
            "SELECT id FROM tasks WHERE workspace_id = $1 AND task_type_id = $2 ORDER BY id",
        )
        .bind(workspace_id)
        .bind(task_type_id)
        .fetch_all(&mut *transaction)
        .await?
    } else {
        Vec::new()
    };
    enqueue_projection(&mut transaction, workspace_id, &task_ids).await?;
    transaction.commit().await?;
    project_many(&state, workspace_id, &task_ids).await;
    Ok(Json(updated))
}

pub(super) async fn reorder(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<ReorderTaskTypesRequest>, JsonRejection>,
) -> Result<StatusCode, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    let current: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM task_types WHERE workspace_id = $1 AND archived_at IS NULL FOR UPDATE",
    )
    .bind(workspace_id)
    .fetch_all(&mut *transaction)
    .await?;
    validate_reorder_ids(&request.ids, &current)?;
    let shift = i32::try_from(current.len() + 1)
        .map_err(|_| AppError::Validation("Too many task types to reorder".to_owned()))?;
    sqlx::query(
        "UPDATE task_types SET position = position + $1 WHERE workspace_id = $2 AND archived_at IS NULL",
    )
    .bind(shift)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await?;
    for (position, task_type_id) in request.ids.into_iter().enumerate() {
        sqlx::query(
            "UPDATE task_types SET position = $1, updated_at = now() WHERE id = $2 AND workspace_id = $3",
        )
        .bind(position as i32)
        .bind(task_type_id)
        .bind(workspace_id)
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn remove(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    query: Result<Query<ReplacementQuery>, QueryRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, task_type_id)) = path.map_err(AppError::from)?;
    let Query(query) = query.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    let is_protected: bool = sqlx::query_scalar(
        "SELECT is_protected FROM task_types WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
    )
    .bind(task_type_id)
    .bind(workspace_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Task type not found".to_owned()))?;
    if is_protected {
        return Err(AppError::Validation(
            "The protected Task type cannot be deleted".to_owned(),
        ));
    }

    let referenced: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM tasks WHERE workspace_id = $1 AND task_type_id = $2
            UNION ALL
            SELECT 1 FROM workspaces WHERE id = $1 AND default_task_type_id = $2
            UNION ALL
            SELECT 1 FROM projects WHERE workspace_id = $1 AND default_task_type_id = $2
            UNION ALL
            SELECT 1 FROM project_task_types WHERE workspace_id = $1 AND task_type_id = $2
        )
        "#,
    )
    .bind(workspace_id)
    .bind(task_type_id)
    .fetch_one(&mut *transaction)
    .await?;
    if referenced && query.replacement_id.is_none() {
        return Err(AppError::Conflict(
            "This task type is in use; provide an active replacement".to_owned(),
        ));
    }
    let task_ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM tasks WHERE workspace_id = $1 AND task_type_id = $2 ORDER BY id",
    )
    .bind(workspace_id)
    .bind(task_type_id)
    .fetch_all(&mut *transaction)
    .await?;

    if let Some(replacement_id) = query.replacement_id {
        if replacement_id == task_type_id {
            return Err(AppError::Validation(
                "Replacement task type must be different".to_owned(),
            ));
        }
        let replacement_exists: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM task_types
                WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL
            )
            "#,
        )
        .bind(replacement_id)
        .bind(workspace_id)
        .fetch_one(&mut *transaction)
        .await?;
        if !replacement_exists {
            return Err(AppError::Validation(
                "Replacement task type must be active in this Workspace".to_owned(),
            ));
        }

        sqlx::query(
            "UPDATE tasks SET task_type_id = $1 WHERE workspace_id = $2 AND task_type_id = $3",
        )
        .bind(replacement_id)
        .bind(workspace_id)
        .bind(task_type_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE projects SET default_task_type_id = $1 WHERE workspace_id = $2 AND default_task_type_id = $3",
        )
        .bind(replacement_id)
        .bind(workspace_id)
        .bind(task_type_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE workspaces SET default_task_type_id = $1 WHERE id = $2 AND default_task_type_id = $3",
        )
        .bind(replacement_id)
        .bind(workspace_id)
        .bind(task_type_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO project_task_types (workspace_id, project_id, task_type_id)
            SELECT workspace_id, project_id, $1
            FROM project_task_types
            WHERE workspace_id = $2 AND task_type_id = $3
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(replacement_id)
        .bind(workspace_id)
        .bind(task_type_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query("DELETE FROM project_task_types WHERE workspace_id = $1 AND task_type_id = $2")
            .bind(workspace_id)
            .bind(task_type_id)
            .execute(&mut *transaction)
            .await?;
    }

    sqlx::query("DELETE FROM task_types WHERE id = $1 AND workspace_id = $2")
        .bind(task_type_id)
        .bind(workspace_id)
        .execute(&mut *transaction)
        .await?;
    enqueue_projection(&mut transaction, workspace_id, &task_ids).await?;
    transaction.commit().await?;
    project_many(&state, workspace_id, &task_ids).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn lock_workspace(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    workspace_id: Uuid,
) -> Result<(), AppError> {
    let found: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE")
            .bind(workspace_id)
            .fetch_optional(&mut **transaction)
            .await?;
    found
        .map(|_| ())
        .ok_or_else(|| AppError::NotFound("Workspace not found".to_owned()))
}

fn validate_reorder_ids(ids: &[Uuid], current: &[Uuid]) -> Result<(), AppError> {
    let requested: HashSet<_> = ids.iter().copied().collect();
    let existing: HashSet<_> = current.iter().copied().collect();
    if requested.len() != ids.len() || requested != existing {
        return Err(AppError::Validation(
            "Reorder every active task type exactly once".to_owned(),
        ));
    }
    Ok(())
}
