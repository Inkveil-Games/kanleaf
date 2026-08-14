use serde::{Deserialize, Serialize};

use crate::api::{get_json, patch_json, post_json, put_json};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
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

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Todo => "todo",
            Self::InProgress => "in_progress",
            Self::Done => "done",
        }
    }

    pub fn from_value(value: &str) -> Option<Self> {
        match value {
            "todo" => Some(Self::Todo),
            "in_progress" => Some(Self::InProgress),
            "done" => Some(Self::Done),
            _ => None,
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

#[derive(Serialize)]
struct UpdateTitleRequest<'a> {
    title: &'a str,
}

#[derive(Serialize)]
struct UpdateStatusRequest {
    status: TaskStatus,
}

#[derive(Serialize)]
struct UpdateProjectRequest<'a> {
    project_id: Option<&'a str>,
}

#[derive(Deserialize)]
struct MarkdownContentResponse {
    content: String,
}

#[derive(Serialize)]
struct MarkdownContentRequest<'a> {
    content: &'a str,
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

pub async fn update_title(
    token: &str,
    workspace_id: &str,
    task_id: &str,
    title: &str,
) -> Result<Task, String> {
    patch_json(
        &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
        token,
        &UpdateTitleRequest { title },
    )
    .await
}

pub async fn update_status(
    token: &str,
    workspace_id: &str,
    task_id: &str,
    status: TaskStatus,
) -> Result<Task, String> {
    patch_json(
        &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
        token,
        &UpdateStatusRequest { status },
    )
    .await
}

pub async fn update_project(
    token: &str,
    workspace_id: &str,
    task_id: &str,
    project_id: Option<&str>,
) -> Result<Task, String> {
    patch_json(
        &format!("/api/workspaces/{workspace_id}/tasks/{task_id}"),
        token,
        &UpdateProjectRequest { project_id },
    )
    .await
}

pub async fn get_content(token: &str, workspace_id: &str, task_id: &str) -> Result<String, String> {
    get_json::<MarkdownContentResponse>(
        &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/content"),
        token,
    )
    .await
    .map(|response| response.content)
}

pub async fn update_content(
    token: &str,
    workspace_id: &str,
    task_id: &str,
    content: &str,
) -> Result<String, String> {
    put_json::<_, MarkdownContentResponse>(
        &format!("/api/workspaces/{workspace_id}/tasks/{task_id}/content"),
        token,
        &MarkdownContentRequest { content },
    )
    .await
    .map(|response| response.content)
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
        assert_eq!(TaskStatus::Todo.as_str(), "todo");
        assert_eq!(
            TaskStatus::from_value("in_progress"),
            Some(TaskStatus::InProgress)
        );
        assert_eq!(TaskStatus::from_value("blocked"), None);
    }
}
