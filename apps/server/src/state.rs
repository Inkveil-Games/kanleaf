use std::{path::PathBuf, time::Duration};

use sqlx::PgPool;

use crate::vault::Vault;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub vault: Vault,
    pub session_ttl: Duration,
}

impl AppState {
    pub fn new(pool: PgPool, data_dir: PathBuf, session_ttl: Duration) -> Self {
        Self {
            pool,
            vault: Vault::new(data_dir),
            session_ttl,
        }
    }
}
