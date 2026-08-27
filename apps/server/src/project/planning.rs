use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::error::AppError;

#[derive(Clone, Copy)]
pub(super) enum PlanningFeature {
    Cycles,
    Modules,
}

impl PlanningFeature {
    const fn column(self) -> &'static str {
        match self {
            Self::Cycles => "cycles_enabled",
            Self::Modules => "modules_enabled",
        }
    }

    const fn label(self) -> &'static str {
        match self {
            Self::Cycles => "Cycles",
            Self::Modules => "Modules",
        }
    }
}

pub(super) async fn require_feature(
    pool: &PgPool,
    workspace_id: Uuid,
    project_id: Uuid,
    feature: PlanningFeature,
) -> Result<(), AppError> {
    let enabled: Option<bool> = sqlx::query_scalar(&format!(
        "SELECT {} FROM projects WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL",
        feature.column()
    ))
    .bind(workspace_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await?;
    match enabled {
        Some(true) => Ok(()),
        Some(false) => Err(AppError::Validation(format!(
            "{} are disabled for this Project",
            feature.label()
        ))),
        None => Err(AppError::NotFound("Project not found".to_owned())),
    }
}

pub(super) async fn lock_feature(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Uuid,
    feature: PlanningFeature,
) -> Result<(), AppError> {
    let enabled: Option<bool> = sqlx::query_scalar(&format!(
        "SELECT {} FROM projects WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL FOR UPDATE",
        feature.column()
    ))
    .bind(workspace_id)
    .bind(project_id)
    .fetch_optional(&mut **transaction)
    .await?;
    match enabled {
        Some(true) => Ok(()),
        Some(false) => Err(AppError::Validation(format!(
            "{} are disabled for this Project",
            feature.label()
        ))),
        None => Err(AppError::NotFound("Project not found".to_owned())),
    }
}

pub(super) async fn validate_lead(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Uuid,
    user_id: Option<Uuid>,
) -> Result<(), AppError> {
    let Some(user_id) = user_id else {
        return Ok(());
    };
    let eligible: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM workspace_memberships
            LEFT JOIN project_memberships
              ON project_memberships.workspace_id = workspace_memberships.workspace_id
             AND project_memberships.project_id = $2
             AND project_memberships.user_id = workspace_memberships.user_id
            WHERE workspace_memberships.workspace_id = $1
              AND workspace_memberships.user_id = $3
              AND (
                  workspace_memberships.role IN ('owner', 'admin')
                  OR project_memberships.user_id IS NOT NULL
              )
        )
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(user_id)
    .fetch_one(&mut **transaction)
    .await?;
    if !eligible {
        return Err(AppError::Validation(
            "Module lead must have access to this Project".to_owned(),
        ));
    }
    Ok(())
}
