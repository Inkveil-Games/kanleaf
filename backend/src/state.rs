use sqlx::PgPool;

use kanleaf_backend::vault::Vault;

#[derive(Clone)]
pub struct AppState {
    db: PgPool,
    vault: Vault,
}

impl AppState {
    pub fn new(db: PgPool, vault: Vault) -> Self {
        Self { db, vault }
    }

    pub fn db(&self) -> &PgPool {
        &self.db
    }

    pub fn vault(&self) -> &Vault {
        &self.vault
    }
}
