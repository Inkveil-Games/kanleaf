CREATE TABLE documents (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID,
    parent_id UUID,
    title TEXT NOT NULL,
    position BIGINT NOT NULL DEFAULT 0,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, id),
    CONSTRAINT documents_project_workspace_fk
        FOREIGN KEY (workspace_id, project_id)
        REFERENCES projects(workspace_id, id),
    CONSTRAINT documents_parent_workspace_fk
        FOREIGN KEY (workspace_id, parent_id)
        REFERENCES documents(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT documents_title_length CHECK (
        char_length(btrim(title)) BETWEEN 1 AND 300
    ),
    CONSTRAINT documents_position_nonnegative CHECK (position >= 0),
    CONSTRAINT documents_not_own_parent CHECK (parent_id IS DISTINCT FROM id)
);

CREATE INDEX documents_workspace_tree_idx
    ON documents(workspace_id, project_id, parent_id, position, id)
    WHERE archived_at IS NULL;

CREATE INDEX documents_parent_idx
    ON documents(workspace_id, parent_id)
    WHERE archived_at IS NULL;
