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

use crate::state::{AppState, AppStore, StoredUser};
use kanleaf_backend::domain::{
    user::UserId,
    workspace::{Workspace, WorkspaceMembership, WorkspaceRole},
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
        eprintln!("Authentication error: {error}");
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
    let exists = app_store(&state)?.users.contains_key(&email);

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

    if app_store(&state)?.users.contains_key(&email) {
        return Err(ApiError {
            status: StatusCode::CONFLICT,
            message: "An account already exists for this email.",
        });
    }

    let password = request.password;
    let password_hash = tokio::task::spawn_blocking(move || hash_password(&password))
        .await
        .map_err(ApiError::internal)??;
    let token = Uuid::new_v4().to_string();
    let user_id = UserId::new();
    let personal_workspace =
        Workspace::new("Personal", SystemTime::now()).map_err(ApiError::internal)?;
    let personal_workspace_id = personal_workspace.id();
    let membership = WorkspaceMembership::new(personal_workspace_id, user_id, WorkspaceRole::Owner);

    let mut store = app_store(&state)?;
    if store.users.contains_key(&email) {
        return Err(ApiError {
            status: StatusCode::CONFLICT,
            message: "An account already exists for this email.",
        });
    }

    store.users.insert(
        email.clone(),
        StoredUser {
            id: user_id,
            password_hash,
        },
    );
    store.sessions.insert(token.clone(), user_id);
    store
        .workspaces
        .insert(personal_workspace_id, personal_workspace);
    store.workspace_memberships.push(membership);
    store
        .active_workspaces
        .insert(user_id, personal_workspace_id);

    Ok((StatusCode::CREATED, Json(AuthResponse { email, token })))
}

async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    let email = normalize_email(&request.email)?;
    let (user_id, password_hash) = app_store(&state)?
        .users
        .get(&email)
        .map(|user| (user.id, user.password_hash.clone()))
        .ok_or_else(ApiError::unauthorized)?;
    let password = request.password;
    let password_is_valid =
        tokio::task::spawn_blocking(move || verify_password(&password, &password_hash))
            .await
            .map_err(ApiError::internal)??;

    if !password_is_valid {
        return Err(ApiError::unauthorized());
    }

    let token = Uuid::new_v4().to_string();
    app_store(&state)?.sessions.insert(token.clone(), user_id);

    Ok(Json(AuthResponse { email, token }))
}

async fn logout(
    State(state): State<AppState>,
    Json(request): Json<LogoutRequest>,
) -> Result<Json<MessageResponse>, ApiError> {
    app_store(&state)?.sessions.remove(&request.token);

    Ok(Json(MessageResponse {
        message: "Signed out.",
    }))
}

async fn forgot_password(
    Json(request): Json<EmailRequest>,
) -> Result<Json<MessageResponse>, ApiError> {
    normalize_email(&request.email)?;

    Ok(Json(MessageResponse {
        message: "Password reset is unavailable while accounts are stored in memory. Restart the backend to clear local accounts.",
    }))
}

fn app_store(state: &AppState) -> Result<std::sync::MutexGuard<'_, AppStore>, ApiError> {
    state.lock().map_err(ApiError::internal)
}

pub fn authenticated_user(headers: &HeaderMap, state: &AppState) -> Result<UserId, ApiError> {
    let token = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|token| !token.is_empty())
        .ok_or_else(ApiError::unauthenticated)?;

    app_store(state)?
        .sessions
        .get(token)
        .copied()
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

    #[tokio::test]
    async fn registration_creates_an_isolated_personal_workspace() {
        let state = AppState::default();

        for email in ["first@example.com", "second@example.com"] {
            let _ = register(
                State(state.clone()),
                Json(RegisterRequest {
                    email: email.to_owned(),
                    password: "correct horse".to_owned(),
                    password_confirmation: "correct horse".to_owned(),
                }),
            )
            .await
            .unwrap();
        }

        let store = state.lock().unwrap();
        let first_user_id = store.users["first@example.com"].id;
        let second_user_id = store.users["second@example.com"].id;
        let first_memberships = store
            .workspace_memberships
            .iter()
            .filter(|membership| membership.user_id() == first_user_id)
            .collect::<Vec<_>>();
        let second_memberships = store
            .workspace_memberships
            .iter()
            .filter(|membership| membership.user_id() == second_user_id)
            .collect::<Vec<_>>();

        assert_eq!(store.workspaces.len(), 2);
        assert_eq!(first_memberships.len(), 1);
        assert_eq!(second_memberships.len(), 1);
        assert_eq!(first_memberships[0].role(), WorkspaceRole::Owner);
        assert_eq!(second_memberships[0].role(), WorkspaceRole::Owner);
        assert_ne!(
            first_memberships[0].workspace_id(),
            second_memberships[0].workspace_id()
        );
        assert_eq!(
            store.workspaces[&first_memberships[0].workspace_id()].name(),
            "Personal"
        );
        assert_eq!(
            store.workspaces[&second_memberships[0].workspace_id()].name(),
            "Personal"
        );
    }
}
