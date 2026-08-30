use std::future::pending;

use anyhow::Context;
use kanleaf_server::{
    AppState,
    config::Config,
    document::{migrate_legacy_library, recover_library_operations},
    router,
    task::{recover_projection_jobs, spawn_projection_worker},
    workspace::migrate_workspace_vaults,
};
use sqlx::postgres::PgPoolOptions;
use tokio::signal;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    init_tracing();

    let config = Config::from_env().context("invalid server configuration")?;
    tokio::fs::create_dir_all(&config.data_dir)
        .await
        .context("failed to create KANLEAF_DATA_DIR")?;

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await
        .context("failed to connect to PostgreSQL")?;
    sqlx::migrate!()
        .run(&pool)
        .await
        .context("failed to run database migrations")?;

    let state = AppState::new(pool, config.data_dir, config.session_ttl);
    recover_library_operations(&state)
        .await
        .context("failed to recover interrupted Library operations")?;
    migrate_legacy_library(&state)
        .await
        .context("failed to migrate legacy Pages into the Library vault")?;
    migrate_workspace_vaults(&state)
        .await
        .context("failed to migrate legacy Workspace vaults")?;
    recover_projection_jobs(&state)
        .await
        .context("failed to recover pending Task property projections")?;

    let listener = tokio::net::TcpListener::bind(config.bind_address)
        .await
        .context("failed to bind server address")?;
    let address = listener.local_addr()?;
    spawn_projection_worker(state.clone());
    let app = router(state, config.cors_origins);

    info!(%address, "Kanleaf server listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server stopped unexpectedly")?;

    Ok(())
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("kanleaf_server=info,tower_http=info"));
    tracing_subscriber::fmt().with_env_filter(filter).init();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = signal::ctrl_c().await {
            warn!(%error, "failed to install Ctrl+C handler");
            pending::<()>().await;
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match signal::unix::signal(signal::unix::SignalKind::terminate()) {
            Ok(mut stream) => {
                stream.recv().await;
            }
            Err(error) => {
                warn!(%error, "failed to install SIGTERM handler");
                pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }

    info!("shutdown signal received");
}
