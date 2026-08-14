mod auth;
mod project;
mod state;
mod workspace;

use std::{env, error::Error, io};

use axum::{
    Json, Router,
    extract::State,
    http::{HeaderValue, Method, header::CONTENT_TYPE},
    routing::get,
};
use serde::Serialize;
use sqlx::postgres::PgPoolOptions;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;

#[derive(Serialize)]
struct HelloResponse {
    message: &'static str,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    database: &'static str,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let address = env::var("BACKEND_ADDRESS").unwrap_or_else(|_| "127.0.0.1:3000".to_owned());
    let database_url = env::var("DATABASE_URL").map_err(|_| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "DATABASE_URL must be set to a PostgreSQL connection URL",
        )
    })?;
    let database = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;
    sqlx::migrate!("./migrations").run(&database).await?;
    let listener = TcpListener::bind(&address).await?;
    let state = state::AppState::new(database);
    let health_router = Router::new()
        .route("/api/health", get(health))
        .with_state(state.clone());
    let app = Router::new()
        .route("/api/hello", get(hello))
        .merge(health_router)
        .nest("/api/auth", auth::router(state.clone()))
        .nest("/api/workspaces", workspace::router(state.clone()))
        .merge(project::router(state))
        .layer(cors());

    println!("Backend listening on http://{address}");
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health(
    State(state): State<state::AppState>,
) -> (axum::http::StatusCode, Json<HealthResponse>) {
    match sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(state.db())
        .await
    {
        Ok(1) => (
            axum::http::StatusCode::OK,
            Json(HealthResponse {
                status: "ok",
                version: env!("CARGO_PKG_VERSION"),
                database: "ok",
            }),
        ),
        Ok(_) => (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Json(HealthResponse {
                status: "error",
                version: env!("CARGO_PKG_VERSION"),
                database: "unavailable",
            }),
        ),
        Err(error) => {
            eprintln!("Database health check failed: {error}");
            (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                Json(HealthResponse {
                    status: "error",
                    version: env!("CARGO_PKG_VERSION"),
                    database: "unavailable",
                }),
            )
        }
    }
}

async fn hello() -> Json<HelloResponse> {
    Json(HelloResponse {
        message: "Hello, world!",
    })
}

fn cors() -> CorsLayer {
    CorsLayer::new()
        .allow_origin([
            HeaderValue::from_static("http://127.0.0.1:1420"),
            HeaderValue::from_static("http://localhost:1420"),
            HeaderValue::from_static("http://tauri.localhost"),
            HeaderValue::from_static("tauri://localhost"),
        ])
        .allow_methods([Method::GET, Method::POST, Method::PATCH])
        .allow_headers([CONTENT_TYPE, axum::http::header::AUTHORIZATION])
}

#[cfg(all(test, feature = "postgres-tests"))]
mod tests {
    use super::*;

    #[sqlx::test(migrations = "./migrations")]
    async fn health_reports_database_and_package_version(pool: sqlx::PgPool) {
        let (status, Json(response)) = health(State(state::AppState::new(pool))).await;

        assert_eq!(status, axum::http::StatusCode::OK);
        assert_eq!(response.status, "ok");
        assert_eq!(response.database, "ok");
        assert_eq!(response.version, env!("CARGO_PKG_VERSION"));
    }
}
