use axum::{
    Json, Router,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, PathRejection, QueryRejection},
    },
    http::{StatusCode, header},
    routing::{get, patch, post},
};
use chrono::{DateTime, Utc};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use super::{signing::SigningKey, transport::validate_endpoint};
use crate::{
    AppState,
    auth::AuthenticatedUser,
    domain::events::{Event, EventData, EventType, Identity},
    domain_event::{self, Catalog},
    error::AppError,
    workspace::{WorkspaceRole, require_workspace_admin},
};

#[derive(Deserialize, Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "snake_case")]
enum ProjectScope {
    All,
    Selected,
}
impl ProjectScope {
    fn as_str(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Selected => "selected",
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WebhookInput {
    name: String,
    endpoint_url: String,
    project_scope: ProjectScope,
    #[serde(default)]
    project_ids: Vec<Uuid>,
    event_types: Vec<EventType>,
    #[serde(default = "enabled_by_default")]
    enabled: bool,
}
fn enabled_by_default() -> bool {
    true
}

#[derive(Serialize, FromRow)]
pub(super) struct WebhookRow {
    pub id: Uuid,
    workspace_id: Uuid,
    name: String,
    endpoint_url: String,
    enabled: bool,
    project_scope: String,
    created_by_user_id: Option<Uuid>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    secret_regenerated_at: DateTime<Utc>,
}
#[derive(Serialize, FromRow)]
struct ProjectSummary {
    id: Uuid,
    name: String,
    identifier: String,
}
#[derive(Serialize)]
struct WebhookResponse {
    #[serde(flatten)]
    webhook: WebhookRow,
    projects: Vec<ProjectSummary>,
    event_types: Vec<String>,
}
#[derive(Serialize)]
struct CreatedWebhook {
    webhook: WebhookResponse,
    signing_secret: String,
}
#[derive(Serialize)]
struct SecretResponse {
    signing_secret: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EnabledInput {
    enabled: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CatalogQuery {
    project_id: Option<Uuid>,
}

#[derive(Serialize, FromRow)]
pub(super) struct DeliveryResponse {
    pub id: Uuid,
    pub event_id: Uuid,
    pub event_type: String,
    pub is_test: bool,
    pub status: String,
    pub attempt_count: i32,
    pub http_status: Option<i32>,
    pub duration_ms: Option<i32>,
    pub last_error: Option<String>,
    pub next_attempt_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub delivered_at: Option<DateTime<Utc>>,
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/workspaces/{workspace_id}/webhook-catalog",
            get(catalog),
        )
        .route(
            "/api/workspaces/{workspace_id}/webhooks",
            get(list).post(create),
        )
        .route(
            "/api/workspaces/{workspace_id}/webhooks/{webhook_id}",
            get(detail).patch(update).delete(delete),
        )
        .route(
            "/api/workspaces/{workspace_id}/webhooks/{webhook_id}/enabled",
            patch(set_enabled),
        )
        .route(
            "/api/workspaces/{workspace_id}/webhooks/{webhook_id}/secret",
            post(regenerate),
        )
        .route(
            "/api/workspaces/{workspace_id}/webhooks/{webhook_id}/test",
            post(test),
        )
        .route(
            "/api/workspaces/{workspace_id}/webhooks/{webhook_id}/deliveries",
            get(deliveries),
        )
        .route(
            "/api/workspaces/{workspace_id}/webhooks/{webhook_id}/deliveries/{delivery_id}",
            get(delivery_detail),
        )
}

fn key(state: &AppState) -> Result<&SigningKey, AppError> {
    state
        .webhook_key
        .as_ref()
        .ok_or(AppError::WebhooksUnavailable)
}

pub async fn validate_signing_key(state: &AppState) -> anyhow::Result<()> {
    let ids: Vec<String> = sqlx::query_scalar("SELECT DISTINCT signing_key_id FROM webhooks")
        .fetch_all(&state.pool)
        .await?;
    if ids
        .iter()
        .any(|id| state.webhook_key.as_ref().is_none_or(|key| key.id() != id))
    {
        anyhow::bail!(
            "Existing webhooks require the original KANLEAF_WEBHOOK_SIGNING_KEY; restore it before starting Kanleaf"
        );
    }
    Ok(())
}

async fn authorize(
    transaction: &mut Transaction<'_, Postgres>,
    actor: Uuid,
    workspace: Uuid,
) -> Result<(), AppError> {
    let prior_role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2",
    )
    .bind(workspace)
    .bind(actor)
    .fetch_optional(&mut **transaction)
    .await?;
    if !WorkspaceRole::from_database(&prior_role.ok_or(AppError::Forbidden)?)?.can_manage() {
        return Err(AppError::Forbidden);
    }
    // Fence deletion before membership/child locks; recheck the current role below.
    let live: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM workspaces WHERE id=$1 FOR KEY SHARE")
            .bind(workspace)
            .fetch_optional(&mut **transaction)
            .await?;
    live.ok_or(AppError::Forbidden)?;
    let role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2 FOR SHARE",
    )
    .bind(workspace)
    .bind(actor)
    .fetch_optional(&mut **transaction)
    .await?;
    if !WorkspaceRole::from_database(&role.ok_or(AppError::Forbidden)?)?.can_manage() {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

async fn validate_input(
    state: &AppState,
    actor: Uuid,
    workspace: Uuid,
    input: &WebhookInput,
) -> Result<(), AppError> {
    require_workspace_admin(&state.pool, actor, workspace).await?;
    key(state)?;
    if input.name.trim().is_empty()
        || input.name.chars().count() > 120
        || input.name.chars().any(char::is_control)
    {
        return Err(AppError::Validation(
            "Name must contain 1 to 120 characters".to_owned(),
        ));
    }
    if input.event_types.is_empty()
        || input.event_types.len() > 6
        || input
            .event_types
            .iter()
            .any(|event| !EventType::CATALOG.contains(event))
        || input
            .event_types
            .iter()
            .enumerate()
            .any(|(i, event)| input.event_types[..i].contains(event))
    {
        return Err(AppError::Validation(
            "Select one or more distinct supported event types".to_owned(),
        ));
    }
    if input.project_ids.len() > 500
        || input
            .project_ids
            .iter()
            .enumerate()
            .any(|(i, id)| input.project_ids[..i].contains(id))
        || (input.project_scope == ProjectScope::Selected && input.project_ids.is_empty())
        || (input.project_scope == ProjectScope::All && !input.project_ids.is_empty())
    {
        return Err(AppError::Validation(
            "Selected scope requires distinct Projects; All projects must not include a selection"
                .to_owned(),
        ));
    }
    validate_endpoint(&input.endpoint_url, &state.webhook_policy)
        .await
        .map_err(|error| AppError::Validation(error.to_owned()))?;
    Ok(())
}

async fn selections(
    transaction: &mut Transaction<'_, Postgres>,
    workspace: Uuid,
    webhook: Uuid,
    input: &WebhookInput,
) -> Result<(), AppError> {
    let projects: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM projects WHERE workspace_id=$1 AND id=ANY($2) AND archived_at IS NULL FOR SHARE")
        .bind(workspace).bind(&input.project_ids).fetch_all(&mut **transaction).await?;
    if projects.len() != input.project_ids.len() {
        return Err(AppError::Validation(
            "Select Projects from this Workspace".to_owned(),
        ));
    }
    sqlx::query("DELETE FROM webhook_projects WHERE webhook_id=$1")
        .bind(webhook)
        .execute(&mut **transaction)
        .await?;
    sqlx::query("DELETE FROM webhook_event_subscriptions WHERE webhook_id=$1")
        .bind(webhook)
        .execute(&mut **transaction)
        .await?;
    for project in &input.project_ids {
        sqlx::query(
            "INSERT INTO webhook_projects(workspace_id,webhook_id,project_id) VALUES ($1,$2,$3)",
        )
        .bind(workspace)
        .bind(webhook)
        .bind(project)
        .execute(&mut **transaction)
        .await?;
    }
    for event in &input.event_types {
        sqlx::query(
            "INSERT INTO webhook_event_subscriptions(webhook_id,event_type) VALUES ($1,$2)",
        )
        .bind(webhook)
        .bind(event.as_str())
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

async fn read(
    transaction: &mut Transaction<'_, Postgres>,
    workspace: Uuid,
    id: Uuid,
) -> Result<WebhookResponse, AppError> {
    let webhook = sqlx::query_as::<_, WebhookRow>("SELECT id,workspace_id,name,endpoint_url,enabled,project_scope,created_by_user_id,created_at,updated_at,secret_regenerated_at FROM webhooks WHERE workspace_id=$1 AND id=$2")
        .bind(workspace).bind(id).fetch_optional(&mut **transaction).await?.ok_or_else(|| AppError::NotFound("Webhook not found".to_owned()))?;
    let projects = sqlx::query_as::<_, ProjectSummary>("SELECT p.id,p.name,p.identifier FROM webhook_projects wp JOIN projects p ON p.workspace_id=wp.workspace_id AND p.id=wp.project_id WHERE wp.webhook_id=$1 ORDER BY p.name,p.id")
        .bind(id).fetch_all(&mut **transaction).await?;
    let event_types = sqlx::query_scalar("SELECT event_type FROM webhook_event_subscriptions WHERE webhook_id=$1 ORDER BY event_type")
        .bind(id).fetch_all(&mut **transaction).await?;
    Ok(WebhookResponse {
        webhook,
        projects,
        event_types,
    })
}

async fn lock_webhook(
    transaction: &mut Transaction<'_, Postgres>,
    workspace: Uuid,
    id: Uuid,
) -> Result<(), AppError> {
    let id: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM webhooks WHERE workspace_id=$1 AND id=$2 FOR UPDATE")
            .bind(workspace)
            .bind(id)
            .fetch_optional(&mut **transaction)
            .await?;
    id.ok_or_else(|| AppError::NotFound("Webhook not found".to_owned()))?;
    Ok(())
}

async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<Vec<WebhookResponse>>, AppError> {
    let Path(workspace) = path.map_err(AppError::from)?;
    let mut tx = state.pool.begin().await?;
    authorize(&mut tx, auth.user.id, workspace).await?;
    key(&state)?;
    let ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM webhooks WHERE workspace_id=$1 ORDER BY created_at,id")
            .bind(workspace)
            .fetch_all(&mut *tx)
            .await?;
    let mut hooks = Vec::with_capacity(ids.len());
    for id in ids {
        hooks.push(read(&mut tx, workspace, id).await?);
    }
    tx.commit().await?;
    Ok(Json(hooks))
}

async fn detail(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<WebhookResponse>, AppError> {
    let Path((workspace, id)) = path.map_err(AppError::from)?;
    let mut tx = state.pool.begin().await?;
    authorize(&mut tx, auth.user.id, workspace).await?;
    key(&state)?;
    let hook = read(&mut tx, workspace, id).await?;
    tx.commit().await?;
    Ok(Json(hook))
}

async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    body: Result<Json<WebhookInput>, JsonRejection>,
) -> Result<
    (
        StatusCode,
        [(header::HeaderName, &'static str); 1],
        Json<CreatedWebhook>,
    ),
    AppError,
> {
    let Path(workspace) = path.map_err(AppError::from)?;
    let Json(input) = body.map_err(AppError::from)?;
    validate_input(&state, auth.user.id, workspace, &input).await?;
    let key = key(&state)?;
    let id = Uuid::new_v4();
    let mut nonce = [0u8; 32];
    OsRng.fill_bytes(&mut nonce);
    let mut tx = state.pool.begin().await?;
    authorize(&mut tx, auth.user.id, workspace).await?;
    sqlx::query("INSERT INTO webhooks(id,workspace_id,name,endpoint_url,enabled,project_scope,secret_nonce,signing_key_id,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(id).bind(workspace).bind(input.name.trim()).bind(input.endpoint_url.trim()).bind(input.enabled).bind(input.project_scope.as_str()).bind(nonce.as_slice()).bind(key.id()).bind(auth.user.id).execute(&mut *tx).await?;
    selections(&mut tx, workspace, id, &input).await?;
    let webhook = read(&mut tx, workspace, id).await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        [(header::CACHE_CONTROL, "no-store")],
        Json(CreatedWebhook {
            webhook,
            signing_secret: key.derive(workspace, id, &nonce),
        }),
    ))
}

async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    body: Result<Json<WebhookInput>, JsonRejection>,
) -> Result<Json<WebhookResponse>, AppError> {
    let Path((workspace, id)) = path.map_err(AppError::from)?;
    let Json(input) = body.map_err(AppError::from)?;
    validate_input(&state, auth.user.id, workspace, &input).await?;
    let mut tx = state.pool.begin().await?;
    authorize(&mut tx, auth.user.id, workspace).await?;
    lock_webhook(&mut tx, workspace, id).await?;
    sqlx::query("UPDATE webhooks SET name=$1,endpoint_url=$2,enabled_since=CASE WHEN $3 AND NOT enabled THEN clock_timestamp() ELSE enabled_since END,enabled=$3,project_scope=$4,updated_at=now() WHERE workspace_id=$5 AND id=$6")
        .bind(input.name.trim()).bind(input.endpoint_url.trim()).bind(input.enabled).bind(input.project_scope.as_str()).bind(workspace).bind(id).execute(&mut *tx).await?;
    selections(&mut tx, workspace, id, &input).await?;
    if !input.enabled {
        cancel_pending(&mut tx, id).await?;
    }
    let webhook = read(&mut tx, workspace, id).await?;
    tx.commit().await?;
    Ok(Json(webhook))
}

async fn cancel_pending(tx: &mut Transaction<'_, Postgres>, id: Uuid) -> Result<(), AppError> {
    sqlx::query("UPDATE webhook_deliveries SET status='canceled',last_error='Webhook disabled' WHERE webhook_id=$1 AND status='pending' AND NOT is_test")
        .bind(id).execute(&mut **tx).await?;
    Ok(())
}

async fn set_enabled(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    body: Result<Json<EnabledInput>, JsonRejection>,
) -> Result<Json<WebhookResponse>, AppError> {
    let Path((workspace, id)) = path.map_err(AppError::from)?;
    let Json(input) = body.map_err(AppError::from)?;
    let mut tx = state.pool.begin().await?;
    authorize(&mut tx, auth.user.id, workspace).await?;
    key(&state)?;
    lock_webhook(&mut tx, workspace, id).await?;
    let hook = read(&mut tx, workspace, id).await?;
    if input.enabled && hook.webhook.project_scope == "selected" && hook.projects.is_empty() {
        return Err(AppError::Validation(
            "Select at least one Project before enabling this webhook".to_owned(),
        ));
    }
    sqlx::query("UPDATE webhooks SET enabled_since=CASE WHEN $1 AND NOT enabled THEN clock_timestamp() ELSE enabled_since END,enabled=$1,updated_at=now() WHERE id=$2").bind(input.enabled).bind(id).execute(&mut *tx).await?;
    if !input.enabled {
        cancel_pending(&mut tx, id).await?;
    }
    let hook = read(&mut tx, workspace, id).await?;
    tx.commit().await?;
    Ok(Json(hook))
}

async fn delete(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace, id)) = path.map_err(AppError::from)?;
    let mut tx = state.pool.begin().await?;
    authorize(&mut tx, auth.user.id, workspace).await?;
    key(&state)?;
    lock_webhook(&mut tx, workspace, id).await?;
    sqlx::query("DELETE FROM webhooks WHERE workspace_id=$1 AND id=$2")
        .bind(workspace)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn regenerate(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<
    (
        [(header::HeaderName, &'static str); 1],
        Json<SecretResponse>,
    ),
    AppError,
> {
    let Path((workspace, id)) = path.map_err(AppError::from)?;
    let mut tx = state.pool.begin().await?;
    authorize(&mut tx, auth.user.id, workspace).await?;
    let key = key(&state)?;
    lock_webhook(&mut tx, workspace, id).await?;
    let mut nonce = [0u8; 32];
    OsRng.fill_bytes(&mut nonce);
    sqlx::query("UPDATE webhooks SET secret_nonce=$1,secret_regenerated_at=now(),updated_at=now() WHERE id=$2").bind(nonce.as_slice()).bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(SecretResponse {
            signing_secret: key.derive(workspace, id, &nonce),
        }),
    ))
}

async fn catalog(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    query: Result<Query<CatalogQuery>, QueryRejection>,
) -> Result<Json<Catalog>, AppError> {
    let Path(workspace) = path.map_err(AppError::from)?;
    let Query(query) = query.map_err(AppError::from)?;
    let mut tx = state.pool.begin().await?;
    authorize(&mut tx, auth.user.id, workspace).await?;
    key(&state)?;
    let identifier: String = sqlx::query_scalar("SELECT identifier FROM workspaces WHERE id=$1")
        .bind(workspace)
        .fetch_one(&mut *tx)
        .await?;
    let project = if let Some(id) = query.project_id {
        let identifier: String =
            sqlx::query_scalar("SELECT identifier FROM projects WHERE workspace_id=$1 AND id=$2")
                .bind(workspace)
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| AppError::NotFound("Project not found".to_owned()))?;
        Identity { id, identifier }
    } else {
        Identity {
            id: Uuid::from_u128(7),
            identifier: "example-project".to_owned(),
        }
    };
    let identity = Identity {
        id: workspace,
        identifier,
    };
    let examples = EventType::CATALOG
        .into_iter()
        .map(|kind| {
            (
                kind.as_str().to_owned(),
                Event::example(kind, identity.clone(), project.clone()),
            )
        })
        .collect();
    tx.commit().await?;
    Ok(Json(Catalog {
        event_types: EventType::CATALOG.to_vec(),
        examples,
        allow_http: state.webhook_policy.allow_http,
    }))
}

async fn test(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<(StatusCode, Json<DeliveryResponse>), AppError> {
    let Path((workspace, id)) = path.map_err(AppError::from)?;
    let mut tx = state.pool.begin().await?;
    authorize(&mut tx, auth.user.id, workspace).await?;
    key(&state)?;
    lock_webhook(&mut tx, workspace, id).await?;
    let identity: (Uuid, String) =
        sqlx::query_as("SELECT id,identifier FROM workspaces WHERE id=$1")
            .bind(workspace)
            .fetch_one(&mut *tx)
            .await?;
    let event = Event::new(
        EventType::WebhookTest,
        Identity {
            id: identity.0,
            identifier: identity.1,
        },
        None,
        Some(auth.user.id),
        EventData::Test {
            message: "Kanleaf webhook test".to_owned(),
        },
    );
    domain_event::store(&mut tx, &event, None).await?;
    let delivery = Uuid::new_v4();
    sqlx::query("INSERT INTO webhook_deliveries(id,workspace_id,webhook_id,event_id,event_type,is_test) VALUES ($1,$2,$3,$4,'webhook.test',true)").bind(delivery).bind(workspace).bind(id).bind(event.id).execute(&mut *tx).await?;
    let result = read_delivery(&mut tx, workspace, id, delivery).await?;
    tx.commit().await?;
    Ok((StatusCode::ACCEPTED, Json(result)))
}

async fn read_delivery(
    tx: &mut Transaction<'_, Postgres>,
    workspace: Uuid,
    hook: Uuid,
    id: Uuid,
) -> Result<DeliveryResponse, AppError> {
    sqlx::query_as("SELECT id,event_id,event_type,is_test,status,attempt_count,http_status,duration_ms,last_error,next_attempt_at,created_at,delivered_at FROM webhook_deliveries WHERE workspace_id=$1 AND webhook_id=$2 AND id=$3")
        .bind(workspace).bind(hook).bind(id).fetch_optional(&mut **tx).await?
        .ok_or_else(|| AppError::NotFound("Delivery not found".to_owned()))
}

async fn delivery_detail(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
) -> Result<Json<DeliveryResponse>, AppError> {
    let Path((workspace, hook, id)) = path.map_err(AppError::from)?;
    let mut tx = state.pool.begin().await?;
    authorize(&mut tx, auth.user.id, workspace).await?;
    key(&state)?;
    let result = read_delivery(&mut tx, workspace, hook, id).await?;
    tx.commit().await?;
    Ok(Json(result))
}

async fn deliveries(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
) -> Result<Json<Vec<DeliveryResponse>>, AppError> {
    let Path((workspace, id)) = path.map_err(AppError::from)?;
    let mut tx = state.pool.begin().await?;
    authorize(&mut tx, auth.user.id, workspace).await?;
    key(&state)?;
    read(&mut tx, workspace, id).await?;
    let rows=sqlx::query_as("SELECT id,event_id,event_type,is_test,status,attempt_count,http_status,duration_ms,last_error,next_attempt_at,created_at,delivered_at FROM webhook_deliveries WHERE workspace_id=$1 AND webhook_id=$2 ORDER BY created_at DESC,id DESC LIMIT 50")
        .bind(workspace).bind(id).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(rows))
}
