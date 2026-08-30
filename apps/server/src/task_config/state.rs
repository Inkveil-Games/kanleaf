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
    domain::{HexColor, ResourceName, TaskStateGroup},
    error::{AppError, is_unique_violation},
    task::{enqueue_projection, project_many},
    workspace::require_workspace_admin,
};

use super::TaskStateResponse;

#[derive(Deserialize)]
pub(super) struct CreateStateRequest {
    name: String,
    color: String,
    state_group: TaskStateGroup,
}

#[derive(Deserialize)]
pub(super) struct UpdateStateRequest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    state_group: Option<TaskStateGroup>,
    #[serde(default)]
    archived: Option<bool>,
}

#[derive(Deserialize)]
pub(super) struct ReorderStatesRequest {
    ids: Vec<Uuid>,
}

#[derive(Deserialize, Default)]
pub(super) struct ReplacementQuery {
    replacement_id: Option<Uuid>,
}

pub(super) async fn list(
    pool: &PgPool,
    workspace_id: Uuid,
) -> Result<Vec<TaskStateResponse>, AppError> {
    Ok(sqlx::query_as(
        r#"
        SELECT id, workspace_id, name, color, state_group, position,
               archived_at, created_at, updated_at
        FROM task_states
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
    payload: Result<Json<CreateStateRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<TaskStateResponse>), AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let name = ResourceName::new(&request.name)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let color =
        HexColor::new(&request.color).map_err(|error| AppError::Validation(error.to_string()))?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;

    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    let position: i32 = sqlx::query_scalar(
        "SELECT COALESCE(max(position) + 1, 0) FROM task_states WHERE workspace_id = $1 AND archived_at IS NULL",
    )
    .bind(workspace_id)
    .fetch_one(&mut *transaction)
    .await?;
    let created = sqlx::query_as::<_, TaskStateResponse>(
        r#"
        INSERT INTO task_states
            (id, workspace_id, name, color, state_group, position)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, workspace_id, name, color, state_group, position,
                  archived_at, created_at, updated_at
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(workspace_id)
    .bind(name.as_str())
    .bind(color.as_str())
    .bind(request.state_group.as_str())
    .bind(position)
    .fetch_one(&mut *transaction)
    .await;
    let created = match created {
        Ok(created) => created,
        Err(error) if is_unique_violation(&error) => {
            return Err(AppError::Conflict(
                "An active state already uses this name".to_owned(),
            ));
        }
        Err(error) => return Err(error.into()),
    };
    transaction.commit().await?;
    Ok((StatusCode::CREATED, Json(created)))
}

pub(super) async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<UpdateStateRequest>, JsonRejection>,
) -> Result<Json<TaskStateResponse>, AppError> {
    let Path((workspace_id, state_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    if request.name.is_none()
        && request.color.is_none()
        && request.state_group.is_none()
        && request.archived.is_none()
    {
        return Err(AppError::Validation(
            "Provide at least one state field to update".to_owned(),
        ));
    }
    let name = request
        .name
        .as_deref()
        .map(ResourceName::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let color = request
        .color
        .as_deref()
        .map(HexColor::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;

    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    let is_archived: bool = sqlx::query_scalar(
        "SELECT archived_at IS NOT NULL FROM task_states WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
    )
    .bind(state_id)
    .bind(workspace_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Task state not found".to_owned()))?;
    if request.archived == Some(true) {
        let is_default: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM workspaces
                WHERE id = $1 AND default_inbox_state_id = $2
                UNION ALL
                SELECT 1 FROM projects
                WHERE workspace_id = $1 AND default_state_id = $2
                  AND archived_at IS NULL
            )
            "#,
        )
        .bind(workspace_id)
        .bind(state_id)
        .fetch_one(&mut *transaction)
        .await?;
        if is_default {
            return Err(AppError::Validation(
                "Choose replacement defaults before archiving this state".to_owned(),
            ));
        }
    }
    let new_position: Option<i32> = if request.archived == Some(false) && is_archived {
        Some(
            sqlx::query_scalar::<_, i32>(
                "SELECT COALESCE(max(position) + 1, 0) FROM task_states WHERE workspace_id = $1 AND archived_at IS NULL",
            )
            .bind(workspace_id)
            .fetch_one(&mut *transaction)
            .await?,
        )
    } else {
        None
    };

    let updated = sqlx::query_as::<_, TaskStateResponse>(
        r#"
        UPDATE task_states
        SET name = COALESCE($1, name),
            color = COALESCE($2, color),
            state_group = COALESCE($3, state_group),
            archived_at = CASE
                WHEN $4::boolean IS NULL THEN archived_at
                WHEN $4 THEN now()
                ELSE NULL
            END,
            position = COALESCE($5, position),
            updated_at = now()
        WHERE id = $6 AND workspace_id = $7
        RETURNING id, workspace_id, name, color, state_group, position,
                  archived_at, created_at, updated_at
        "#,
    )
    .bind(name.as_ref().map(ResourceName::as_str))
    .bind(color.as_ref().map(HexColor::as_str))
    .bind(request.state_group.map(TaskStateGroup::as_str))
    .bind(request.archived)
    .bind(new_position)
    .bind(state_id)
    .bind(workspace_id)
    .fetch_optional(&mut *transaction)
    .await;
    let updated = match updated {
        Ok(Some(updated)) => updated,
        Ok(None) => return Err(AppError::NotFound("Task state not found".to_owned())),
        Err(error) if is_unique_violation(&error) => {
            return Err(AppError::Conflict(
                "An active state already uses this name".to_owned(),
            ));
        }
        Err(error) => return Err(error.into()),
    };
    let task_ids = if name.is_some() {
        sqlx::query_scalar(
            "SELECT id FROM tasks WHERE workspace_id = $1 AND state_id = $2 ORDER BY id",
        )
        .bind(workspace_id)
        .bind(state_id)
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
    payload: Result<Json<ReorderStatesRequest>, JsonRejection>,
) -> Result<StatusCode, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    let current: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM task_states WHERE workspace_id = $1 AND archived_at IS NULL FOR UPDATE",
    )
    .bind(workspace_id)
    .fetch_all(&mut *transaction)
    .await?;
    validate_reorder_ids(&request.ids, &current, "state")?;

    let shift = i32::try_from(current.len() + 1)
        .map_err(|_| AppError::Validation("Too many states to reorder".to_owned()))?;
    sqlx::query(
        "UPDATE task_states SET position = position + $1 WHERE workspace_id = $2 AND archived_at IS NULL",
    )
    .bind(shift)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await?;
    for (position, state_id) in request.ids.into_iter().enumerate() {
        sqlx::query(
            "UPDATE task_states SET position = $1, updated_at = now() WHERE id = $2 AND workspace_id = $3",
        )
        .bind(position as i32)
        .bind(state_id)
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
    let Path((workspace_id, state_id)) = path.map_err(AppError::from)?;
    let Query(query) = query.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    let state_group: String = sqlx::query_scalar(
        "SELECT state_group FROM task_states WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
    )
    .bind(state_id)
    .bind(workspace_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Task state not found".to_owned()))?;

    let referenced: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM tasks WHERE workspace_id = $1 AND state_id = $2
            UNION ALL
            SELECT 1 FROM workspaces WHERE id = $1 AND default_inbox_state_id = $2
            UNION ALL
            SELECT 1 FROM projects WHERE workspace_id = $1 AND default_state_id = $2
        )
        "#,
    )
    .bind(workspace_id)
    .bind(state_id)
    .fetch_one(&mut *transaction)
    .await?;

    if referenced && query.replacement_id.is_none() {
        return Err(AppError::Conflict(
            "This state is in use; provide an active replacement state".to_owned(),
        ));
    }
    let task_ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM tasks WHERE workspace_id = $1 AND state_id = $2 ORDER BY id",
    )
    .bind(workspace_id)
    .bind(state_id)
    .fetch_all(&mut *transaction)
    .await?;
    if let Some(replacement_id) = query.replacement_id {
        if replacement_id == state_id {
            return Err(AppError::Validation(
                "Replacement state must be different".to_owned(),
            ));
        }
        let replacement_group: Option<String> = sqlx::query_scalar(
            r#"
            SELECT state_group FROM task_states
            WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL
            "#,
        )
        .bind(replacement_id)
        .bind(workspace_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if replacement_group.as_deref() != Some(state_group.as_str()) {
            return Err(AppError::Validation(
                "Replacement state must be active and in the same group".to_owned(),
            ));
        }

        sqlx::query("UPDATE tasks SET state_id = $1 WHERE workspace_id = $2 AND state_id = $3")
            .bind(replacement_id)
            .bind(workspace_id)
            .bind(state_id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query(
            "UPDATE projects SET default_state_id = $1 WHERE workspace_id = $2 AND default_state_id = $3",
        )
        .bind(replacement_id)
        .bind(workspace_id)
        .bind(state_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE workspaces SET default_inbox_state_id = $1 WHERE id = $2 AND default_inbox_state_id = $3",
        )
        .bind(replacement_id)
        .bind(workspace_id)
        .bind(state_id)
        .execute(&mut *transaction)
        .await?;
    }

    sqlx::query("DELETE FROM task_states WHERE id = $1 AND workspace_id = $2")
        .bind(state_id)
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

fn validate_reorder_ids(ids: &[Uuid], current: &[Uuid], kind: &str) -> Result<(), AppError> {
    let requested: HashSet<_> = ids.iter().copied().collect();
    let existing: HashSet<_> = current.iter().copied().collect();
    if requested.len() != ids.len() || requested != existing {
        return Err(AppError::Validation(format!(
            "Reorder every active {kind} exactly once"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::validate_reorder_ids;

    #[test]
    fn reorder_requires_the_complete_unique_set() {
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        assert!(validate_reorder_ids(&[second, first], &[first, second], "state").is_ok());
        assert!(validate_reorder_ids(&[first, first], &[first, second], "state").is_err());
        assert!(validate_reorder_ids(&[first], &[first, second], "state").is_err());
    }
}
