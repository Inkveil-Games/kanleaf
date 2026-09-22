mod label;
mod state;

use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection, rejection::PathRejection},
    routing::{get, patch, post, put},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    domain::{ConfigurationDescription, SystemStateRole},
    error::AppError,
    workspace::{require_workspace_admin, require_workspace_member},
};

#[derive(Clone, Debug, Serialize, FromRow)]
pub struct TaskStateResponse {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub name: String,
    pub icon: Option<String>,
    pub color: String,
    pub description: String,
    pub system_role: Option<String>,
    pub position: i32,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, FromRow)]
pub struct TaskLabelResponse {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub name: String,
    pub icon: Option<String>,
    pub color: String,
    pub description: String,
    pub position: i32,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct TaskConfigurationResponse {
    states: Vec<TaskStateResponse>,
    labels: Vec<TaskLabelResponse>,
    default_state_id: Uuid,
    state_property_description: String,
    label_property_description: String,
}

#[derive(Deserialize)]
struct UpdateTaskConfigurationRequest {
    #[serde(default)]
    state_id: Option<Uuid>,
    #[serde(default)]
    state_property_description: Option<String>,
    #[serde(default)]
    label_property_description: Option<String>,
}

#[derive(FromRow)]
struct WorkspaceTaskConfiguration {
    default_state_id: Uuid,
    state_property_description: String,
    label_property_description: String,
}

pub(crate) struct NewWorkspaceTaskConfiguration {
    state_ids: [Uuid; 3],
    legacy_task_type_id: Uuid,
}

impl NewWorkspaceTaskConfiguration {
    pub(crate) fn new() -> Self {
        Self {
            state_ids: std::array::from_fn(|_| Uuid::new_v4()),
            legacy_task_type_id: Uuid::new_v4(),
        }
    }

    pub(crate) const fn default_state_id(&self) -> Uuid {
        self.state_ids[0]
    }

    pub(crate) const fn default_task_type_id(&self) -> Uuid {
        self.legacy_task_type_id
    }

    pub(crate) async fn install(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        workspace_id: Uuid,
    ) -> Result<(), AppError> {
        const STATES: [(&str, &str, &str, SystemStateRole); 3] = [
            ("Todo", "circle", "#64748B", SystemStateRole::Todo),
            (
                "In Progress",
                "loader-circle",
                "#3B82F6",
                SystemStateRole::InProgress,
            ),
            ("Done", "circle-check", "#22A06B", SystemStateRole::Done),
        ];

        for (position, ((name, icon, color, role), state_id)) in
            STATES.into_iter().zip(self.state_ids).enumerate()
        {
            sqlx::query(
                r#"
                INSERT INTO task_states
                    (id, workspace_id, name, icon, color, state_group,
                     system_role, position)
                VALUES ($1, $2, $3, $4, $5, $6, $6, $7)
                "#,
            )
            .bind(state_id)
            .bind(workspace_id)
            .bind(name)
            .bind(icon)
            .bind(color)
            .bind(role.as_str())
            .bind(position as i32)
            .execute(&mut **transaction)
            .await?;
        }

        sqlx::query(
            r#"
            INSERT INTO task_types
                (id, workspace_id, name, icon, color, description, position, is_protected)
            VALUES ($1, $2, 'Task', 'check-square', '#64748B',
                    'General work item', 0, true)
            "#,
        )
        .bind(self.legacy_task_type_id)
        .bind(workspace_id)
        .execute(&mut **transaction)
        .await?;
        Ok(())
    }
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/workspaces/{workspace_id}/task-configuration",
            get(list).patch(update_configuration),
        )
        .route("/api/workspaces/{workspace_id}/states", post(state::create))
        .route(
            "/api/workspaces/{workspace_id}/states/reorder",
            put(state::reorder),
        )
        .route(
            "/api/workspaces/{workspace_id}/states/{state_id}",
            patch(state::update).delete(state::remove),
        )
        .route("/api/workspaces/{workspace_id}/labels", post(label::create))
        .route(
            "/api/workspaces/{workspace_id}/labels/reorder",
            put(label::reorder),
        )
        .route(
            "/api/workspaces/{workspace_id}/labels/{label_id}",
            patch(label::update).delete(label::remove),
        )
}

async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<TaskConfigurationResponse>, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    require_workspace_member(&state.pool, auth.user.id, workspace_id).await?;
    let (states, labels, configuration) = tokio::try_join!(
        state::list(&state.pool, workspace_id),
        label::list(&state.pool, workspace_id),
        load_configuration(&state.pool, workspace_id),
    )?;
    Ok(Json(TaskConfigurationResponse {
        states,
        labels,
        default_state_id: configuration.default_state_id,
        state_property_description: configuration.state_property_description,
        label_property_description: configuration.label_property_description,
    }))
}

async fn update_configuration(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<UpdateTaskConfigurationRequest>, JsonRejection>,
) -> Result<Json<TaskConfigurationResponse>, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    if request.state_id.is_none()
        && request.state_property_description.is_none()
        && request.label_property_description.is_none()
    {
        return Err(AppError::Validation(
            "Provide at least one Task property setting".to_owned(),
        ));
    }
    let state_description = request
        .state_property_description
        .as_deref()
        .map(ConfigurationDescription::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let label_description = request
        .label_property_description
        .as_deref()
        .map(ConfigurationDescription::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let mut transaction = state.pool.begin().await?;
    let found: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE")
            .bind(workspace_id)
            .fetch_optional(&mut *transaction)
            .await?;
    if found.is_none() {
        return Err(AppError::NotFound("Workspace not found".to_owned()));
    }
    if let Some(state_id) = request.state_id {
        validate_state_assignment(&mut transaction, workspace_id, state_id).await?;
    }
    sqlx::query(
        r#"
        UPDATE workspaces
        SET default_inbox_state_id = COALESCE($1, default_inbox_state_id),
            state_property_description = COALESCE($2, state_property_description),
            label_property_description = COALESCE($3, label_property_description),
            updated_at = now()
        WHERE id = $4
        "#,
    )
    .bind(request.state_id)
    .bind(
        state_description
            .as_ref()
            .map(ConfigurationDescription::as_str),
    )
    .bind(
        label_description
            .as_ref()
            .map(ConfigurationDescription::as_str),
    )
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    list(State(state), auth, Ok(Path(workspace_id))).await
}

async fn load_configuration(
    pool: &PgPool,
    workspace_id: Uuid,
) -> Result<WorkspaceTaskConfiguration, AppError> {
    sqlx::query_as(
        r#"
        SELECT default_inbox_state_id AS default_state_id,
               state_property_description,
               label_property_description
        FROM workspaces
        WHERE id = $1
        "#,
    )
    .bind(workspace_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Workspace not found".to_owned()))
}

pub(crate) async fn resolve_task_defaults(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
) -> Result<(Uuid, Uuid), AppError> {
    sqlx::query_as(
        r#"
        SELECT
            CASE WHEN $2::uuid IS NULL
                THEN workspaces.default_inbox_state_id
                ELSE projects.default_state_id
            END,
            CASE WHEN $2::uuid IS NULL
                THEN workspaces.default_task_type_id
                ELSE projects.default_task_type_id
            END
        FROM workspaces
        LEFT JOIN projects
          ON projects.workspace_id = workspaces.id
         AND projects.id = $2
         AND projects.archived_at IS NULL
        WHERE workspaces.id = $1
          AND ($2::uuid IS NULL OR projects.id IS NOT NULL)
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Project not found".to_owned()))
}

pub(crate) async fn validate_state_assignment(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    state_id: Uuid,
) -> Result<(), AppError> {
    let exists: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM task_states
            WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL
        )
        "#,
    )
    .bind(state_id)
    .bind(workspace_id)
    .fetch_one(&mut **transaction)
    .await?;
    if !exists {
        return Err(AppError::Validation(
            "Task state is unavailable in this Workspace".to_owned(),
        ));
    }
    Ok(())
}

pub(crate) async fn validate_task_type_assignment(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    task_type_id: Uuid,
) -> Result<(), AppError> {
    let exists: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM task_types
            WHERE task_types.id = $1
              AND task_types.workspace_id = $2
              AND task_types.archived_at IS NULL
              AND (
                  $3::uuid IS NULL OR EXISTS (
                      SELECT 1 FROM project_task_types
                      WHERE project_task_types.workspace_id = $2
                        AND project_task_types.project_id = $3
                        AND project_task_types.task_type_id = $1
                  )
              )
        )
        "#,
    )
    .bind(task_type_id)
    .bind(workspace_id)
    .bind(project_id)
    .fetch_one(&mut **transaction)
    .await?;
    if !exists {
        return Err(AppError::Validation(
            "Task type is unavailable for this Task location".to_owned(),
        ));
    }
    Ok(())
}

pub(crate) async fn lock_workspace_for_assignment(
    transaction: &mut Transaction<'_, Postgres>,
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
