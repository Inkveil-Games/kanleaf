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
use uuid::Uuid;

use crate::{
    AppState,
    domain::{NormalizedEmail, ValidatedPassword},
    error::{AppError, is_unique_violation},
};

const PERSONAL_WORKSPACE_NAME: &str = "Personal";

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

#[derive(Clone, Debug, Serialize, FromRow)]
pub struct UserResponse {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
    pub theme: String,
    pub timezone: String,
    pub week_start: String,
    pub date_format: String,
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
    active_workspace_id: Option<Uuid>,
}

pub struct AuthenticatedUser {
    pub session_id: Uuid,
    pub expires_at: DateTime<Utc>,
    pub user: UserResponse,
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
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
    let workspace_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    let (token, token_hash) = generate_bearer_token()?;
    let expires_at = session_expiry(state.session_ttl)?;

    let mut transaction = state.pool.begin().await?;
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

    sqlx::query("INSERT INTO workspaces (id, name) VALUES ($1, $2)")
        .bind(workspace_id)
        .bind(PERSONAL_WORKSPACE_NAME)
        .execute(&mut *transaction)
        .await?;
    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
    )
    .bind(workspace_id)
    .bind(user_id)
    .execute(&mut *transaction)
    .await?;
    sqlx::query("UPDATE users SET active_workspace_id = $1, updated_at = now() WHERE id = $2")
        .bind(workspace_id)
        .bind(user_id)
        .execute(&mut *transaction)
        .await?;
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
            display_name,
            theme: "system".to_owned(),
            timezone: "UTC".to_owned(),
            week_start: "monday".to_owned(),
            date_format: "locale".to_owned(),
            active_workspace_id: Some(workspace_id),
        },
    })
}

async fn login_user(state: &AppState, request: LoginRequest) -> Result<AuthResponse, AppError> {
    let email = NormalizedEmail::new(&request.email).map_err(|_| AppError::Unauthorized)?;
    let password = ValidatedPassword::new(request.password).map_err(|_| AppError::Unauthorized)?;
    let user = sqlx::query_as::<_, LoginUser>(
        r#"
        SELECT id, email, display_name, theme, timezone, week_start, date_format,
               password_hash, active_workspace_id
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

    let session_id = Uuid::new_v4();
    let (token, token_hash) = generate_bearer_token()?;
    let expires_at = session_expiry(state.session_ttl)?;
    let mut transaction = state.pool.begin().await?;
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
            display_name: user.display_name,
            theme: user.theme,
            timezone: user.timezone,
            week_start: user.week_start,
            date_format: user.date_format,
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
        let token_hash = hash_bearer_token(token);

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
                users.active_workspace_id
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = $1 AND sessions.expires_at > now()
            "#,
        )
        .bind(token_hash.as_slice())
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::Unauthorized)?;

        Ok(Self {
            session_id: session.session_id,
            expires_at: session.expires_at,
            user: UserResponse {
                id: session.user_id,
                email: session.email,
                display_name: session.display_name,
                theme: session.theme,
                timezone: session.timezone,
                week_start: session.week_start,
                date_format: session.date_format,
                active_workspace_id: session.active_workspace_id,
            },
        })
    }
}

pub(crate) async fn select_user_response(
    pool: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<UserResponse, AppError> {
    Ok(sqlx::query_as::<_, UserResponse>(
        r#"
        SELECT id, email, display_name, theme, timezone, week_start, date_format,
               active_workspace_id
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_one(pool)
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

pub(crate) fn generate_bearer_token() -> Result<(String, [u8; 32]), AppError> {
    let mut bytes = [0_u8; 32];
    OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|error| AppError::internal(anyhow!("OS randomness unavailable: {error}")))?;
    let token = URL_SAFE_NO_PAD.encode(bytes);
    let token_hash = hash_bearer_token(&token);
    Ok((token, token_hash))
}

pub(crate) fn hash_bearer_token(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
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
    use super::{generate_bearer_token, hash_bearer_token};

    #[test]
    fn session_tokens_are_random_and_only_their_hashes_are_stable() {
        let (first, first_hash) = generate_bearer_token().unwrap();
        let (second, second_hash) = generate_bearer_token().unwrap();

        assert_ne!(first, second);
        assert_ne!(first_hash, second_hash);
        assert_eq!(first_hash, hash_bearer_token(&first));
        assert_eq!(first.len(), 43);
        assert_eq!(first_hash.len(), 32);
    }
}
