use std::collections::{HashMap, HashSet};

use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection, rejection::PathRejection},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    domain::{ConfigurationDescription, HexColor, ResourceName},
    error::{AppError, is_unique_violation},
    task::{enqueue_projection, project_many, read_undefined_properties, task_vault_row},
    workspace::{require_workspace_admin, require_workspace_member},
};

use super::PropertyType;

const RESERVED_PROPERTY_NAMES: &[&str] = &[
    "Kanleaf ID",
    "Reference",
    "Title",
    "Project",
    "State",
    "Type",
    "Priority",
    "Assignees",
    "Labels",
    "Cycle",
    "Modules",
    "Start date",
    "Due date",
    "Estimate",
    "Parent",
];

#[derive(Clone, Debug, Serialize)]
pub(crate) struct PropertyDefinitionResponse {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub name: String,
    #[serde(rename = "type")]
    pub property_type: String,
    pub description: String,
    pub position: i32,
    pub configuration: Value,
    pub options: Vec<PropertyOptionResponse>,
    pub usage_count: i64,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, FromRow)]
pub(crate) struct PropertyOptionResponse {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub property_id: Uuid,
    pub name: String,
    pub color: String,
    pub position: i32,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct PropertyDefinitionRow {
    id: Uuid,
    workspace_id: Uuid,
    name: String,
    property_type: String,
    description: String,
    position: i32,
    configuration: Value,
    archived_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CreateOptionRequest {
    name: String,
    color: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CreatePropertyRequest {
    name: String,
    #[serde(rename = "type")]
    property_type: String,
    #[serde(default)]
    description: String,
    #[serde(default = "empty_configuration")]
    configuration: Value,
    #[serde(default)]
    options: Vec<CreateOptionRequest>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct UpdatePropertyRequest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    configuration: Option<Value>,
    #[serde(default)]
    archived: Option<bool>,
    #[serde(default)]
    options: Option<Vec<SaveOptionRequest>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveOptionRequest {
    #[serde(default)]
    id: Option<Uuid>,
    name: String,
    color: String,
    #[serde(default)]
    archived: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ReorderRequest {
    ids: Vec<Uuid>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct UpdateOptionRequest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    archived: Option<bool>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DeletePropertyRequest {
    name: String,
}

fn empty_configuration() -> Value {
    Value::Object(Map::new())
}

pub(super) async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
) -> Result<Json<Vec<PropertyDefinitionResponse>>, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    require_workspace_member(&state.pool, auth.user.id, workspace_id).await?;
    Ok(Json(load_definitions(&state.pool, workspace_id).await?))
}

pub(super) async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<CreatePropertyRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<PropertyDefinitionResponse>), AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let name = property_name(&request.name)?;
    let property_type = PropertyType::parse(&request.property_type)?;
    let description = ConfigurationDescription::new(request.description.trim())
        .map_err(|error| AppError::Validation(error.to_string()))?;
    validate_configuration(&request.configuration)?;
    if !property_type.is_select() && !request.options.is_empty() {
        return Err(AppError::Validation(
            "Only select properties can define options".to_owned(),
        ));
    }
    let options = validate_create_options(&request.options)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;

    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    reject_undefined_name_collision(&state, workspace_id, name.as_str()).await?;
    let property_id = Uuid::new_v4();
    let position: i32 = sqlx::query_scalar(
        "SELECT COALESCE(max(position) + 1, 0) FROM custom_property_definitions WHERE workspace_id = $1 AND archived_at IS NULL",
    )
    .bind(workspace_id)
    .fetch_one(&mut *transaction)
    .await?;
    let inserted = sqlx::query_as::<_, PropertyDefinitionRow>(
        r#"
        INSERT INTO custom_property_definitions
            (id, workspace_id, name, property_type, description, position, configuration)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, workspace_id, name, property_type, description, position,
                  configuration, archived_at, created_at, updated_at
        "#,
    )
    .bind(property_id)
    .bind(workspace_id)
    .bind(name.as_str())
    .bind(property_type.as_str())
    .bind(description.as_str())
    .bind(position)
    .bind(&request.configuration)
    .fetch_one(&mut *transaction)
    .await;
    let inserted = match inserted {
        Ok(inserted) => inserted,
        Err(error) if is_unique_violation(&error) => {
            return Err(AppError::Conflict(
                "A defined or archived property already uses this name".to_owned(),
            ));
        }
        Err(error) => return Err(error.into()),
    };
    let mut inserted_options = Vec::with_capacity(options.len());
    for (position, (name, color)) in options.into_iter().enumerate() {
        inserted_options.push(
            insert_option(
                &mut transaction,
                workspace_id,
                property_id,
                name.as_str(),
                color.as_str(),
                position as i32,
            )
            .await?,
        );
    }
    transaction.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(into_response(inserted, inserted_options, 0)),
    ))
}

pub(super) async fn define(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<CreatePropertyRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<PropertyDefinitionResponse>), AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let name = property_name(&request.name)?;
    let property_type = PropertyType::parse(&request.property_type)?;
    let description = ConfigurationDescription::new(request.description.trim())
        .map_err(|error| AppError::Validation(error.to_string()))?;
    validate_configuration(&request.configuration)?;
    if !property_type.is_select() && !request.options.is_empty() {
        return Err(AppError::Validation(
            "Only select properties can define options".to_owned(),
        ));
    }
    let options = validate_create_options(&request.options)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;

    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    let task_ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM tasks WHERE workspace_id = $1 ORDER BY id FOR UPDATE")
            .bind(workspace_id)
            .fetch_all(&mut *transaction)
            .await?;
    let defined_names: Vec<String> =
        sqlx::query_scalar("SELECT name FROM custom_property_definitions WHERE workspace_id = $1")
            .bind(workspace_id)
            .fetch_all(&mut *transaction)
            .await?;
    if defined_names
        .iter()
        .any(|existing| existing.eq_ignore_ascii_case(name.as_str()))
    {
        return Err(AppError::Conflict(
            "A defined or archived property already uses this name".to_owned(),
        ));
    }

    let mut imported = Vec::new();
    let mut scanned_revisions = Vec::with_capacity(task_ids.len());
    for task_id in &task_ids {
        let row = task_vault_row(&mut transaction, workspace_id, *task_id, true).await?;
        let mut reserved = defined_names.clone();
        let cleanup: Option<Vec<String>> = sqlx::query_scalar(
            "SELECT cleanup_property_names FROM task_projection_jobs WHERE workspace_id = $1 AND task_id = $2",
        )
        .bind(workspace_id)
        .bind(task_id)
        .fetch_optional(&mut *transaction)
        .await?;
        reserved.extend(cleanup.unwrap_or_default());
        let document = state
            .vault
            .read_task_document(workspace_id, &row.path()?)
            .await
            .map_err(AppError::internal)?;
        scanned_revisions.push((*task_id, document.revision.clone()));
        let matches = read_undefined_properties(&document.content, &reserved)
            .map_err(|_| invalid_frontmatter())?
            .into_iter()
            .filter(|property| property.name.eq_ignore_ascii_case(name.as_str()))
            .collect::<Vec<_>>();
        if matches.len() > 1 {
            return Err(AppError::Conflict(format!(
                "Task Markdown contains multiple fields matching {}",
                name.as_str()
            )));
        }
        if let Some(property) = matches.into_iter().next() {
            imported.push(ImportedPropertyValue {
                task_id: *task_id,
                source_name: property.name,
                value: property.value,
            });
        }
    }
    if imported.is_empty() {
        return Err(AppError::Conflict(
            "This undefined property no longer exists in Task Markdown".to_owned(),
        ));
    }

    let property_id = Uuid::new_v4();
    let position: i32 = sqlx::query_scalar(
        "SELECT COALESCE(max(position) + 1, 0) FROM custom_property_definitions WHERE workspace_id = $1 AND archived_at IS NULL",
    )
    .bind(workspace_id)
    .fetch_one(&mut *transaction)
    .await?;
    let inserted = sqlx::query_as::<_, PropertyDefinitionRow>(
        r#"
        INSERT INTO custom_property_definitions
            (id, workspace_id, name, property_type, description, position, configuration)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, workspace_id, name, property_type, description, position,
                  configuration, archived_at, created_at, updated_at
        "#,
    )
    .bind(property_id)
    .bind(workspace_id)
    .bind(name.as_str())
    .bind(property_type.as_str())
    .bind(description.as_str())
    .bind(position)
    .bind(&request.configuration)
    .fetch_one(&mut *transaction)
    .await;
    let inserted = match inserted {
        Ok(inserted) => inserted,
        Err(error) if is_unique_violation(&error) => {
            return Err(AppError::Conflict(
                "A defined or archived property already uses this name".to_owned(),
            ));
        }
        Err(error) => return Err(error.into()),
    };
    let mut inserted_options = Vec::with_capacity(options.len());
    for (position, (option_name, color)) in options.into_iter().enumerate() {
        inserted_options.push(
            insert_option(
                &mut transaction,
                workspace_id,
                property_id,
                option_name.as_str(),
                color.as_str(),
                position as i32,
            )
            .await?,
        );
    }

    for item in &imported {
        let value = imported_value(
            &mut transaction,
            workspace_id,
            property_id,
            property_type,
            item.value.clone(),
            &inserted_options,
        )
        .await?;
        sqlx::query(
            r#"
            INSERT INTO task_custom_property_values
                (workspace_id, task_id, property_id, value)
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(workspace_id)
        .bind(item.task_id)
        .bind(property_id)
        .bind(value)
        .execute(&mut *transaction)
        .await?;
    }

    for (task_id, source_revision) in &scanned_revisions {
        let row = task_vault_row(&mut transaction, workspace_id, *task_id, true).await?;
        let current = state
            .vault
            .read_task_document(workspace_id, &row.path()?)
            .await
            .map_err(AppError::internal)?;
        if current.revision != *source_revision {
            return Err(AppError::Conflict(
                "Task Markdown changed while the property was being defined; review it and try again"
                    .to_owned(),
            ));
        }
    }
    for item in &imported {
        enqueue_with_cleanup(
            &mut transaction,
            workspace_id,
            &[item.task_id],
            &item.source_name,
        )
        .await?;
    }
    transaction.commit().await?;
    let affected_task_ids = imported.iter().map(|item| item.task_id).collect::<Vec<_>>();
    project_many(&state, workspace_id, &affected_task_ids).await;
    Ok((
        StatusCode::CREATED,
        Json(into_response(
            inserted,
            inserted_options,
            imported.len() as i64,
        )),
    ))
}

struct ImportedPropertyValue {
    task_id: Uuid,
    source_name: String,
    value: Value,
}

async fn imported_value(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    property_id: Uuid,
    property_type: PropertyType,
    raw: Value,
    options: &[PropertyOptionResponse],
) -> Result<Value, AppError> {
    let value = match property_type {
        PropertyType::Text => match raw {
            Value::String(_) => raw,
            _ => Value::String(serde_json::to_string(&raw).map_err(AppError::internal)?),
        },
        PropertyType::SingleSelect => {
            let name = raw
                .as_str()
                .ok_or_else(|| invalid_imported_value("Single select"))?;
            Value::String(option_id_for_name(options, name)?.to_string())
        }
        PropertyType::MultiSelect => {
            let names = raw
                .as_array()
                .ok_or_else(|| invalid_imported_value("Multi-select"))?;
            Value::Array(
                names
                    .iter()
                    .map(|name| {
                        name.as_str()
                            .ok_or_else(|| invalid_imported_value("Multi-select"))
                            .and_then(|name| option_id_for_name(options, name))
                            .map(|id| Value::String(id.to_string()))
                    })
                    .collect::<Result<Vec<_>, _>>()?,
            )
        }
        _ => raw,
    };
    super::value::validate_value(transaction, workspace_id, property_id, property_type, value)
        .await
        .map_err(|_| {
            AppError::Validation(format!(
                "A Task contains a value that is invalid for {}",
                property_type.as_str()
            ))
        })
}

fn option_id_for_name(options: &[PropertyOptionResponse], name: &str) -> Result<Uuid, AppError> {
    options
        .iter()
        .find(|option| option.name == name)
        .map(|option| option.id)
        .ok_or_else(|| {
            AppError::Validation(format!(
                "Select option {name} must be added before this property can be defined"
            ))
        })
}

fn invalid_imported_value(property_type: &str) -> AppError {
    AppError::Validation(format!(
        "A Task contains a value that is invalid for {property_type}"
    ))
}

fn invalid_frontmatter() -> AppError {
    AppError::Conflict("A Task contains properties that Kanleaf cannot inspect safely".to_owned())
}

pub(super) async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<UpdatePropertyRequest>, JsonRejection>,
) -> Result<Json<PropertyDefinitionResponse>, AppError> {
    let Path((workspace_id, property_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    if request.name.is_none()
        && request.description.is_none()
        && request.configuration.is_none()
        && request.archived.is_none()
        && request.options.is_none()
    {
        return Err(AppError::Validation(
            "Provide at least one property field to update".to_owned(),
        ));
    }
    let name = request.name.as_deref().map(property_name).transpose()?;
    let description = request
        .description
        .as_deref()
        .map(str::trim)
        .map(ConfigurationDescription::new)
        .transpose()
        .map_err(|error| AppError::Validation(error.to_string()))?;
    if let Some(configuration) = &request.configuration {
        validate_configuration(configuration)?;
    }
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;

    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    if let Some(name) = &name {
        reject_undefined_name_collision(&state, workspace_id, name.as_str()).await?;
    }
    let previous: Option<(String, bool, String)> = sqlx::query_as(
        "SELECT name, archived_at IS NOT NULL, property_type FROM custom_property_definitions WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
    )
    .bind(workspace_id)
    .bind(property_id)
    .fetch_optional(&mut *transaction)
    .await?;
    let (previous_name, was_archived, property_type) =
        previous.ok_or_else(|| AppError::NotFound("Property not found".to_owned()))?;
    let property_type = PropertyType::parse(&property_type)?;
    if request.options.is_some() && !property_type.is_select() {
        return Err(AppError::Validation(
            "Only select properties can define options".to_owned(),
        ));
    }
    let task_ids = property_task_ids(&mut transaction, workspace_id, property_id).await?;
    let new_position: Option<i32> = if request.archived == Some(false) && was_archived {
        Some(
            sqlx::query_scalar(
                "SELECT COALESCE(max(position) + 1, 0) FROM custom_property_definitions WHERE workspace_id = $1 AND archived_at IS NULL",
            )
            .bind(workspace_id)
            .fetch_one(&mut *transaction)
            .await?,
        )
    } else {
        None
    };
    let updated = sqlx::query_as::<_, PropertyDefinitionRow>(
        r#"
        UPDATE custom_property_definitions
        SET name = COALESCE($1, name),
            description = COALESCE($2, description),
            configuration = COALESCE($3, configuration),
            archived_at = CASE
                WHEN $4::boolean IS NULL THEN archived_at
                WHEN $4 THEN now()
                ELSE NULL
            END,
            position = COALESCE($5, position),
            updated_at = now()
        WHERE workspace_id = $6 AND id = $7
        RETURNING id, workspace_id, name, property_type, description, position,
                  configuration, archived_at, created_at, updated_at
        "#,
    )
    .bind(name.as_ref().map(ResourceName::as_str))
    .bind(description.as_ref().map(ConfigurationDescription::as_str))
    .bind(request.configuration)
    .bind(request.archived)
    .bind(new_position)
    .bind(workspace_id)
    .bind(property_id)
    .fetch_one(&mut *transaction)
    .await;
    let updated = match updated {
        Ok(updated) => updated,
        Err(error) if is_unique_violation(&error) => {
            return Err(AppError::Conflict(
                "A defined or archived property already uses this name".to_owned(),
            ));
        }
        Err(error) => return Err(error.into()),
    };
    if let Some(options) = &request.options {
        replace_options(
            &mut transaction,
            workspace_id,
            property_id,
            property_type,
            options,
        )
        .await?;
    }
    if name.is_some() {
        enqueue_with_cleanup(&mut transaction, workspace_id, &task_ids, &previous_name).await?;
    } else if request.archived.is_some() || request.options.is_some() {
        enqueue_projection(&mut transaction, workspace_id, &task_ids).await?;
    }
    let options = options_for_property(&mut transaction, workspace_id, property_id).await?;
    transaction.commit().await?;
    project_many(&state, workspace_id, &task_ids).await;
    Ok(Json(into_response(updated, options, task_ids.len() as i64)))
}

pub(super) async fn reorder(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    payload: Result<Json<ReorderRequest>, JsonRejection>,
) -> Result<StatusCode, AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    let current: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM custom_property_definitions WHERE workspace_id = $1 AND archived_at IS NULL FOR UPDATE",
    )
    .bind(workspace_id)
    .fetch_all(&mut *transaction)
    .await?;
    validate_reorder_ids(&request.ids, &current, "property")?;
    for (position, property_id) in request.ids.into_iter().enumerate() {
        sqlx::query(
            "UPDATE custom_property_definitions SET position = $1, updated_at = now() WHERE workspace_id = $2 AND id = $3",
        )
        .bind(position as i32)
        .bind(workspace_id)
        .bind(property_id)
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn remove(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<DeletePropertyRequest>, JsonRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, property_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    let current_name: String = sqlx::query_scalar(
        "SELECT name FROM custom_property_definitions WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
    )
    .bind(workspace_id)
    .bind(property_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Property not found".to_owned()))?;
    if request.name != current_name {
        return Err(AppError::Validation(
            "Enter the exact property name to confirm deletion".to_owned(),
        ));
    }
    let task_ids = property_task_ids(&mut transaction, workspace_id, property_id).await?;
    sqlx::query("DELETE FROM custom_property_definitions WHERE workspace_id = $1 AND id = $2")
        .bind(workspace_id)
        .bind(property_id)
        .execute(&mut *transaction)
        .await?;
    enqueue_with_cleanup(&mut transaction, workspace_id, &task_ids, &current_name).await?;
    transaction.commit().await?;
    project_many(&state, workspace_id, &task_ids).await;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn create_option(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<CreateOptionRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<PropertyOptionResponse>), AppError> {
    let Path((workspace_id, property_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    let name = option_name(&request.name)?;
    let color = normalized_color(&request.color)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    require_select_property(&mut transaction, workspace_id, property_id, false).await?;
    let position: i32 = sqlx::query_scalar(
        "SELECT COALESCE(max(position) + 1, 0) FROM custom_property_options WHERE workspace_id = $1 AND property_id = $2 AND archived_at IS NULL",
    )
    .bind(workspace_id)
    .bind(property_id)
    .fetch_one(&mut *transaction)
    .await?;
    let inserted = insert_option(
        &mut transaction,
        workspace_id,
        property_id,
        name.as_str(),
        color.as_str(),
        position,
    )
    .await?;
    transaction.commit().await?;
    Ok((StatusCode::CREATED, Json(inserted)))
}

pub(super) async fn update_option(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<UpdateOptionRequest>, JsonRejection>,
) -> Result<Json<PropertyOptionResponse>, AppError> {
    let Path((workspace_id, property_id, option_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    if request.name.is_none() && request.color.is_none() && request.archived.is_none() {
        return Err(AppError::Validation(
            "Provide at least one option field to update".to_owned(),
        ));
    }
    let name = request.name.as_deref().map(option_name).transpose()?;
    let color = request.color.as_deref().map(normalized_color).transpose()?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    require_select_property(&mut transaction, workspace_id, property_id, true).await?;
    let was_archived: bool = sqlx::query_scalar(
        "SELECT archived_at IS NOT NULL FROM custom_property_options WHERE workspace_id = $1 AND property_id = $2 AND id = $3 FOR UPDATE",
    )
    .bind(workspace_id)
    .bind(property_id)
    .bind(option_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Property option not found".to_owned()))?;
    let new_position: Option<i32> = if request.archived == Some(false) && was_archived {
        Some(
            sqlx::query_scalar(
                "SELECT COALESCE(max(position) + 1, 0) FROM custom_property_options WHERE workspace_id = $1 AND property_id = $2 AND archived_at IS NULL",
            )
            .bind(workspace_id)
            .bind(property_id)
            .fetch_one(&mut *transaction)
            .await?,
        )
    } else {
        None
    };
    let updated = sqlx::query_as::<_, PropertyOptionResponse>(
        r#"
        UPDATE custom_property_options
        SET name = COALESCE($1, name), color = COALESCE($2, color),
            archived_at = CASE
                WHEN $3::boolean IS NULL THEN archived_at
                WHEN $3 THEN now()
                ELSE NULL
            END,
            position = COALESCE($4, position), updated_at = now()
        WHERE workspace_id = $5 AND property_id = $6 AND id = $7
        RETURNING id, workspace_id, property_id, name, color, position,
                  archived_at, created_at, updated_at
        "#,
    )
    .bind(name.as_ref().map(ResourceName::as_str))
    .bind(color.as_ref().map(HexColor::as_str))
    .bind(request.archived)
    .bind(new_position)
    .bind(workspace_id)
    .bind(property_id)
    .bind(option_id)
    .fetch_one(&mut *transaction)
    .await;
    let updated = match updated {
        Ok(updated) => updated,
        Err(error) if is_unique_violation(&error) => {
            return Err(AppError::Conflict(
                "A defined or archived option already uses this name".to_owned(),
            ));
        }
        Err(error) => return Err(error.into()),
    };
    let task_ids = option_task_ids(&mut transaction, workspace_id, property_id, option_id).await?;
    if name.is_some() || request.archived.is_some() {
        enqueue_projection(&mut transaction, workspace_id, &task_ids).await?;
    }
    transaction.commit().await?;
    project_many(&state, workspace_id, &task_ids).await;
    Ok(Json(updated))
}

pub(super) async fn reorder_options(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<ReorderRequest>, JsonRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, property_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    require_select_property(&mut transaction, workspace_id, property_id, true).await?;
    let current: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM custom_property_options WHERE workspace_id = $1 AND property_id = $2 AND archived_at IS NULL FOR UPDATE",
    )
    .bind(workspace_id)
    .bind(property_id)
    .fetch_all(&mut *transaction)
    .await?;
    validate_reorder_ids(&request.ids, &current, "property option")?;
    for (position, option_id) in request.ids.into_iter().enumerate() {
        sqlx::query(
            "UPDATE custom_property_options SET position = $1, updated_at = now() WHERE workspace_id = $2 AND property_id = $3 AND id = $4",
        )
        .bind(position as i32)
        .bind(workspace_id)
        .bind(property_id)
        .bind(option_id)
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn remove_option(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, property_id, option_id)) = path.map_err(AppError::from)?;
    require_workspace_admin(&state.pool, auth.user.id, workspace_id).await?;
    let mut transaction = state.pool.begin().await?;
    lock_workspace(&mut transaction, workspace_id).await?;
    let property_type =
        require_select_property(&mut transaction, workspace_id, property_id, true).await?;
    let found: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM custom_property_options WHERE workspace_id = $1 AND property_id = $2 AND id = $3 FOR UPDATE",
    )
    .bind(workspace_id)
    .bind(property_id)
    .bind(option_id)
    .fetch_optional(&mut *transaction)
    .await?;
    if found.is_none() {
        return Err(AppError::NotFound("Property option not found".to_owned()));
    }
    let task_ids = option_task_ids(&mut transaction, workspace_id, property_id, option_id).await?;
    delete_option_data(
        &mut transaction,
        workspace_id,
        property_id,
        option_id,
        property_type,
    )
    .await?;
    enqueue_projection(&mut transaction, workspace_id, &task_ids).await?;
    transaction.commit().await?;
    project_many(&state, workspace_id, &task_ids).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn replace_options(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    property_id: Uuid,
    property_type: PropertyType,
    requested: &[SaveOptionRequest],
) -> Result<(), AppError> {
    let existing = options_for_property(transaction, workspace_id, property_id).await?;
    let existing_ids = existing
        .iter()
        .map(|option| option.id)
        .collect::<HashSet<_>>();
    let mut requested_ids = HashSet::new();
    let mut names = HashSet::new();
    let mut validated = Vec::with_capacity(requested.len());
    for option in requested {
        if option
            .id
            .is_some_and(|id| !existing_ids.contains(&id) || !requested_ids.insert(id))
        {
            return Err(AppError::Validation(
                "Property options must use unique IDs belonging to this property".to_owned(),
            ));
        }
        if option.id.is_none() && option.archived {
            return Err(AppError::Validation(
                "A new property option cannot start archived".to_owned(),
            ));
        }
        let name = option_name(&option.name)?;
        if !names.insert(name.as_str().to_lowercase()) {
            return Err(AppError::Validation(
                "Property options cannot contain duplicate names".to_owned(),
            ));
        }
        validated.push((
            option.id,
            name,
            normalized_color(&option.color)?,
            option.archived,
        ));
    }

    for option in existing
        .iter()
        .filter(|option| !requested_ids.contains(&option.id))
    {
        delete_option_data(
            transaction,
            workspace_id,
            property_id,
            option.id,
            property_type,
        )
        .await?;
    }

    if !requested_ids.is_empty() {
        let temporary_prefix = format!("__kanleaf_{}_", Uuid::new_v4());
        sqlx::query(
            r#"
            UPDATE custom_property_options
            SET name = $1 || id::text
            WHERE workspace_id = $2 AND property_id = $3 AND id = ANY($4)
            "#,
        )
        .bind(temporary_prefix)
        .bind(workspace_id)
        .bind(property_id)
        .bind(requested_ids.iter().copied().collect::<Vec<_>>())
        .execute(&mut **transaction)
        .await?;
    }

    let mut active_position = 0_i32;
    let mut archived_position = 0_i32;
    for (id, name, color, archived) in validated {
        let position = if archived {
            let position = archived_position;
            archived_position += 1;
            position
        } else {
            let position = active_position;
            active_position += 1;
            position
        };
        match id {
            Some(id) => {
                sqlx::query(
                    r#"
                    UPDATE custom_property_options
                    SET name = $1, color = $2, position = $3,
                        archived_at = CASE WHEN $4 THEN COALESCE(archived_at, now()) ELSE NULL END,
                        updated_at = now()
                    WHERE workspace_id = $5 AND property_id = $6 AND id = $7
                    "#,
                )
                .bind(name.as_str())
                .bind(color.as_str())
                .bind(position)
                .bind(archived)
                .bind(workspace_id)
                .bind(property_id)
                .bind(id)
                .execute(&mut **transaction)
                .await?;
            }
            None => {
                insert_option(
                    transaction,
                    workspace_id,
                    property_id,
                    name.as_str(),
                    color.as_str(),
                    position,
                )
                .await?;
            }
        }
    }
    Ok(())
}

async fn delete_option_data(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    property_id: Uuid,
    option_id: Uuid,
    property_type: PropertyType,
) -> Result<(), AppError> {
    match property_type {
        PropertyType::SingleSelect => {
            sqlx::query(
                "DELETE FROM task_custom_property_values WHERE workspace_id = $1 AND property_id = $2 AND value = to_jsonb($3::text)",
            )
            .bind(workspace_id)
            .bind(property_id)
            .bind(option_id.to_string())
            .execute(&mut **transaction)
            .await?;
        }
        PropertyType::MultiSelect => {
            sqlx::query(
                r#"
                UPDATE task_custom_property_values AS values
                SET value = COALESCE(
                        (
                            SELECT jsonb_agg(element ORDER BY ordinal)
                            FROM jsonb_array_elements(values.value)
                                 WITH ORDINALITY AS items(element, ordinal)
                            WHERE element <> to_jsonb($3::text)
                        ),
                        '[]'::jsonb
                    ),
                    updated_at = now()
                WHERE values.workspace_id = $1 AND values.property_id = $2
                "#,
            )
            .bind(workspace_id)
            .bind(property_id)
            .bind(option_id.to_string())
            .execute(&mut **transaction)
            .await?;
            sqlx::query(
                "DELETE FROM task_custom_property_values WHERE workspace_id = $1 AND property_id = $2 AND value = '[]'::jsonb",
            )
            .bind(workspace_id)
            .bind(property_id)
            .execute(&mut **transaction)
            .await?;
        }
        _ => unreachable!("select property validation returned a non-select type"),
    }
    sqlx::query(
        "DELETE FROM custom_property_options WHERE workspace_id = $1 AND property_id = $2 AND id = $3",
    )
    .bind(workspace_id)
    .bind(property_id)
    .bind(option_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

pub(crate) async fn load_definitions(
    pool: &sqlx::PgPool,
    workspace_id: Uuid,
) -> Result<Vec<PropertyDefinitionResponse>, AppError> {
    let rows = sqlx::query_as::<_, PropertyDefinitionRow>(
        r#"
        SELECT id, workspace_id, name, property_type, description, position,
               configuration, archived_at, created_at, updated_at
        FROM custom_property_definitions
        WHERE workspace_id = $1
        ORDER BY archived_at NULLS FIRST, position, id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await?;
    let options = sqlx::query_as::<_, PropertyOptionResponse>(
        r#"
        SELECT id, workspace_id, property_id, name, color, position,
               archived_at, created_at, updated_at
        FROM custom_property_options
        WHERE workspace_id = $1
        ORDER BY property_id, archived_at NULLS FIRST, position, id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await?;
    let mut options_by_property: HashMap<Uuid, Vec<PropertyOptionResponse>> = HashMap::new();
    for option in options {
        options_by_property
            .entry(option.property_id)
            .or_default()
            .push(option);
    }
    let usage_counts: HashMap<Uuid, i64> = sqlx::query_as(
        r#"
        SELECT property_id, count(*)::bigint
        FROM task_custom_property_values
        WHERE workspace_id = $1
        GROUP BY property_id
        "#,
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();
    Ok(rows
        .into_iter()
        .map(|row| {
            let options = options_by_property.remove(&row.id).unwrap_or_default();
            let usage_count = usage_counts.get(&row.id).copied().unwrap_or(0);
            into_response(row, options, usage_count)
        })
        .collect())
}

fn into_response(
    row: PropertyDefinitionRow,
    options: Vec<PropertyOptionResponse>,
    usage_count: i64,
) -> PropertyDefinitionResponse {
    PropertyDefinitionResponse {
        id: row.id,
        workspace_id: row.workspace_id,
        name: row.name,
        property_type: row.property_type,
        description: row.description,
        position: row.position,
        configuration: row.configuration,
        options,
        usage_count,
        archived_at: row.archived_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn property_name(value: &str) -> Result<ResourceName, AppError> {
    let name = ResourceName::new(value).map_err(|error| AppError::Validation(error.to_string()))?;
    if is_reserved_property_name(name.as_str()) {
        return Err(AppError::Validation(
            "Property name is reserved by Kanleaf".to_owned(),
        ));
    }
    Ok(name)
}

pub(crate) fn is_reserved_property_name(name: &str) -> bool {
    RESERVED_PROPERTY_NAMES
        .iter()
        .any(|reserved| reserved.eq_ignore_ascii_case(name))
}

fn option_name(value: &str) -> Result<ResourceName, AppError> {
    ResourceName::new(value).map_err(|error| AppError::Validation(error.to_string()))
}

fn normalized_color(value: &str) -> Result<HexColor, AppError> {
    HexColor::new(&value.to_uppercase()).map_err(|error| AppError::Validation(error.to_string()))
}

fn validate_configuration(configuration: &Value) -> Result<(), AppError> {
    if !configuration.as_object().is_some_and(Map::is_empty) {
        return Err(AppError::Validation(
            "Property configuration contains unsupported fields".to_owned(),
        ));
    }
    Ok(())
}

fn validate_create_options(
    options: &[CreateOptionRequest],
) -> Result<Vec<(ResourceName, HexColor)>, AppError> {
    let mut names = HashSet::new();
    options
        .iter()
        .map(|option| {
            let name = option_name(&option.name)?;
            if !names.insert(name.as_str().to_lowercase()) {
                return Err(AppError::Validation(
                    "Property options cannot contain duplicate names".to_owned(),
                ));
            }
            Ok((name, normalized_color(&option.color)?))
        })
        .collect()
}

async fn insert_option(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    property_id: Uuid,
    name: &str,
    color: &str,
    position: i32,
) -> Result<PropertyOptionResponse, AppError> {
    let inserted = sqlx::query_as::<_, PropertyOptionResponse>(
        r#"
        INSERT INTO custom_property_options
            (id, workspace_id, property_id, name, color, position)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, workspace_id, property_id, name, color, position,
                  archived_at, created_at, updated_at
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(workspace_id)
    .bind(property_id)
    .bind(name)
    .bind(color)
    .bind(position)
    .fetch_one(&mut **transaction)
    .await;
    match inserted {
        Ok(inserted) => Ok(inserted),
        Err(error) if is_unique_violation(&error) => Err(AppError::Conflict(
            "A defined or archived option already uses this name".to_owned(),
        )),
        Err(error) => Err(error.into()),
    }
}

async fn options_for_property(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    property_id: Uuid,
) -> Result<Vec<PropertyOptionResponse>, AppError> {
    Ok(sqlx::query_as(
        r#"
        SELECT id, workspace_id, property_id, name, color, position,
               archived_at, created_at, updated_at
        FROM custom_property_options
        WHERE workspace_id = $1 AND property_id = $2
        ORDER BY archived_at NULLS FIRST, position, id
        "#,
    )
    .bind(workspace_id)
    .bind(property_id)
    .fetch_all(&mut **transaction)
    .await?)
}

async fn require_select_property(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    property_id: Uuid,
    include_archived: bool,
) -> Result<PropertyType, AppError> {
    let property_type: String = sqlx::query_scalar(
        r#"
        SELECT property_type FROM custom_property_definitions
        WHERE workspace_id = $1 AND id = $2 AND ($3 OR archived_at IS NULL)
        FOR UPDATE
        "#,
    )
    .bind(workspace_id)
    .bind(property_id)
    .bind(include_archived)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Property not found".to_owned()))?;
    let property_type = PropertyType::parse(&property_type)?;
    if !property_type.is_select() {
        return Err(AppError::Validation(
            "Only select properties can define options".to_owned(),
        ));
    }
    Ok(property_type)
}

async fn property_task_ids(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    property_id: Uuid,
) -> Result<Vec<Uuid>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT task_id FROM task_custom_property_values WHERE workspace_id = $1 AND property_id = $2 ORDER BY task_id",
    )
    .bind(workspace_id)
    .bind(property_id)
    .fetch_all(&mut **transaction)
    .await?)
}

async fn option_task_ids(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    property_id: Uuid,
    option_id: Uuid,
) -> Result<Vec<Uuid>, AppError> {
    Ok(sqlx::query_scalar(
        r#"
        SELECT task_id FROM task_custom_property_values
        WHERE workspace_id = $1 AND property_id = $2
          AND (value = to_jsonb($3::text) OR value @> jsonb_build_array($3::text))
        ORDER BY task_id
        "#,
    )
    .bind(workspace_id)
    .bind(property_id)
    .bind(option_id.to_string())
    .fetch_all(&mut **transaction)
    .await?)
}

async fn enqueue_with_cleanup(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_ids: &[Uuid],
    old_name: &str,
) -> Result<(), AppError> {
    enqueue_projection(transaction, workspace_id, task_ids).await?;
    if task_ids.is_empty() {
        return Ok(());
    }
    sqlx::query(
        r#"
        UPDATE task_projection_jobs
        SET cleanup_property_names = ARRAY(
                SELECT DISTINCT name
                FROM unnest(cleanup_property_names || ARRAY[$3::text]) AS names(name)
                ORDER BY name
            ),
            updated_at = now()
        WHERE workspace_id = $1 AND task_id = ANY($2)
        "#,
    )
    .bind(workspace_id)
    .bind(task_ids)
    .bind(old_name)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

fn validate_reorder_ids(
    requested: &[Uuid],
    current: &[Uuid],
    entity: &str,
) -> Result<(), AppError> {
    let requested_set: HashSet<_> = requested.iter().copied().collect();
    let current_set: HashSet<_> = current.iter().copied().collect();
    if requested.len() != requested_set.len()
        || requested_set.len() != current_set.len()
        || requested_set != current_set
    {
        return Err(AppError::Validation(format!(
            "Reorder must include every active {entity} exactly once"
        )));
    }
    Ok(())
}

pub(super) async fn lock_workspace(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
) -> Result<(), AppError> {
    let found: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE")
            .bind(workspace_id)
            .fetch_optional(&mut **transaction)
            .await?;
    if found.is_none() {
        return Err(AppError::NotFound("Workspace not found".to_owned()));
    }
    Ok(())
}

async fn reject_undefined_name_collision(
    state: &AppState,
    workspace_id: Uuid,
    name: &str,
) -> Result<(), AppError> {
    if super::undefined::scan_workspace(state, workspace_id)
        .await?
        .contains_key(&name.to_lowercase())
    {
        return Err(AppError::Conflict(
            "An undefined Task property already uses this name".to_owned(),
        ));
    }
    Ok(())
}
