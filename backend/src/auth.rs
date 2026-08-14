use std::time::SystemTime;

use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode, header::AUTHORIZATION},
    response::{IntoResponse, Response},
    routing::post,
};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::state::AppState;
use kanleaf_backend::domain::{
    user::UserId,
    workspace::{Workspace, WorkspaceRole},
};
use kanleaf_backend::persistence::{
    session,
    user::{self, RegistrationError},
};

#[derive(Deserialize)]
struct EmailRequest {
    email: String,
}

#[derive(Serialize)]
struct EmailStatusResponse {
    exists: bool,
}

#[derive(Deserialize)]
struct RegisterRequest {
    email: String,
    password: String,
    password_confirmation: String,
}

#[derive(Deserialize)]
struct LoginRequest {
    email: String,
    password: String,
}

#[derive(Deserialize)]
struct LogoutRequest {
    token: String,
}

#[derive(Serialize)]
struct AuthResponse {
    email: String,
    token: String,
}

#[derive(Serialize)]
struct MessageResponse {
    message: &'static str,
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: &'static str,
}

#[derive(Serialize)]
struct ApiErrorBody {
    message: &'static str,
}

impl ApiError {
    pub fn bad_request(message: &'static str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message,
        }
    }

    pub fn internal(error: impl std::fmt::Display) -> Self {
        eprintln!("Backend error: {error}");
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: "Something went wrong. Please try again.",
        }
    }

    fn unauthorized() -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: "The password you entered is incorrect.",
        }
    }

    pub fn unauthenticated() -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: "Sign in to continue.",
        }
    }

    pub fn forbidden(message: &'static str) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message,
        }
    }

    pub fn not_found(message: &'static str) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message,
        }
    }

    fn conflict(message: &'static str) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ApiErrorBody {
                message: self.message,
            }),
        )
            .into_response()
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/email", post(check_email))
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/forgot-password", post(forgot_password))
        .with_state(state)
}

async fn check_email(
    State(state): State<AppState>,
    Json(request): Json<EmailRequest>,
) -> Result<Json<EmailStatusResponse>, ApiError> {
    let email = normalize_email(&request.email)?;
    let exists = user::email_exists(state.db(), &email)
        .await
        .map_err(ApiError::internal)?;

    Ok(Json(EmailStatusResponse { exists }))
}

async fn register(
    State(state): State<AppState>,
    Json(request): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<AuthResponse>), ApiError> {
    let email = normalize_email(&request.email)?;
    validate_password(&request.password)?;

    if request.password != request.password_confirmation {
        return Err(ApiError::bad_request("The passwords do not match."));
    }

    let password = request.password;
    let password_hash = tokio::task::spawn_blocking(move || hash_password(&password))
        .await
        .map_err(ApiError::internal)??;
    let token = Uuid::new_v4().to_string();
    let user_id = UserId::new();
    let now = SystemTime::now();
    let personal_workspace = Workspace::new("Personal", now).map_err(ApiError::internal)?;

    match user::register_with_personal_workspace(
        state.db(),
        user_id,
        &email,
        &password_hash,
        &personal_workspace,
        WorkspaceRole::Owner,
        now,
    )
    .await
    {
        Ok(()) => {}
        Err(RegistrationError::DuplicateEmail) => {
            return Err(ApiError::conflict(
                "An account already exists for this email.",
            ));
        }
        Err(RegistrationError::Database(error)) => return Err(ApiError::internal(error)),
    }

    session::create(state.db(), user_id, &token, SystemTime::now())
        .await
        .map_err(ApiError::internal)?;

    Ok((StatusCode::CREATED, Json(AuthResponse { email, token })))
}

async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    let email = normalize_email(&request.email)?;
    let user = user::find_by_email(state.db(), &email)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(ApiError::unauthorized)?;
    let user_id = user.id;
    let password_hash = user.password_hash;
    let password = request.password;
    let password_is_valid =
        tokio::task::spawn_blocking(move || verify_password(&password, &password_hash))
            .await
            .map_err(ApiError::internal)??;

    if !password_is_valid {
        return Err(ApiError::unauthorized());
    }

    let token = Uuid::new_v4().to_string();
    session::create(state.db(), user_id, &token, SystemTime::now())
        .await
        .map_err(ApiError::internal)?;

    Ok(Json(AuthResponse { email, token }))
}

async fn logout(
    State(state): State<AppState>,
    Json(request): Json<LogoutRequest>,
) -> Result<Json<MessageResponse>, ApiError> {
    session::delete(state.db(), &request.token)
        .await
        .map_err(ApiError::internal)?;

    Ok(Json(MessageResponse {
        message: "Signed out.",
    }))
}

async fn forgot_password(
    Json(request): Json<EmailRequest>,
) -> Result<Json<MessageResponse>, ApiError> {
    normalize_email(&request.email)?;

    Ok(Json(MessageResponse {
        message: "Password reset is not available yet.",
    }))
}

pub async fn authenticated_user(headers: &HeaderMap, state: &AppState) -> Result<UserId, ApiError> {
    let token = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|token| !token.is_empty())
        .ok_or_else(ApiError::unauthenticated)?;

    session::user_for_token(state.db(), token)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(ApiError::unauthenticated)
}

fn normalize_email(email: &str) -> Result<String, ApiError> {
    let email = email.trim().to_lowercase();
    let Some((local, domain)) = email.split_once('@') else {
        return Err(ApiError::bad_request("Enter a valid email address."));
    };

    if email.len() > 254
        || local.is_empty()
        || domain.is_empty()
        || !domain.contains('.')
        || email.contains(char::is_whitespace)
        || domain.ends_with('.')
    {
        return Err(ApiError::bad_request("Enter a valid email address."));
    }

    Ok(email)
}

fn validate_password(password: &str) -> Result<(), ApiError> {
    if password.len() < 8 {
        return Err(ApiError::bad_request(
            "Password must be at least 8 characters.",
        ));
    }

    if password.len() > 128 {
        return Err(ApiError::bad_request(
            "Password must be 128 characters or fewer.",
        ));
    }

    Ok(())
}

fn hash_password(password: &str) -> Result<String, ApiError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(ApiError::internal)
}

fn verify_password(password: &str, password_hash: &str) -> Result<bool, ApiError> {
    let password_hash = PasswordHash::new(password_hash).map_err(ApiError::internal)?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &password_hash)
        .is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_and_hashes_credentials() {
        assert_eq!(
            normalize_email("  Person@Example.COM ").unwrap(),
            "person@example.com"
        );
        assert!(normalize_email("not-an-email").is_err());
        assert!(validate_password("short").is_err());

        let hash = hash_password("correct horse").unwrap();
        assert!(verify_password("correct horse", &hash).unwrap());
        assert!(!verify_password("wrong password", &hash).unwrap());
    }

    #[cfg(feature = "postgres-tests")]
    #[sqlx::test(migrations = "./migrations")]
    async fn login_and_logout_use_persisted_sessions(pool: sqlx::PgPool) {
        let user_id = UserId::new();
        let password_hash = hash_password("correct horse").unwrap();
        let personal = Workspace::new("Personal", SystemTime::UNIX_EPOCH).unwrap();
        user::register_with_personal_workspace(
            &pool,
            user_id,
            "person@example.com",
            &password_hash,
            &personal,
            WorkspaceRole::Owner,
            SystemTime::UNIX_EPOCH,
        )
        .await
        .unwrap();
        let state = AppState::new(
            pool.clone(),
            kanleaf_backend::vault::Vault::new(std::env::temp_dir().join("kanleaf-auth-test")),
        );

        let Json(response) = login(
            State(state.clone()),
            Json(LoginRequest {
                email: "person@example.com".to_owned(),
                password: "correct horse".to_owned(),
            }),
        )
        .await
        .unwrap();

        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            format!("Bearer {}", response.token).parse().unwrap(),
        );
        assert_eq!(authenticated_user(&headers, &state).await.unwrap(), user_id);

        let mut invalid_headers = HeaderMap::new();
        invalid_headers.insert(AUTHORIZATION, "Bearer invalid-token".parse().unwrap());
        assert!(authenticated_user(&invalid_headers, &state).await.is_err());

        let _ = logout(
            State(state.clone()),
            Json(LogoutRequest {
                token: response.token,
            }),
        )
        .await
        .unwrap();
        assert!(authenticated_user(&headers, &state).await.is_err());
    }
}
