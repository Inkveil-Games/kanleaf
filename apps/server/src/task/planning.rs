use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::error::AppError;

pub(super) async fn validate_assignments(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    cycle_id: Option<Uuid>,
    module_ids: &[Uuid],
) -> Result<(), AppError> {
    validate_cycle(transaction, workspace_id, project_id, cycle_id).await?;
    validate_modules(transaction, workspace_id, project_id, module_ids).await
}

pub(super) async fn validate_cycle(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    cycle_id: Option<Uuid>,
) -> Result<(), AppError> {
    let Some(cycle_id) = cycle_id else {
        return Ok(());
    };
    let Some(project_id) = project_id else {
        return Err(AppError::Validation(
            "Inbox Tasks cannot belong to a Cycle".to_owned(),
        ));
    };
    let enabled: Option<bool> = sqlx::query_scalar(
        "SELECT cycles_enabled FROM projects WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL FOR SHARE",
    )
    .bind(workspace_id)
    .bind(project_id)
    .fetch_optional(&mut **transaction)
    .await?;
    if enabled != Some(true) {
        return Err(AppError::Validation(
            "Cycles are disabled or unavailable for this Project".to_owned(),
        ));
    }
    let available: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM project_cycles
            WHERE workspace_id = $1 AND project_id = $2 AND id = $3
              AND archived_at IS NULL AND completed_at IS NULL
        )
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(cycle_id)
    .fetch_one(&mut **transaction)
    .await?;
    if !available {
        return Err(AppError::Validation(
            "Task Cycle is not available in this Project".to_owned(),
        ));
    }
    Ok(())
}

pub(super) async fn validate_modules(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    module_ids: &[Uuid],
) -> Result<(), AppError> {
    if module_ids.is_empty() {
        return Ok(());
    }
    let Some(project_id) = project_id else {
        return Err(AppError::Validation(
            "Inbox Tasks cannot belong to Modules".to_owned(),
        ));
    };
    let enabled: Option<bool> = sqlx::query_scalar(
        "SELECT modules_enabled FROM projects WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL FOR SHARE",
    )
    .bind(workspace_id)
    .bind(project_id)
    .fetch_optional(&mut **transaction)
    .await?;
    if enabled != Some(true) {
        return Err(AppError::Validation(
            "Modules are disabled or unavailable for this Project".to_owned(),
        ));
    }
    let count: i64 = sqlx::query_scalar(
        r#"
        SELECT count(*) FROM project_modules
        WHERE workspace_id = $1 AND project_id = $2
          AND id = ANY($3) AND archived_at IS NULL
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(module_ids)
    .fetch_one(&mut **transaction)
    .await?;
    if count as usize != module_ids.len() {
        return Err(AppError::Validation(
            "One or more Task Modules are unavailable in this Project".to_owned(),
        ));
    }
    Ok(())
}

pub(super) async fn cycle_id(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
) -> Result<Option<Uuid>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT cycle_id FROM task_cycle_assignments WHERE workspace_id = $1 AND task_id = $2",
    )
    .bind(workspace_id)
    .bind(task_id)
    .fetch_optional(&mut **transaction)
    .await?)
}

pub(super) async fn module_ids(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
) -> Result<Vec<Uuid>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT module_id FROM task_module_assignments WHERE workspace_id = $1 AND task_id = $2 ORDER BY module_id",
    )
    .bind(workspace_id)
    .bind(task_id)
    .fetch_all(&mut **transaction)
    .await?)
}

pub(super) async fn delete_cycle(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM task_cycle_assignments WHERE workspace_id = $1 AND task_id = $2")
        .bind(workspace_id)
        .bind(task_id)
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

pub(super) async fn delete_modules(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM task_module_assignments WHERE workspace_id = $1 AND task_id = $2")
        .bind(workspace_id)
        .bind(task_id)
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

pub(super) async fn replace_cycle(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    task_id: Uuid,
    cycle_id: Option<Uuid>,
) -> Result<(), AppError> {
    delete_cycle(transaction, workspace_id, task_id).await?;
    if let (Some(project_id), Some(cycle_id)) = (project_id, cycle_id) {
        sqlx::query(
            "INSERT INTO task_cycle_assignments (workspace_id, project_id, task_id, cycle_id) VALUES ($1, $2, $3, $4)",
        )
        .bind(workspace_id)
        .bind(project_id)
        .bind(task_id)
        .bind(cycle_id)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

pub(super) async fn replace_modules(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    task_id: Uuid,
    module_ids: &[Uuid],
) -> Result<(), AppError> {
    delete_modules(transaction, workspace_id, task_id).await?;
    if let Some(project_id) = project_id
        && !module_ids.is_empty()
    {
        sqlx::query(
            r#"
            INSERT INTO task_module_assignments (workspace_id, project_id, task_id, module_id)
            SELECT $1, $2, $3, module_id FROM unnest($4::uuid[]) AS module_id
            "#,
        )
        .bind(workspace_id)
        .bind(project_id)
        .bind(task_id)
        .bind(module_ids)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}
