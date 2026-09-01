use std::path::PathBuf;

use axum::{
    Json, Router,
    extract::DefaultBodyLimit,
    http::{HeaderName, HeaderValue, Method, StatusCode, header},
    middleware,
    response::Response,
    routing::{any, get},
};
use serde::Serialize;
use tower_http::{
    cors::CorsLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};

use crate::{
    AppState, account, auth, collaboration, error::AppError, host, portability, workspace,
};

static REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");
const IMMUTABLE_ASSET_CACHE: &str = "public, max-age=31536000, immutable";

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    version: &'static str,
}

pub fn router(state: AppState, allowed_origins: Vec<HeaderValue>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(allowed_origins)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);

    Router::new()
        .route("/api/health", get(health))
        .nest("/api/auth", auth::routes())
        .route("/api/session", get(auth::session))
        .merge(host::routes())
        .merge(account::routes())
        .merge(collaboration::routes())
        .merge(portability::routes())
        .merge(workspace::routes())
        .route("/api", any(api_not_found))
        .route("/api/{*path}", any(api_not_found))
        .with_state(state)
        .layer(DefaultBodyLimit::max(8 * 1024 * 1024))
        .layer(PropagateRequestIdLayer::new(REQUEST_ID_HEADER.clone()))
        .layer(TraceLayer::new_for_http())
        .layer(SetRequestIdLayer::new(
            REQUEST_ID_HEADER.clone(),
            MakeRequestUuid,
        ))
        .layer(cors)
}

pub fn router_with_web_client(
    state: AppState,
    allowed_origins: Vec<HeaderValue>,
    web_dir: PathBuf,
) -> Router {
    let assets = Router::new()
        .nest_service("/assets", ServeDir::new(web_dir.join("assets")))
        .layer(middleware::map_response(cache_asset_response));
    let index = ServeFile::new(web_dir.join("index.html"));
    let web_files = Router::new()
        .fallback_service(ServeDir::new(web_dir).fallback(index))
        .layer(middleware::map_response(revalidate_web_response));

    router(state, allowed_origins)
        .merge(assets)
        .fallback_service(web_files)
}

async fn api_not_found() -> AppError {
    AppError::NotFound("API endpoint not found".to_owned())
}

async fn cache_asset_response(mut response: Response) -> Response {
    if response.status().is_success() {
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static(IMMUTABLE_ASSET_CACHE),
        );
    }
    response
}

async fn revalidate_web_response(mut response: Response) -> Response {
    if response.status().is_success() || response.status() == StatusCode::NOT_MODIFIED {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    }
    response
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "kanleaf",
        version: env!("CARGO_PKG_VERSION"),
    })
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf, time::Duration};

    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode, header},
    };
    use http::HeaderValue;
    use serde_json::Value;
    use sqlx::postgres::PgPoolOptions;
    use tempfile::TempDir;
    use tower::ServiceExt;

    use super::IMMUTABLE_ASSET_CACHE;
    use crate::{AppState, router, router_with_web_client};

    fn state() -> AppState {
        let pool = PgPoolOptions::new()
            .connect_lazy("postgres://kanleaf@127.0.0.1/kanleaf")
            .unwrap();
        AppState::new(pool, PathBuf::from("test-data"), Duration::from_secs(60))
    }

    fn allowed_origins() -> Vec<HeaderValue> {
        vec![HeaderValue::from_static("http://127.0.0.1:1420")]
    }

    #[tokio::test]
    async fn reports_service_health_without_exposing_internals() {
        let app = router(state(), allowed_origins());

        let response = app
            .oneshot(Request::get("/api/health").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.headers().contains_key("x-request-id"));
        let body = to_bytes(response.into_body(), 4096).await.unwrap();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["status"], "ok");
        assert_eq!(payload["service"], "kanleaf");
        assert!(payload.get("database_url").is_none());
    }

    #[tokio::test]
    async fn returns_json_for_unknown_api_routes() {
        let response = router(state(), allowed_origins())
            .oneshot(
                Request::get("/api/does-not-exist")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/json"
        );
        let body = to_bytes(response.into_body(), 4096).await.unwrap();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["error"]["code"], "not_found");
    }

    #[tokio::test]
    async fn remains_api_only_without_a_web_directory() {
        let response = router(state(), allowed_origins())
            .oneshot(Request::get("/").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn serves_static_assets_and_spa_routes() {
        let web_dir = TempDir::new().unwrap();
        fs::create_dir(web_dir.path().join("assets")).unwrap();
        fs::write(
            web_dir.path().join("index.html"),
            "<!doctype html><main>Kanleaf browser client</main>",
        )
        .unwrap();
        fs::write(
            web_dir.path().join("assets").join("app-123.js"),
            "window.KANLEAF = true;",
        )
        .unwrap();
        let app = router_with_web_client(state(), allowed_origins(), web_dir.path().to_owned());

        let spa_response = app
            .clone()
            .oneshot(Request::get("/host").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(spa_response.status(), StatusCode::OK);
        assert_eq!(
            spa_response.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-cache"
        );
        let last_modified = spa_response
            .headers()
            .get(header::LAST_MODIFIED)
            .unwrap()
            .clone();
        assert!(
            String::from_utf8(
                to_bytes(spa_response.into_body(), 4096)
                    .await
                    .unwrap()
                    .to_vec()
            )
            .unwrap()
            .contains("Kanleaf browser client")
        );

        let not_modified_response = app
            .clone()
            .oneshot(
                Request::get("/host")
                    .header(header::IF_MODIFIED_SINCE, last_modified)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(not_modified_response.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(
            not_modified_response
                .headers()
                .get(header::CACHE_CONTROL)
                .unwrap(),
            "no-cache"
        );

        for path in [
            "/host/access",
            "/w/01994e1e-66dd-7d58-8274-a9a428aadf2f/projects/01994e1e-6d47-7ac2-8b28-433a93632680/cycles/01994e1e-7293-7299-9d4d-03d444a80bc9",
        ] {
            let deep_link_response = app
                .clone()
                .oneshot(Request::get(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(deep_link_response.status(), StatusCode::OK, "{path}");
            assert_eq!(
                deep_link_response
                    .headers()
                    .get(header::CACHE_CONTROL)
                    .unwrap(),
                "no-cache",
                "{path}"
            );
            assert!(
                String::from_utf8(
                    to_bytes(deep_link_response.into_body(), 4096)
                        .await
                        .unwrap()
                        .to_vec()
                )
                .unwrap()
                .contains("Kanleaf browser client"),
                "{path}"
            );
        }

        let asset_response = app
            .clone()
            .oneshot(
                Request::get("/assets/app-123.js")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(asset_response.status(), StatusCode::OK);
        assert_eq!(
            asset_response.headers().get(header::CACHE_CONTROL).unwrap(),
            IMMUTABLE_ASSET_CACHE
        );

        let missing_asset_response = app
            .oneshot(
                Request::get("/assets/missing.js")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing_asset_response.status(), StatusCode::NOT_FOUND);
    }
}
