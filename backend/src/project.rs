use std::time::SystemTime;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, patch},
};
use kanleaf_backend::domain::{
    project::{Project, ProjectError, ProjectId},
    user::UserId,
    workspace::WorkspaceId,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::{ApiError, authenticated_user},
    state::{AppState, AppStore},
    workspace::has_membership,
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
    let user_id = authenticated_user(&headers, &state)?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let store = state.lock().map_err(ApiError::internal)?;
    let projects = list_for_user(&store, user_id, workspace_id)?
        .into_iter()
        .map(ProjectResponse::from)
        .collect();

    Ok(Json(projects))
}

async fn create_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
    Json(request): Json<ProjectNameRequest>,
) -> Result<(StatusCode, Json<ProjectResponse>), ApiError> {
    let user_id = authenticated_user(&headers, &state)?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let mut store = state.lock().map_err(ApiError::internal)?;
    let project = create_for_user(
        &mut store,
        user_id,
        workspace_id,
        request.name,
        SystemTime::now(),
    )?;

    Ok((StatusCode::CREATED, Json(ProjectResponse::from(&project))))
}

async fn rename_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, project_id)): Path<(String, String)>,
    Json(request): Json<ProjectNameRequest>,
) -> Result<Json<ProjectResponse>, ApiError> {
    let user_id = authenticated_user(&headers, &state)?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let project_id = parse_project_id(&project_id)?;
    let mut store = state.lock().map_err(ApiError::internal)?;
    let project = rename_for_user(
        &mut store,
        user_id,
        workspace_id,
        project_id,
        request.name,
        SystemTime::now(),
    )?;

    Ok(Json(ProjectResponse::from(&project)))
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

fn list_for_user(
    store: &AppStore,
    user_id: UserId,
    workspace_id: WorkspaceId,
) -> Result<Vec<&Project>, ProjectOperationError> {
    ensure_workspace_access(store, user_id, workspace_id)?;
    Ok(store
        .projects
        .iter()
        .filter(|project| project.workspace_id() == workspace_id)
        .collect())
}

fn create_for_user(
    store: &mut AppStore,
    user_id: UserId,
    workspace_id: WorkspaceId,
    name: impl Into<String>,
    now: SystemTime,
) -> Result<Project, ProjectOperationError> {
    ensure_workspace_access(store, user_id, workspace_id)?;
    let project = Project::new(workspace_id, name, now).map_err(map_domain_error)?;
    store.projects.push(project.clone());
    Ok(project)
}

fn rename_for_user(
    store: &mut AppStore,
    user_id: UserId,
    workspace_id: WorkspaceId,
    project_id: ProjectId,
    name: impl Into<String>,
    now: SystemTime,
) -> Result<Project, ProjectOperationError> {
    ensure_workspace_access(store, user_id, workspace_id)?;
    let project = store
        .projects
        .iter_mut()
        .find(|project| project.id() == project_id && project.workspace_id() == workspace_id)
        .ok_or(ProjectOperationError::NotFound)?;
    project.rename(name, now).map_err(map_domain_error)?;
    Ok(project.clone())
}

fn ensure_workspace_access(
    store: &AppStore,
    user_id: UserId,
    workspace_id: WorkspaceId,
) -> Result<(), ProjectOperationError> {
    has_membership(store, user_id, workspace_id)
        .then_some(())
        .ok_or(ProjectOperationError::AccessDenied)
}

fn map_domain_error(error: ProjectError) -> ProjectOperationError {
    match error {
        ProjectError::EmptyName => ProjectOperationError::InvalidName,
    }
}

#[cfg(test)]
mod tests {
    use std::time::UNIX_EPOCH;

    use kanleaf_backend::domain::workspace::{Workspace, WorkspaceMembership, WorkspaceRole};

    use super::*;

    #[test]
    fn projects_are_isolated_by_workspace() {
        let mut store = AppStore::default();
        let user = UserId::new();
        let workspace_a = add_workspace(&mut store, user, "Workspace A");
        let workspace_b = add_workspace(&mut store, user, "Workspace B");
        let project_a =
            create_for_user(&mut store, user, workspace_a, "Project A", UNIX_EPOCH).unwrap();
        let project_b =
            create_for_user(&mut store, user, workspace_b, "Project B", UNIX_EPOCH).unwrap();

        assert_eq!(
            list_for_user(&store, user, workspace_a),
            Ok(vec![&project_a])
        );
        assert_eq!(
            list_for_user(&store, user, workspace_b),
            Ok(vec![&project_b])
        );
        assert_eq!(
            rename_for_user(
                &mut store,
                user,
                workspace_a,
                project_b.id(),
                "Moved",
                UNIX_EPOCH,
            ),
            Err(ProjectOperationError::NotFound)
        );
        assert_eq!(store.projects[1].name(), "Project B");
    }

    #[test]
    fn project_operations_require_workspace_membership() {
        let mut store = AppStore::default();
        let member = UserId::new();
        let outsider = UserId::new();
        let workspace_id = add_workspace(&mut store, member, "Private");

        assert_eq!(
            list_for_user(&store, outsider, workspace_id),
            Err(ProjectOperationError::AccessDenied)
        );
        assert_eq!(
            create_for_user(&mut store, outsider, workspace_id, "Denied", UNIX_EPOCH),
            Err(ProjectOperationError::AccessDenied)
        );
    }

    fn add_workspace(store: &mut AppStore, user_id: UserId, name: &str) -> WorkspaceId {
        let workspace = Workspace::new(name, UNIX_EPOCH).unwrap();
        let workspace_id = workspace.id();
        store.workspaces.insert(workspace_id, workspace);
        store.workspace_memberships.push(WorkspaceMembership::new(
            workspace_id,
            user_id,
            WorkspaceRole::Owner,
        ));
        workspace_id
    }
}
