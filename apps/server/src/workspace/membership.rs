use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection, rejection::PathRejection},
    http::StatusCode,
    routing::{get, patch, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::{AppState, auth::AuthenticatedUser, error::AppError};

use super::{
    AssignableWorkspaceRole, WorkspaceRole, require_workspace_admin, require_workspace_member,
    require_workspace_owner,
};

#[derive(Serialize, FromRow)]
struct WorkspaceMemberResponse {
    user_id: Uuid,
    email: String,
    display_name: String,
    role: String,
    joined_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct UpdateMemberRequest {
    role: AssignableWorkspaceRole,
}

#[derive(Deserialize)]
struct TransferOwnershipRequest {
    user_id: Uuid,
}

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/workspaces/{workspace_id}/members", get(list))
        .route(
            "/api/workspaces/{workspace_id}/members/{user_id}",
            patch(update).delete(remove),
        )
        .route("/api/workspaces/{workspace_id}/leave", post(leave))
        .route(
            "/api/workspaces/{workspace_id}/transfer-ownership",
            post(transfer_ownership),
        )
}

async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<Vec<WorkspaceMemberResponse>>, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    require_workspace_member(&state.pool, auth.user.id, workspace_id).await?;
    let members = sqlx::query_as::<_, WorkspaceMemberResponse>(
        r#"
        SELECT users.id AS user_id, users.email, users.display_name,
               memberships.role, memberships.created_at AS joined_at,
               memberships.updated_at
        FROM workspace_memberships AS memberships
        JOIN users ON users.id = memberships.user_id
        WHERE memberships.workspace_id = $1
        ORDER BY CASE memberships.role
                    WHEN 'owner' THEN 0
                    WHEN 'admin' THEN 1
                    WHEN 'member' THEN 2
                    ELSE 3
                 END,
                 lower(users.display_name), users.id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(members))
}

async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<UpdateMemberRequest>, JsonRejection>,
) -> Result<Json<WorkspaceMemberResponse>, AppError> {
    let Path((workspace_id, user_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;

    let mut transaction = state.pool.begin().await?;
    let current = lock_member_role(&mut transaction, workspace_id, user_id).await?;
    if current == WorkspaceRole::Owner {
        return Err(AppError::Validation(
            "Transfer ownership before changing the Owner role".to_owned(),
        ));
    }
    if current == WorkspaceRole::Admin && !request.role.is_admin() {
        clear_project_references(&mut transaction, workspace_id, user_id).await?;
        sqlx::query(
            r#"
            DELETE FROM task_assignees
            USING tasks
            WHERE task_assignees.workspace_id = $1
              AND task_assignees.user_id = $2
              AND task_assignees.task_id = tasks.id
              AND tasks.workspace_id = $1
              AND tasks.project_id IS NOT NULL
            "#,
        )
        .bind(workspace_id)
        .bind(user_id)
        .execute(&mut *transaction)
        .await?;
    }
    if request.role == AssignableWorkspaceRole::Guest {
        sqlx::query(
            r#"
            DELETE FROM task_assignees
            USING tasks
            WHERE task_assignees.workspace_id = $1
              AND task_assignees.user_id = $2
              AND task_assignees.task_id = tasks.id
              AND tasks.workspace_id = $1
              AND tasks.project_id IS NULL
            "#,
        )
        .bind(workspace_id)
        .bind(user_id)
        .execute(&mut *transaction)
        .await?;
    }
    if request.role.is_admin() {
        sqlx::query("DELETE FROM project_memberships WHERE workspace_id = $1 AND user_id = $2")
            .bind(workspace_id)
            .bind(user_id)
            .execute(&mut *transaction)
            .await?;
    }
    sqlx::query(
        r#"
        UPDATE workspace_memberships
        SET role = $1, updated_at = now()
        WHERE workspace_id = $2 AND user_id = $3
        "#,
    )
    .bind(request.role.as_str())
    .bind(workspace_id)
    .bind(user_id)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;

    Ok(Json(
        select_member(&state.pool, workspace_id, user_id).await?,
    ))
}

async fn remove(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, user_id)) = path.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    if user_id == auth.user.id {
        return Err(AppError::Validation(
            "Use the leave action to remove yourself".to_owned(),
        ));
    }

    let mut transaction = state.pool.begin().await?;
    let role = lock_member_role(&mut transaction, workspace_id, user_id).await?;
    if role == WorkspaceRole::Owner {
        return Err(AppError::Validation(
            "The Workspace Owner cannot be removed".to_owned(),
        ));
    }
    clear_project_references(&mut transaction, workspace_id, user_id).await?;
    sqlx::query("DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2")
        .bind(workspace_id)
        .bind(user_id)
        .execute(&mut *transaction)
        .await?;
    select_active_workspace_after_departure(&mut transaction, user_id, workspace_id).await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn leave(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let mut transaction = state.pool.begin().await?;
    let role = lock_member_role(&mut transaction, workspace_id, auth.user.id).await?;
    if role == WorkspaceRole::Owner {
        return Err(AppError::Validation(
            "Transfer ownership before leaving this Workspace".to_owned(),
        ));
    }
    let membership_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM workspace_memberships WHERE user_id = $1")
            .bind(auth.user.id)
            .fetch_one(&mut *transaction)
            .await?;
    if membership_count <= 1 {
        return Err(AppError::Validation(
            "Join or create another Workspace before leaving this one".to_owned(),
        ));
    }

    clear_project_references(&mut transaction, workspace_id, auth.user.id).await?;
    sqlx::query("DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2")
        .bind(workspace_id)
        .bind(auth.user.id)
        .execute(&mut *transaction)
        .await?;
    select_active_workspace_after_departure(&mut transaction, auth.user.id, workspace_id).await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn transfer_ownership(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<TransferOwnershipRequest>, JsonRejection>,
) -> Result<StatusCode, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    require_workspace_owner(&state.pool, auth.user.id, workspace_id).await?;

    let mut transaction = state.pool.begin().await?;
    let target_role = lock_member_role(&mut transaction, workspace_id, request.user_id).await?;
    if target_role != WorkspaceRole::Admin {
        return Err(AppError::Validation(
            "Ownership can only be transferred to a Workspace Admin".to_owned(),
        ));
    }

    // Demote first so the partial unique index never observes two owners.
    sqlx::query(
        "UPDATE workspace_memberships SET role = 'admin', updated_at = now() WHERE workspace_id = $1 AND user_id = $2 AND role = 'owner'",
    )
    .bind(workspace_id)
    .bind(auth.user.id)
    .execute(&mut *transaction)
    .await?;
    let promoted = sqlx::query(
        "UPDATE workspace_memberships SET role = 'owner', updated_at = now() WHERE workspace_id = $1 AND user_id = $2 AND role = 'admin'",
    )
    .bind(workspace_id)
    .bind(request.user_id)
    .execute(&mut *transaction)
    .await?;
    if promoted.rows_affected() != 1 {
        return Err(AppError::Conflict(
            "Workspace membership changed during ownership transfer".to_owned(),
        ));
    }
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn lock_member_role(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    user_id: Uuid,
) -> Result<WorkspaceRole, AppError> {
    let role: Option<String> = sqlx::query_scalar(
        r#"
        SELECT role
        FROM workspace_memberships
        WHERE workspace_id = $1 AND user_id = $2
        FOR UPDATE
        "#,
    )
    .bind(workspace_id)
    .bind(user_id)
    .fetch_optional(&mut **transaction)
    .await?;
    let role = role.ok_or_else(|| AppError::NotFound("Workspace member not found".to_owned()))?;
    WorkspaceRole::from_database(&role)
}

async fn select_member(
    pool: &sqlx::PgPool,
    workspace_id: Uuid,
    user_id: Uuid,
) -> Result<WorkspaceMemberResponse, AppError> {
    sqlx::query_as::<_, WorkspaceMemberResponse>(
        r#"
        SELECT users.id AS user_id, users.email, users.display_name,
               memberships.role, memberships.created_at AS joined_at,
               memberships.updated_at
        FROM workspace_memberships AS memberships
        JOIN users ON users.id = memberships.user_id
        WHERE memberships.workspace_id = $1 AND memberships.user_id = $2
        "#,
    )
    .bind(workspace_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Workspace member not found".to_owned()))
}

async fn select_active_workspace_after_departure(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    departed_workspace_id: Uuid,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        UPDATE users
        SET active_workspace_id = CASE
                WHEN active_workspace_id = $2 THEN (
                    SELECT memberships.workspace_id
                    FROM workspace_memberships AS memberships
                    JOIN workspaces ON workspaces.id = memberships.workspace_id
                    WHERE memberships.user_id = $1
                    ORDER BY workspaces.created_at, workspaces.id
                    LIMIT 1
                )
                ELSE active_workspace_id
            END,
            updated_at = now()
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .bind(departed_workspace_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn clear_project_references(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        UPDATE projects
        SET lead_user_id = CASE WHEN lead_user_id = $2 THEN NULL ELSE lead_user_id END,
            default_assignee_id = CASE
                WHEN default_assignee_id = $2 THEN NULL
                ELSE default_assignee_id
            END,
            updated_at = CASE
                WHEN lead_user_id = $2 OR default_assignee_id = $2 THEN now()
                ELSE updated_at
            END
        WHERE workspace_id = $1
          AND (lead_user_id = $2 OR default_assignee_id = $2)
        "#,
    )
    .bind(workspace_id)
    .bind(user_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}
