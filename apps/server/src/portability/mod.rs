mod operation;
mod sync;

use axum::Router;

use crate::AppState;

pub use operation::recover_workspace_operations;

pub(crate) fn routes() -> Router<AppState> {
    sync::routes()
}
