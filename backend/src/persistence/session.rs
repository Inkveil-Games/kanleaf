use std::time::SystemTime;

use sha2::{Digest, Sha256};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::domain::user::UserId;

pub async fn create(
    pool: &PgPool,
    user_id: UserId,
    token: &str,
    created_at: SystemTime,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1, $2, $3)")
        .bind(token_hash(token).to_vec())
        .bind(Uuid::from(user_id))
        .bind(OffsetDateTime::from(created_at))
        .execute(pool)
        .await?;

    Ok(())
}

pub async fn user_for_token(pool: &PgPool, token: &str) -> Result<Option<UserId>, sqlx::Error> {
    sqlx::query_scalar::<_, Uuid>("SELECT user_id FROM sessions WHERE token_hash = $1")
        .bind(token_hash(token).to_vec())
        .fetch_optional(pool)
        .await
        .map(|user_id| user_id.map(Into::into))
}

pub async fn delete(pool: &PgPool, token: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM sessions WHERE token_hash = $1")
        .bind(token_hash(token).to_vec())
        .execute(pool)
        .await?;

    Ok(())
}

fn token_hash(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}
