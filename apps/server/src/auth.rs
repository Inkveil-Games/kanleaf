use std::time::Duration as StdDuration;

use anyhow::anyhow;
use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use axum::{
    Json, Router,
    extract::{FromRequestParts, State, rejection::JsonRejection},
    http::{StatusCode, header, request::Parts},
    routing::post,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Duration, Utc};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use tracing::warn;
use uuid::Uuid;

use crate::{
    AppState,
    domain::{NormalizedEmail, ValidatedPassword},
    error::{AppError, is_unique_violation},
};

const PASSWORD_RESET_RESPONSE_FLOOR: StdDuration = StdDuration::from_millis(500);

#[derive(Deserialize)]
struct RegisterRequest {
    email: String,
    password: String,
}

#[derive(Deserialize)]
struct LoginRequest {
    email: String,
    password: String,
}

#[derive(Deserialize)]
struct ForgotPasswordRequest {
    email: String,
    return_to: Option<String>,
}

#[derive(Deserialize)]
struct ResetPasswordRequest {
    token: String,
    password: String,
}

#[derive(Clone, Debug, Serialize, FromRow)]
pub struct UserResponse {
    pub id: Uuid,
    pub email: String,
    pub is_host: bool,
    pub display_name: String,
    pub theme: String,
    pub timezone: String,
    pub week_start: String,
    pub date_format: String,
    pub setup_stage: String,
    pub active_workspace_id: Option<Uuid>,
}

#[derive(Serialize)]
struct AuthResponse {
    token: String,
    expires_at: DateTime<Utc>,
    user: UserResponse,
}

#[derive(Serialize)]
pub(crate) struct SessionResponse {
    expires_at: DateTime<Utc>,
    user: UserResponse,
}

#[derive(FromRow)]
struct LoginUser {
    id: Uuid,
    email: String,
    display_name: String,
    theme: String,
    timezone: String,
    week_start: String,
    date_format: String,
    setup_stage: String,
    password_hash: String,
    active_workspace_id: Option<Uuid>,
}

#[derive(FromRow)]
struct SessionUser {
    session_id: Uuid,
    expires_at: DateTime<Utc>,
    user_id: Uuid,
    email: String,
    display_name: String,
    theme: String,
    timezone: String,
    week_start: String,
    date_format: String,
    setup_stage: String,
    active_workspace_id: Option<Uuid>,
}

#[derive(FromRow)]
struct PasswordResetToken {
    id: Uuid,
    user_id: Uuid,
}

pub struct AuthenticatedUser {
    pub session_id: Uuid,
    pub expires_at: DateTime<Utc>,
    pub user: UserResponse,
}

pub struct OptionalAuthenticatedUser(pub Option<AuthenticatedUser>);

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/forgot-password", post(forgot_password))
        .route("/reset-password", post(reset_password))
        .route("/logout", post(logout))
}

pub(crate) async fn session(auth: AuthenticatedUser) -> Json<SessionResponse> {
    Json(SessionResponse {
        expires_at: auth.expires_at,
        user: auth.user,
    })
}

async fn register(
    State(state): State<AppState>,
    payload: Result<Json<RegisterRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<AuthResponse>), AppError> {
    let Json(request) = payload.map_err(AppError::from)?;
    let response = register_user(&state, request).await?;
    Ok((StatusCode::CREATED, Json(response)))
}

async fn login(
    State(state): State<AppState>,
    payload: Result<Json<LoginRequest>, JsonRejection>,
) -> Result<Json<AuthResponse>, AppError> {
    let Json(request) = payload.map_err(AppError::from)?;
    Ok(Json(login_user(&state, request).await?))
}

async fn logout(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<StatusCode, AppError> {
    sqlx::query("DELETE FROM sessions WHERE id = $1 AND user_id = $2")
        .bind(auth.session_id)
        .bind(auth.user.id)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn forgot_password(
    State(state): State<AppState>,
    payload: Result<Json<ForgotPasswordRequest>, JsonRejection>,
) -> Result<StatusCode, AppError> {
    let response_started_at = tokio::time::Instant::now();
    let Json(request) = payload.map_err(AppError::from)?;
    let email = NormalizedEmail::new(&request.email)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let return_to = validated_password_reset_return_to(request.return_to)?;
    if !state.mailer().is_enabled() {
        return Ok(password_reset_requested(response_started_at).await);
    }

    let mut transaction = state.pool.begin().await?;
    let user_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE email = $1 FOR UPDATE")
        .bind(email.as_str())
        .fetch_optional(&mut *transaction)
        .await?;
    let Some(user_id) = user_id else {
        transaction.rollback().await?;
        return Ok(password_reset_requested(response_started_at).await);
    };
    let cooling_down: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM password_reset_tokens
            WHERE user_id = $1 AND created_at > now() - interval '60 seconds'
        )
        "#,
    )
    .bind(user_id)
    .fetch_one(&mut *transaction)
    .await?;
    if cooling_down {
        transaction.rollback().await?;
        return Ok(password_reset_requested(response_started_at).await);
    }

    sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *transaction)
        .await?;
    let (token, token_hash) = generate_secret_token()?;
    let expires_at = Utc::now() + Duration::minutes(30);
    sqlx::query(
        r#"
        INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(token_hash.as_slice())
    .bind(expires_at)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;

    let mailer = state.mailer().clone();
    let account_email = email.as_str().to_owned();
    drop(tokio::spawn(async move {
        let delivery = mailer
            .send_password_reset(crate::mail::PasswordResetMail {
                account_email: &account_email,
                expires_at,
                token: &token,
                return_to: return_to.as_deref(),
            })
            .await;
        if delivery == crate::mail::MailDelivery::Failed {
            warn!(%user_id, "password reset email delivery failed");
        }
    }));
    Ok(password_reset_requested(response_started_at).await)
}

async fn reset_password(
    State(state): State<AppState>,
    payload: Result<Json<ResetPasswordRequest>, JsonRejection>,
) -> Result<StatusCode, AppError> {
    let Json(request) = payload.map_err(AppError::from)?;
    let password = ValidatedPassword::new(request.password)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    if !valid_secret_token(&request.token) {
        return Err(invalid_password_reset_link());
    }
    let token_hash = hash_secret_token(&request.token);

    let mut transaction = state.pool.begin().await?;
    let user_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM password_reset_tokens WHERE token_hash = $1",
    )
    .bind(token_hash.as_slice())
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(invalid_password_reset_link)?;
    sqlx::query("SELECT id FROM users WHERE id = $1 FOR UPDATE")
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await?;
    let reset_token = sqlx::query_as::<_, PasswordResetToken>(
        r#"
        SELECT id, user_id
        FROM password_reset_tokens
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
        FOR UPDATE
        "#,
    )
    .bind(token_hash.as_slice())
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(invalid_password_reset_link)?;
    let password_hash = hash_password(password).await?;

    sqlx::query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2")
        .bind(password_hash)
        .bind(reset_token.user_id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("UPDATE password_reset_tokens SET consumed_at = now() WHERE id = $1")
        .bind(reset_token.id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1 AND id <> $2")
        .bind(reset_token.user_id)
        .bind(reset_token.id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM sessions WHERE user_id = $1")
        .bind(reset_token.user_id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn register_user(
    state: &AppState,
    request: RegisterRequest,
) -> Result<AuthResponse, AppError> {
    let email = NormalizedEmail::new(&request.email)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let password = ValidatedPassword::new(request.password)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let password_hash = hash_password(password).await?;
    let display_name = default_display_name(&email);
    let user_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    let (token, token_hash) = generate_secret_token()?;
    let expires_at = session_expiry(state.session_ttl)?;
    let is_host = state.is_host_email(email.as_str());

    let mut transaction = state.pool.begin().await?;
    require_email_access(&mut transaction, state, email.as_str()).await?;
    let insert_user = sqlx::query(
        "INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)",
    )
    .bind(user_id)
    .bind(email.as_str())
    .bind(&display_name)
    .bind(password_hash)
    .execute(&mut *transaction)
    .await;
    if let Err(error) = insert_user {
        return if is_unique_violation(&error) {
            Err(AppError::Conflict(
                "An account already exists for this email".to_owned(),
            ))
        } else {
            Err(error.into())
        };
    }

    insert_session(
        &mut transaction,
        session_id,
        user_id,
        &token_hash,
        expires_at,
    )
    .await?;
    transaction.commit().await?;

    Ok(AuthResponse {
        token,
        expires_at,
        user: UserResponse {
            id: user_id,
            email: email.as_str().to_owned(),
            is_host,
            display_name,
            theme: "system".to_owned(),
            timezone: "UTC".to_owned(),
            week_start: "monday".to_owned(),
            date_format: "locale".to_owned(),
            setup_stage: "account".to_owned(),
            active_workspace_id: None,
        },
    })
}

async fn login_user(state: &AppState, request: LoginRequest) -> Result<AuthResponse, AppError> {
    let email = NormalizedEmail::new(&request.email).map_err(|_| AppError::Unauthorized)?;
    let password = ValidatedPassword::new(request.password).map_err(|_| AppError::Unauthorized)?;
    let user = sqlx::query_as::<_, LoginUser>(
        r#"
        SELECT id, email, display_name, theme, timezone, week_start, date_format,
               setup_stage, password_hash, active_workspace_id
        FROM users
        WHERE email = $1
        "#,
    )
    .bind(email.as_str())
    .fetch_optional(&state.pool)
    .await?;

    let Some(user) = user else {
        // Keep missing-account logins on the same expensive path as password checks.
        let _ = hash_password(password).await?;
        return Err(AppError::Unauthorized);
    };
    if !verify_password(password, user.password_hash).await? {
        return Err(AppError::Unauthorized);
    }

    let is_host = state.is_host_email(&user.email);
    let session_id = Uuid::new_v4();
    let (token, token_hash) = generate_secret_token()?;
    let expires_at = session_expiry(state.session_ttl)?;
    let mut transaction = state.pool.begin().await?;
    require_email_access(&mut transaction, state, &user.email).await?;
    insert_session(
        &mut transaction,
        session_id,
        user.id,
        &token_hash,
        expires_at,
    )
    .await?;
    transaction.commit().await?;

    Ok(AuthResponse {
        token,
        expires_at,
        user: UserResponse {
            id: user.id,
            email: user.email,
            is_host,
            display_name: user.display_name,
            theme: user.theme,
            timezone: user.timezone,
            week_start: user.week_start,
            date_format: user.date_format,
            setup_stage: user.setup_stage,
            active_workspace_id: user.active_workspace_id,
        },
    })
}

async fn insert_session(
    transaction: &mut Transaction<'_, Postgres>,
    session_id: Uuid,
    user_id: Uuid,
    token_hash: &[u8; 32],
    expires_at: DateTime<Utc>,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
    )
    .bind(session_id)
    .bind(user_id)
    .bind(token_hash.as_slice())
    .bind(expires_at)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn require_email_access(
    transaction: &mut Transaction<'_, Postgres>,
    state: &AppState,
    email: &str,
) -> Result<(), AppError> {
    let restricted: bool = sqlx::query_scalar(
        "SELECT restricted_access FROM instance_settings WHERE id = 1 FOR SHARE",
    )
    .fetch_one(&mut **transaction)
    .await?;
    if !restricted || state.is_host_email(email) {
        return Ok(());
    }

    let allowed: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM instance_allowed_emails WHERE email = $1)")
            .bind(email)
            .fetch_one(&mut **transaction)
            .await?;
    if allowed {
        Ok(())
    } else {
        Err(AppError::AccessRestricted)
    }
}

impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .ok_or(AppError::Unauthorized)?;
        let token = header
            .strip_prefix("Bearer ")
            .filter(|token| (20..=200).contains(&token.len()))
            .filter(|token| !token.chars().any(char::is_whitespace))
            .ok_or(AppError::Unauthorized)?;
        let token_hash = hash_secret_token(token);

        let session = sqlx::query_as::<_, SessionUser>(
            r#"
            SELECT
                sessions.id AS session_id,
                sessions.expires_at,
                users.id AS user_id,
                users.email,
                users.display_name,
                users.theme,
                users.timezone,
                users.week_start,
                users.date_format,
                users.setup_stage,
                users.active_workspace_id
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            CROSS JOIN instance_settings
            WHERE sessions.token_hash = $1 AND sessions.expires_at > now()
              AND (
                    NOT instance_settings.restricted_access
                    OR users.email = $2
                    OR EXISTS (
                        SELECT 1
                        FROM instance_allowed_emails
                        WHERE instance_allowed_emails.email = users.email
                    )
                  )
            "#,
        )
        .bind(token_hash.as_slice())
        .bind(state.host_email().map(NormalizedEmail::as_str))
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::Unauthorized)?;
        let is_host = state.is_host_email(&session.email);

        Ok(Self {
            session_id: session.session_id,
            expires_at: session.expires_at,
            user: UserResponse {
                id: session.user_id,
                email: session.email,
                is_host,
                display_name: session.display_name,
                theme: session.theme,
                timezone: session.timezone,
                week_start: session.week_start,
                date_format: session.date_format,
                setup_stage: session.setup_stage,
                active_workspace_id: session.active_workspace_id,
            },
        })
    }
}

impl FromRequestParts<AppState> for OptionalAuthenticatedUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if !parts.headers.contains_key(header::AUTHORIZATION) {
            return Ok(Self(None));
        }
        AuthenticatedUser::from_request_parts(parts, state)
            .await
            .map(Some)
            .map(Self)
    }
}

pub(crate) async fn select_user_response(
    state: &AppState,
    user_id: Uuid,
) -> Result<UserResponse, AppError> {
    Ok(sqlx::query_as::<_, UserResponse>(
        r#"
        SELECT id, email, COALESCE(email = $2, false) AS is_host, display_name,
               theme, timezone, week_start, date_format, setup_stage, active_workspace_id
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .bind(state.host_email().map(NormalizedEmail::as_str))
    .fetch_one(&state.pool)
    .await?)
}

pub(crate) async fn hash_password(password: ValidatedPassword) -> Result<String, AppError> {
    tokio::task::spawn_blocking(move || {
        let salt = random_salt()?;
        Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map(|hash| hash.to_string())
            .map_err(|error| anyhow!("failed to hash password: {error}"))
    })
    .await
    .map_err(AppError::internal)?
    .map_err(AppError::internal)
}

pub(crate) async fn verify_password(
    password: ValidatedPassword,
    password_hash: String,
) -> Result<bool, AppError> {
    tokio::task::spawn_blocking(move || {
        let parsed = PasswordHash::new(&password_hash)
            .map_err(|error| anyhow!("stored password hash is invalid: {error}"))?;
        Ok(Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok())
    })
    .await
    .map_err(AppError::internal)?
}

fn random_salt() -> Result<SaltString, AppError> {
    let mut bytes = [0_u8; 16];
    OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|error| AppError::internal(anyhow!("OS randomness unavailable: {error}")))?;
    SaltString::encode_b64(&bytes)
        .map_err(|error| AppError::internal(anyhow!("failed to encode password salt: {error}")))
}

pub(crate) fn generate_secret_token() -> Result<(String, [u8; 32]), AppError> {
    let mut bytes = [0_u8; 32];
    OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|error| AppError::internal(anyhow!("OS randomness unavailable: {error}")))?;
    let token = URL_SAFE_NO_PAD.encode(bytes);
    let token_hash = hash_secret_token(&token);
    Ok((token, token_hash))
}

pub(crate) fn hash_secret_token(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

pub(crate) fn valid_secret_token(token: &str) -> bool {
    token.len() == 43
        && token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn validated_password_reset_return_to(
    return_to: Option<String>,
) -> Result<Option<String>, AppError> {
    let Some(return_to) = return_to else {
        return Ok(None);
    };
    let token = return_to.strip_prefix("/invite#token=").unwrap_or_default();
    if valid_secret_token(token) {
        Ok(Some(return_to))
    } else {
        Err(AppError::Validation(
            "Password reset return destination is invalid".to_owned(),
        ))
    }
}

fn invalid_password_reset_link() -> AppError {
    AppError::Validation(
        "This reset link is invalid or has expired. Request a new link.".to_owned(),
    )
}

async fn password_reset_requested(started_at: tokio::time::Instant) -> StatusCode {
    tokio::time::sleep_until(started_at + PASSWORD_RESET_RESPONSE_FLOOR).await;
    StatusCode::NO_CONTENT
}

fn session_expiry(ttl: StdDuration) -> Result<DateTime<Utc>, AppError> {
    let ttl = Duration::from_std(ttl)
        .map_err(|error| AppError::internal(anyhow!("session TTL is out of range: {error}")))?;
    Ok(Utc::now() + ttl)
}

fn default_display_name(email: &NormalizedEmail) -> String {
    email
        .as_str()
        .split_once('@')
        .map_or("User", |(local, _)| local)
        .chars()
        .take(120)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{generate_secret_token, hash_secret_token};

    #[test]
    fn session_tokens_are_random_and_only_their_hashes_are_stable() {
        let (first, first_hash) = generate_secret_token().unwrap();
        let (second, second_hash) = generate_secret_token().unwrap();

        assert_ne!(first, second);
        assert_ne!(first_hash, second_hash);
        assert_eq!(first_hash, hash_secret_token(&first));
        assert_eq!(first.len(), 43);
        assert_eq!(first_hash.len(), 32);
    }
}
