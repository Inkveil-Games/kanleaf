use std::time::SystemTime;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, patch},
};
use kanleaf_backend::{
    domain::{
        project::{Project, ProjectError, ProjectId},
        user::UserId,
        workspace::WorkspaceId,
    },
    persistence::workspace,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::{ApiError, authenticated_user},
    state::AppState,
};

#[derive(Deserialize)]
struct ProjectNameRequest {
    name: String,
}

#[derive(Serialize)]
struct ProjectResponse {
    id: String,
    workspace_id: String,
    name: String,
}

impl From<&Project> for ProjectResponse {
    fn from(project: &Project) -> Self {
        Self {
            id: project.id().to_string(),
            workspace_id: project.workspace_id().to_string(),
            name: project.name().to_owned(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProjectOperationError {
    AccessDenied,
    InvalidName,
    NotFound,
}

impl From<ProjectOperationError> for ApiError {
    fn from(error: ProjectOperationError) -> Self {
        match error {
            ProjectOperationError::AccessDenied => {
                ApiError::forbidden("You do not have access to this workspace.")
            }
            ProjectOperationError::InvalidName => {
                ApiError::bad_request("Project name cannot be empty.")
            }
            ProjectOperationError::NotFound => ApiError::not_found("Project not found."),
        }
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route(
            "/api/workspaces/{workspace_id}/projects",
            get(list_projects).post(create_project),
        )
        .route(
            "/api/workspaces/{workspace_id}/projects/{project_id}",
            patch(rename_project),
        )
        .with_state(state)
}

async fn list_projects(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
) -> Result<Json<Vec<ProjectResponse>>, ApiError> {
    let user_id = authenticated_user(&headers, &state).await?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    ensure_workspace_access(&state, user_id, workspace_id).await?;
    let projects = state.projects().map_err(ApiError::internal)?;
    let response = list_in_workspace(&projects, workspace_id)
        .into_iter()
        .map(ProjectResponse::from)
        .collect();

    Ok(Json(response))
}

async fn create_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
    Json(request): Json<ProjectNameRequest>,
) -> Result<(StatusCode, Json<ProjectResponse>), ApiError> {
    let user_id = authenticated_user(&headers, &state).await?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    ensure_workspace_access(&state, user_id, workspace_id).await?;
    let project =
        Project::new(workspace_id, request.name, SystemTime::now()).map_err(map_domain_error)?;
    state
        .projects()
        .map_err(ApiError::internal)?
        .push(project.clone());

    Ok((StatusCode::CREATED, Json((&project).into())))
}

async fn rename_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, project_id)): Path<(String, String)>,
    Json(request): Json<ProjectNameRequest>,
) -> Result<Json<ProjectResponse>, ApiError> {
    let user_id = authenticated_user(&headers, &state).await?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let project_id = parse_project_id(&project_id)?;
    ensure_workspace_access(&state, user_id, workspace_id).await?;
    let project = rename_in_workspace(
        &mut state.projects().map_err(ApiError::internal)?,
        workspace_id,
        project_id,
        request.name,
        SystemTime::now(),
    )?;

    Ok(Json((&project).into()))
}

fn parse_workspace_id(value: &str) -> Result<WorkspaceId, ApiError> {
    value
        .parse()
        .map_err(|_| ApiError::bad_request("Enter a valid workspace ID."))
}

fn parse_project_id(value: &str) -> Result<ProjectId, ApiError> {
    value
        .parse()
        .map_err(|_| ApiError::bad_request("Enter a valid project ID."))
}

fn list_in_workspace(projects: &[Project], workspace_id: WorkspaceId) -> Vec<&Project> {
    projects
        .iter()
        .filter(|project| project.workspace_id() == workspace_id)
        .collect()
}

fn rename_in_workspace(
    projects: &mut [Project],
    workspace_id: WorkspaceId,
    project_id: ProjectId,
    name: impl Into<String>,
    now: SystemTime,
) -> Result<Project, ProjectOperationError> {
    let project = projects
        .iter_mut()
        .find(|project| project.id() == project_id && project.workspace_id() == workspace_id)
        .ok_or(ProjectOperationError::NotFound)?;
    project.rename(name, now).map_err(map_domain_error)?;
    Ok(project.clone())
}

async fn ensure_workspace_access(
    state: &AppState,
    user_id: UserId,
    workspace_id: WorkspaceId,
) -> Result<(), ApiError> {
    workspace::has_membership(state.db(), user_id, workspace_id)
        .await
        .map_err(ApiError::internal)?
        .then_some(())
        .ok_or_else(|| ProjectOperationError::AccessDenied.into())
}

fn map_domain_error(error: ProjectError) -> ProjectOperationError {
    match error {
        ProjectError::EmptyName => ProjectOperationError::InvalidName,
    }
}

#[cfg(test)]
mod tests {
    use std::time::UNIX_EPOCH;

    use super::*;

    #[test]
    fn projects_are_isolated_by_workspace() {
        let workspace_a = WorkspaceId::new();
        let workspace_b = WorkspaceId::new();
        let project_a = Project::new(workspace_a, "Project A", UNIX_EPOCH).unwrap();
        let project_b = Project::new(workspace_b, "Project B", UNIX_EPOCH).unwrap();
        let mut projects = vec![project_a.clone(), project_b.clone()];

        assert_eq!(list_in_workspace(&projects, workspace_a), vec![&project_a]);
        assert_eq!(list_in_workspace(&projects, workspace_b), vec![&project_b]);
        assert_eq!(
            rename_in_workspace(
                &mut projects,
                workspace_a,
                project_b.id(),
                "Moved",
                UNIX_EPOCH,
            ),
            Err(ProjectOperationError::NotFound)
        );
        assert_eq!(projects[1].name(), "Project B");
    }
}
