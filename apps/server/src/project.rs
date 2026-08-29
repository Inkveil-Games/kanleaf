mod access;
mod cycle;
mod membership;
mod module;
mod planning;

use std::collections::HashSet;

use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection, rejection::PathRejection},
    http::StatusCode,
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    domain::{ProjectDescription, ProjectIdentifier, ProjectVisibility, ResourceName},
    error::{AppError, is_unique_violation},
    task_config::{validate_state_assignment, validate_task_type_assignment},
    workspace::{WorkspaceRole, workspace_role},
};

pub(crate) use access::{
    require_project_access, require_project_admin, require_project_commenter,
    require_project_editor,
};

#[derive(Clone, Debug, Serialize, FromRow)]
pub struct ProjectResponse {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub name: String,
    pub identifier: String,
    pub description: String,
    pub lead_user_id: Option<Uuid>,
    pub visibility: String,
    pub default_assignee_id: Option<Uuid>,
    pub default_state_id: Uuid,
    pub default_task_type_id: Uuid,
    pub cycles_enabled: bool,
    pub modules_enabled: bool,
    pub pages_enabled: bool,
    pub views_enabled: bool,
    pub enabled_task_type_ids: Vec<Uuid>,
    pub effective_role: Option<String>,
    pub can_join: bool,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub(crate) struct CreateProjectRequest {
    name: String,
    #[serde(default)]
    identifier: Option<String>,
}

#[derive(Deserialize)]
struct UpdateProjectRequest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    identifier: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable_uuid_patch")]
    lead_user_id: Option<Option<Uuid>>,
    #[serde(default)]
    visibility: Option<ProjectVisibility>,
    #[serde(default, deserialize_with = "deserialize_nullable_uuid_patch")]
    default_assignee_id: Option<Option<Uuid>>,
    #[serde(default)]
    default_state_id: Option<Uuid>,
    #[serde(default)]
    default_task_type_id: Option<Uuid>,
    #[serde(default)]
    enabled_task_type_ids: Option<Vec<Uuid>>,
    #[serde(default)]
    cycles_enabled: Option<bool>,
    #[serde(default)]
    modules_enabled: Option<bool>,
    #[serde(default)]
    pages_enabled: Option<bool>,
    #[serde(default)]
    views_enabled: Option<bool>,
}

#[derive(Deserialize)]
struct DeleteProjectRequest {
    identifier: String,
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/workspaces/{workspace_id}/projects",
            get(list).post(create),
        )
        .route(
            "/api/workspaces/{workspace_id}/projects/{project_id}",
            get(detail).patch(update).delete(archive),
        )
        .route(
            "/api/workspaces/{workspace_id}/projects/{project_id}/archive",
            post(archive),
        )
        .route(
            "/api/workspaces/{workspace_id}/projects/{project_id}/delete",
            post(delete_project),
        )
        .merge(membership::routes())
        .merge(cycle::routes())
        .merge(module::routes())
}

async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<Vec<ProjectResponse>>, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    workspace_role(&state.pool, auth.user.id, workspace_id).await?;
    let projects = sqlx::query_as::<_, ProjectResponse>(
        r#"
        SELECT projects.id, projects.workspace_id, projects.name,
               projects.identifier, projects.description, projects.lead_user_id,
               projects.visibility, projects.default_assignee_id,
               projects.default_state_id, projects.default_task_type_id,
               projects.cycles_enabled, projects.modules_enabled,
               projects.pages_enabled, projects.views_enabled,
               ARRAY(
                   SELECT project_task_types.task_type_id
                   FROM project_task_types
                   JOIN task_types ON task_types.id = project_task_types.task_type_id
                   WHERE project_task_types.workspace_id = projects.workspace_id
                     AND project_task_types.project_id = projects.id
                   ORDER BY task_types.position, task_types.id
               ) AS enabled_task_type_ids,
               CASE
                   WHEN workspace_memberships.role IN ('owner', 'admin') THEN 'admin'
                   ELSE project_memberships.role
               END AS effective_role,
               workspace_memberships.role = 'member'
                   AND projects.visibility = 'open'
                   AND project_memberships.user_id IS NULL AS can_join,
               projects.archived_at, projects.created_at, projects.updated_at
        FROM projects
        JOIN workspace_memberships
          ON workspace_memberships.workspace_id = projects.workspace_id
         AND workspace_memberships.user_id = $1
        LEFT JOIN project_memberships
          ON project_memberships.workspace_id = projects.workspace_id
         AND project_memberships.project_id = projects.id
         AND project_memberships.user_id = $1
        WHERE projects.workspace_id = $2
          AND projects.archived_at IS NULL
          AND (
              workspace_memberships.role IN ('owner', 'admin')
              OR project_memberships.user_id IS NOT NULL
              OR (
                  workspace_memberships.role = 'member'
                  AND projects.visibility = 'open'
              )
          )
        ORDER BY projects.created_at, projects.id
        "#,
    )
    .bind(auth.user.id)
    .bind(workspace_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(projects))
}

async fn detail(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<ProjectResponse>, AppError> {
    let Path((workspace_id, project_id)) = path.map_err(AppError::from)?;
    require_project_access(&state.pool, auth.user.id, workspace_id, project_id).await?;
    Ok(Json(
        select_project(&state.pool, auth.user.id, workspace_id, project_id).await?,
    ))
}

async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<CreateProjectRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ProjectResponse>), AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let name = ResourceName::new(&request.name)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let role = workspace_role(&state.pool, auth.user.id, workspace_id).await?;
    if role == WorkspaceRole::Guest {
        return Err(AppError::Forbidden);
    }

    let project_id = Uuid::new_v4();
    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    let identifier = match request.identifier {
        Some(identifier) => ProjectIdentifier::new(&identifier)
            .map_err(|error| AppError::Validation(error.to_string()))?,
        None => generate_identifier(&mut transaction, workspace_id, name.as_str()).await?,
    };
    let result = sqlx::query(
        r#"
        INSERT INTO projects (
            id, workspace_id, name, identifier, lead_user_id,
            default_state_id, default_task_type_id
        )
        SELECT $1, id, $3, $4, $5,
               default_inbox_state_id, default_task_type_id
        FROM workspaces
        WHERE id = $2
        "#,
    )
    .bind(project_id)
    .bind(workspace_id)
    .bind(name.as_str())
    .bind(identifier.as_str())
    .bind(auth.user.id)
    .execute(&mut *transaction)
    .await;
    match result {
        Ok(_) => {}
        Err(error) if is_unique_violation(&error) => {
            return Err(AppError::Conflict(
                "Project name or identifier is already in use".to_owned(),
            ));
        }
        Err(error) => return Err(error.into()),
    }
    sqlx::query(
        r#"
        INSERT INTO project_task_types (workspace_id, project_id, task_type_id)
        SELECT workspace_id, $1, id
        FROM task_types
        WHERE workspace_id = $2 AND archived_at IS NULL
        "#,
    )
    .bind(project_id)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await?;
    if role == WorkspaceRole::Member {
        sqlx::query(
            r#"
            INSERT INTO project_memberships
                (workspace_id, project_id, user_id, role)
            VALUES ($1, $2, $3, 'admin')
            "#,
        )
        .bind(workspace_id)
        .bind(project_id)
        .bind(auth.user.id)
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(select_project(&state.pool, auth.user.id, workspace_id, project_id).await?),
    ))
}

async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<UpdateProjectRequest>, JsonRejection>,
) -> Result<Json<ProjectResponse>, AppError> {
    let Path((workspace_id, project_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    if request.is_empty() {
        return Err(AppError::Validation(
            "Provide at least one Project field to update".to_owned(),
        ));
    }
    let name = request
        .name
        .as_deref()
        .map(ResourceName::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let identifier = request
        .identifier
        .as_deref()
        .map(ProjectIdentifier::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let description = request
        .description
        .as_deref()
        .map(ProjectDescription::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    require_project_admin(&state.pool, auth.user.id, workspace_id, project_id).await?;

    let mut transaction = state.pool.begin().await?;
    lock_workspace_for_assignment(&mut transaction, workspace_id).await?;
    let (current_state_id, current_type_id): (Uuid, Uuid) = sqlx::query_as(
        r#"
        SELECT default_state_id, default_task_type_id
        FROM projects
        WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL
        FOR UPDATE
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Project not found".to_owned()))?;

    let default_state_id = request.default_state_id.unwrap_or(current_state_id);
    let default_task_type_id = request.default_task_type_id.unwrap_or(current_type_id);
    if request.default_state_id.is_some() {
        validate_state_assignment(&mut transaction, workspace_id, default_state_id).await?;
    }
    if request.default_task_type_id.is_some() || request.enabled_task_type_ids.is_some() {
        validate_task_type_assignment(&mut transaction, workspace_id, None, default_task_type_id)
            .await?;
    }
    if let Some(ids) = &request.enabled_task_type_ids {
        validate_enabled_types(&mut transaction, workspace_id, ids, default_task_type_id).await?;
    }
    if let Some(Some(user_id)) = request.lead_user_id {
        validate_project_admin_candidate(&mut transaction, workspace_id, project_id, user_id)
            .await?;
    }
    if let Some(Some(user_id)) = request.default_assignee_id {
        validate_project_member_candidate(&mut transaction, workspace_id, project_id, user_id)
            .await?;
    }

    let lead_changed = request.lead_user_id.is_some();
    let lead_user_id = request.lead_user_id.flatten();
    let assignee_changed = request.default_assignee_id.is_some();
    let default_assignee_id = request.default_assignee_id.flatten();
    let updated = sqlx::query(
        r#"
        UPDATE projects
        SET name = COALESCE($1, name),
            identifier = COALESCE($2, identifier),
            description = COALESCE($3, description),
            lead_user_id = CASE WHEN $4 THEN $5 ELSE lead_user_id END,
            visibility = COALESCE($6, visibility),
            default_assignee_id = CASE WHEN $7 THEN $8 ELSE default_assignee_id END,
            default_state_id = COALESCE($9, default_state_id),
            default_task_type_id = COALESCE($10, default_task_type_id),
            cycles_enabled = COALESCE($11, cycles_enabled),
            modules_enabled = COALESCE($12, modules_enabled),
            pages_enabled = COALESCE($13, pages_enabled),
            views_enabled = COALESCE($14, views_enabled),
            updated_at = now()
        WHERE workspace_id = $15 AND id = $16 AND archived_at IS NULL
        "#,
    )
    .bind(name.as_ref().map(ResourceName::as_str))
    .bind(identifier.as_ref().map(ProjectIdentifier::as_str))
    .bind(description.as_ref().map(ProjectDescription::as_str))
    .bind(lead_changed)
    .bind(lead_user_id)
    .bind(request.visibility.map(ProjectVisibility::as_str))
    .bind(assignee_changed)
    .bind(default_assignee_id)
    .bind(request.default_state_id)
    .bind(request.default_task_type_id)
    .bind(request.cycles_enabled)
    .bind(request.modules_enabled)
    .bind(request.pages_enabled)
    .bind(request.views_enabled)
    .bind(workspace_id)
    .bind(project_id)
    .execute(&mut *transaction)
    .await;
    match updated {
        Ok(_) => {}
        Err(error) if is_unique_violation(&error) => {
            return Err(AppError::Conflict(
                "Project name or identifier is already in use".to_owned(),
            ));
        }
        Err(error) => return Err(error.into()),
    }
    if let Some(ids) = request.enabled_task_type_ids {
        sqlx::query("DELETE FROM project_task_types WHERE workspace_id = $1 AND project_id = $2")
            .bind(workspace_id)
            .bind(project_id)
            .execute(&mut *transaction)
            .await?;
        for task_type_id in ids {
            sqlx::query(
                r#"
                INSERT INTO project_task_types
                    (workspace_id, project_id, task_type_id)
                VALUES ($1, $2, $3)
                "#,
            )
            .bind(workspace_id)
            .bind(project_id)
            .bind(task_type_id)
            .execute(&mut *transaction)
            .await?;
        }
    }
    transaction.commit().await?;
    Ok(Json(
        select_project(&state.pool, auth.user.id, workspace_id, project_id).await?,
    ))
}

async fn archive(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, project_id)) = path.map_err(AppError::from)?;
    require_project_admin(&state.pool, auth.user.id, workspace_id, project_id).await?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    let result = sqlx::query(
        "UPDATE projects SET archived_at = now(), updated_at = now() WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL",
    )
    .bind(project_id)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Project not found".to_owned()));
    }
    move_tasks_to_inbox(&mut transaction, workspace_id, project_id).await?;
    move_documents_to_workspace(&mut transaction, workspace_id, project_id).await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_project(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<DeleteProjectRequest>, JsonRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, project_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    require_project_admin(&state.pool, auth.user.id, workspace_id, project_id).await?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    let identifier: Option<String> = sqlx::query_scalar(
        "SELECT identifier FROM projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
    )
    .bind(workspace_id)
    .bind(project_id)
    .fetch_optional(&mut *transaction)
    .await?;
    let identifier =
        identifier.ok_or_else(|| AppError::NotFound("Project not found".to_owned()))?;
    if request.identifier.trim().to_ascii_uppercase() != identifier {
        return Err(AppError::Validation(
            "Project identifier does not match".to_owned(),
        ));
    }
    move_tasks_to_inbox(&mut transaction, workspace_id, project_id).await?;
    move_documents_to_workspace(&mut transaction, workspace_id, project_id).await?;
    sqlx::query("DELETE FROM projects WHERE workspace_id = $1 AND id = $2")
        .bind(workspace_id)
        .bind(project_id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn move_documents_to_workspace(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Uuid,
) -> Result<(), AppError> {
    // A Project archive must not strand durable Pages behind an inaccessible
    // Project scope. Moving the whole forest preserves parent relationships.
    sqlx::query(
        r#"
        UPDATE documents
        SET project_id = NULL, updated_at = now()
        WHERE workspace_id = $1 AND project_id = $2
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

impl UpdateProjectRequest {
    fn is_empty(&self) -> bool {
        self.name.is_none()
            && self.identifier.is_none()
            && self.description.is_none()
            && self.lead_user_id.is_none()
            && self.visibility.is_none()
            && self.default_assignee_id.is_none()
            && self.default_state_id.is_none()
            && self.default_task_type_id.is_none()
            && self.enabled_task_type_ids.is_none()
            && self.cycles_enabled.is_none()
            && self.modules_enabled.is_none()
            && self.pages_enabled.is_none()
            && self.views_enabled.is_none()
    }
}

async fn select_project(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
    project_id: Uuid,
) -> Result<ProjectResponse, AppError> {
    sqlx::query_as::<_, ProjectResponse>(
        r#"
        SELECT projects.id, projects.workspace_id, projects.name,
               projects.identifier, projects.description, projects.lead_user_id,
               projects.visibility, projects.default_assignee_id,
               projects.default_state_id, projects.default_task_type_id,
               projects.cycles_enabled, projects.modules_enabled,
               projects.pages_enabled, projects.views_enabled,
               ARRAY(
                   SELECT project_task_types.task_type_id
                   FROM project_task_types
                   JOIN task_types ON task_types.id = project_task_types.task_type_id
                   WHERE project_task_types.workspace_id = projects.workspace_id
                     AND project_task_types.project_id = projects.id
                   ORDER BY task_types.position, task_types.id
               ) AS enabled_task_type_ids,
               CASE
                   WHEN workspace_memberships.role IN ('owner', 'admin') THEN 'admin'
                   ELSE project_memberships.role
               END AS effective_role,
               false AS can_join,
               projects.archived_at, projects.created_at, projects.updated_at
        FROM projects
        JOIN workspace_memberships
          ON workspace_memberships.workspace_id = projects.workspace_id
         AND workspace_memberships.user_id = $1
        LEFT JOIN project_memberships
          ON project_memberships.workspace_id = projects.workspace_id
         AND project_memberships.project_id = projects.id
         AND project_memberships.user_id = $1
        WHERE projects.workspace_id = $2 AND projects.id = $3
        "#,
    )
    .bind(user_id)
    .bind(workspace_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Project not found".to_owned()))
}

async fn generate_identifier(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    name: &str,
) -> Result<ProjectIdentifier, AppError> {
    let mut base: String = name
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(8)
        .collect::<String>()
        .to_ascii_uppercase();
    if base.len() < 2 {
        base = "PRJ".to_owned();
    }
    for ordinal in 1..=9999 {
        let suffix = if ordinal == 1 {
            String::new()
        } else {
            ordinal.to_string()
        };
        let prefix_length = 12usize.saturating_sub(suffix.len());
        let candidate = format!("{}{}", &base[..base.len().min(prefix_length)], suffix);
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE workspace_id = $1 AND identifier = $2)",
        )
        .bind(workspace_id)
        .bind(&candidate)
        .fetch_one(&mut **transaction)
        .await?;
        if !exists {
            return ProjectIdentifier::new(&candidate)
                .map_err(|error| AppError::Validation(error.to_string()));
        }
    }
    Err(AppError::Conflict(
        "Could not allocate a unique Project identifier".to_owned(),
    ))
}

async fn validate_enabled_types(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    ids: &[Uuid],
    default_task_type_id: Uuid,
) -> Result<(), AppError> {
    let unique: HashSet<_> = ids.iter().copied().collect();
    if ids.is_empty() || unique.len() != ids.len() || !unique.contains(&default_task_type_id) {
        return Err(AppError::Validation(
            "Enabled types must be unique and include the Project default".to_owned(),
        ));
    }
    let available: i64 = sqlx::query_scalar(
        r#"
        SELECT count(*) FROM task_types
        WHERE workspace_id = $1 AND archived_at IS NULL AND id = ANY($2)
        "#,
    )
    .bind(workspace_id)
    .bind(ids)
    .fetch_one(&mut **transaction)
    .await?;
    if usize::try_from(available).ok() != Some(ids.len()) {
        return Err(AppError::Validation(
            "Every enabled task type must be active in this Workspace".to_owned(),
        ));
    }
    Ok(())
}

async fn validate_project_admin_candidate(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let valid: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM workspace_memberships
            WHERE workspace_id = $1 AND user_id = $3
              AND (
                  role IN ('owner', 'admin') OR EXISTS(
                      SELECT 1 FROM project_memberships
                      WHERE workspace_id = $1 AND project_id = $2
                        AND user_id = $3 AND role = 'admin'
                  )
              )
        )
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(user_id)
    .fetch_one(&mut **transaction)
    .await?;
    if !valid {
        return Err(AppError::Validation(
            "Project lead must have effective Project Admin access".to_owned(),
        ));
    }
    Ok(())
}

async fn validate_project_member_candidate(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let valid: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM workspace_memberships
            WHERE workspace_id = $1 AND user_id = $3
              AND (
                  role IN ('owner', 'admin') OR EXISTS(
                      SELECT 1 FROM project_memberships
                      WHERE workspace_id = $1 AND project_id = $2 AND user_id = $3
                  )
              )
        )
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(user_id)
    .fetch_one(&mut **transaction)
    .await?;
    if !valid {
        return Err(AppError::Validation(
            "Default assignee must have access to this Project".to_owned(),
        ));
    }
    Ok(())
}

async fn lock_workspace(
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

async fn lock_workspace_for_assignment(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
) -> Result<(), AppError> {
    let found: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM workspaces WHERE id = $1 FOR SHARE")
            .bind(workspace_id)
            .fetch_optional(&mut **transaction)
            .await?;
    found
        .map(|_| ())
        .ok_or_else(|| AppError::NotFound("Workspace not found".to_owned()))
}

async fn move_tasks_to_inbox(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Uuid,
) -> Result<(), AppError> {
    // Preserve work when a Project leaves navigation; Inbox is the neutral scope.
    sqlx::query("DELETE FROM task_cycle_assignments WHERE workspace_id = $1 AND project_id = $2")
        .bind(workspace_id)
        .bind(project_id)
        .execute(&mut **transaction)
        .await?;
    sqlx::query("DELETE FROM task_module_assignments WHERE workspace_id = $1 AND project_id = $2")
        .bind(workspace_id)
        .bind(project_id)
        .execute(&mut **transaction)
        .await?;
    sqlx::query(
        r#"
        DELETE FROM task_assignees
        USING tasks, workspace_memberships
        WHERE task_assignees.workspace_id = $1
          AND task_assignees.task_id = tasks.id
          AND tasks.workspace_id = $1
          AND tasks.project_id = $2
          AND workspace_memberships.workspace_id = $1
          AND workspace_memberships.user_id = task_assignees.user_id
          AND workspace_memberships.role = 'guest'
        "#,
    )
    .bind(workspace_id)
    .bind(project_id)
    .execute(&mut **transaction)
    .await?;
    sqlx::query(
        "UPDATE tasks SET project_id = NULL, updated_at = now() WHERE workspace_id = $1 AND project_id = $2",
    )
    .bind(workspace_id)
    .bind(project_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

fn deserialize_nullable_uuid_patch<'de, D>(
    deserializer: D,
) -> Result<Option<Option<Uuid>>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<Uuid>::deserialize(deserializer).map(Some)
}
