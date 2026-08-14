use serde::{Deserialize, Serialize};

use crate::api::{get_json, post_empty_json, post_json};

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Workspace {
    pub id: String,
    pub name: String,
}

#[derive(Deserialize)]
pub struct WorkspaceList {
    pub workspaces: Vec<Workspace>,
    pub active_workspace_id: Option<String>,
}

#[derive(Serialize)]
struct WorkspaceNameRequest<'a> {
    name: &'a str,
}

pub async fn list(token: &str) -> Result<WorkspaceList, String> {
    get_json("/api/workspaces", token).await
}

pub async fn create(token: &str, name: &str) -> Result<Workspace, String> {
    post_json(
        "/api/workspaces",
        Some(token),
        &WorkspaceNameRequest { name },
    )
    .await
}

pub async fn activate(token: &str, workspace_id: &str) -> Result<Workspace, String> {
    post_empty_json(&format!("/api/workspaces/{workspace_id}/activate"), token).await
}
