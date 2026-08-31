use std::{path::PathBuf, time::Duration};

use sqlx::PgPool;

use crate::{domain::NormalizedEmail, vault::Vault};

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub vault: Vault,
    pub session_ttl: Duration,
    host_email: Option<NormalizedEmail>,
}

impl AppState {
    pub fn new(pool: PgPool, data_dir: PathBuf, session_ttl: Duration) -> Self {
        Self {
            pool,
            vault: Vault::new(data_dir),
            session_ttl,
            host_email: None,
        }
    }

    pub fn with_host_email(mut self, host_email: Option<NormalizedEmail>) -> Self {
        self.host_email = host_email;
        self
    }

    pub(crate) fn host_email(&self) -> Option<&NormalizedEmail> {
        self.host_email.as_ref()
    }

    pub(crate) fn is_host_email(&self, email: &str) -> bool {
        self.host_email
            .as_ref()
            .is_some_and(|host_email| host_email.as_str() == email)
    }
}
