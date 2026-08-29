use anyhow::anyhow;
use axum::{
    Json, Router,
    extract::{
        Path, Query, State, rejection::JsonRejection, rejection::PathRejection,
        rejection::QueryRejection,
    },
    http::StatusCode,
    routing::get,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, types::Json as SqlJson};
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    domain::ResourceName,
    error::{AppError, is_unique_violation},
    project::{require_project_access, require_project_admin, require_project_editor},
    task::TaskQuery,
    workspace::{WorkspaceRole, workspace_role},
};

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum SavedViewVisibility {
    Personal,
    Shared,
}

impl SavedViewVisibility {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Personal => "personal",
            Self::Shared => "shared",
        }
    }

    fn from_database(value: &str) -> Result<Self, AppError> {
        match value {
            "personal" => Ok(Self::Personal),
            "shared" => Ok(Self::Shared),
            _ => Err(AppError::internal(anyhow!(
                "database contains invalid saved view visibility"
            ))),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum SavedViewLayout {
    List,
    Board,
    Calendar,
    Table,
    Timeline,
}

impl SavedViewLayout {
    const fn as_str(self) -> &'static str {
        match self {
            Self::List => "list",
            Self::Board => "board",
            Self::Calendar => "calendar",
            Self::Table => "table",
            Self::Timeline => "timeline",
        }
    }

    fn from_database(value: &str) -> Result<Self, AppError> {
        match value {
            "list" => Ok(Self::List),
            "board" => Ok(Self::Board),
            "calendar" => Ok(Self::Calendar),
            "table" => Ok(Self::Table),
            "timeline" => Ok(Self::Timeline),
            _ => Err(AppError::internal(anyhow!(
                "database contains invalid saved view layout"
            ))),
        }
    }
}

#[derive(Serialize)]
struct SavedViewResponse {
    id: Uuid,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    owner_id: Uuid,
    name: String,
    visibility: SavedViewVisibility,
    query_version: i16,
    query: TaskQuery,
    layout: SavedViewLayout,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct SavedViewRow {
    id: Uuid,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    owner_id: Uuid,
    name: String,
    visibility: String,
    query_version: i16,
    query: SqlJson<TaskQuery>,
    layout: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl SavedViewRow {
    fn into_response(self) -> Result<SavedViewResponse, AppError> {
        Ok(SavedViewResponse {
            id: self.id,
            workspace_id: self.workspace_id,
            project_id: self.project_id,
            owner_id: self.owner_id,
            name: self.name,
            visibility: SavedViewVisibility::from_database(&self.visibility)?,
            query_version: self.query_version,
            query: self.query.0,
            layout: SavedViewLayout::from_database(&self.layout)?,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct ListViewsQuery {
    project_id: Option<Uuid>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateSavedViewRequest {
    name: String,
    #[serde(default = "personal_visibility")]
    visibility: SavedViewVisibility,
    #[serde(default)]
    project_id: Option<Uuid>,
    query: TaskQuery,
    layout: SavedViewLayout,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateSavedViewRequest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    visibility: Option<SavedViewVisibility>,
    #[serde(default)]
    query: Option<TaskQuery>,
    #[serde(default)]
    layout: Option<SavedViewLayout>,
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/workspaces/{workspace_id}/views",
            get(list).post(create),
        )
        .route(
            "/api/workspaces/{workspace_id}/views/{view_id}",
            get(detail).patch(update).delete(delete_view),
        )
}

async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    filters: Result<Query<ListViewsQuery>, QueryRejection>,
) -> Result<Json<Vec<SavedViewResponse>>, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Query(filters) = filters.map_err(AppError::from)?;
    workspace_role(&state.pool, auth.user.id, workspace_id).await?;
    authorize_project_scope(&state.pool, auth.user.id, workspace_id, filters.project_id).await?;
    let rows = sqlx::query_as::<_, SavedViewRow>(
        r#"
        SELECT id, workspace_id, project_id, owner_id, name, visibility,
               query_version, query, layout, created_at, updated_at
        FROM saved_views
        WHERE workspace_id = $1
          AND project_id IS NOT DISTINCT FROM $2
          AND (visibility = 'shared' OR owner_id = $3)
        ORDER BY visibility DESC, lower(name), id
        "#,
    )
    .bind(workspace_id)
    .bind(filters.project_id)
    .bind(auth.user.id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows_to_responses(rows)?))
}

async fn detail(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<SavedViewResponse>, AppError> {
    let Path((workspace_id, view_id)) = path.map_err(AppError::from)?;
    let role = workspace_role(&state.pool, auth.user.id, workspace_id).await?;
    let row = find_view(&state.pool, workspace_id, view_id).await?;
    authorize_read(&state.pool, auth.user.id, workspace_id, role, &row).await?;
    Ok(Json(row.into_response()?))
}

async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<CreateSavedViewRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<SavedViewResponse>), AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let name = ResourceName::new(&request.name)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let role = workspace_role(&state.pool, auth.user.id, workspace_id).await?;
    let query = validate_query_scope(
        &state.pool,
        auth.user.id,
        workspace_id,
        role,
        request.project_id,
        request.query,
    )
    .await?;
    authorize_visibility(
        &state.pool,
        auth.user.id,
        workspace_id,
        role,
        request.project_id,
        request.visibility,
    )
    .await?;
    let result = sqlx::query_as::<_, SavedViewRow>(
        r#"
        INSERT INTO saved_views (
            id, workspace_id, project_id, owner_id, name, visibility,
            query_version, query, layout
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, workspace_id, project_id, owner_id, name, visibility,
                  query_version, query, layout, created_at, updated_at
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(workspace_id)
    .bind(request.project_id)
    .bind(auth.user.id)
    .bind(name.as_str())
    .bind(request.visibility.as_str())
    .bind(query.version as i16)
    .bind(SqlJson(query))
    .bind(request.layout.as_str())
    .fetch_one(&state.pool)
    .await;
    let row = result.map_err(map_name_conflict)?;
    Ok((StatusCode::CREATED, Json(row.into_response()?)))
}

async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<UpdateSavedViewRequest>, JsonRejection>,
) -> Result<Json<SavedViewResponse>, AppError> {
    let Path((workspace_id, view_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    if request.name.is_none()
        && request.visibility.is_none()
        && request.query.is_none()
        && request.layout.is_none()
    {
        return Err(AppError::Validation(
            "Saved view update must change at least one field".to_owned(),
        ));
    }
    let role = workspace_role(&state.pool, auth.user.id, workspace_id).await?;
    let current = find_view(&state.pool, workspace_id, view_id).await?;
    authorize_mutation(&state.pool, auth.user.id, workspace_id, role, &current).await?;
    let visibility = request
        .visibility
        .unwrap_or(SavedViewVisibility::from_database(&current.visibility)?);
    if request.visibility.is_some() {
        if current.owner_id != auth.user.id && matches!(visibility, SavedViewVisibility::Personal) {
            return Err(AppError::Forbidden);
        }
        authorize_visibility(
            &state.pool,
            auth.user.id,
            workspace_id,
            role,
            current.project_id,
            visibility,
        )
        .await?;
    }
    let query = match request.query {
        Some(query) => {
            validate_query_scope(
                &state.pool,
                auth.user.id,
                workspace_id,
                role,
                current.project_id,
                query,
            )
            .await?
        }
        None => current.query.0,
    };
    let name = request
        .name
        .as_deref()
        .map(ResourceName::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let result = sqlx::query_as::<_, SavedViewRow>(
        r#"
        UPDATE saved_views
        SET name = COALESCE($3, name),
            visibility = $4,
            query_version = $5,
            query = $6,
            layout = COALESCE($7, layout),
            updated_at = now()
        WHERE workspace_id = $1 AND id = $2
        RETURNING id, workspace_id, project_id, owner_id, name, visibility,
                  query_version, query, layout, created_at, updated_at
        "#,
    )
    .bind(workspace_id)
    .bind(view_id)
    .bind(name.as_ref().map(ResourceName::as_str))
    .bind(visibility.as_str())
    .bind(query.version as i16)
    .bind(SqlJson(query))
    .bind(request.layout.map(SavedViewLayout::as_str))
    .fetch_one(&state.pool)
    .await;
    Ok(Json(result.map_err(map_name_conflict)?.into_response()?))
}

async fn delete_view(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, view_id)) = path.map_err(AppError::from)?;
    let role = workspace_role(&state.pool, auth.user.id, workspace_id).await?;
    let row = find_view(&state.pool, workspace_id, view_id).await?;
    authorize_mutation(&state.pool, auth.user.id, workspace_id, role, &row).await?;
    sqlx::query("DELETE FROM saved_views WHERE workspace_id = $1 AND id = $2")
        .bind(workspace_id)
        .bind(view_id)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn find_view(
    pool: &PgPool,
    workspace_id: Uuid,
    view_id: Uuid,
) -> Result<SavedViewRow, AppError> {
    sqlx::query_as::<_, SavedViewRow>(
        r#"
        SELECT id, workspace_id, project_id, owner_id, name, visibility,
               query_version, query, layout, created_at, updated_at
        FROM saved_views
        WHERE workspace_id = $1 AND id = $2
        "#,
    )
    .bind(workspace_id)
    .bind(view_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Saved view not found".to_owned()))
}

async fn authorize_read(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
    _role: WorkspaceRole,
    row: &SavedViewRow,
) -> Result<(), AppError> {
    authorize_project_scope(pool, user_id, workspace_id, row.project_id).await?;
    if row.visibility == "personal" && row.owner_id != user_id {
        return Err(AppError::NotFound("Saved view not found".to_owned()));
    }
    Ok(())
}

async fn authorize_mutation(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
    role: WorkspaceRole,
    row: &SavedViewRow,
) -> Result<(), AppError> {
    authorize_read(pool, user_id, workspace_id, role, row).await?;
    if row.visibility == "personal" {
        return if row.owner_id == user_id {
            Ok(())
        } else {
            Err(AppError::Forbidden)
        };
    }
    match row.project_id {
        Some(project_id) if row.owner_id == user_id => {
            require_project_editor(pool, user_id, workspace_id, project_id).await?;
        }
        Some(project_id) => {
            require_project_admin(pool, user_id, workspace_id, project_id).await?;
        }
        None if role.can_manage() => {}
        None => return Err(AppError::Forbidden),
    }
    Ok(())
}

async fn authorize_visibility(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
    role: WorkspaceRole,
    project_id: Option<Uuid>,
    visibility: SavedViewVisibility,
) -> Result<(), AppError> {
    if matches!(visibility, SavedViewVisibility::Personal) {
        return authorize_project_scope(pool, user_id, workspace_id, project_id).await;
    }
    match project_id {
        Some(project_id) => {
            require_project_editor(pool, user_id, workspace_id, project_id).await?;
            require_views_enabled(pool, workspace_id, project_id).await
        }
        None if role.can_manage() => Ok(()),
        None => Err(AppError::Forbidden),
    }
}

async fn authorize_project_scope(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
) -> Result<(), AppError> {
    if let Some(project_id) = project_id {
        require_project_access(pool, user_id, workspace_id, project_id).await?;
        require_views_enabled(pool, workspace_id, project_id).await?;
    }
    Ok(())
}

async fn require_views_enabled(
    pool: &PgPool,
    workspace_id: Uuid,
    project_id: Uuid,
) -> Result<(), AppError> {
    let enabled: bool = sqlx::query_scalar(
        "SELECT views_enabled FROM projects WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL",
    )
    .bind(workspace_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Project not found".to_owned()))?;
    if !enabled {
        return Err(AppError::Validation(
            "Saved Views are disabled for this Project".to_owned(),
        ));
    }
    Ok(())
}

async fn validate_query_scope(
    pool: &PgPool,
    user_id: Uuid,
    workspace_id: Uuid,
    role: WorkspaceRole,
    project_id: Option<Uuid>,
    query: TaskQuery,
) -> Result<TaskQuery, AppError> {
    let query = query.validate()?;
    let query_project_id = query
        .authorize_scope(pool, user_id, workspace_id, role)
        .await?;
    if query_project_id != project_id {
        return Err(AppError::Validation(
            "Saved view scope must match its Task query scope".to_owned(),
        ));
    }
    authorize_project_scope(pool, user_id, workspace_id, project_id).await?;
    Ok(query)
}

fn rows_to_responses(rows: Vec<SavedViewRow>) -> Result<Vec<SavedViewResponse>, AppError> {
    rows.into_iter().map(SavedViewRow::into_response).collect()
}

fn map_name_conflict(error: sqlx::Error) -> AppError {
    if is_unique_violation(&error) {
        AppError::Conflict("A Saved View with that name already exists".to_owned())
    } else {
        error.into()
    }
}

const fn personal_visibility() -> SavedViewVisibility {
    SavedViewVisibility::Personal
}
