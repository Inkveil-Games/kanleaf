use std::collections::BTreeSet;

use axum::{
    Json, Router,
    extract::{FromRequestParts, Path, State, rejection::JsonRejection, rejection::PathRejection},
    http::StatusCode,
    http::request::Parts,
    routing::{delete, get},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{AuthenticatedUser, verify_password},
    domain::{NormalizedEmail, ValidatedPassword},
    error::AppError,
    workspace::{WorkspaceDeletionAuthority, permanently_delete_workspace},
};

pub(crate) struct HostUser(AuthenticatedUser);

#[derive(Deserialize)]
struct AccessPolicyRequest {
    restricted: bool,
    allowed_emails: Vec<String>,
}

#[derive(Deserialize)]
struct DeleteHostWorkspaceRequest {
    identifier: String,
    password: String,
}

#[derive(Serialize)]
struct AccessPolicyResponse {
    restricted: bool,
    allowed_emails: Vec<String>,
}

#[derive(FromRow)]
struct AccessPolicyRow {
    restricted: bool,
    allowed_emails: Vec<String>,
}

#[derive(FromRow)]
struct HostWorkspaceRow {
    id: Uuid,
    name: String,
    identifier: String,
    created_at: DateTime<Utc>,
    owner_id: Uuid,
    owner_display_name: String,
    owner_email: String,
}

#[derive(Serialize)]
struct HostWorkspaceResponse {
    id: Uuid,
    name: String,
    identifier: String,
    created_at: DateTime<Utc>,
    owner: HostOwnerResponse,
}

#[derive(Serialize)]
struct HostOwnerResponse {
    id: Uuid,
    display_name: String,
    email: String,
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/host/workspaces", get(list_workspaces))
        .route(
            "/api/host/workspaces/{workspace_id}",
            delete(delete_workspace),
        )
        .route("/api/host/access", get(get_access).put(update_access))
}

impl FromRequestParts<AppState> for HostUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let auth = AuthenticatedUser::from_request_parts(parts, state).await?;
        if !auth.user.is_host {
            return Err(AppError::Forbidden);
        }
        Ok(Self(auth))
    }
}

async fn delete_workspace(
    HostUser(auth): HostUser,
    State(state): State<AppState>,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<DeleteHostWorkspaceRequest>, JsonRejection>,
) -> Result<StatusCode, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let (identifier, password_hash): (String, String) = sqlx::query_as(
        r#"
        SELECT workspaces.identifier, users.password_hash
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
    if request.identifier != identifier {
        return Err(AppError::Validation(
            "Workspace ID does not match".to_owned(),
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
        WorkspaceDeletionAuthority::Host {
            user_id: auth.user.id,
            verified_password_hash: password_hash,
        },
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_workspaces(
    _host: HostUser,
    State(state): State<AppState>,
) -> Result<Json<Vec<HostWorkspaceResponse>>, AppError> {
    let rows = sqlx::query_as::<_, HostWorkspaceRow>(
        r#"
        SELECT workspaces.id,
               workspaces.name,
               workspaces.identifier,
               workspaces.created_at,
               users.id AS owner_id,
               users.display_name AS owner_display_name,
               users.email AS owner_email
        FROM workspaces
        JOIN workspace_memberships
          ON workspace_memberships.workspace_id = workspaces.id
         AND workspace_memberships.role = 'owner'
        JOIN users ON users.id = workspace_memberships.user_id
        ORDER BY workspaces.created_at, workspaces.id
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(
        rows.into_iter()
            .map(|row| HostWorkspaceResponse {
                id: row.id,
                name: row.name,
                identifier: row.identifier,
                created_at: row.created_at,
                owner: HostOwnerResponse {
                    id: row.owner_id,
                    display_name: row.owner_display_name,
                    email: row.owner_email,
                },
            })
            .collect(),
    ))
}

async fn get_access(
    _host: HostUser,
    State(state): State<AppState>,
) -> Result<Json<AccessPolicyResponse>, AppError> {
    let policy = sqlx::query_as::<_, AccessPolicyRow>(
        r#"
        SELECT settings.restricted_access AS restricted,
               COALESCE(
                   array_agg(allowed.email ORDER BY allowed.email)
                       FILTER (WHERE allowed.email IS NOT NULL),
                   ARRAY[]::TEXT[]
               ) AS allowed_emails
        FROM instance_settings AS settings
        LEFT JOIN instance_allowed_emails AS allowed ON TRUE
        WHERE settings.id = 1
        GROUP BY settings.id, settings.restricted_access
        "#,
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(AccessPolicyResponse {
        restricted: policy.restricted,
        allowed_emails: policy.allowed_emails,
    }))
}

async fn update_access(
    _host: HostUser,
    State(state): State<AppState>,
    payload: Result<Json<AccessPolicyRequest>, JsonRejection>,
) -> Result<Json<AccessPolicyResponse>, AppError> {
    let Json(request) = payload.map_err(AppError::from)?;
    let allowed_emails = normalize_allowed_emails(request.allowed_emails)?;

    let mut transaction = state.pool.begin().await?;
    sqlx::query_scalar::<_, bool>(
        "SELECT restricted_access FROM instance_settings WHERE id = 1 FOR UPDATE",
    )
    .fetch_one(&mut *transaction)
    .await?;
    sqlx::query(
        "UPDATE instance_settings SET restricted_access = $1, updated_at = now() WHERE id = 1",
    )
    .bind(request.restricted)
    .execute(&mut *transaction)
    .await?;
    sqlx::query("DELETE FROM instance_allowed_emails")
        .execute(&mut *transaction)
        .await?;
    if !allowed_emails.is_empty() {
        sqlx::query(
            r#"
            INSERT INTO instance_allowed_emails (email)
            SELECT allowed.email
            FROM unnest($1::TEXT[]) AS allowed(email)
            "#,
        )
        .bind(&allowed_emails)
        .execute(&mut *transaction)
        .await?;
    }

    if request.restricted {
        sqlx::query(
            r#"
            DELETE FROM sessions
            USING users
            WHERE sessions.user_id = users.id
              AND users.email IS DISTINCT FROM $1::TEXT
              AND NOT EXISTS (
                  SELECT 1
                  FROM instance_allowed_emails
                  WHERE instance_allowed_emails.email = users.email
              )
            "#,
        )
        .bind(state.host_email().map(NormalizedEmail::as_str))
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;

    Ok(Json(AccessPolicyResponse {
        restricted: request.restricted,
        allowed_emails,
    }))
}

fn normalize_allowed_emails(values: Vec<String>) -> Result<Vec<String>, AppError> {
    values
        .into_iter()
        .map(|value| {
            NormalizedEmail::new(&value)
                .map(|email| email.as_str().to_owned())
                .map_err(|error| AppError::Validation(error.to_string()))
        })
        .collect::<Result<BTreeSet<_>, _>>()
        .map(|emails| emails.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::normalize_allowed_emails;

    #[test]
    fn normalizes_sorts_and_deduplicates_allowed_emails() {
        assert_eq!(
            normalize_allowed_emails(vec![
                " Zebra@Example.com ".to_owned(),
                "alpha@example.com".to_owned(),
                "zebra@example.com".to_owned(),
            ])
            .unwrap(),
            vec!["alpha@example.com", "zebra@example.com"]
        );
    }

    #[test]
    fn rejects_the_complete_list_when_one_email_is_invalid() {
        assert!(
            normalize_allowed_emails(vec!["valid@example.com".to_owned(), "invalid".to_owned(),])
                .is_err()
        );
    }
}
