use std::time::SystemTime;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, patch, post},
};
use kanleaf_backend::domain::{
    user::UserId,
    workspace::{Workspace, WorkspaceError, WorkspaceId, WorkspaceMembership, WorkspaceRole},
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::{ApiError, authenticated_user},
    state::{AppState, AppStore},
};

#[derive(Deserialize)]
struct WorkspaceNameRequest {
    name: String,
}

#[derive(Serialize)]
struct WorkspaceResponse {
    id: String,
    name: String,
}

impl From<&Workspace> for WorkspaceResponse {
    fn from(workspace: &Workspace) -> Self {
        Self {
            id: workspace.id().to_string(),
            name: workspace.name().to_owned(),
        }
    }
}

#[derive(Serialize)]
struct WorkspaceListResponse {
    workspaces: Vec<WorkspaceResponse>,
    active_workspace_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WorkspaceOperationError {
    AccessDenied,
    InvalidName,
}

impl From<WorkspaceOperationError> for ApiError {
    fn from(error: WorkspaceOperationError) -> Self {
        match error {
            WorkspaceOperationError::AccessDenied => {
                ApiError::forbidden("You do not have access to this workspace.")
            }
            WorkspaceOperationError::InvalidName => {
                ApiError::bad_request("Workspace name cannot be empty.")
            }
        }
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/", get(list_workspaces).post(create_workspace))
        .route("/{workspace_id}", patch(rename_workspace))
        .route("/{workspace_id}/activate", post(activate_workspace))
        .with_state(state)
}

async fn list_workspaces(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<WorkspaceListResponse>, ApiError> {
    let user_id = authenticated_user(&headers, &state)?;
    let store = state.lock().map_err(ApiError::internal)?;
    let workspaces = workspaces_for_user(&store, user_id)
        .into_iter()
        .map(WorkspaceResponse::from)
        .collect();
    let active_workspace_id = store
        .active_workspaces
        .get(&user_id)
        .map(ToString::to_string);

    Ok(Json(WorkspaceListResponse {
        workspaces,
        active_workspace_id,
    }))
}

async fn create_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<WorkspaceNameRequest>,
) -> Result<(StatusCode, Json<WorkspaceResponse>), ApiError> {
    let user_id = authenticated_user(&headers, &state)?;
    let mut store = state.lock().map_err(ApiError::internal)?;
    let workspace = create_for_user(&mut store, user_id, request.name, SystemTime::now())?;

    Ok((
        StatusCode::CREATED,
        Json(WorkspaceResponse::from(&workspace)),
    ))
}

async fn rename_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
    Json(request): Json<WorkspaceNameRequest>,
) -> Result<Json<WorkspaceResponse>, ApiError> {
    let user_id = authenticated_user(&headers, &state)?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let mut store = state.lock().map_err(ApiError::internal)?;
    let workspace = rename_for_user(
        &mut store,
        user_id,
        workspace_id,
        request.name,
        SystemTime::now(),
    )?;

    Ok(Json(WorkspaceResponse::from(&workspace)))
}

async fn activate_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceResponse>, ApiError> {
    let user_id = authenticated_user(&headers, &state)?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let mut store = state.lock().map_err(ApiError::internal)?;
    let workspace = activate_for_user(&mut store, user_id, workspace_id)?;

    Ok(Json(WorkspaceResponse::from(&workspace)))
}

fn parse_workspace_id(value: &str) -> Result<WorkspaceId, ApiError> {
    value
        .parse()
        .map_err(|_| ApiError::bad_request("Enter a valid workspace ID."))
}

fn workspaces_for_user(store: &AppStore, user_id: UserId) -> Vec<&Workspace> {
    store
        .workspace_memberships
        .iter()
        .filter(|membership| membership.user_id() == user_id)
        .filter_map(|membership| store.workspaces.get(&membership.workspace_id()))
        .collect()
}

fn create_for_user(
    store: &mut AppStore,
    user_id: UserId,
    name: impl Into<String>,
    now: SystemTime,
) -> Result<Workspace, WorkspaceOperationError> {
    let workspace = Workspace::new(name, now).map_err(map_domain_error)?;
    let workspace_id = workspace.id();
    let membership = WorkspaceMembership::new(workspace_id, user_id, WorkspaceRole::Owner);

    store.workspaces.insert(workspace_id, workspace.clone());
    store.workspace_memberships.push(membership);
    store.active_workspaces.insert(user_id, workspace_id);

    Ok(workspace)
}

fn rename_for_user(
    store: &mut AppStore,
    user_id: UserId,
    workspace_id: WorkspaceId,
    name: impl Into<String>,
    now: SystemTime,
) -> Result<Workspace, WorkspaceOperationError> {
    ensure_membership(store, user_id, workspace_id)?;
    let workspace = store
        .workspaces
        .get_mut(&workspace_id)
        .ok_or(WorkspaceOperationError::AccessDenied)?;
    workspace.rename(name, now).map_err(map_domain_error)?;
    Ok(workspace.clone())
}

fn activate_for_user(
    store: &mut AppStore,
    user_id: UserId,
    workspace_id: WorkspaceId,
) -> Result<Workspace, WorkspaceOperationError> {
    ensure_membership(store, user_id, workspace_id)?;
    let workspace = store
        .workspaces
        .get(&workspace_id)
        .cloned()
        .ok_or(WorkspaceOperationError::AccessDenied)?;
    store.active_workspaces.insert(user_id, workspace_id);
    Ok(workspace)
}

fn ensure_membership(
    store: &AppStore,
    user_id: UserId,
    workspace_id: WorkspaceId,
) -> Result<(), WorkspaceOperationError> {
    has_membership(store, user_id, workspace_id)
        .then_some(())
        .ok_or(WorkspaceOperationError::AccessDenied)
}

pub(crate) fn has_membership(store: &AppStore, user_id: UserId, workspace_id: WorkspaceId) -> bool {
    store.workspace_memberships.iter().any(|membership| {
        membership.user_id() == user_id && membership.workspace_id() == workspace_id
    })
}

fn map_domain_error(error: WorkspaceError) -> WorkspaceOperationError {
    match error {
        WorkspaceError::EmptyName => WorkspaceOperationError::InvalidName,
    }
}

#[cfg(test)]
mod tests {
    use std::time::UNIX_EPOCH;

    use super::*;

    #[test]
    fn workspace_access_is_limited_to_members() {
        let mut store = AppStore::default();
        let user_a = UserId::new();
        let user_b = UserId::new();
        let workspace_a = create_for_user(&mut store, user_a, "Workspace A", UNIX_EPOCH).unwrap();

        assert_eq!(workspaces_for_user(&store, user_a), vec![&workspace_a]);
        assert!(workspaces_for_user(&store, user_b).is_empty());
        assert_eq!(
            activate_for_user(&mut store, user_b, workspace_a.id()),
            Err(WorkspaceOperationError::AccessDenied)
        );
        assert_eq!(
            rename_for_user(&mut store, user_b, workspace_a.id(), "Stolen", UNIX_EPOCH,),
            Err(WorkspaceOperationError::AccessDenied)
        );
        assert_eq!(store.workspaces[&workspace_a.id()].name(), "Workspace A");
    }
}
