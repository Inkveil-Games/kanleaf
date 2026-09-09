use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection, rejection::PathRejection},
    http::StatusCode,
    routing::{delete, get, post},
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Postgres, Transaction};
use tracing::warn;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{
        AuthenticatedUser, OptionalAuthenticatedUser, generate_secret_token, hash_secret_token,
    },
    collaboration::notify_invitation,
    domain::NormalizedEmail,
    error::{AppError, is_unique_violation},
    mail::{MailDelivery, WorkspaceInvitationMail},
};

use super::{AssignableWorkspaceRole, require_account_details, require_workspace_admin};

const INVITATION_LIFETIME_DAYS: i64 = 7;

#[derive(Deserialize)]
struct CreateInvitationRequest {
    email: String,
    role: AssignableWorkspaceRole,
}

#[derive(Deserialize)]
struct AcceptTokenRequest {
    token: String,
}

#[derive(Deserialize)]
struct ResolveInvitationRequest {
    token: String,
}

#[derive(Serialize, FromRow)]
struct InvitationResponse {
    id: Uuid,
    workspace_id: Uuid,
    workspace_name: String,
    workspace_identifier: String,
    email: String,
    role: String,
    invited_by_display_name: Option<String>,
    status: String,
    expires_at: DateTime<Utc>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct IssuedInvitationResponse {
    #[serde(flatten)]
    invitation: InvitationResponse,
    token: String,
    delivery: MailDelivery,
    invitation_url: Option<String>,
}

#[derive(FromRow)]
struct InvitationRecord {
    id: Uuid,
    workspace_id: Uuid,
    email: String,
    role: String,
}

#[derive(FromRow)]
struct InvitationPreviewRecord {
    workspace_name: String,
    workspace_identifier: String,
    email: String,
    role: String,
    invited_by_display_name: Option<String>,
    status: String,
    expires_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct InvitationPreviewResponse {
    status: String,
    workspace_name: Option<String>,
    workspace_identifier: Option<String>,
    invited_by_display_name: Option<String>,
    role: Option<String>,
    expires_at: Option<DateTime<Utc>>,
    invitee_email_hint: Option<String>,
    account_email_matches: Option<bool>,
}

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/invitations", get(list_pending))
        .route("/api/invitations/resolve", post(resolve))
        .route("/api/invitations/accept-token", post(accept_token))
        .route("/api/invitations/{invitation_id}/accept", post(accept))
        .route("/api/invitations/{invitation_id}/decline", post(decline))
        .route(
            "/api/workspaces/{workspace_id}/invitations",
            get(list_workspace).post(create),
        )
        .route(
            "/api/workspaces/{workspace_id}/invitations/{invitation_id}/renew",
            post(renew),
        )
        .route(
            "/api/workspaces/{workspace_id}/invitations/{invitation_id}",
            delete(revoke),
        )
}

async fn list_pending(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<Json<Vec<InvitationResponse>>, AppError> {
    let invitations = sqlx::query_as::<_, InvitationResponse>(&format!(
        r#"
        {}
        WHERE invitations.email = $1
          AND invitations.accepted_at IS NULL
          AND invitations.declined_at IS NULL
          AND invitations.revoked_at IS NULL
          AND invitations.expires_at > now()
        ORDER BY invitations.created_at DESC, invitations.id
        "#,
        invitation_select()
    ))
    .bind(&auth.user.email)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(invitations))
}

async fn list_workspace(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<Vec<InvitationResponse>>, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let invitations = sqlx::query_as::<_, InvitationResponse>(&format!(
        r#"
        {}
        WHERE invitations.workspace_id = $1
        ORDER BY invitations.created_at DESC, invitations.id
        "#,
        invitation_select()
    ))
    .bind(workspace_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(invitations))
}

async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<CreateInvitationRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<IssuedInvitationResponse>), AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let email = NormalizedEmail::new(&request.email)
        .map_err(|error| AppError::Validation(error.to_string()))?;

    let already_member: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM workspace_memberships AS memberships
            JOIN users ON users.id = memberships.user_id
            WHERE memberships.workspace_id = $1 AND users.email = $2
        )
        "#,
    )
    .bind(workspace_id)
    .bind(email.as_str())
    .fetch_one(&state.pool)
    .await?;
    if already_member {
        return Err(AppError::Conflict(
            "This account is already a Workspace member".to_owned(),
        ));
    }

    let invitation_id = Uuid::new_v4();
    let (token, token_hash) = generate_secret_token()?;
    let expires_at = invitation_expiry();
    let mut transaction = state.pool.begin().await?;
    let inserted = sqlx::query(
        r#"
        INSERT INTO workspace_invitations
            (id, workspace_id, email, role, token_hash, invited_by, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(invitation_id)
    .bind(workspace_id)
    .bind(email.as_str())
    .bind(request.role.as_str())
    .bind(token_hash.as_slice())
    .bind(auth.user.id)
    .bind(expires_at)
    .execute(&mut *transaction)
    .await;
    if let Err(error) = inserted {
        return if is_unique_violation(&error) {
            Err(AppError::Conflict(
                "A pending invitation already exists for this email".to_owned(),
            ))
        } else {
            Err(error.into())
        };
    }

    notify_invitation(
        &mut transaction,
        workspace_id,
        invitation_id,
        email.as_str(),
        auth.user.id,
    )
    .await?;
    transaction.commit().await?;

    let invitation = find_invitation(&state.pool, invitation_id).await?;
    let invitation_url = state
        .mailer()
        .invitation_url(&token)
        .map(|url| url.to_string());
    let delivery = send_invitation_mail(&state, &invitation, &token).await;
    log_delivery_failure(delivery, workspace_id, invitation_id);
    Ok((
        StatusCode::CREATED,
        Json(IssuedInvitationResponse {
            invitation,
            token,
            delivery,
            invitation_url,
        }),
    ))
}

async fn renew(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<IssuedInvitationResponse>, AppError> {
    let Path((workspace_id, invitation_id)) = path.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let (token, token_hash) = generate_secret_token()?;
    let mut transaction = state.pool.begin().await?;
    let result = sqlx::query(
        r#"
        UPDATE workspace_invitations
        SET token_hash = $1, expires_at = $2, declined_at = NULL, revoked_at = NULL,
            updated_at = now()
        WHERE id = $3 AND workspace_id = $4 AND accepted_at IS NULL
        "#,
    )
    .bind(token_hash.as_slice())
    .bind(invitation_expiry())
    .bind(invitation_id)
    .bind(workspace_id)
    .execute(&mut *transaction)
    .await;
    let result = match result {
        Ok(result) => result,
        Err(error) if is_unique_violation(&error) => {
            return Err(AppError::Conflict(
                "Another pending invitation exists for this email".to_owned(),
            ));
        }
        Err(error) => return Err(error.into()),
    };
    if result.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "Accepted invitations cannot be renewed".to_owned(),
        ));
    }
    transaction.commit().await?;

    let invitation = find_invitation(&state.pool, invitation_id).await?;
    let invitation_url = state
        .mailer()
        .invitation_url(&token)
        .map(|url| url.to_string());
    let delivery = send_invitation_mail(&state, &invitation, &token).await;
    log_delivery_failure(delivery, workspace_id, invitation_id);
    Ok(Json(IssuedInvitationResponse {
        invitation,
        token,
        delivery,
        invitation_url,
    }))
}

async fn resolve(
    State(state): State<AppState>,
    auth: OptionalAuthenticatedUser,
    payload: Result<Json<ResolveInvitationRequest>, JsonRejection>,
) -> Result<Json<InvitationPreviewResponse>, AppError> {
    let Json(request) = payload.map_err(AppError::from)?;
    let token = request.token.trim();
    if !valid_invitation_token(token) {
        return Ok(Json(invalid_preview()));
    }
    let token_hash = hash_secret_token(token);
    let preview = sqlx::query_as::<_, InvitationPreviewRecord>(
        r#"
        SELECT workspaces.name AS workspace_name,
               workspaces.identifier AS workspace_identifier,
               invitations.email, invitations.role,
               inviters.display_name AS invited_by_display_name,
               CASE
                   WHEN invitations.accepted_at IS NOT NULL THEN 'accepted'
                   WHEN invitations.declined_at IS NOT NULL THEN 'declined'
                   WHEN invitations.revoked_at IS NOT NULL THEN 'revoked'
                   WHEN invitations.expires_at <= now() THEN 'expired'
                   ELSE 'pending'
               END AS status,
               invitations.expires_at
        FROM workspace_invitations AS invitations
        JOIN workspaces ON workspaces.id = invitations.workspace_id
        LEFT JOIN users AS inviters ON inviters.id = invitations.invited_by
        WHERE invitations.token_hash = $1
        "#,
    )
    .bind(token_hash.as_slice())
    .fetch_optional(&state.pool)
    .await?;
    let Some(preview) = preview else {
        return Ok(Json(invalid_preview()));
    };
    let account_email_matches = auth.0.as_ref().map(|auth| auth.user.email == preview.email);
    Ok(Json(InvitationPreviewResponse {
        status: preview.status,
        workspace_name: Some(preview.workspace_name),
        workspace_identifier: Some(preview.workspace_identifier),
        invited_by_display_name: preview.invited_by_display_name,
        role: Some(preview.role),
        expires_at: Some(preview.expires_at),
        invitee_email_hint: Some(mask_email(&preview.email)),
        account_email_matches,
    }))
}

async fn revoke(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, invitation_id)) = path.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let result = sqlx::query(
        r#"
        UPDATE workspace_invitations
        SET revoked_at = now(), updated_at = now()
        WHERE id = $1 AND workspace_id = $2
          AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL
        "#,
    )
    .bind(invitation_id)
    .bind(workspace_id)
    .execute(&state.pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "Invitation is already resolved".to_owned(),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn accept(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path(invitation_id) = path.map_err(AppError::from)?;
    let mut transaction = state.pool.begin().await?;
    let invitation = lock_pending_invitation(&mut transaction, invitation_id, None).await?;
    accept_locked_invitation(&mut transaction, &auth, invitation).await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn accept_token(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    payload: Result<Json<AcceptTokenRequest>, JsonRejection>,
) -> Result<StatusCode, AppError> {
    let Json(request) = payload.map_err(AppError::from)?;
    let token = request.token.trim();
    if !valid_invitation_token(token) {
        return Err(AppError::Validation(
            "Invitation token is invalid".to_owned(),
        ));
    }
    let token_hash = hash_secret_token(token);
    let mut transaction = state.pool.begin().await?;
    let invitation =
        lock_pending_invitation(&mut transaction, Uuid::nil(), Some(&token_hash)).await?;
    accept_locked_invitation(&mut transaction, &auth, invitation).await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn send_invitation_mail(
    state: &AppState,
    invitation: &InvitationResponse,
    token: &str,
) -> MailDelivery {
    state
        .mailer()
        .send_workspace_invitation(WorkspaceInvitationMail {
            invitee_email: &invitation.email,
            inviter_display_name: invitation
                .invited_by_display_name
                .as_deref()
                .unwrap_or("A Workspace admin"),
            workspace_name: &invitation.workspace_name,
            role: &invitation.role,
            expires_at: invitation.expires_at,
            token,
        })
        .await
}

fn log_delivery_failure(delivery: MailDelivery, workspace_id: Uuid, invitation_id: Uuid) {
    if delivery == MailDelivery::Failed {
        warn!(%workspace_id, %invitation_id, "Workspace invitation email delivery failed");
    }
}

fn valid_invitation_token(token: &str) -> bool {
    token.len() == 43
        && token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn invalid_preview() -> InvitationPreviewResponse {
    InvitationPreviewResponse {
        status: "invalid".to_owned(),
        workspace_name: None,
        workspace_identifier: None,
        invited_by_display_name: None,
        role: None,
        expires_at: None,
        invitee_email_hint: None,
        account_email_matches: None,
    }
}

fn mask_email(email: &str) -> String {
    let Some((local, domain)) = email.split_once('@') else {
        return "***".to_owned();
    };
    let first = local.chars().next().unwrap_or('*');
    format!("{first}***@{domain}")
}

async fn decline(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path(invitation_id) = path.map_err(AppError::from)?;
    let result = sqlx::query(
        r#"
        UPDATE workspace_invitations
        SET declined_at = now(), updated_at = now()
        WHERE id = $1 AND email = $2
          AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL
          AND expires_at > now()
        "#,
    )
    .bind(invitation_id)
    .bind(&auth.user.email)
    .execute(&state.pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "Invitation is expired, resolved, or belongs to another account".to_owned(),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn lock_pending_invitation(
    transaction: &mut Transaction<'_, Postgres>,
    invitation_id: Uuid,
    token_hash: Option<&[u8; 32]>,
) -> Result<InvitationRecord, AppError> {
    let invitation = sqlx::query_as::<_, InvitationRecord>(
        r#"
        SELECT id, workspace_id, email, role
        FROM workspace_invitations
        WHERE (($1::bytea IS NULL AND id = $2) OR token_hash = $1)
          AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL
          AND expires_at > now()
        FOR UPDATE
        "#,
    )
    .bind(token_hash.map(|hash| hash.as_slice()))
    .bind(invitation_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| AppError::Conflict("Invitation is expired, resolved, or invalid".to_owned()))?;
    Ok(invitation)
}

async fn accept_locked_invitation(
    transaction: &mut Transaction<'_, Postgres>,
    auth: &AuthenticatedUser,
    invitation: InvitationRecord,
) -> Result<(), AppError> {
    if invitation.email != auth.user.email {
        return Err(AppError::Forbidden);
    }
    require_account_details(&auth.user.setup_stage)?;
    sqlx::query(
        r#"
        INSERT INTO workspace_memberships (workspace_id, user_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (workspace_id, user_id) DO NOTHING
        "#,
    )
    .bind(invitation.workspace_id)
    .bind(auth.user.id)
    .bind(&invitation.role)
    .execute(&mut **transaction)
    .await?;
    sqlx::query(
        "UPDATE workspace_invitations SET accepted_at = now(), updated_at = now() WHERE id = $1",
    )
    .bind(invitation.id)
    .execute(&mut **transaction)
    .await?;
    sqlx::query(
        r#"
        UPDATE users
        SET active_workspace_id = $1,
            setup_stage = CASE
                WHEN setup_stage IN ('workspace', 'invite') THEN 'complete'
                ELSE setup_stage
            END,
            updated_at = now()
        WHERE id = $2
        "#,
    )
    .bind(invitation.workspace_id)
    .bind(auth.user.id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn find_invitation(
    pool: &sqlx::PgPool,
    invitation_id: Uuid,
) -> Result<InvitationResponse, AppError> {
    sqlx::query_as::<_, InvitationResponse>(&format!(
        r#"
        {}
        WHERE invitations.id = $1
        "#,
        invitation_select()
    ))
    .bind(invitation_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Invitation not found".to_owned()))
}

fn invitation_select() -> &'static str {
    r#"
    SELECT invitations.id, invitations.workspace_id, workspaces.name AS workspace_name,
           workspaces.identifier AS workspace_identifier,
           invitations.email, invitations.role,
           inviters.display_name AS invited_by_display_name,
           CASE
               WHEN invitations.accepted_at IS NOT NULL THEN 'accepted'
               WHEN invitations.declined_at IS NOT NULL THEN 'declined'
               WHEN invitations.revoked_at IS NOT NULL THEN 'revoked'
               WHEN invitations.expires_at <= now() THEN 'expired'
               ELSE 'pending'
           END AS status,
           invitations.expires_at, invitations.created_at, invitations.updated_at
    FROM workspace_invitations AS invitations
    JOIN workspaces ON workspaces.id = invitations.workspace_id
    LEFT JOIN users AS inviters ON inviters.id = invitations.invited_by
    "#
}

fn invitation_expiry() -> DateTime<Utc> {
    Utc::now() + Duration::days(INVITATION_LIFETIME_DAYS)
}
