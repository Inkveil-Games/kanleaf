use serde::{Deserialize, Serialize};

use crate::api::{get_json, post_json};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Todo,
    InProgress,
    Done,
}

impl TaskStatus {
    pub fn label(self) -> &'static str {
        match self {
            Self::Todo => "Todo",
            Self::InProgress => "In progress",
            Self::Done => "Done",
        }
    }

    pub fn class_name(self) -> &'static str {
        match self {
            Self::Todo => "todo",
            Self::InProgress => "in-progress",
            Self::Done => "done",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Task {
    pub id: String,
    pub workspace_id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub status: TaskStatus,
}

#[derive(Serialize)]
struct CreateTaskRequest<'a> {
    title: &'a str,
    project_id: Option<&'a str>,
}

pub async fn list_inbox(token: &str, workspace_id: &str) -> Result<Vec<Task>, String> {
    get_json(
        &format!("/api/workspaces/{workspace_id}/tasks/inbox"),
        token,
    )
    .await
}

pub async fn list_project(
    token: &str,
    workspace_id: &str,
    project_id: &str,
) -> Result<Vec<Task>, String> {
    get_json(
        &format!("/api/workspaces/{workspace_id}/projects/{project_id}/tasks"),
        token,
    )
    .await
}

pub async fn create(
    token: &str,
    workspace_id: &str,
    project_id: Option<&str>,
    title: &str,
) -> Result<Task, String> {
    post_json(
        &format!("/api/workspaces/{workspace_id}/tasks"),
        Some(token),
        &CreateTaskRequest { title, project_id },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_status_has_compact_list_metadata() {
        assert_eq!(TaskStatus::Todo.label(), "Todo");
        assert_eq!(TaskStatus::InProgress.label(), "In progress");
        assert_eq!(TaskStatus::Done.label(), "Done");
        assert_eq!(TaskStatus::Todo.class_name(), "todo");
        assert_eq!(TaskStatus::InProgress.class_name(), "in-progress");
        assert_eq!(TaskStatus::Done.class_name(), "done");
    }
}
