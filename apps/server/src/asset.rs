use axum::{
    Json, Router,
    body::Body,
    extract::{
        DefaultBodyLimit, Multipart, Path, Query, State, rejection::PathRejection,
        rejection::QueryRejection,
    },
    http::{Response, StatusCode, header},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AppState, auth::AuthenticatedUser, document::authorize_document_location, error::AppError,
    task::authorize_task_location, vault::AssetPath,
};

const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum AssetTargetKind {
    Task,
    Document,
}

#[derive(Deserialize)]
struct AssetTargetQuery {
    target_kind: AssetTargetKind,
    target_id: Uuid,
}

#[derive(Serialize)]
struct UploadedAsset {
    reference: String,
    original_name: String,
    mime_type: &'static str,
    size: usize,
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/workspaces/{workspace_id}/assets/images",
            post(upload_image),
        )
        .route(
            "/api/workspaces/{workspace_id}/assets/images/{file_name}",
            get(read_image),
        )
        .layer(DefaultBodyLimit::max(MAX_IMAGE_BYTES + 64 * 1024))
}

async fn upload_image(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<Uuid>, PathRejection>,
    query: Result<Query<AssetTargetQuery>, QueryRejection>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<UploadedAsset>), AppError> {
    let Path(workspace_id) = path.map_err(AppError::from)?;
    let Query(target) = query.map_err(AppError::from)?;
    authorize_target(&state, auth.user.id, workspace_id, &target, true).await?;

    let mut upload = None;
    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|_| AppError::Validation("Image upload is invalid".to_owned()))?
    {
        if field.name() != Some("file") || upload.is_some() {
            return Err(AppError::Validation(
                "Upload exactly one image file".to_owned(),
            ));
        }
        let original_name = field
            .file_name()
            .map(str::to_owned)
            .ok_or_else(|| AppError::Validation("Image filename is required".to_owned()))?;
        validate_original_name(&original_name)?;
        let declared_type = field.content_type().map(str::to_owned);
        let mut bytes = Vec::new();
        while let Some(chunk) = field
            .chunk()
            .await
            .map_err(|_| AppError::Validation("Image upload is invalid".to_owned()))?
        {
            if bytes.len().saturating_add(chunk.len()) > MAX_IMAGE_BYTES {
                return Err(AppError::Validation(
                    "Image must be 5 MiB or smaller".to_owned(),
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        if bytes.is_empty() {
            return Err(AppError::Validation("Image cannot be empty".to_owned()));
        }
        let (mime_type, extension) = detect_image_type(&bytes)
            .ok_or_else(|| AppError::Validation("Image type is not supported".to_owned()))?;
        if declared_type
            .as_deref()
            .is_some_and(|value| value != mime_type)
        {
            return Err(AppError::Validation(
                "Image content does not match its MIME type".to_owned(),
            ));
        }
        upload = Some((original_name, bytes, mime_type, extension));
    }
    let (original_name, bytes, mime_type, extension) =
        upload.ok_or_else(|| AppError::Validation("Image file is required".to_owned()))?;
    let file_name = format!("{}.{}", Uuid::new_v4(), extension);
    let asset_path = AssetPath::parse_image(&file_name).map_err(AppError::internal)?;
    state
        .vault
        .create_image_asset(workspace_id, &asset_path, &bytes)
        .await
        .map_err(AppError::internal)?;
    Ok((
        StatusCode::CREATED,
        Json(UploadedAsset {
            reference: format!("kanleaf-asset://images/{file_name}"),
            original_name,
            mime_type,
            size: bytes.len(),
        }),
    ))
}

async fn read_image(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    path: Result<Path<(Uuid, String)>, PathRejection>,
    query: Result<Query<AssetTargetQuery>, QueryRejection>,
) -> Result<Response<Body>, AppError> {
    let Path((workspace_id, file_name)) = path.map_err(AppError::from)?;
    let Query(target) = query.map_err(AppError::from)?;
    authorize_target(&state, auth.user.id, workspace_id, &target, false).await?;
    let asset_path = AssetPath::parse_image(&file_name)
        .map_err(|_| AppError::NotFound("Asset not found".to_owned()))?;
    let bytes = state
        .vault
        .read_image_asset(workspace_id, &asset_path)
        .await
        .map_err(|_| AppError::NotFound("Asset not found".to_owned()))?;
    let (mime_type, _) = detect_image_type(&bytes)
        .ok_or_else(|| AppError::NotFound("Asset not found".to_owned()))?;
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime_type)
        .header(
            header::CACHE_CONTROL,
            "private, max-age=31536000, immutable",
        )
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(Body::from(bytes))
        .map_err(AppError::internal)
}

async fn authorize_target(
    state: &AppState,
    user_id: Uuid,
    workspace_id: Uuid,
    target: &AssetTargetQuery,
    edit: bool,
) -> Result<(), AppError> {
    match target.target_kind {
        AssetTargetKind::Task => {
            let project_id: Option<Option<Uuid>> = sqlx::query_scalar(
                "SELECT project_id FROM tasks WHERE workspace_id = $1 AND id = $2",
            )
            .bind(workspace_id)
            .bind(target.target_id)
            .fetch_optional(&state.pool)
            .await?;
            let project_id =
                project_id.ok_or_else(|| AppError::NotFound("Task not found".to_owned()))?;
            authorize_task_location(&state.pool, user_id, workspace_id, project_id, edit).await
        }
        AssetTargetKind::Document => {
            authorize_document_location(state, user_id, workspace_id, target.target_id, edit).await
        }
    }
}

fn validate_original_name(name: &str) -> Result<(), AppError> {
    if name.is_empty()
        || name.len() > 255
        || name.contains(['/', '\\'])
        || name.chars().any(char::is_control)
        || matches!(name, "." | "..")
    {
        return Err(AppError::Validation("Image filename is invalid".to_owned()));
    }
    Ok(())
}

fn detect_image_type(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("image/png", "png"))
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(("image/jpeg", "jpg"))
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(("image/gif", "gif"))
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some(("image/webp", "webp"))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::{detect_image_type, validate_original_name};

    #[test]
    fn validates_image_content_and_untrusted_original_names() {
        assert_eq!(
            detect_image_type(b"\x89PNG\r\n\x1a\nrest"),
            Some(("image/png", "png"))
        );
        assert!(detect_image_type(b"not an image").is_none());
        assert!(validate_original_name("screenshot.png").is_ok());
        assert!(validate_original_name("../../outside.png").is_err());
        assert!(validate_original_name("folder\\outside.png").is_err());
    }
}
