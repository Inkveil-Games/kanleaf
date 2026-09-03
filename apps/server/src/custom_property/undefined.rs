use std::collections::BTreeMap;

use axum::{
    Json,
    extract::{Path, State, rejection::PathRejection},
};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    error::AppError,
    task::{
        UndefinedProperty, authorize_task_location, lock_task_location, read_undefined_properties,
        task_vault_row,
    },
    workspace::require_workspace_admin,
};

#[derive(Serialize)]
pub(super) struct UndefinedPropertySummary {
    name: String,
    task_count: usize,
}

pub(super) async fn list_task(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<Vec<UndefinedProperty>>, AppError> {
    let Path((workspace_id, task_id)) = path.map_err(AppError::from)?;
    let mut transaction = state.pool.begin().await?;
    let project_id = lock_task_location(&mut transaction, workspace_id, task_id, false).await?;
    authorize_task_location(&state.pool, auth.user.id, workspace_id, project_id, false).await?;
    let row = task_vault_row(&mut transaction, workspace_id, task_id, false).await?;
    let reserved = reserved_names(&mut transaction, workspace_id, task_id).await?;
    let document = state
        .vault
        .read_task_document(workspace_id, &row.path()?)
        .await
        .map_err(AppError::internal)?;
    let values = read_undefined_properties(&document.content, &reserved)
        .map_err(|_| invalid_frontmatter())?;
    transaction.commit().await?;
    Ok(Json(values))
}

pub(super) async fn list_workspace(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<Vec<UndefinedPropertySummary>>, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let values = scan_workspace(&state, workspace_id).await?;
    Ok(Json(
        values
            .into_values()
            .map(|(name, task_count)| UndefinedPropertySummary { name, task_count })
            .collect(),
    ))
}

pub(crate) async fn scan_workspace(
    state: &AppState,
    workspace_id: Uuid,
) -> Result<BTreeMap<String, (String, usize)>, AppError> {
    let mut transaction = state.pool.begin().await?;
    let task_ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM tasks WHERE workspace_id = $1 ORDER BY id")
            .bind(workspace_id)
            .fetch_all(&mut *transaction)
            .await?;
    let mut grouped = BTreeMap::<String, (String, usize)>::new();
    for task_id in task_ids {
        let row = task_vault_row(&mut transaction, workspace_id, task_id, true).await?;
        let reserved = reserved_names(&mut transaction, workspace_id, task_id).await?;
        let document = state
            .vault
            .read_task_document(workspace_id, &row.path()?)
            .await
            .map_err(AppError::internal)?;
        let mut seen = std::collections::HashSet::new();
        for property in read_undefined_properties(&document.content, &reserved)
            .map_err(|_| invalid_frontmatter())?
        {
            let normalized = property.name.to_lowercase();
            if seen.insert(normalized.clone()) {
                let entry = grouped.entry(normalized).or_insert((property.name, 0));
                entry.1 += 1;
            }
        }
    }
    transaction.commit().await?;
    Ok(grouped)
}

async fn reserved_names(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
) -> Result<Vec<String>, AppError> {
    let mut names: Vec<String> =
        sqlx::query_scalar("SELECT name FROM custom_property_definitions WHERE workspace_id = $1")
            .bind(workspace_id)
            .fetch_all(&mut **transaction)
            .await?;
    let cleanup: Option<Vec<String>> = sqlx::query_scalar(
        "SELECT cleanup_property_names FROM task_projection_jobs WHERE workspace_id = $1 AND task_id = $2",
    )
    .bind(workspace_id)
    .bind(task_id)
    .fetch_optional(&mut **transaction)
    .await?;
    names.extend(cleanup.unwrap_or_default());
    Ok(names)
}

fn invalid_frontmatter() -> AppError {
    AppError::Conflict("A Task contains properties that Kanleaf cannot inspect safely".to_owned())
}
