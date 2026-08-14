mod auth;
mod state;
mod workspace;

use std::{env, error::Error};

use axum::{
    Json, Router,
    http::{HeaderValue, Method, header::CONTENT_TYPE},
    routing::get,
};
use serde::Serialize;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;

#[derive(Serialize)]
struct HelloResponse {
    message: &'static str,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let address = env::var("BACKEND_ADDRESS").unwrap_or_else(|_| "127.0.0.1:3000".to_owned());
    let listener = TcpListener::bind(&address).await?;
    let state = state::AppState::default();
    let app = Router::new()
        .route("/api/hello", get(hello))
        .nest("/api/auth", auth::router(state.clone()))
        .nest("/api/workspaces", workspace::router(state))
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
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([CONTENT_TYPE, axum::http::header::AUTHORIZATION])
}
