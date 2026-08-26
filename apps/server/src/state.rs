use std::{path::PathBuf, sync::Arc, time::Duration};

use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub data_dir: Arc<PathBuf>,
    pub session_ttl: Duration,
}

impl AppState {
    pub fn new(pool: PgPool, data_dir: PathBuf, session_ttl: Duration) -> Self {
        Self {
            pool,
            data_dir: Arc::new(data_dir),
            session_ttl,
        }
    }
}
