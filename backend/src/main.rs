mod auth;
mod project;
mod state;
mod workspace;

use std::{env, error::Error, io};

use axum::{
    Json, Router,
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
    let app = Router::new()
        .route("/api/hello", get(hello))
        .nest("/api/auth", auth::router(state.clone()))
        .nest("/api/workspaces", workspace::router(state.clone()))
        .merge(project::router(state))
        .layer(cors());

    println!("Backend listening on http://{address}");
    axum::serve(listener, app).await?;

    Ok(())
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
