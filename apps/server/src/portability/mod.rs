mod archive;
mod config;
mod operation;
mod sync;

use axum::Router;

use crate::AppState;

pub use archive::{recover_export_operations, spawn_export_cleanup_worker};
pub use config::{
    recover_projection_jobs as recover_config_projection_jobs,
    spawn_projection_worker as spawn_config_projection_worker,
};
pub use operation::recover_workspace_operations;

pub(crate) fn routes() -> Router<AppState> {
    sync::routes().merge(archive::routes())
}
