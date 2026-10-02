CREATE TABLE custom_property_default_options (
    workspace_id UUID NOT NULL,
    property_id UUID NOT NULL,
    option_id UUID NOT NULL,
    PRIMARY KEY (workspace_id, property_id, option_id),
    FOREIGN KEY (workspace_id, property_id)
        REFERENCES custom_property_definitions(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, property_id, option_id)
        REFERENCES custom_property_options(workspace_id, property_id, id) ON DELETE CASCADE
);

CREATE TABLE workspace_default_labels (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    label_id UUID NOT NULL,
    PRIMARY KEY (workspace_id, label_id),
    FOREIGN KEY (workspace_id, label_id)
        REFERENCES task_labels(workspace_id, id) ON DELETE CASCADE
);

CREATE TRIGGER custom_property_default_options_config_projection_dirty
AFTER INSERT OR UPDATE OR DELETE ON custom_property_default_options
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('workspace_id');

CREATE TRIGGER workspace_default_labels_config_projection_dirty
AFTER INSERT OR UPDATE OR DELETE ON workspace_default_labels
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('workspace_id');

WITH changed AS (
    UPDATE workspaces SET config_version = config_version + 1
    RETURNING id, config_version
)
INSERT INTO workspace_config_projection_jobs (workspace_id, config_version)
SELECT id, config_version FROM changed
ON CONFLICT (workspace_id) DO UPDATE
SET config_version = EXCLUDED.config_version,
    attempts = 0,
    next_attempt_at = now(),
    last_error = NULL,
    updated_at = now();
