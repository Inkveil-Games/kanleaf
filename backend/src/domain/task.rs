use std::{fmt, str::FromStr, time::SystemTime};

use uuid::Uuid;

use super::{project::ProjectId, user::UserId, workspace::WorkspaceId};

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct TaskId(Uuid);

impl TaskId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for TaskId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for TaskId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl FromStr for TaskId {
    type Err = uuid::Error;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Uuid::parse_str(value).map(Self)
    }
}

impl From<Uuid> for TaskId {
    fn from(value: Uuid) -> Self {
        Self(value)
    }
}

impl From<TaskId> for Uuid {
    fn from(value: TaskId) -> Self {
        value.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TaskStatus {
    Todo,
    InProgress,
    Done,
}

impl TaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Todo => "todo",
            Self::InProgress => "in_progress",
            Self::Done => "done",
        }
    }
}

impl FromStr for TaskStatus {
    type Err = TaskError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "todo" => Ok(Self::Todo),
            "in_progress" => Ok(Self::InProgress),
            "done" => Ok(Self::Done),
            _ => Err(TaskError::InvalidStatus),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Task {
    id: TaskId,
    workspace_id: WorkspaceId,
    project_id: Option<ProjectId>,
    title: String,
    status: TaskStatus,
    created_by: UserId,
    created_at: SystemTime,
    updated_at: SystemTime,
}

impl Task {
    pub fn new(
        workspace_id: WorkspaceId,
        project_id: Option<ProjectId>,
        title: impl Into<String>,
        created_by: UserId,
        now: SystemTime,
    ) -> Result<Self, TaskError> {
        Ok(Self {
            id: TaskId::new(),
            workspace_id,
            project_id,
            title: Self::validated_title(title)?,
            status: TaskStatus::Todo,
            created_by,
            created_at: now,
            updated_at: now,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn restore(
        id: TaskId,
        workspace_id: WorkspaceId,
        project_id: Option<ProjectId>,
        title: impl Into<String>,
        status: TaskStatus,
        created_by: UserId,
        created_at: SystemTime,
        updated_at: SystemTime,
    ) -> Result<Self, TaskError> {
        Ok(Self {
            id,
            workspace_id,
            project_id,
            title: Self::validated_title(title)?,
            status,
            created_by,
            created_at,
            updated_at,
        })
    }

    pub fn validated_title(title: impl Into<String>) -> Result<String, TaskError> {
        let title = title.into();
        let title = title.trim();
        if title.is_empty() {
            return Err(TaskError::EmptyTitle);
        }

        Ok(title.to_owned())
    }

    pub fn id(&self) -> TaskId {
        self.id
    }

    pub fn workspace_id(&self) -> WorkspaceId {
        self.workspace_id
    }

    pub fn project_id(&self) -> Option<ProjectId> {
        self.project_id
    }

    pub fn title(&self) -> &str {
        &self.title
    }

    pub fn status(&self) -> TaskStatus {
        self.status
    }

    pub fn created_by(&self) -> UserId {
        self.created_by
    }

    pub fn created_at(&self) -> SystemTime {
        self.created_at
    }

    pub fn updated_at(&self) -> SystemTime {
        self.updated_at
    }

    pub fn rename(&mut self, title: impl Into<String>, now: SystemTime) -> Result<(), TaskError> {
        self.title = Self::validated_title(title)?;
        self.updated_at = now;
        Ok(())
    }

    pub fn set_status(&mut self, status: TaskStatus, now: SystemTime) {
        self.status = status;
        self.updated_at = now;
    }

    pub fn move_to_project(&mut self, project_id: Option<ProjectId>, now: SystemTime) {
        self.project_id = project_id;
        self.updated_at = now;
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TaskError {
    EmptyTitle,
    InvalidStatus,
}

impl fmt::Display for TaskError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyTitle => formatter.write_str("Task title cannot be empty."),
            Self::InvalidStatus => formatter.write_str("Task status is invalid."),
        }
    }
}

impl std::error::Error for TaskError {}

#[cfg(test)]
mod tests {
    use std::time::{Duration, UNIX_EPOCH};

    use super::*;

    #[test]
    fn task_defaults_to_todo_and_validates_its_title() {
        let workspace_id = WorkspaceId::new();
        let user_id = UserId::new();
        assert_eq!(
            Task::new(workspace_id, None, "  ", user_id, UNIX_EPOCH),
            Err(TaskError::EmptyTitle)
        );

        let mut task = Task::new(workspace_id, None, "  Task A  ", user_id, UNIX_EPOCH).unwrap();
        let project_id = ProjectId::new();
        let updated_at = UNIX_EPOCH + Duration::from_secs(10);

        assert_eq!(task.title(), "Task A");
        assert_eq!(task.status(), TaskStatus::Todo);
        assert_eq!(task.project_id(), None);

        task.set_status(TaskStatus::InProgress, updated_at);
        task.move_to_project(Some(project_id), updated_at);
        task.rename("  Task A renamed  ", updated_at).unwrap();

        assert_eq!(task.title(), "Task A renamed");
        assert_eq!(task.status(), TaskStatus::InProgress);
        assert_eq!(task.project_id(), Some(project_id));
        assert_eq!(task.workspace_id(), workspace_id);
        assert_eq!(task.created_by(), user_id);
        assert_eq!(task.created_at(), UNIX_EPOCH);
        assert_eq!(task.updated_at(), updated_at);
    }

    #[test]
    fn task_status_has_a_stable_storage_representation() {
        assert_eq!(TaskStatus::Todo.as_str(), "todo");
        assert_eq!(TaskStatus::InProgress.as_str(), "in_progress");
        assert_eq!(TaskStatus::Done.as_str(), "done");
        assert_eq!("todo".parse(), Ok(TaskStatus::Todo));
        assert_eq!("in_progress".parse(), Ok(TaskStatus::InProgress));
        assert_eq!("done".parse(), Ok(TaskStatus::Done));
        assert_eq!(
            "blocked".parse::<TaskStatus>(),
            Err(TaskError::InvalidStatus)
        );
    }
}
