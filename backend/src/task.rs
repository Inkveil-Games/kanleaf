use std::time::SystemTime;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use kanleaf_backend::{
    domain::{
        project::ProjectId,
        task::{Task, TaskError, TaskId, TaskStatus},
        user::UserId,
        workspace::WorkspaceId,
    },
    persistence::{task, workspace},
};
use serde::{Deserialize, Deserializer, Serialize};

use crate::{
    auth::{ApiError, authenticated_user},
    state::AppState,
};

#[derive(Deserialize)]
struct CreateTaskRequest {
    title: String,
    project_id: Option<String>,
}

#[derive(Deserialize)]
struct UpdateTaskRequest {
    title: Option<String>,
    status: Option<String>,
    #[serde(default, deserialize_with = "deserialize_project_update")]
    project_id: ProjectUpdate,
}

#[derive(Default)]
enum ProjectUpdate {
    #[default]
    Unchanged,
    Set(Option<String>),
}

fn deserialize_project_update<'de, D>(deserializer: D) -> Result<ProjectUpdate, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer).map(ProjectUpdate::Set)
}

#[derive(Debug, Serialize)]
struct TaskResponse {
    id: String,
    workspace_id: String,
    project_id: Option<String>,
    title: String,
    status: &'static str,
}

impl From<&Task> for TaskResponse {
    fn from(task: &Task) -> Self {
        Self {
            id: task.id().to_string(),
            workspace_id: task.workspace_id().to_string(),
            project_id: task.project_id().map(|id| id.to_string()),
            title: task.title().to_owned(),
            status: task.status().as_str(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TaskOperationError {
    AccessDenied,
    InvalidTitle,
    InvalidStatus,
    InvalidProject,
    NotFound,
}

impl From<TaskOperationError> for ApiError {
    fn from(error: TaskOperationError) -> Self {
        match error {
            TaskOperationError::AccessDenied => {
                ApiError::forbidden("You do not have access to this workspace.")
            }
            TaskOperationError::InvalidTitle => {
                ApiError::bad_request("Task title cannot be empty.")
            }
            TaskOperationError::InvalidStatus => {
                ApiError::bad_request("Task status must be todo, in_progress, or done.")
            }
            TaskOperationError::InvalidProject => {
                ApiError::bad_request("Project does not belong to this workspace.")
            }
            TaskOperationError::NotFound => ApiError::not_found("Task not found."),
        }
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/workspaces/{workspace_id}/tasks", post(create_task))
        .route(
            "/api/workspaces/{workspace_id}/tasks/inbox",
            get(list_inbox_tasks),
        )
        .route(
            "/api/workspaces/{workspace_id}/projects/{project_id}/tasks",
            get(list_project_tasks),
        )
        .route(
            "/api/workspaces/{workspace_id}/tasks/{task_id}",
            get(get_task).patch(update_task),
        )
        .with_state(state)
}

async fn create_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
    Json(request): Json<CreateTaskRequest>,
) -> Result<(StatusCode, Json<TaskResponse>), ApiError> {
    let user_id = authenticated_user(&headers, &state).await?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    ensure_workspace_access(&state, user_id, workspace_id).await?;
    let project_id = request
        .project_id
        .as_deref()
        .map(parse_project_id)
        .transpose()?;
    let task = Task::new(
        workspace_id,
        project_id,
        request.title,
        user_id,
        SystemTime::now(),
    )
    .map_err(map_domain_error)?;
    let created = task::create_for_user(state.db(), user_id, &task)
        .await
        .map_err(ApiError::internal)?;
    if !created {
        return Err(TaskOperationError::InvalidProject.into());
    }

    Ok((StatusCode::CREATED, Json((&task).into())))
}

async fn list_inbox_tasks(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
) -> Result<Json<Vec<TaskResponse>>, ApiError> {
    let user_id = authenticated_user(&headers, &state).await?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    ensure_workspace_access(&state, user_id, workspace_id).await?;
    let response = task::list_inbox_for_user(state.db(), user_id, workspace_id)
        .await
        .map_err(ApiError::internal)?
        .iter()
        .map(TaskResponse::from)
        .collect();

    Ok(Json(response))
}

async fn list_project_tasks(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, project_id)): Path<(String, String)>,
) -> Result<Json<Vec<TaskResponse>>, ApiError> {
    let user_id = authenticated_user(&headers, &state).await?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let project_id = parse_project_id(&project_id)?;
    ensure_workspace_access(&state, user_id, workspace_id).await?;
    let response = task::list_project_for_user(state.db(), user_id, workspace_id, project_id)
        .await
        .map_err(ApiError::internal)?
        .iter()
        .map(TaskResponse::from)
        .collect();

    Ok(Json(response))
}

async fn get_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, task_id)): Path<(String, String)>,
) -> Result<Json<TaskResponse>, ApiError> {
    let user_id = authenticated_user(&headers, &state).await?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let task_id = parse_task_id(&task_id)?;
    ensure_workspace_access(&state, user_id, workspace_id).await?;
    let task = task::find_for_user(state.db(), user_id, workspace_id, task_id)
        .await
        .map_err(ApiError::internal)?
        .ok_or(TaskOperationError::NotFound)?;

    Ok(Json((&task).into()))
}

async fn update_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, task_id)): Path<(String, String)>,
    Json(request): Json<UpdateTaskRequest>,
) -> Result<Json<TaskResponse>, ApiError> {
    let user_id = authenticated_user(&headers, &state).await?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let task_id = parse_task_id(&task_id)?;
    ensure_workspace_access(&state, user_id, workspace_id).await?;
    let mut task = task::find_for_user(state.db(), user_id, workspace_id, task_id)
        .await
        .map_err(ApiError::internal)?
        .ok_or(TaskOperationError::NotFound)?;
    let now = SystemTime::now();

    if let Some(title) = request.title {
        task.rename(title, now).map_err(map_domain_error)?;
    }
    if let Some(status) = request.status {
        task.set_status(parse_status(&status)?, now);
    }
    let project_changed = matches!(&request.project_id, ProjectUpdate::Set(_));
    if let ProjectUpdate::Set(project_id) = request.project_id {
        let project_id = project_id.as_deref().map(parse_project_id).transpose()?;
        task.move_to_project(project_id, now);
    }

    let task = task::update_for_user(state.db(), user_id, &task)
        .await
        .map_err(ApiError::internal)?
        .ok_or(if project_changed {
            TaskOperationError::InvalidProject
        } else {
            TaskOperationError::NotFound
        })?;

    Ok(Json((&task).into()))
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

fn parse_task_id(value: &str) -> Result<TaskId, ApiError> {
    value
        .parse()
        .map_err(|_| ApiError::bad_request("Enter a valid task ID."))
}

fn parse_status(value: &str) -> Result<TaskStatus, ApiError> {
    value
        .parse()
        .map_err(|_| TaskOperationError::InvalidStatus.into())
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
        .ok_or_else(|| TaskOperationError::AccessDenied.into())
}

fn map_domain_error(error: TaskError) -> TaskOperationError {
    match error {
        TaskError::EmptyTitle => TaskOperationError::InvalidTitle,
        TaskError::InvalidStatus => TaskOperationError::InvalidStatus,
    }
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "postgres-tests")]
    use std::time::UNIX_EPOCH;

    #[cfg(feature = "postgres-tests")]
    use axum::{
        http::{HeaderValue, header::AUTHORIZATION},
        response::IntoResponse,
    };
    #[cfg(feature = "postgres-tests")]
    use kanleaf_backend::{
        domain::{
            project::Project,
            user::UserId,
            workspace::{Workspace, WorkspaceRole},
        },
        persistence::{project, session, user},
    };

    use super::*;

    #[test]
    fn patch_distinguishes_an_omitted_project_from_null() {
        let omitted: UpdateTaskRequest = serde_json::from_str("{}").unwrap();
        let null: UpdateTaskRequest = serde_json::from_str(r#"{"project_id":null}"#).unwrap();
        let project: UpdateTaskRequest =
            serde_json::from_str(r#"{"project_id":"project-a"}"#).unwrap();

        assert!(matches!(omitted.project_id, ProjectUpdate::Unchanged));
        assert!(matches!(null.project_id, ProjectUpdate::Set(None)));
        assert!(matches!(
            project.project_id,
            ProjectUpdate::Set(Some(id)) if id == "project-a"
        ));
    }

    #[cfg(feature = "postgres-tests")]
    #[sqlx::test(migrations = "./migrations")]
    async fn task_api_enforces_workspace_and_project_boundaries(pool: sqlx::PgPool) {
        let user_a = UserId::new();
        let workspace_a = Workspace::new("Workspace A", UNIX_EPOCH).unwrap();
        user::register_with_personal_workspace(
            &pool,
            user_a,
            "task-api-a@example.com",
            "hash-a",
            &workspace_a,
            WorkspaceRole::Owner,
            UNIX_EPOCH,
        )
        .await
        .unwrap();
        let user_b = UserId::new();
        let workspace_b = Workspace::new("Workspace B", UNIX_EPOCH).unwrap();
        user::register_with_personal_workspace(
            &pool,
            user_b,
            "task-api-b@example.com",
            "hash-b",
            &workspace_b,
            WorkspaceRole::Owner,
            UNIX_EPOCH,
        )
        .await
        .unwrap();
        let project_a = Project::new(workspace_a.id(), "Project A", UNIX_EPOCH).unwrap();
        let project_b = Project::new(workspace_b.id(), "Project B", UNIX_EPOCH).unwrap();
        project::create_for_user(&pool, user_a, &project_a)
            .await
            .unwrap();
        project::create_for_user(&pool, user_b, &project_b)
            .await
            .unwrap();
        session::create(&pool, user_a, "token-a", UNIX_EPOCH)
            .await
            .unwrap();
        session::create(&pool, user_b, "token-b", UNIX_EPOCH)
            .await
            .unwrap();
        let state = AppState::new(pool);

        let (status, Json(created)) = create_task(
            State(state.clone()),
            authorization("token-a"),
            Path(workspace_a.id().to_string()),
            Json(CreateTaskRequest {
                title: "  Task A  ".to_owned(),
                project_id: None,
            }),
        )
        .await
        .unwrap();
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.workspace_id, workspace_a.id().to_string());
        assert_eq!(created.project_id, None);
        assert_eq!(created.title, "Task A");
        assert_eq!(created.status, "todo");

        let outsider_create = create_task(
            State(state.clone()),
            authorization("token-b"),
            Path(workspace_a.id().to_string()),
            Json(CreateTaskRequest {
                title: "Stolen".to_owned(),
                project_id: None,
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(
            outsider_create.into_response().status(),
            StatusCode::FORBIDDEN
        );

        let crossed_project = create_task(
            State(state.clone()),
            authorization("token-a"),
            Path(workspace_a.id().to_string()),
            Json(CreateTaskRequest {
                title: "Crossed".to_owned(),
                project_id: Some(project_b.id().to_string()),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(
            crossed_project.into_response().status(),
            StatusCode::BAD_REQUEST
        );

        let empty_title = create_task(
            State(state.clone()),
            authorization("token-a"),
            Path(workspace_a.id().to_string()),
            Json(CreateTaskRequest {
                title: " ".to_owned(),
                project_id: None,
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(
            empty_title.into_response().status(),
            StatusCode::BAD_REQUEST
        );

        let outsider_read = get_task(
            State(state.clone()),
            authorization("token-b"),
            Path((workspace_a.id().to_string(), created.id.clone())),
        )
        .await
        .unwrap_err();
        assert_eq!(
            outsider_read.into_response().status(),
            StatusCode::FORBIDDEN
        );

        let Json(updated) = update_task(
            State(state.clone()),
            authorization("token-a"),
            Path((workspace_a.id().to_string(), created.id.clone())),
            Json(UpdateTaskRequest {
                title: Some("Task A renamed".to_owned()),
                status: Some("in_progress".to_owned()),
                project_id: ProjectUpdate::Set(Some(project_a.id().to_string())),
            }),
        )
        .await
        .unwrap();
        assert_eq!(updated.title, "Task A renamed");
        assert_eq!(updated.status, "in_progress");
        assert_eq!(updated.project_id, Some(project_a.id().to_string()));

        let Json(inbox) = list_inbox_tasks(
            State(state.clone()),
            authorization("token-a"),
            Path(workspace_a.id().to_string()),
        )
        .await
        .unwrap();
        assert!(inbox.is_empty());
        let Json(project_tasks) = list_project_tasks(
            State(state.clone()),
            authorization("token-a"),
            Path((workspace_a.id().to_string(), project_a.id().to_string())),
        )
        .await
        .unwrap();
        assert_eq!(project_tasks.len(), 1);
        assert_eq!(project_tasks[0].id, created.id);

        let invalid_status = update_task(
            State(state.clone()),
            authorization("token-a"),
            Path((workspace_a.id().to_string(), created.id.clone())),
            Json(UpdateTaskRequest {
                title: None,
                status: Some("blocked".to_owned()),
                project_id: ProjectUpdate::Unchanged,
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(
            invalid_status.into_response().status(),
            StatusCode::BAD_REQUEST
        );

        let crossed_move = update_task(
            State(state.clone()),
            authorization("token-a"),
            Path((workspace_a.id().to_string(), created.id.clone())),
            Json(UpdateTaskRequest {
                title: None,
                status: None,
                project_id: ProjectUpdate::Set(Some(project_b.id().to_string())),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(
            crossed_move.into_response().status(),
            StatusCode::BAD_REQUEST
        );

        let outsider_update = update_task(
            State(state.clone()),
            authorization("token-b"),
            Path((workspace_a.id().to_string(), created.id.clone())),
            Json(UpdateTaskRequest {
                title: Some("Stolen".to_owned()),
                status: None,
                project_id: ProjectUpdate::Unchanged,
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(
            outsider_update.into_response().status(),
            StatusCode::FORBIDDEN
        );

        let Json(moved_to_inbox) = update_task(
            State(state.clone()),
            authorization("token-a"),
            Path((workspace_a.id().to_string(), created.id.clone())),
            Json(UpdateTaskRequest {
                title: None,
                status: Some("done".to_owned()),
                project_id: ProjectUpdate::Set(None),
            }),
        )
        .await
        .unwrap();
        assert_eq!(moved_to_inbox.project_id, None);
        assert_eq!(moved_to_inbox.status, "done");

        let Json(inbox) = list_inbox_tasks(
            State(state),
            authorization("token-a"),
            Path(workspace_a.id().to_string()),
        )
        .await
        .unwrap();
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].id, created.id);
    }

    #[cfg(feature = "postgres-tests")]
    fn authorization(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
        );
        headers
    }
}
