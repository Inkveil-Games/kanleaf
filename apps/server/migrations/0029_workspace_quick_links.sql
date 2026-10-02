CREATE TABLE workspace_quick_links (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT,
    url TEXT,
    project_id UUID,
    document_id UUID,
    position BIGINT NOT NULL CHECK (position >= 0),
    CONSTRAINT workspace_quick_links_project_fk
        FOREIGN KEY (workspace_id, project_id)
        REFERENCES projects(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT workspace_quick_links_document_fk
        FOREIGN KEY (workspace_id, document_id)
        REFERENCES documents(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT workspace_quick_links_target CHECK (
        (kind = 'external' AND title IS NOT NULL AND url IS NOT NULL
            AND char_length(btrim(title)) BETWEEN 1 AND 120
            AND char_length(url) BETWEEN 1 AND 2048
            AND project_id IS NULL AND document_id IS NULL)
        OR (kind = 'project' AND project_id IS NOT NULL
            AND document_id IS NULL AND title IS NULL AND url IS NULL)
        OR (kind = 'page' AND document_id IS NOT NULL
            AND project_id IS NULL AND title IS NULL AND url IS NULL)
    )
);

CREATE INDEX workspace_quick_links_order_idx
    ON workspace_quick_links(workspace_id, position, id);
CREATE INDEX workspace_quick_links_project_idx
    ON workspace_quick_links(workspace_id, project_id) WHERE project_id IS NOT NULL;
CREATE INDEX workspace_quick_links_document_idx
    ON workspace_quick_links(workspace_id, document_id) WHERE document_id IS NOT NULL;

CREATE TRIGGER workspace_quick_links_config_projection_dirty
AFTER INSERT OR UPDATE OR DELETE ON workspace_quick_links
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('workspace_id');

-- Existing vaults must receive the new portable configuration schema, too.
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
