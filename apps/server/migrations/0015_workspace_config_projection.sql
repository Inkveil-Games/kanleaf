ALTER TABLE workspaces
    ADD COLUMN config_version BIGINT NOT NULL DEFAULT 1,
    ADD COLUMN projected_config_version BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN config_projection_error TEXT,
    ADD COLUMN config_projection_attempted_at TIMESTAMPTZ,
    ADD CONSTRAINT workspaces_config_version_positive CHECK (config_version > 0),
    ADD CONSTRAINT workspaces_projected_config_version_valid CHECK (
        projected_config_version >= 0
        AND projected_config_version <= config_version
    );

CREATE TABLE workspace_config_projection_jobs (
    workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    config_version BIGINT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT workspace_config_projection_jobs_version_positive CHECK (config_version > 0),
    CONSTRAINT workspace_config_projection_jobs_attempts_nonnegative CHECK (attempts >= 0)
);

CREATE INDEX workspace_config_projection_jobs_due_idx
    ON workspace_config_projection_jobs(next_attempt_at, updated_at);

CREATE FUNCTION kanleaf_mark_workspace_config_dirty()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_workspace_id UUID;
    target_version BIGINT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        target_workspace_id := (to_jsonb(OLD) ->> TG_ARGV[0])::UUID;
    ELSE
        target_workspace_id := (to_jsonb(NEW) ->> TG_ARGV[0])::UUID;
    END IF;

    UPDATE workspaces
    SET config_version = config_version + 1
    WHERE id = target_workspace_id
    RETURNING config_version INTO target_version;

    IF target_version IS NOT NULL THEN
        INSERT INTO workspace_config_projection_jobs (workspace_id, config_version)
        VALUES (target_workspace_id, target_version)
        ON CONFLICT (workspace_id) DO UPDATE
        SET config_version = EXCLUDED.config_version,
            attempts = 0,
            next_attempt_at = now(),
            last_error = NULL,
            updated_at = now();
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION kanleaf_mark_user_workspace_configs_dirty()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    WITH changed AS (
        UPDATE workspaces
        SET config_version = config_version + 1
        FROM workspace_memberships
        WHERE workspace_memberships.workspace_id = workspaces.id
          AND workspace_memberships.user_id = NEW.id
        RETURNING workspaces.id, workspaces.config_version
    )
    INSERT INTO workspace_config_projection_jobs (workspace_id, config_version)
    SELECT id, config_version FROM changed
    ON CONFLICT (workspace_id) DO UPDATE
    SET config_version = EXCLUDED.config_version,
        attempts = 0,
        next_attempt_at = now(),
        last_error = NULL,
        updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER workspaces_config_projection_dirty
AFTER INSERT OR UPDATE OF name, accent, default_inbox_state_id,
    default_task_type_id, vault_layout_version
ON workspaces
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('id');

CREATE TRIGGER users_config_projection_dirty
AFTER UPDATE OF email, display_name ON users
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_user_workspace_configs_dirty();

CREATE TRIGGER workspace_memberships_config_projection_dirty
AFTER INSERT OR UPDATE OR DELETE ON workspace_memberships
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('workspace_id');

CREATE TRIGGER projects_config_projection_dirty
AFTER INSERT OR UPDATE OR DELETE ON projects
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('workspace_id');

CREATE TRIGGER project_memberships_config_projection_dirty
AFTER INSERT OR UPDATE OR DELETE ON project_memberships
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('workspace_id');

CREATE TRIGGER task_states_config_projection_dirty
AFTER INSERT OR UPDATE OR DELETE ON task_states
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('workspace_id');

CREATE TRIGGER task_labels_config_projection_dirty
AFTER INSERT OR UPDATE OR DELETE ON task_labels
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('workspace_id');

CREATE TRIGGER task_types_config_projection_dirty
AFTER INSERT OR UPDATE OR DELETE ON task_types
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('workspace_id');

CREATE TRIGGER project_task_types_config_projection_dirty
AFTER INSERT OR UPDATE OR DELETE ON project_task_types
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('workspace_id');

CREATE TRIGGER project_cycles_config_projection_dirty
AFTER INSERT OR UPDATE OR DELETE ON project_cycles
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('workspace_id');

CREATE TRIGGER project_modules_config_projection_dirty
AFTER INSERT OR UPDATE OR DELETE ON project_modules
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('workspace_id');

CREATE TRIGGER saved_views_config_projection_dirty
AFTER INSERT OR UPDATE OR DELETE ON saved_views
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('workspace_id');

CREATE TRIGGER tasks_config_projection_dirty
AFTER INSERT OR DELETE OR UPDATE OF project_id, storage_name, archived_at ON tasks
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('workspace_id');

CREATE TRIGGER documents_config_projection_dirty
AFTER INSERT OR UPDATE OR DELETE ON documents
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('workspace_id');

INSERT INTO workspace_config_projection_jobs (workspace_id, config_version)
SELECT id, config_version FROM workspaces;
