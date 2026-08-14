use std::{
    collections::HashMap,
    fmt,
    sync::{Arc, Mutex, MutexGuard},
};

use kanleaf_backend::domain::{
    user::UserId,
    workspace::{Workspace, WorkspaceId, WorkspaceMembership},
};

#[derive(Clone, Default)]
pub struct AppState {
    store: Arc<Mutex<AppStore>>,
}

#[derive(Default)]
pub struct AppStore {
    pub users: HashMap<String, StoredUser>,
    pub sessions: HashMap<String, UserId>,
    pub workspaces: HashMap<WorkspaceId, Workspace>,
    pub workspace_memberships: Vec<WorkspaceMembership>,
    pub active_workspaces: HashMap<UserId, WorkspaceId>,
}

pub struct StoredUser {
    pub id: UserId,
    pub password_hash: String,
}

impl AppState {
    pub fn lock(&self) -> Result<MutexGuard<'_, AppStore>, StateError> {
        self.store.lock().map_err(|_| StateError::Poisoned)
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
