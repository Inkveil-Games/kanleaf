use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GraphViewSettings {
    pub direction: GraphDirection,
    pub show_parent_edges: bool,
    pub show_block_edges: bool,
    pub show_completed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum GraphDirection {
    Vertical,
}

impl Default for GraphViewSettings {
    fn default() -> Self {
        Self {
            direction: GraphDirection::Vertical,
            show_parent_edges: true,
            show_block_edges: true,
            show_completed: true,
        }
    }
}
