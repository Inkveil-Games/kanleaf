CREATE TABLE users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    active_workspace_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_email_normalized CHECK (
        email = lower(btrim(email))
        AND char_length(email) BETWEEN 3 AND 320
    )
);

CREATE TABLE workspaces (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT workspaces_name_length CHECK (
        char_length(btrim(name)) BETWEEN 1 AND 120
    )
);

CREATE TABLE workspace_memberships (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id),
    CONSTRAINT workspace_memberships_role CHECK (role IN ('owner', 'member'))
);

ALTER TABLE users
    ADD CONSTRAINT users_active_workspace_fk
    FOREIGN KEY (active_workspace_id)
    REFERENCES workspaces(id)
    ON DELETE SET NULL;

CREATE INDEX workspace_memberships_user_idx
    ON workspace_memberships(user_id);

CREATE TABLE sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sessions_token_hash_length CHECK (octet_length(token_hash) = 32)
);

CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE projects (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, id),
    CONSTRAINT projects_name_length CHECK (
        char_length(btrim(name)) BETWEEN 1 AND 120
    )
);

CREATE UNIQUE INDEX projects_workspace_name_active_idx
    ON projects(workspace_id, lower(name))
    WHERE archived_at IS NULL;

CREATE INDEX projects_workspace_idx
    ON projects(workspace_id, created_at);

CREATE TABLE tasks (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'none',
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tasks_project_workspace_fk
        FOREIGN KEY (workspace_id, project_id)
        REFERENCES projects(workspace_id, id),
    CONSTRAINT tasks_title_length CHECK (
        char_length(btrim(title)) BETWEEN 1 AND 300
    ),
    CONSTRAINT tasks_status CHECK (status IN ('todo', 'in_progress', 'done')),
    CONSTRAINT tasks_priority CHECK (priority IN ('none', 'low', 'medium', 'high'))
);

CREATE INDEX tasks_workspace_inbox_idx
    ON tasks(workspace_id, updated_at DESC)
    WHERE project_id IS NULL AND archived_at IS NULL;

CREATE INDEX tasks_project_idx
    ON tasks(workspace_id, project_id, updated_at DESC)
    WHERE archived_at IS NULL;

CREATE INDEX tasks_workspace_title_search_idx
    ON tasks(workspace_id, lower(title))
    WHERE archived_at IS NULL;
