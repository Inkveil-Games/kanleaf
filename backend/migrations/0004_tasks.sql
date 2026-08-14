ALTER TABLE projects
    ADD CONSTRAINT projects_workspace_id_id_unique UNIQUE (workspace_id, id);

CREATE TABLE tasks (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID,
    title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'done')),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (workspace_id, project_id)
        REFERENCES projects (workspace_id, id)
        ON DELETE RESTRICT
);

CREATE INDEX tasks_workspace_inbox_idx
    ON tasks (workspace_id, created_at, id)
    WHERE project_id IS NULL;

CREATE INDEX tasks_workspace_project_idx
    ON tasks (workspace_id, project_id, created_at, id)
    WHERE project_id IS NOT NULL;
