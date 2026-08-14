use std::time::SystemTime;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, patch, post},
};
use kanleaf_backend::{
    domain::workspace::{Workspace, WorkspaceError, WorkspaceId},
    persistence::workspace,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::{ApiError, authenticated_user},
    state::AppState,
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
    let user_id = authenticated_user(&headers, &state).await?;
    let workspaces = workspace::list_for_user(state.db(), user_id)
        .await
        .map_err(ApiError::internal)?
        .iter()
        .map(WorkspaceResponse::from)
        .collect();
    let active_workspace_id = workspace::active_workspace_id(state.db(), user_id)
        .await
        .map_err(ApiError::internal)?
        .map(|id| id.to_string());

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
    let user_id = authenticated_user(&headers, &state).await?;
    let workspace = Workspace::new(request.name, SystemTime::now()).map_err(map_domain_error)?;
    workspace::create_for_user(state.db(), user_id, &workspace)
        .await
        .map_err(ApiError::internal)?;

    Ok((StatusCode::CREATED, Json((&workspace).into())))
}

async fn rename_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
    Json(request): Json<WorkspaceNameRequest>,
) -> Result<Json<WorkspaceResponse>, ApiError> {
    let user_id = authenticated_user(&headers, &state).await?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let name = Workspace::validated_name(request.name).map_err(map_domain_error)?;
    let workspace =
        workspace::rename_for_user(state.db(), user_id, workspace_id, &name, SystemTime::now())
            .await
            .map_err(ApiError::internal)?
            .ok_or(WorkspaceOperationError::AccessDenied)?;

    Ok(Json((&workspace).into()))
}

async fn activate_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceResponse>, ApiError> {
    let user_id = authenticated_user(&headers, &state).await?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let workspace = workspace::activate_for_user(state.db(), user_id, workspace_id)
        .await
        .map_err(ApiError::internal)?
        .ok_or(WorkspaceOperationError::AccessDenied)?;

    Ok(Json((&workspace).into()))
}

fn parse_workspace_id(value: &str) -> Result<WorkspaceId, ApiError> {
    value
        .parse()
        .map_err(|_| ApiError::bad_request("Enter a valid workspace ID."))
}

fn map_domain_error(error: WorkspaceError) -> WorkspaceOperationError {
    match error {
        WorkspaceError::EmptyName => WorkspaceOperationError::InvalidName,
    }
}
