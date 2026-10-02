ALTER TABLE custom_property_definitions
    ADD COLUMN default_date JSONB,
    ADD CONSTRAINT custom_property_date_default_type CHECK (
        default_date IS NULL OR (property_type = 'date' AND jsonb_typeof(default_date) = 'object')
    );

ALTER TABLE workspaces
    ADD COLUMN default_priority TEXT NOT NULL DEFAULT 'none'
        CHECK (default_priority IN ('none', 'low', 'medium', 'high', 'critical')),
    ADD COLUMN default_start_date JSONB CHECK (default_start_date IS NULL OR jsonb_typeof(default_start_date) = 'object'),
    ADD COLUMN default_due_date JSONB CHECK (default_due_date IS NULL OR jsonb_typeof(default_due_date) = 'object');

DROP TRIGGER workspaces_config_projection_dirty ON workspaces;
CREATE TRIGGER workspaces_config_projection_dirty
AFTER INSERT OR UPDATE OF name, accent, default_inbox_state_id,
    vault_layout_version, state_property_description, label_property_description,
    default_priority, default_start_date, default_due_date
ON workspaces
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('id');

WITH changed AS (
    UPDATE workspaces SET config_version = config_version + 1
    RETURNING id, config_version
)
INSERT INTO workspace_config_projection_jobs (workspace_id, config_version)
SELECT id, config_version FROM changed
ON CONFLICT (workspace_id) DO UPDATE
SET config_version = EXCLUDED.config_version,
    attempts = 0, next_attempt_at = now(), last_error = NULL, updated_at = now();
