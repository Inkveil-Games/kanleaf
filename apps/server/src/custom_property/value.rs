use std::collections::HashSet;

use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection, rejection::PathRejection},
    http::StatusCode,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, Postgres, Transaction};
use url::Url;
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthenticatedUser,
    error::AppError,
    task::{
        CustomProperty, authorize_task_location, enqueue_projection, lock_task_location,
        project_now,
    },
};

use super::PropertyType;

const MAX_TEXT_VALUE_CHARS: usize = 10_000;

#[derive(Clone, Debug, Serialize, FromRow)]
pub struct TaskPropertyValueResponse {
    pub property_id: Uuid,
    pub value: Value,
}

#[derive(Clone, Debug)]
pub(crate) struct PropertyValueMutation {
    pub property_id: Uuid,
    pub value: Option<Value>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SetValueRequest {
    value: Value,
}

#[derive(FromRow)]
struct PropertyForValue {
    property_type: String,
    archived: bool,
}

pub(super) async fn set(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
    payload: Result<Json<SetValueRequest>, JsonRejection>,
) -> Result<Json<TaskPropertyValueResponse>, AppError> {
    let Path((workspace_id, task_id, property_id)) = path.map_err(AppError::from)?;
    let Json(request) = payload.map_err(AppError::from)?;

    Ok(Json(
        set_value(
            &state,
            auth.user.id,
            workspace_id,
            task_id,
            property_id,
            request.value,
        )
        .await?,
    ))
}

pub(crate) async fn set_value(
    state: &AppState,
    actor_id: Uuid,
    workspace_id: Uuid,
    task_id: Uuid,
    property_id: Uuid,
    requested_value: Value,
) -> Result<TaskPropertyValueResponse, AppError> {
    let mut transaction = state.pool.begin().await?;
    super::definition::lock_workspace(&mut transaction, workspace_id).await?;
    let project_id = lock_task_location(&mut transaction, workspace_id, task_id, true).await?;
    authorize_task_location(&state.pool, actor_id, workspace_id, project_id, true).await?;
    let response =
        set_value_in_transaction(&mut transaction, workspace_id, property_id, requested_value)
            .await?;
    let response = upsert_value(&mut transaction, workspace_id, task_id, response).await?;
    enqueue_projection(&mut transaction, workspace_id, &[task_id]).await?;
    transaction.commit().await?;
    project_now(state, workspace_id, task_id).await;
    Ok(response)
}

pub(super) async fn clear(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, Uuid, Uuid)>, PathRejection>,
) -> Result<StatusCode, AppError> {
    let Path((workspace_id, task_id, property_id)) = path.map_err(AppError::from)?;
    clear_value(&state, auth.user.id, workspace_id, task_id, property_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn clear_value(
    state: &AppState,
    actor_id: Uuid,
    workspace_id: Uuid,
    task_id: Uuid,
    property_id: Uuid,
) -> Result<(), AppError> {
    let mut transaction = state.pool.begin().await?;
    super::definition::lock_workspace(&mut transaction, workspace_id).await?;
    let project_id = lock_task_location(&mut transaction, workspace_id, task_id, true).await?;
    authorize_task_location(&state.pool, actor_id, workspace_id, project_id, true).await?;
    property_for_value(&mut transaction, workspace_id, property_id).await?;
    let deleted = delete_value(&mut transaction, workspace_id, task_id, property_id).await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound(
            "Task property value not found".to_owned(),
        ));
    }
    enqueue_projection(&mut transaction, workspace_id, &[task_id]).await?;
    transaction.commit().await?;
    project_now(state, workspace_id, task_id).await;
    Ok(())
}

pub(crate) async fn apply_value_mutations(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
    mutations: &[PropertyValueMutation],
) -> Result<(), AppError> {
    let mut ids = HashSet::new();
    if mutations
        .iter()
        .any(|mutation| !ids.insert(mutation.property_id))
    {
        return Err(AppError::Validation(
            "A Task property can be changed only once per update".to_owned(),
        ));
    }
    for mutation in mutations {
        match mutation.value.clone() {
            Some(value) => {
                let value = set_value_in_transaction(
                    transaction,
                    workspace_id,
                    mutation.property_id,
                    value,
                )
                .await?;
                upsert_value(transaction, workspace_id, task_id, value).await?;
            }
            None => {
                property_for_value(transaction, workspace_id, mutation.property_id).await?;
                delete_value(transaction, workspace_id, task_id, mutation.property_id).await?;
            }
        }
    }
    Ok(())
}

async fn set_value_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    property_id: Uuid,
    requested_value: Value,
) -> Result<TaskPropertyValueResponse, AppError> {
    let property = property_for_value(transaction, workspace_id, property_id).await?;
    if property.archived {
        return Err(AppError::Validation(
            "Archived properties cannot receive new values".to_owned(),
        ));
    }
    let property_type = PropertyType::parse(&property.property_type)?;
    let value = validate_value(
        transaction,
        workspace_id,
        property_id,
        property_type,
        requested_value,
    )
    .await?;
    Ok(TaskPropertyValueResponse { property_id, value })
}

async fn upsert_value(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
    value: TaskPropertyValueResponse,
) -> Result<TaskPropertyValueResponse, AppError> {
    Ok(sqlx::query_as::<_, TaskPropertyValueResponse>(
        r#"
        INSERT INTO task_custom_property_values
            (workspace_id, task_id, property_id, value)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (task_id, property_id) DO UPDATE
        SET value = EXCLUDED.value, updated_at = now()
        RETURNING property_id, value
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(value.property_id)
    .bind(value.value)
    .fetch_one(&mut **transaction)
    .await?)
}

async fn delete_value(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
    property_id: Uuid,
) -> Result<sqlx::postgres::PgQueryResult, AppError> {
    Ok(sqlx::query(
        "DELETE FROM task_custom_property_values WHERE workspace_id = $1 AND task_id = $2 AND property_id = $3",
    )
    .bind(workspace_id)
    .bind(task_id)
    .bind(property_id)
    .execute(&mut **transaction)
    .await?)
}

async fn property_for_value(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    property_id: Uuid,
) -> Result<PropertyForValue, AppError> {
    sqlx::query_as(
        r#"
        SELECT property_type, archived_at IS NOT NULL AS archived
        FROM custom_property_definitions
        WHERE workspace_id = $1 AND id = $2
        FOR SHARE
        "#,
    )
    .bind(workspace_id)
    .bind(property_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Property not found".to_owned()))
}

pub(super) async fn validate_value(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    property_id: Uuid,
    property_type: PropertyType,
    value: Value,
) -> Result<Value, AppError> {
    let value = validate_value_shape(property_type, value)?;
    match property_type {
        PropertyType::Text
        | PropertyType::Number
        | PropertyType::Date
        | PropertyType::Checkbox
        | PropertyType::Url => Ok(value),
        PropertyType::SingleSelect => {
            let option_id = parse_option_id(&value)?;
            require_options(transaction, workspace_id, property_id, &[option_id]).await?;
            Ok(value)
        }
        PropertyType::MultiSelect => {
            let values = value
                .as_array()
                .ok_or_else(|| invalid_value("Multi-select"))?;
            let option_ids = values
                .iter()
                .map(parse_option_id)
                .collect::<Result<Vec<_>, _>>()?;
            require_options(transaction, workspace_id, property_id, &option_ids).await?;
            Ok(value)
        }
    }
}

pub(crate) fn validate_value_shape(
    property_type: PropertyType,
    value: Value,
) -> Result<Value, AppError> {
    match property_type {
        PropertyType::Text => {
            let text = value.as_str().ok_or_else(|| invalid_value("Text"))?;
            if text.is_empty() {
                return Err(AppError::Validation(
                    "Text property values cannot be empty; clear the property instead".to_owned(),
                ));
            }
            if text.chars().count() > MAX_TEXT_VALUE_CHARS {
                return Err(AppError::Validation(
                    "Text property values cannot exceed 10000 characters".to_owned(),
                ));
            }
            Ok(value)
        }
        PropertyType::Number => value
            .is_number()
            .then_some(value)
            .ok_or_else(|| invalid_value("Number")),
        PropertyType::Date => {
            let date = value.as_str().ok_or_else(|| invalid_value("Date"))?;
            NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| invalid_value("Date"))?;
            Ok(value)
        }
        PropertyType::Checkbox => value
            .is_boolean()
            .then_some(value)
            .ok_or_else(|| invalid_value("Checkbox")),
        PropertyType::Url => {
            let raw = value.as_str().ok_or_else(|| invalid_value("URL"))?;
            let parsed = Url::parse(raw).map_err(|_| invalid_value("URL"))?;
            if !matches!(parsed.scheme(), "http" | "https") {
                return Err(AppError::Validation(
                    "URL property values must use HTTP or HTTPS".to_owned(),
                ));
            }
            Ok(value)
        }
        PropertyType::SingleSelect => {
            let option_id = parse_option_id(&value)?;
            Ok(Value::String(option_id.to_string()))
        }
        PropertyType::MultiSelect => {
            let values = value
                .as_array()
                .ok_or_else(|| invalid_value("Multi-select"))?;
            if values.is_empty() {
                return Err(AppError::Validation(
                    "Multi-select property values cannot be empty; clear the property instead"
                        .to_owned(),
                ));
            }
            let option_ids = values
                .iter()
                .map(parse_option_id)
                .collect::<Result<Vec<_>, _>>()?;
            let unique = option_ids.iter().copied().collect::<HashSet<_>>();
            if unique.len() != option_ids.len() {
                return Err(AppError::Validation(
                    "Multi-select property values cannot contain duplicate options".to_owned(),
                ));
            }
            Ok(Value::Array(
                option_ids
                    .into_iter()
                    .map(|id| Value::String(id.to_string()))
                    .collect(),
            ))
        }
    }
}

fn parse_option_id(value: &Value) -> Result<Uuid, AppError> {
    value
        .as_str()
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| AppError::Validation("Select values must use option IDs".to_owned()))
}

async fn require_options(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    property_id: Uuid,
    option_ids: &[Uuid],
) -> Result<(), AppError> {
    let found: Vec<Uuid> = sqlx::query_scalar(
        r#"
        SELECT id FROM custom_property_options
        WHERE workspace_id = $1 AND property_id = $2
          AND id = ANY($3) AND archived_at IS NULL
        "#,
    )
    .bind(workspace_id)
    .bind(property_id)
    .bind(option_ids)
    .fetch_all(&mut **transaction)
    .await?;
    if found.len() != option_ids.len() {
        return Err(AppError::Validation(
            "A selected option does not belong to this property or is archived".to_owned(),
        ));
    }
    Ok(())
}

fn invalid_value(property_type: &str) -> AppError {
    AppError::Validation(format!("Invalid value for {property_type} property"))
}

pub(crate) async fn load_projected_values(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
) -> Result<Vec<CustomProperty>, AppError> {
    Ok(sqlx::query_as::<_, CustomProperty>(
        r#"
        SELECT definitions.name,
               definitions.property_type,
               CASE definitions.property_type
                   WHEN 'single_select' THEN to_jsonb((
                       SELECT options.name
                       FROM custom_property_options AS options
                       WHERE options.workspace_id = values.workspace_id
                         AND options.property_id = values.property_id
                         AND options.id = (values.value #>> '{}')::uuid
                   ))
                   WHEN 'multi_select' THEN COALESCE((
                       SELECT jsonb_agg(options.name ORDER BY selected.ordinal)
                       FROM jsonb_array_elements_text(values.value)
                            WITH ORDINALITY AS selected(option_id, ordinal)
                       JOIN custom_property_options AS options
                         ON options.workspace_id = values.workspace_id
                        AND options.property_id = values.property_id
                        AND options.id = selected.option_id::uuid
                   ), '[]'::jsonb)
                   ELSE values.value
               END AS value
        FROM task_custom_property_values AS values
        JOIN custom_property_definitions AS definitions
          ON definitions.workspace_id = values.workspace_id
         AND definitions.id = values.property_id
        WHERE values.workspace_id = $1 AND values.task_id = $2
        ORDER BY definitions.position, definitions.id
        "#,
    )
    .bind(workspace_id)
    .bind(task_id)
    .fetch_all(&mut **transaction)
    .await?)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{PropertyType, validate_value_shape};

    #[test]
    fn validates_property_shapes_shared_by_api_sync_and_import() {
        assert!(validate_value_shape(PropertyType::Text, json!("note")).is_ok());
        assert!(validate_value_shape(PropertyType::Text, json!("")).is_err());
        assert!(validate_value_shape(PropertyType::Text, json!("x".repeat(10_001))).is_err());
        assert!(validate_value_shape(PropertyType::Number, json!(3.5)).is_ok());
        assert!(validate_value_shape(PropertyType::Date, json!("2026-09-03")).is_ok());
        assert!(validate_value_shape(PropertyType::Date, json!("03/09/2026")).is_err());
        assert!(validate_value_shape(PropertyType::Url, json!("https://kanleaf.dev")).is_ok());
        assert!(validate_value_shape(PropertyType::Url, json!("file:///tmp/task")).is_err());
    }
}
