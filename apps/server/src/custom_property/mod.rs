mod definition;
mod undefined;
mod value;

pub(crate) use definition::{
    PropertyDefinitionResponse, is_reserved_property_name, load_definitions,
};
pub(crate) use value::{
    PropertyValueMutation, apply_value_mutations, load_projected_values, validate_value_shape,
};

use axum::{
    Router,
    routing::{get, patch, post, put},
};

use crate::AppState;

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/workspaces/{workspace_id}/properties",
            get(definition::list).post(definition::create),
        )
        .route(
            "/api/workspaces/{workspace_id}/properties/reorder",
            put(definition::reorder),
        )
        .route(
            "/api/workspaces/{workspace_id}/properties/undefined",
            get(undefined::list_workspace),
        )
        .route(
            "/api/workspaces/{workspace_id}/properties/define",
            post(definition::define),
        )
        .route(
            "/api/workspaces/{workspace_id}/properties/{property_id}",
            patch(definition::update).delete(definition::remove),
        )
        .route(
            "/api/workspaces/{workspace_id}/properties/{property_id}/options",
            post(definition::create_option),
        )
        .route(
            "/api/workspaces/{workspace_id}/properties/{property_id}/options/reorder",
            put(definition::reorder_options),
        )
        .route(
            "/api/workspaces/{workspace_id}/properties/{property_id}/options/{option_id}",
            patch(definition::update_option).delete(definition::remove_option),
        )
        .route(
            "/api/workspaces/{workspace_id}/tasks/{task_id}/properties/{property_id}",
            put(value::set).delete(value::clear),
        )
        .route(
            "/api/workspaces/{workspace_id}/tasks/{task_id}/properties/undefined",
            get(undefined::list_task),
        )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PropertyType {
    Text,
    Number,
    Date,
    SingleSelect,
    MultiSelect,
    Checkbox,
    Url,
}

impl PropertyType {
    pub(crate) fn parse(value: &str) -> Result<Self, crate::error::AppError> {
        match value {
            "text" => Ok(Self::Text),
            "number" => Ok(Self::Number),
            "date" => Ok(Self::Date),
            "single_select" => Ok(Self::SingleSelect),
            "multi_select" => Ok(Self::MultiSelect),
            "checkbox" => Ok(Self::Checkbox),
            "url" => Ok(Self::Url),
            _ => Err(crate::error::AppError::Validation(
                "Property type is not supported".to_owned(),
            )),
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Number => "number",
            Self::Date => "date",
            Self::SingleSelect => "single_select",
            Self::MultiSelect => "multi_select",
            Self::Checkbox => "checkbox",
            Self::Url => "url",
        }
    }

    pub(crate) const fn is_select(self) -> bool {
        matches!(self, Self::SingleSelect | Self::MultiSelect)
    }
}
