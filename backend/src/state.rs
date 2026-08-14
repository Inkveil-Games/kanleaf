use std::{
    fmt,
    sync::{Arc, Mutex, MutexGuard},
};

use kanleaf_backend::domain::project::Project;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    db: PgPool,
    projects: Arc<Mutex<Vec<Project>>>,
}

impl AppState {
    pub fn new(db: PgPool) -> Self {
        Self {
            db,
            projects: Arc::default(),
        }
    }

    pub fn db(&self) -> &PgPool {
        &self.db
    }

    pub fn projects(&self) -> Result<MutexGuard<'_, Vec<Project>>, StateError> {
        self.projects.lock().map_err(|_| StateError::Poisoned)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StateError {
    Poisoned,
}

impl fmt::Display for StateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Poisoned => formatter.write_str("application state lock was poisoned"),
        }
    }
}
