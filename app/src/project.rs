use serde::{Deserialize, Serialize};

use crate::api::{get_json, post_json};

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Project {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
}

#[derive(Serialize)]
struct ProjectNameRequest<'a> {
    name: &'a str,
}

pub async fn list(token: &str, workspace_id: &str) -> Result<Vec<Project>, String> {
    get_json(&format!("/api/workspaces/{workspace_id}/projects"), token).await
}

pub async fn create(token: &str, workspace_id: &str, name: &str) -> Result<Project, String> {
    post_json(
        &format!("/api/workspaces/{workspace_id}/projects"),
        Some(token),
        &ProjectNameRequest { name },
    )
    .await
}
