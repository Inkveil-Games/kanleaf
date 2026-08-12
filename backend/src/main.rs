use std::{env, error::Error};

use axum::{Json, Router, routing::get};
use serde::Serialize;
use tokio::net::TcpListener;

#[derive(Serialize)]
struct HelloResponse {
    message: &'static str,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let address = env::var("BACKEND_ADDRESS").unwrap_or_else(|_| "127.0.0.1:3000".to_owned());
    let listener = TcpListener::bind(&address).await?;
    let app = Router::new().route("/api/hello", get(hello));

    println!("Backend listening on http://{address}");
    axum::serve(listener, app).await?;

    Ok(())
}

async fn hello() -> Json<HelloResponse> {
    Json(HelloResponse {
        message: "Hello, world!",
    })
}
