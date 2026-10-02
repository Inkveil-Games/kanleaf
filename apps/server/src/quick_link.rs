use std::collections::HashSet;

use axum::{
    Json, Router,
    extract::{Path, State, rejection::JsonRejection, rejection::PathRejection},
    http::StatusCode,
    routing::{get, put},
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgConnection, Postgres, Transaction};
use url::Url;
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    domain::ResourceName,
    error::AppError,
    workspace::{WorkspaceRole, lock_workspace, require_workspace_admin, workspace_role},
};

#[derive(Clone, Debug, Deserialize, Serialize, FromRow)]
#[serde(deny_unknown_fields)]
pub(crate) struct QuickLinkConfig {
    pub id: Uuid,
    pub kind: String,
    pub title: Option<String>,
    pub url: Option<String>,
    pub project_id: Option<Uuid>,
    pub document_id: Option<Uuid>,
    pub position: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct QuickLinkRequest {
    kind: String,
    title: Option<String>,
    url: Option<String>,
    project_id: Option<Uuid>,
    document_id: Option<Uuid>,
}

impl QuickLinkRequest {
    fn into_config(self, id: Uuid, position: i64) -> Result<QuickLinkConfig, AppError> {
        let row = QuickLinkConfig {
            id,
            kind: self.kind,
            title: self.title.map(|title| title.trim().to_owned()),
            url: self.url,
            project_id: self.project_id,
            document_id: self.document_id,
            position,
        };
        validate_config(&row)?;
        Ok(row)
    }
}

#[derive(Serialize, FromRow)]
struct QuickLinkResponse {
    id: Uuid,
    kind: String,
    title: String,
    url: Option<String>,
    project_id: Option<Uuid>,
    project_identifier: Option<String>,
    document_id: Option<Uuid>,
    document_number: Option<i64>,
    position: i64,
    available: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OrderRequest {
    ids: Vec<Uuid>,
}

pub(crate) fn validate_config(link: &QuickLinkConfig) -> Result<(), AppError> {
    let valid_shape = match link.kind.as_str() {
        "external" => {
            link.title.is_some()
                && link.url.is_some()
                && link.project_id.is_none()
                && link.document_id.is_none()
        }
        "project" => {
            link.project_id.is_some()
                && link.document_id.is_none()
                && link.title.is_none()
                && link.url.is_none()
        }
        "page" => {
            link.document_id.is_some()
                && link.project_id.is_none()
                && link.title.is_none()
                && link.url.is_none()
        }
        _ => false,
    };
    if !valid_shape || link.position < 0 {
        return Err(AppError::Validation("Invalid Quick link target".to_owned()));
    }
    if let Some(title) = &link.title {
        ResourceName::new(title).map_err(|error| AppError::Validation(error.to_string()))?;
        if title.chars().any(char::is_control) {
            return Err(AppError::Validation(
                "Quick link title cannot contain control characters".to_owned(),
            ));
        }
    }
    if let Some(raw) = &link.url {
        let invalid_url = || {
            AppError::Validation(
                "Quick link URL must be HTTP(S), at most 2048 characters, and contain no credentials or control characters".to_owned(),
            )
        };
        if raw.chars().count() > 2048 || raw.trim() != raw || raw.chars().any(char::is_control) {
            return Err(invalid_url());
        }
        let (_, destination) = raw.split_once("://").ok_or_else(invalid_url)?;
        let authority = destination
            .split(['/', '?', '#'])
            .next()
            .unwrap_or_default();
        if authority.is_empty() || authority.contains('@') || raw.contains('\\') {
            return Err(invalid_url());
        }
        let url = Url::parse(raw).map_err(|_| invalid_url())?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(invalid_url());
        }
    }
    Ok(())
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/workspaces/{workspace_id}/quick-links",
            get(list).post(create),
        )
        .route(
            "/api/workspaces/{workspace_id}/quick-links/order",
            put(reorder),
        )
        .route(
            "/api/workspaces/{workspace_id}/quick-links/{link_id}",
            put(update).delete(delete),
        )
}

async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<Vec<QuickLinkResponse>>, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    workspace_role(&state.pool, auth.user.id, workspace_id).await?;
    Ok(Json(
        visible_links(
            &mut *state.pool.acquire().await?,
            workspace_id,
            auth.user.id,
        )
        .await?,
    ))
}

async fn visible_links(
    connection: &mut PgConnection,
    workspace_id: Uuid,
    user_id: Uuid,
) -> Result<Vec<QuickLinkResponse>, AppError> {
    // Membership and target availability are evaluated in one snapshot, before enrichment
    // can leave the server. Public discovery is not effective Project access.
    Ok(sqlx::query_as(
        r#"
        WITH links AS (
            SELECT q.id, q.kind, COALESCE(q.title, d.title, p.name) AS title,
                   q.url, COALESCE(q.project_id, d.project_id) AS project_id,
                   p.identifier AS project_identifier, q.document_id,
                   d.document_number, q.position,
                   m.role IN ('owner', 'admin') AS can_manage,
                   CASE q.kind
                     WHEN 'external' THEN true
                     WHEN 'project' THEN p.archived_at IS NULL
                          AND (m.role IN ('owner', 'admin') OR pm.user_id IS NOT NULL)
                     WHEN 'page' THEN d.archived_at IS NULL
                          AND CASE WHEN d.project_id IS NULL THEN m.role <> 'guest'
                                   ELSE p.archived_at IS NULL AND p.pages_enabled
                                        AND (m.role IN ('owner', 'admin') OR pm.user_id IS NOT NULL)
                              END
                   END AS available
            FROM workspace_quick_links q
            JOIN workspace_memberships m ON m.workspace_id = q.workspace_id AND m.user_id = $2
            LEFT JOIN documents d ON d.workspace_id = q.workspace_id AND d.id = q.document_id
            LEFT JOIN projects p ON p.workspace_id = q.workspace_id
                                AND p.id = COALESCE(q.project_id, d.project_id)
            LEFT JOIN project_memberships pm ON pm.workspace_id = p.workspace_id
                                             AND pm.project_id = p.id AND pm.user_id = $2
            WHERE q.workspace_id = $1
        )
        SELECT id, kind, title, url, project_id, project_identifier,
               document_id, document_number, position, available
        FROM links WHERE can_manage OR available ORDER BY position, id
        "#,
    )
    .bind(workspace_id)
    .bind(user_id)
    .fetch_all(connection)
    .await?)
}

async fn begin_management(
    state: &AppState,
    workspace_id: Uuid,
    user_id: Uuid,
) -> Result<Transaction<'_, Postgres>, AppError> {
    require_workspace_admin(&state.pool, user_id, workspace_id).await?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    // Keep the management role stable until this mutation commits.
    let role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR SHARE",
    )
    .bind(workspace_id)
    .bind(user_id)
    .fetch_optional(&mut *transaction)
    .await?;
    if !WorkspaceRole::from_database(&role.ok_or(AppError::Forbidden)?)?.can_manage() {
        return Err(AppError::Forbidden);
    }
    Ok(transaction)
}

async fn validate_target(
    connection: &mut PgConnection,
    workspace_id: Uuid,
    link: &QuickLinkConfig,
) -> Result<(), AppError> {
    let found: bool = match link.kind.as_str() {
        "project" => sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL)",
        )
        .bind(workspace_id)
        .bind(link.project_id)
        .fetch_one(connection)
        .await?,
        "page" => sqlx::query_scalar(
            r#"SELECT EXISTS(
                SELECT 1 FROM documents d
                LEFT JOIN projects p ON p.workspace_id = d.workspace_id AND p.id = d.project_id
                WHERE d.workspace_id = $1 AND d.id = $2 AND d.archived_at IS NULL
                  AND (d.project_id IS NULL OR (p.archived_at IS NULL AND p.pages_enabled))
            )"#,
        )
        .bind(workspace_id)
        .bind(link.document_id)
        .fetch_one(connection)
        .await?,
        _ => true,
    };
    if !found {
        return Err(AppError::NotFound("Quick link target not found".to_owned()));
    }
    Ok(())
}

async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<QuickLinkRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<QuickLinkResponse>), AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let mut transaction = begin_management(&state, workspace_id, auth.user.id).await?;
    let maximum: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(position) FROM workspace_quick_links WHERE workspace_id = $1",
    )
    .bind(workspace_id)
    .fetch_one(&mut *transaction)
    .await?;
    let position = maximum.unwrap_or(-1).checked_add(1).ok_or_else(|| {
        AppError::Validation("Reorder Quick links before adding another link".to_owned())
    })?;
    let row = request.into_config(Uuid::new_v4(), position)?;
    validate_target(&mut transaction, workspace_id, &row).await?;
    sqlx::query(
        "INSERT INTO workspace_quick_links (id, workspace_id, kind, title, url, project_id, document_id, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    )
    .bind(row.id).bind(workspace_id).bind(&row.kind).bind(&row.title).bind(&row.url)
    .bind(row.project_id).bind(row.document_id).bind(row.position)
    .execute(&mut *transaction).await?;
    let response = response_for(&mut transaction, workspace_id, auth.user.id, row.id).await?;
    transaction.commit().await?;
    Ok((StatusCode::CREATED, Json(response)))
}

async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<QuickLinkRequest>, JsonRejection>,
) -> Result<Json<QuickLinkResponse>, AppError> {
    let Path((workspace_id, link_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let mut transaction = begin_management(&state, workspace_id, auth.user.id).await?;
    let position = sqlx::query_scalar(
        "SELECT position FROM workspace_quick_links WHERE workspace_id = $1 AND id = $2",
    )
    .bind(workspace_id)
    .bind(link_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(not_found)?;
    let row = request.into_config(link_id, position)?;
    validate_target(&mut transaction, workspace_id, &row).await?;
    sqlx::query(
        "UPDATE workspace_quick_links SET kind=$3,title=$4,url=$5,project_id=$6,document_id=$7 WHERE workspace_id=$1 AND id=$2",
    )
    .bind(workspace_id).bind(link_id).bind(&row.kind).bind(&row.title).bind(&row.url)
    .bind(row.project_id).bind(row.document_id).execute(&mut *transaction).await?;
    let response = response_for(&mut transaction, workspace_id, auth.user.id, link_id).await?;
    transaction.commit().await?;
    Ok(Json(response))
}

async fn response_for(
    connection: &mut PgConnection,
    workspace_id: Uuid,
    user_id: Uuid,
    link_id: Uuid,
) -> Result<QuickLinkResponse, AppError> {
    visible_links(connection, workspace_id, user_id)
        .await?
        .into_iter()
        .find(|link| link.id == link_id)
        .ok_or_else(not_found)
}

async fn delete(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, link_id)) = path.map_err(AppError::from)?;
    let mut transaction = begin_management(&state, workspace_id, auth.user.id).await?;
    let result = sqlx::query("DELETE FROM workspace_quick_links WHERE workspace_id=$1 AND id=$2")
        .bind(workspace_id)
        .bind(link_id)
        .execute(&mut *transaction)
        .await?;
    if result.rows_affected() == 0 {
        return Err(not_found());
    }
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn reorder(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<OrderRequest>, JsonRejection>,
) -> Result<Json<Vec<QuickLinkResponse>>, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let mut transaction = begin_management(&state, workspace_id, auth.user.id).await?;
    let current: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM workspace_quick_links WHERE workspace_id=$1")
            .bind(workspace_id)
            .fetch_all(&mut *transaction)
            .await?;
    let expected: HashSet<_> = current.into_iter().collect();
    let requested: HashSet<_> = request.ids.iter().copied().collect();
    if expected != requested || request.ids.len() != expected.len() {
        return Err(AppError::Validation(
            "Order must contain every Quick link exactly once".to_owned(),
        ));
    }
    sqlx::query(
        "UPDATE workspace_quick_links q SET position = ordering.position - 1 FROM unnest($2::uuid[]) WITH ORDINALITY ordering(id,position) WHERE q.workspace_id=$1 AND q.id=ordering.id",
    )
    .bind(workspace_id).bind(&request.ids).execute(&mut *transaction).await?;
    let links = visible_links(&mut transaction, workspace_id, auth.user.id).await?;
    transaction.commit().await?;
    Ok(Json(links))
}

fn not_found() -> AppError {
    AppError::NotFound("Quick link not found".to_owned())
}
