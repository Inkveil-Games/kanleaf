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
    domain::{ConfigurationDescription, DateDefault, SystemStateRole, TaskPriority},
    error::AppError,
    workspace::{require_workspace_admin, require_workspace_member},
};

#[derive(Clone, Debug, Serialize, FromRow)]
pub struct TaskStateResponse {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub name: String,
    pub color: String,
    pub description: String,
    pub system_role: String,
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
    default_label_ids: Vec<Uuid>,
    default_priority: String,
    default_start_date: Option<DateDefault>,
    default_due_date: Option<DateDefault>,
    default_state_id: Uuid,
    state_property_description: String,
    label_property_description: String,
}

#[derive(Deserialize)]
struct UpdateTaskConfigurationRequest {
    #[serde(default, deserialize_with = "crate::task::deserialize_present")]
    default_priority: Option<TaskPriority>,
    #[serde(default, deserialize_with = "crate::task::deserialize_nullable")]
    default_start_date: Option<Option<DateDefault>>,
    #[serde(default, deserialize_with = "crate::task::deserialize_nullable")]
    default_due_date: Option<Option<DateDefault>>,
    #[serde(default)]
    state_id: Option<Uuid>,
    #[serde(default)]
    default_label_ids: Option<Vec<Uuid>>,
    #[serde(default)]
    state_property_description: Option<String>,
    #[serde(default)]
    label_property_description: Option<String>,
}

#[derive(FromRow)]
struct WorkspaceTaskConfiguration {
    default_priority: String,
    #[sqlx(json(nullable))]
    default_start_date: Option<DateDefault>,
    #[sqlx(json(nullable))]
    default_due_date: Option<DateDefault>,
    default_state_id: Uuid,
    state_property_description: String,
    label_property_description: String,
}

pub(crate) struct NewWorkspaceTaskConfiguration {
    state_ids: [Uuid; 5],
}

impl NewWorkspaceTaskConfiguration {
    pub(crate) fn new() -> Self {
        Self {
            state_ids: std::array::from_fn(|_| Uuid::new_v4()),
        }
    }

    pub(crate) const fn default_state_id(&self) -> Uuid {
        self.state_ids[1]
    }

    pub(crate) async fn install(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        workspace_id: Uuid,
    ) -> Result<(), AppError> {
        const STATES: [(&str, &str, &str, SystemStateRole); 5] = [
            (
                "Backlog",
                "#727480",
                "Ideas and unprioritized work.",
                SystemStateRole::Backlog,
            ),
            (
                "Todo",
                "#7A4DD1",
                "Ready to be worked on.",
                SystemStateRole::Todo,
            ),
            (
                "In Progress",
                "#296DD6",
                "Currently being worked on.",
                SystemStateRole::InProgress,
            ),
            (
                "Done",
                "#2F945C",
                "Completed and ready to close.",
                SystemStateRole::Done,
            ),
            (
                "Cancelled",
                "#D63D3C",
                "Won't be completed.",
                SystemStateRole::Cancelled,
            ),
        ];

        for (position, ((name, color, description, role), state_id)) in
            STATES.into_iter().zip(self.state_ids).enumerate()
        {
            sqlx::query(
                r#"
                INSERT INTO task_states
                    (id, workspace_id, name, color, description, system_role, position)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                "#,
            )
            .bind(state_id)
            .bind(workspace_id)
            .bind(name)
            .bind(color)
            .bind(description)
            .bind(role.as_str())
            .bind(position as i32)
            .execute(&mut **transaction)
            .await?;
        }

        Ok(())
    }
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/workspaces/{workspace_id}/task-configuration",
            get(list).patch(update_configuration),
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
        default_label_ids: sqlx::query_scalar("SELECT defaults.label_id FROM workspace_default_labels AS defaults JOIN task_labels AS labels ON labels.workspace_id = defaults.workspace_id AND labels.id = defaults.label_id WHERE defaults.workspace_id = $1 ORDER BY labels.position, labels.id")
            .bind(workspace_id).fetch_all(&state.pool).await?,
        default_priority: configuration.default_priority,
        default_start_date: configuration.default_start_date,
        default_due_date: configuration.default_due_date,
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
        && request.default_label_ids.is_none()
        && request.default_priority.is_none()
        && request.default_start_date.is_none()
        && request.default_due_date.is_none()
    {
        return Err(AppError::Validation(
            "Provide at least one Task property setting".to_owned(),
        ));
    }
    for default in [&request.default_start_date, &request.default_due_date]
        .into_iter()
        .flatten()
        .flatten()
    {
        default
            .validate()
            .map_err(|error| AppError::Validation(error.to_string()))?;
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
    if request.default_start_date.is_some() || request.default_due_date.is_some() {
        let reference_date =
            crate::domain::local_reference_date(jiff::Timestamp::now(), &auth.user.timezone)
                .map_err(|error| AppError::Validation(error.to_string()))?;
        let current = resolve_builtin_defaults(&mut transaction, workspace_id).await?;
        let start = request
            .default_start_date
            .as_ref()
            .unwrap_or(&current.start_date);
        let due = request
            .default_due_date
            .as_ref()
            .unwrap_or(&current.due_date);
        let resolve = |default: &Option<DateDefault>| -> Result<_, AppError> {
            default
                .as_ref()
                .map(|default| default.resolve(reference_date))
                .transpose()
                .map_err(|error| AppError::Validation(error.to_string()))
        };
        crate::task::validate_schedule(resolve(start)?, resolve(due)?, None)?;
    }
    if let Some(state_id) = request.state_id {
        validate_state_assignment(&mut transaction, workspace_id, state_id).await?;
    }
    if let Some(ids) = &request.default_label_ids {
        if ids
            .iter()
            .copied()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != ids.len()
        {
            return Err(AppError::Validation(
                "Default labels cannot contain duplicates".to_owned(),
            ));
        }
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM task_labels WHERE workspace_id = $1 AND id = ANY($2) AND archived_at IS NULL")
            .bind(workspace_id).bind(ids).fetch_one(&mut *transaction).await?;
        if count as usize != ids.len() {
            return Err(AppError::Validation(
                "Default labels must be active labels in this Workspace".to_owned(),
            ));
        }
        sqlx::query("DELETE FROM workspace_default_labels WHERE workspace_id = $1")
            .bind(workspace_id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("INSERT INTO workspace_default_labels (workspace_id, label_id) SELECT $1, unnest($2::uuid[])").bind(workspace_id).bind(ids).execute(&mut *transaction).await?;
    }
    sqlx::query(
        r#"
        UPDATE workspaces
        SET default_inbox_state_id = COALESCE($1, default_inbox_state_id),
            state_property_description = COALESCE($2, state_property_description),
            label_property_description = COALESCE($3, label_property_description),
            default_priority = COALESCE($5, default_priority),
            default_start_date = CASE WHEN $6 THEN $7 ELSE default_start_date END,
            default_due_date = CASE WHEN $8 THEN $9 ELSE default_due_date END,
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
    .bind(request.default_priority.map(TaskPriority::as_str))
    .bind(request.default_start_date.is_some())
    .bind(
        request
            .default_start_date
            .as_ref()
            .and_then(Option::as_ref)
            .map(sqlx::types::Json),
    )
    .bind(request.default_due_date.is_some())
    .bind(
        request
            .default_due_date
            .as_ref()
            .and_then(Option::as_ref)
            .map(sqlx::types::Json),
    )
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
               label_property_description, default_priority, default_start_date, default_due_date
        FROM workspaces
        WHERE id = $1
        "#,
    )
    .bind(workspace_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Workspace not found".to_owned()))
}

pub(crate) async fn resolve_task_default(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
) -> Result<Uuid, AppError> {
    sqlx::query_scalar(
        r#"
        SELECT CASE WHEN $2::uuid IS NULL
            THEN workspaces.default_inbox_state_id
            ELSE projects.default_state_id
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

pub(crate) async fn resolve_default_labels(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
) -> Result<Vec<Uuid>, AppError> {
    Ok(sqlx::query_scalar("SELECT defaults.label_id FROM workspace_default_labels AS defaults JOIN task_labels AS labels ON labels.workspace_id = defaults.workspace_id AND labels.id = defaults.label_id WHERE defaults.workspace_id = $1 AND labels.archived_at IS NULL ORDER BY labels.position, labels.id")
        .bind(workspace_id).fetch_all(&mut **transaction).await?)
}

#[derive(FromRow)]
pub(crate) struct BuiltinTaskDefaults {
    pub priority: String,
    #[sqlx(json(nullable))]
    pub start_date: Option<DateDefault>,
    #[sqlx(json(nullable))]
    pub due_date: Option<DateDefault>,
}

pub(crate) async fn resolve_builtin_defaults(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
) -> Result<BuiltinTaskDefaults, AppError> {
    Ok(sqlx::query_as("SELECT default_priority AS priority, default_start_date AS start_date, default_due_date AS due_date FROM workspaces WHERE id = $1")
        .bind(workspace_id).fetch_one(&mut **transaction).await?)
}
