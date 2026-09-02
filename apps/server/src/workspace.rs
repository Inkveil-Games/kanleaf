mod invitation;
mod membership;
mod vault_migration;

pub use vault_migration::migrate_workspace_vaults;

use anyhow::anyhow;
use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection, rejection::PathRejection},
    http::StatusCode,
    routing::{get, patch, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use tracing::warn;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{AuthenticatedUser, verify_password},
    document,
    domain::{ResourceName, ValidatedPassword, WorkspaceIdentifier},
    error::{AppError, is_unique_violation},
    project, saved_view, task, task_config,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WorkspaceRole {
    Owner,
    Admin,
    Member,
    Guest,
}

pub(crate) enum WorkspaceDeletionAuthority {
    Owner {
        user_id: Uuid,
        verified_password_hash: String,
    },
    Host {
        user_id: Uuid,
        verified_password_hash: String,
    },
}

impl WorkspaceRole {
    pub(crate) const fn can_manage(self) -> bool {
        matches!(self, Self::Owner | Self::Admin)
    }

    pub(crate) const fn can_access_content(self) -> bool {
        !matches!(self, Self::Guest)
    }

    pub(crate) fn from_database(value: &str) -> Result<Self, AppError> {
        match value {
            "owner" => Ok(Self::Owner),
            "admin" => Ok(Self::Admin),
            "member" => Ok(Self::Member),
            "guest" => Ok(Self::Guest),
            _ => Err(AppError::internal(anyhow!(
                "database contains invalid workspace role"
            ))),
        }
    }
}

#[derive(Clone, Copy, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(super) enum AssignableWorkspaceRole {
    Admin,
    Member,
    Guest,
}

impl AssignableWorkspaceRole {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::Admin => "admin",
            Self::Member => "member",
            Self::Guest => "guest",
        }
    }

    const fn is_admin(self) -> bool {
        matches!(self, Self::Admin)
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum WorkspaceAccent {
    Sage,
    Blue,
    Amber,
    Rose,
    Violet,
    Slate,
}

impl WorkspaceAccent {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Sage => "sage",
            Self::Blue => "blue",
            Self::Amber => "amber",
            Self::Rose => "rose",
            Self::Violet => "violet",
            Self::Slate => "slate",
        }
    }
}

#[derive(Debug, Serialize, FromRow)]
pub struct WorkspaceResponse {
    pub id: Uuid,
    pub name: String,
    pub identifier: String,
    pub accent: String,
    pub role: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct CreateWorkspaceRequest {
    name: String,
    #[serde(default)]
    identifier: Option<String>,
    #[serde(default)]
    accent: Option<WorkspaceAccent>,
}

#[derive(Deserialize)]
struct UpdateWorkspaceRequest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    accent: Option<WorkspaceAccent>,
}

#[derive(Deserialize)]
struct DeleteWorkspaceRequest {
    name: String,
    password: String,
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/workspaces", get(list).post(create))
        .route(
            "/api/workspaces/{workspace_id}",
            patch(update).delete(delete_workspace),
        )
        .route("/api/workspaces/{workspace_id}/activate", post(activate))
        .merge(membership::routes())
        .merge(invitation::routes())
        .merge(task_config::routes())
        .merge(project::routes())
        .merge(saved_view::routes())
        .merge(document::routes())
        .route(
            "/api/workspaces/{workspace_id}/tasks",
            get(task::list).post(task::create),
        )
        .route(
            "/api/workspaces/{workspace_id}/tasks/bulk",
            patch(task::bulk_update),
        )
        .route(
            "/api/workspaces/{workspace_id}/tasks/reorder",
            axum::routing::put(task::reorder),
        )
        .route(
            "/api/workspaces/{workspace_id}/tasks/query",
            post(task::query),
        )
        .route(
            "/api/workspaces/{workspace_id}/tasks/by-number/{task_number}",
            get(task::get_by_number),
        )
        .route(
            "/api/workspaces/{workspace_id}/tasks/{task_id}",
            get(task::get).patch(task::update).delete(task::archive),
        )
        .route(
            "/api/workspaces/{workspace_id}/tasks/{task_id}/delete",
            post(task::delete_permanently),
        )
        .route(
            "/api/workspaces/{workspace_id}/tasks/{task_id}/relations",
            post(task::add_relation),
        )
        .route(
            "/api/workspaces/{workspace_id}/tasks/{task_id}/relations/{related_task_id}",
            axum::routing::delete(task::remove_relation),
        )
        .route(
            "/api/workspaces/{workspace_id}/tasks/{task_id}/document",
            get(task::read_document).put(task::write_document),
        )
}

async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<Json<Vec<WorkspaceResponse>>, AppError> {
    let workspaces = sqlx::query_as::<_, WorkspaceResponse>(
        r#"
        SELECT workspaces.id, workspaces.name, workspaces.identifier, workspaces.accent,
               workspace_memberships.role, workspaces.created_at, workspaces.updated_at
        FROM workspaces
        JOIN workspace_memberships ON workspace_memberships.workspace_id = workspaces.id
        WHERE workspace_memberships.user_id = $1
        ORDER BY workspaces.created_at, workspaces.id
        "#,
    )
    .bind(auth.user.id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(workspaces))
}

async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    payload: Result<Json<CreateWorkspaceRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<WorkspaceResponse>), AppError> {
    let Json(request) = payload.map_err(AppError::from)?;
    require_account_details(&auth.user.setup_stage)?;
    let name = ResourceName::new(&request.name)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let accent = request.accent.unwrap_or(WorkspaceAccent::Sage);
    let workspace_id = Uuid::new_v4();
    let identifier = request
        .identifier
        .as_deref()
        .map(WorkspaceIdentifier::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?
        .unwrap_or_else(|| WorkspaceIdentifier::from_workspace_id(workspace_id));
    let task_configuration = task_config::NewWorkspaceTaskConfiguration::new();
    let mut transaction = state.pool.begin().await?;
    reserve_workspace_identifier(&mut transaction, &identifier, workspace_id).await?;

    let workspace = sqlx::query_as::<_, WorkspaceResponse>(
        r#"
        INSERT INTO workspaces (
            id, name, identifier, accent, default_inbox_state_id, default_task_type_id,
            vault_layout_version
        )
        VALUES ($1, $2, $3, $4, $5, $6, 2)
        RETURNING id, name, identifier, accent, 'owner'::text AS role, created_at, updated_at
        "#,
    )
    .bind(workspace_id)
    .bind(name.as_str())
    .bind(identifier.as_str())
    .bind(accent.as_str())
    .bind(task_configuration.default_state_id())
    .bind(task_configuration.default_task_type_id())
    .fetch_one(&mut *transaction)
    .await?;
    task_configuration
        .install(&mut transaction, workspace_id)
        .await?;
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
    )
    .bind(workspace_id)
    .bind(auth.user.id)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        r#"
        UPDATE users
        SET active_workspace_id = $1,
            setup_stage = CASE
                WHEN setup_stage IN ('workspace', 'invite') THEN 'invite'
                ELSE setup_stage
            END,
            updated_at = now()
        WHERE id = $2
        "#,
    )
    .bind(workspace_id)
    .bind(auth.user.id)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;

    Ok((StatusCode::CREATED, Json(workspace)))
}

async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<UpdateWorkspaceRequest>, JsonRejection>,
) -> Result<Json<WorkspaceResponse>, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    if request.name.is_none() && request.accent.is_none() {
        return Err(AppError::Validation(
            "Provide at least one workspace field to update".to_owned(),
        ));
    }
    let name = request
        .name
        .as_deref()
        .map(ResourceName::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;

    let result = sqlx::query(
        r#"
        UPDATE workspaces
        SET name = COALESCE($1, name), accent = COALESCE($2, accent), updated_at = now()
        WHERE id = $3
        "#,
    )
    .bind(name.as_ref().map(ResourceName::as_str))
    .bind(request.accent.map(WorkspaceAccent::as_str))
    .bind(workspace_id)
    .execute(&state.pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Workspace not found".to_owned()));
    }
    Ok(Json(
        select_workspace(&state.pool, auth.user.id, workspace_id).await?,
    ))
}

async fn activate(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    require_workspace_member(&state.pool, auth.user.id, workspace_id).await?;
    sqlx::query("UPDATE users SET active_workspace_id = $1, updated_at = now() WHERE id = $2")
        .bind(workspace_id)
        .bind(auth.user.id)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_workspace(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<DeleteWorkspaceRequest>, JsonRejection>,
) -> Result<StatusCode, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    require_workspace_owner(&state.pool, auth.user.id, workspace_id).await?;

    let (workspace_name, password_hash): (String, String) = sqlx::query_as(
        r#"
        SELECT workspaces.name, users.password_hash
        FROM workspaces
        CROSS JOIN users
        WHERE workspaces.id = $1 AND users.id = $2
        "#,
    )
    .bind(workspace_id)
    .bind(auth.user.id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Workspace not found".to_owned()))?;
    if request.name != workspace_name {
        return Err(AppError::Validation(
            "Workspace name does not match".to_owned(),
        ));
    }
    let password = ValidatedPassword::new(request.password)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    if !verify_password(password, password_hash.clone()).await? {
        return Err(AppError::Validation("Password is incorrect".to_owned()));
    }

    permanently_delete_workspace(
        &state,
        workspace_id,
        WorkspaceDeletionAuthority::Owner {
            user_id: auth.user.id,
            verified_password_hash: password_hash,
        },
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn permanently_delete_workspace(
    state: &AppState,
    workspace_id: Uuid,
    authority: WorkspaceDeletionAuthority,
) -> Result<(), AppError> {
    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    let (user_id, verified_password_hash) = match authority {
        WorkspaceDeletionAuthority::Owner {
            user_id,
            verified_password_hash,
        } => {
            require_workspace_owner_in_transaction(&mut transaction, user_id, workspace_id).await?;
            (user_id, verified_password_hash)
        }
        WorkspaceDeletionAuthority::Host {
            user_id,
            verified_password_hash,
        } => (user_id, verified_password_hash),
    };
    let current_password_hash: String =
        sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1 FOR UPDATE")
            .bind(user_id)
            .fetch_one(&mut *transaction)
            .await?;
    if current_password_hash != verified_password_hash {
        transaction.rollback().await?;
        return Err(AppError::Validation("Password is incorrect".to_owned()));
    }
    let export_staging_keys: Vec<Uuid> = sqlx::query_scalar(
        r#"
        SELECT staging_key
        FROM workspace_operations
        WHERE workspace_id = $1
          AND kind = 'workspace_export'
          AND staging_key IS NOT NULL
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&mut *transaction)
    .await?;
    let deletion = state
        .vault
        .begin_workspace_deletion(workspace_id, export_staging_keys)
        .await
        .map_err(AppError::internal)?;

    if let Err(error) = delete_workspace_records(&mut transaction, workspace_id).await {
        let database_rollback = transaction.rollback().await;
        let vault_rollback = state.vault.rollback_workspace_deletion(&deletion).await;
        return match (database_rollback, vault_rollback) {
            (Ok(()), Ok(())) => Err(error),
            (database, vault) => Err(AppError::internal(anyhow!(
                "Workspace deletion failed ({error}); database rollback: {database:?}; vault rollback: {vault:?}"
            ))),
        };
    }
    if let Err(error) = transaction.commit().await {
        warn!(%workspace_id, %error, "Workspace deletion commit outcome requires startup recovery");
        return Err(error.into());
    }
    if let Err(error) = state.vault.finish_workspace_deletion(&deletion).await {
        warn!(%workspace_id, %error, "Workspace deletion data remains queued for recovery");
    }
    Ok(())
}

async fn delete_workspace_records(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        UPDATE users
        SET active_workspace_id = (
                SELECT memberships.workspace_id
                FROM workspace_memberships AS memberships
                JOIN workspaces ON workspaces.id = memberships.workspace_id
                WHERE memberships.user_id = users.id
                  AND memberships.workspace_id <> $1
                ORDER BY workspaces.created_at, workspaces.id
                LIMIT 1
            ),
            updated_at = now()
        WHERE active_workspace_id = $1
        "#,
    )
    .bind(workspace_id)
    .execute(&mut **transaction)
    .await?;
    let result = sqlx::query("DELETE FROM workspaces WHERE id = $1")
        .bind(workspace_id)
        .execute(&mut **transaction)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Workspace not found".to_owned()));
    }
    sqlx::query("DELETE FROM workspace_identifier_registry WHERE workspace_id = $1")
        .bind(workspace_id)
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

pub async fn recover_workspace_deletions(state: &AppState) -> anyhow::Result<()> {
    for deletion in state.vault.pending_workspace_deletions().await? {
        let workspace_exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = $1)")
                .bind(deletion.workspace_id())
                .fetch_one(&state.pool)
                .await?;
        if workspace_exists {
            state.vault.rollback_workspace_deletion(&deletion).await?;
        } else {
            state.vault.finish_workspace_deletion(&deletion).await?;
        }
    }
    Ok(())
}

async fn select_workspace(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
) -> Result<WorkspaceResponse, AppError> {
    sqlx::query_as::<_, WorkspaceResponse>(
        r#"
        SELECT workspaces.id, workspaces.name, workspaces.identifier, workspaces.accent,
               workspace_memberships.role, workspaces.created_at, workspaces.updated_at
        FROM workspaces
        JOIN workspace_memberships ON workspace_memberships.workspace_id = workspaces.id
        WHERE workspaces.id = $1 AND workspace_memberships.user_id = $2
        "#,
    )
    .bind(workspace_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Workspace not found".to_owned()))
}

pub(crate) async fn reserve_workspace_identifier(
    transaction: &mut Transaction<'_, Postgres>,
    identifier: &WorkspaceIdentifier,
    workspace_id: Uuid,
) -> Result<(), AppError> {
    let result = sqlx::query(
        r#"
        INSERT INTO workspace_identifier_registry (identifier, workspace_id)
        VALUES ($1, $2)
        "#,
    )
    .bind(identifier.as_str())
    .bind(workspace_id)
    .execute(&mut **transaction)
    .await;
    match result {
        Ok(_) => Ok(()),
        Err(error) if is_unique_violation(&error) => Err(AppError::Conflict(
            "Workspace ID is already in use".to_owned(),
        )),
        Err(error) => Err(error.into()),
    }
}

pub(crate) fn require_account_details(setup_stage: &str) -> Result<(), AppError> {
    if setup_stage == "account" {
        return Err(AppError::Validation(
            "Complete account setup before creating or joining a Workspace".to_owned(),
        ));
    }
    Ok(())
}

pub(super) async fn lock_workspace(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
) -> Result<(), AppError> {
    let workspace: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE")
            .bind(workspace_id)
            .fetch_optional(&mut **transaction)
            .await?;
    if workspace.is_none() {
        return Err(AppError::NotFound("Workspace not found".to_owned()));
    }
    Ok(())
}

pub(super) async fn require_workspace_owner_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    workspace_id: Uuid,
) -> Result<(), AppError> {
    let role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM workspace_memberships WHERE user_id = $1 AND workspace_id = $2",
    )
    .bind(user_id)
    .bind(workspace_id)
    .fetch_optional(&mut **transaction)
    .await?;
    let role = role.ok_or(AppError::Forbidden)?;
    if WorkspaceRole::from_database(&role)? != WorkspaceRole::Owner {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

pub(crate) async fn workspace_role(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
) -> Result<WorkspaceRole, AppError> {
    let role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM workspace_memberships WHERE user_id = $1 AND workspace_id = $2",
    )
    .bind(user_id)
    .bind(workspace_id)
    .fetch_optional(pool)
    .await?;
    let role = role.ok_or(AppError::Forbidden)?;
    WorkspaceRole::from_database(&role)
}

pub(crate) async fn require_workspace_member(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
) -> Result<WorkspaceRole, AppError> {
    workspace_role(pool, user_id, workspace_id).await
}

pub(crate) async fn require_workspace_admin(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
) -> Result<WorkspaceRole, AppError> {
    let role = workspace_role(pool, user_id, workspace_id).await?;
    if !role.can_manage() {
        return Err(AppError::Forbidden);
    }
    Ok(role)
}

pub(super) async fn require_workspace_owner(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
) -> Result<(), AppError> {
    if workspace_role(pool, user_id, workspace_id).await? != WorkspaceRole::Owner {
        return Err(AppError::Forbidden);
    }
    Ok(())
}
