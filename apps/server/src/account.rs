use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection, rejection::PathRejection},
    http::StatusCode,
    routing::{delete, get, patch, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{AuthenticatedUser, UserResponse, hash_password, select_user_response, verify_password},
    domain::{ResourceName, ValidatedPassword},
    error::AppError,
};

#[derive(Deserialize)]
struct ProfileRequest {
    display_name: String,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Theme {
    System,
    Light,
    Dark,
}

impl Theme {
    const fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum WeekStart {
    Monday,
    Sunday,
}

impl WeekStart {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Monday => "monday",
            Self::Sunday => "sunday",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DateFormat {
    Locale,
    YyyyMmDd,
    DdMmYyyy,
    MmDdYyyy,
}

impl DateFormat {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Locale => "locale",
            Self::YyyyMmDd => "yyyy_mm_dd",
            Self::DdMmYyyy => "dd_mm_yyyy",
            Self::MmDdYyyy => "mm_dd_yyyy",
        }
    }
}

#[derive(Deserialize)]
struct PreferencesRequest {
    theme: Theme,
    timezone: String,
    week_start: WeekStart,
    date_format: DateFormat,
}

#[derive(Deserialize)]
struct ChangePasswordRequest {
    current_password: String,
    new_password: String,
}

#[derive(Serialize, FromRow)]
struct AccountSessionResponse {
    id: Uuid,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    is_current: bool,
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/account", get(get_account))
        .route("/api/account/profile", patch(update_profile))
        .route("/api/account/preferences", patch(update_preferences))
        .route("/api/account/password", post(change_password))
        .route("/api/account/sessions", get(list_sessions))
        .route(
            "/api/account/sessions/revoke-others",
            post(revoke_other_sessions),
        )
        .route("/api/account/sessions/{session_id}", delete(revoke_session))
}

async fn get_account(auth: AuthenticatedUser) -> Json<UserResponse> {
    Json(auth.user)
}

async fn update_profile(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    payload: Result<Json<ProfileRequest>, JsonRejection>,
) -> Result<Json<UserResponse>, AppError> {
    let Json(request) = payload.map_err(AppError::from)?;
    let display_name = ResourceName::new(&request.display_name)
        .map_err(|error| AppError::Validation(error.to_string()))?;

    sqlx::query("UPDATE users SET display_name = $1, updated_at = now() WHERE id = $2")
        .bind(display_name.as_str())
        .bind(auth.user.id)
        .execute(&state.pool)
        .await?;

    Ok(Json(select_user_response(&state.pool, auth.user.id).await?))
}

async fn update_preferences(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    payload: Result<Json<PreferencesRequest>, JsonRejection>,
) -> Result<Json<UserResponse>, AppError> {
    let Json(request) = payload.map_err(AppError::from)?;
    let timezone = canonical_timezone(&request.timezone)?;

    sqlx::query(
        r#"
        UPDATE users
        SET theme = $1, timezone = $2, week_start = $3, date_format = $4, updated_at = now()
        WHERE id = $5
        "#,
    )
    .bind(request.theme.as_str())
    .bind(timezone)
    .bind(request.week_start.as_str())
    .bind(request.date_format.as_str())
    .bind(auth.user.id)
    .execute(&state.pool)
    .await?;

    Ok(Json(select_user_response(&state.pool, auth.user.id).await?))
}

async fn change_password(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    payload: Result<Json<ChangePasswordRequest>, JsonRejection>,
) -> Result<StatusCode, AppError> {
    let Json(request) = payload.map_err(AppError::from)?;
    if request.current_password == request.new_password {
        return Err(AppError::Validation(
            "New password must be different".to_owned(),
        ));
    }
    let current_password = ValidatedPassword::new(request.current_password)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let new_password = ValidatedPassword::new(request.new_password)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let stored_hash: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
        .bind(auth.user.id)
        .fetch_one(&state.pool)
        .await?;

    if !verify_password(current_password, stored_hash).await? {
        return Err(AppError::Validation(
            "Current password is incorrect".to_owned(),
        ));
    }
    let replacement = hash_password(new_password).await?;
    let mut transaction = state.pool.begin().await?;
    sqlx::query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2")
        .bind(replacement)
        .bind(auth.user.id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM sessions WHERE user_id = $1 AND id <> $2")
        .bind(auth.user.id)
        .bind(auth.session_id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_sessions(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<Json<Vec<AccountSessionResponse>>, AppError> {
    let sessions = sqlx::query_as::<_, AccountSessionResponse>(
        r#"
        SELECT id, created_at, expires_at, id = $2 AS is_current
        FROM sessions
        WHERE user_id = $1 AND expires_at > now()
        ORDER BY created_at DESC, id
        "#,
    )
    .bind(auth.user.id)
    .bind(auth.session_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(sessions))
}

async fn revoke_session(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path(session_id) = path.map_err(AppError::from)?;
    if session_id == auth.session_id {
        return Err(AppError::Validation(
            "Use logout to end the current session".to_owned(),
        ));
    }

    let result = sqlx::query("DELETE FROM sessions WHERE id = $1 AND user_id = $2")
        .bind(session_id)
        .bind(auth.user.id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Session not found".to_owned()));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn revoke_other_sessions(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<StatusCode, AppError> {
    sqlx::query("DELETE FROM sessions WHERE user_id = $1 AND id <> $2")
        .bind(auth.user.id)
        .bind(auth.session_id)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

fn canonical_timezone(value: &str) -> Result<String, AppError> {
    let value = value.trim();
    let timezone = jiff::tz::db()
        .get(value)
        .map_err(|_| AppError::Validation("Timezone must be a valid IANA name".to_owned()))?;
    timezone
        .iana_name()
        .map(str::to_owned)
        .ok_or_else(|| AppError::Validation("Timezone must be a valid IANA name".to_owned()))
}

#[cfg(test)]
mod tests {
    use super::canonical_timezone;

    #[test]
    fn validates_and_canonicalizes_iana_timezones() {
        assert_eq!(
            canonical_timezone("Asia/Ho_Chi_Minh").unwrap(),
            "Asia/Ho_Chi_Minh"
        );
        assert!(canonical_timezone("GMT+7").is_err());
    }
}
