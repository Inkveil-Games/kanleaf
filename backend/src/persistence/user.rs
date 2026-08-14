use std::{error::Error, fmt, time::SystemTime};

use sqlx::{FromRow, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::{
    user::UserId,
    workspace::{Workspace, WorkspaceRole},
};

#[derive(Debug, FromRow)]
struct UserRow {
    id: Uuid,
    password_hash: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoredUser {
    pub id: UserId,
    pub password_hash: String,
}

#[derive(Debug)]
pub enum RegistrationError {
    DuplicateEmail,
    Database(sqlx::Error),
}

impl fmt::Display for RegistrationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DuplicateEmail => formatter.write_str("email already exists"),
            Self::Database(error) => error.fmt(formatter),
        }
    }
}

impl Error for RegistrationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::DuplicateEmail => None,
            Self::Database(error) => Some(error),
        }
    }
}

pub async fn email_exists(pool: &PgPool, email: &str) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)")
        .bind(email)
        .fetch_one(pool)
        .await
}

pub async fn find_by_email(pool: &PgPool, email: &str) -> Result<Option<StoredUser>, sqlx::Error> {
    sqlx::query_as::<_, UserRow>("SELECT id, password_hash FROM users WHERE email = $1")
        .bind(email)
        .fetch_optional(pool)
        .await
        .map(|row| {
            row.map(|row| StoredUser {
                id: row.id.into(),
                password_hash: row.password_hash,
            })
        })
}

pub async fn register_with_personal_workspace(
    pool: &PgPool,
    user_id: UserId,
    email: &str,
    password_hash: &str,
    workspace: &Workspace,
    role: WorkspaceRole,
    now: SystemTime,
) -> Result<(), RegistrationError> {
    let mut transaction = pool.begin().await.map_err(RegistrationError::Database)?;
    let user_id: Uuid = user_id.into();
    let workspace_id: Uuid = workspace.id().into();
    let now: OffsetDateTime = now.into();

    let user_result = sqlx::query(
        "INSERT INTO users (id, email, password_hash, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $4)",
    )
    .bind(user_id)
    .bind(email)
    .bind(password_hash)
    .bind(now)
    .execute(&mut *transaction)
    .await;

    if let Err(error) = user_result {
        return if is_unique_violation(&error) {
            Err(RegistrationError::DuplicateEmail)
        } else {
            Err(RegistrationError::Database(error))
        };
    }

    sqlx::query(
        "INSERT INTO workspaces (id, name, created_at, updated_at) \
         VALUES ($1, $2, $3, $4)",
    )
    .bind(workspace_id)
    .bind(workspace.name())
    .bind(OffsetDateTime::from(workspace.created_at()))
    .bind(OffsetDateTime::from(workspace.updated_at()))
    .execute(&mut *transaction)
    .await
    .map_err(RegistrationError::Database)?;

    sqlx::query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) \
         VALUES ($1, $2, $3)",
    )
    .bind(workspace_id)
    .bind(user_id)
    .bind(role.as_str())
    .execute(&mut *transaction)
    .await
    .map_err(RegistrationError::Database)?;

    sqlx::query("INSERT INTO user_active_workspaces (user_id, workspace_id) VALUES ($1, $2)")
        .bind(user_id)
        .bind(workspace_id)
        .execute(&mut *transaction)
        .await
        .map_err(RegistrationError::Database)?;

    transaction
        .commit()
        .await
        .map_err(RegistrationError::Database)
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|error| error.code())
        .is_some_and(|code| code == "23505")
}
