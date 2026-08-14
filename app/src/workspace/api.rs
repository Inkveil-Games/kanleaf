use serde::Deserialize;

use crate::api::get_json;

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

pub async fn list(token: &str) -> Result<WorkspaceList, String> {
    get_json("/api/workspaces", token).await
}
