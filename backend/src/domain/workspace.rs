use std::{fmt, time::SystemTime};

use uuid::Uuid;

use super::user::UserId;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct WorkspaceId(Uuid);

impl WorkspaceId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for WorkspaceId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for WorkspaceId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Workspace {
    id: WorkspaceId,
    name: String,
    created_at: SystemTime,
    updated_at: SystemTime,
}

impl Workspace {
    pub fn new(name: impl Into<String>, now: SystemTime) -> Result<Self, WorkspaceError> {
        let name = validated_name(name.into())?;

        Ok(Self {
            id: WorkspaceId::new(),
            name,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn id(&self) -> WorkspaceId {
        self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn created_at(&self) -> SystemTime {
        self.created_at
    }

    pub fn updated_at(&self) -> SystemTime {
        self.updated_at
    }

    pub fn rename(
        &mut self,
        name: impl Into<String>,
        now: SystemTime,
    ) -> Result<(), WorkspaceError> {
        self.name = validated_name(name.into())?;
        self.updated_at = now;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WorkspaceMembership {
    workspace_id: WorkspaceId,
    user_id: UserId,
    role: WorkspaceRole,
}

impl WorkspaceMembership {
    pub fn new(workspace_id: WorkspaceId, user_id: UserId, role: WorkspaceRole) -> Self {
        Self {
            workspace_id,
            user_id,
            role,
        }
    }

    pub fn workspace_id(&self) -> WorkspaceId {
        self.workspace_id
    }

    pub fn user_id(&self) -> UserId {
        self.user_id
    }

    pub fn role(&self) -> WorkspaceRole {
        self.role
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkspaceRole {
    Owner,
    Admin,
    Member,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkspaceError {
    EmptyName,
}

impl fmt::Display for WorkspaceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyName => formatter.write_str("Workspace name cannot be empty."),
        }
    }
}

fn validated_name(name: String) -> Result<String, WorkspaceError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(WorkspaceError::EmptyName);
    }

    Ok(name.to_owned())
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, UNIX_EPOCH};

    use super::*;

    #[test]
    fn workspace_requires_a_name_and_keeps_stable_identity_when_renamed() {
        assert_eq!(
            Workspace::new("  ", UNIX_EPOCH),
            Err(WorkspaceError::EmptyName)
        );

        let mut workspace = Workspace::new("  Personal  ", UNIX_EPOCH).unwrap();
        let id = workspace.id();
        let renamed_at = UNIX_EPOCH + Duration::from_secs(10);

        workspace.rename("Kanleaf", renamed_at).unwrap();

        assert_eq!(workspace.id(), id);
        assert_eq!(workspace.name(), "Kanleaf");
        assert_eq!(workspace.created_at(), UNIX_EPOCH);
        assert_eq!(workspace.updated_at(), renamed_at);
    }

    #[test]
    fn membership_links_a_user_to_a_workspace_with_a_role() {
        let user_id = UserId::new();
        let workspace_id = WorkspaceId::new();
        let membership = WorkspaceMembership::new(workspace_id, user_id, WorkspaceRole::Owner);

        assert_eq!(membership.user_id(), user_id);
        assert_eq!(membership.workspace_id(), workspace_id);
        assert_eq!(membership.role(), WorkspaceRole::Owner);
    }
}
