use std::{fmt, str::FromStr, time::SystemTime};

use uuid::Uuid;

use super::workspace::WorkspaceId;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct ProjectId(Uuid);

impl ProjectId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for ProjectId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for ProjectId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl FromStr for ProjectId {
    type Err = uuid::Error;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Uuid::parse_str(value).map(Self)
    }
}

impl From<Uuid> for ProjectId {
    fn from(value: Uuid) -> Self {
        Self(value)
    }
}

impl From<ProjectId> for Uuid {
    fn from(value: ProjectId) -> Self {
        value.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Project {
    id: ProjectId,
    workspace_id: WorkspaceId,
    name: String,
    created_at: SystemTime,
    updated_at: SystemTime,
}

impl Project {
    pub fn new(
        workspace_id: WorkspaceId,
        name: impl Into<String>,
        now: SystemTime,
    ) -> Result<Self, ProjectError> {
        let name = Self::validated_name(name)?;

        Ok(Self {
            id: ProjectId::new(),
            workspace_id,
            name,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn restore(
        id: ProjectId,
        workspace_id: WorkspaceId,
        name: impl Into<String>,
        created_at: SystemTime,
        updated_at: SystemTime,
    ) -> Result<Self, ProjectError> {
        Ok(Self {
            id,
            workspace_id,
            name: Self::validated_name(name)?,
            created_at,
            updated_at,
        })
    }

    pub fn validated_name(name: impl Into<String>) -> Result<String, ProjectError> {
        let name = name.into();
        let name = name.trim();
        if name.is_empty() {
            return Err(ProjectError::EmptyName);
        }

        Ok(name.to_owned())
    }

    pub fn id(&self) -> ProjectId {
        self.id
    }

    pub fn workspace_id(&self) -> WorkspaceId {
        self.workspace_id
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

    pub fn rename(&mut self, name: impl Into<String>, now: SystemTime) -> Result<(), ProjectError> {
        self.name = Self::validated_name(name)?;
        self.updated_at = now;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProjectError {
    EmptyName,
}

impl fmt::Display for ProjectError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyName => formatter.write_str("Project name cannot be empty."),
        }
    }
}

impl std::error::Error for ProjectError {}

#[cfg(test)]
mod tests {
    use std::time::{Duration, UNIX_EPOCH};

    use super::*;

    #[test]
    fn project_belongs_to_one_workspace_and_keeps_it_when_renamed() {
        let workspace_id = WorkspaceId::new();
        assert_eq!(
            Project::new(workspace_id, "  ", UNIX_EPOCH),
            Err(ProjectError::EmptyName)
        );

        let mut project = Project::new(workspace_id, "  Kanleaf Core  ", UNIX_EPOCH).unwrap();
        let id = project.id();
        let renamed_at = UNIX_EPOCH + Duration::from_secs(10);

        project.rename("Desktop", renamed_at).unwrap();

        assert_eq!(project.id(), id);
        assert_eq!(project.workspace_id(), workspace_id);
        assert_eq!(project.name(), "Desktop");
        assert_eq!(project.created_at(), UNIX_EPOCH);
        assert_eq!(project.updated_at(), renamed_at);
    }
}
