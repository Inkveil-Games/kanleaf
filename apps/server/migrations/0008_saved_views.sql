CREATE TABLE saved_views (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    project_id UUID,
    owner_id UUID NOT NULL,
    name TEXT NOT NULL,
    visibility TEXT NOT NULL,
    query_version SMALLINT NOT NULL,
    query JSONB NOT NULL,
    layout TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT saved_views_workspace_id_unique UNIQUE (workspace_id, id),
    CONSTRAINT saved_views_workspace_fk
        FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id)
        ON DELETE CASCADE,
    CONSTRAINT saved_views_project_fk
        FOREIGN KEY (workspace_id, project_id)
        REFERENCES projects(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT saved_views_owner_fk
        FOREIGN KEY (workspace_id, owner_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE CASCADE,
    CONSTRAINT saved_views_name_length CHECK (
        char_length(btrim(name)) BETWEEN 1 AND 120
    ),
    CONSTRAINT saved_views_visibility CHECK (
        visibility IN ('personal', 'shared')
    ),
    CONSTRAINT saved_views_query_version CHECK (query_version = 1),
    CONSTRAINT saved_views_query_object CHECK (jsonb_typeof(query) = 'object'),
    CONSTRAINT saved_views_layout CHECK (
        layout IN ('list', 'board', 'calendar', 'table', 'timeline')
    )
);

CREATE UNIQUE INDEX saved_views_personal_name_unique
    ON saved_views (
        workspace_id,
        owner_id,
        COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
        lower(name)
    )
    WHERE visibility = 'personal';

CREATE UNIQUE INDEX saved_views_shared_name_unique
    ON saved_views (
        workspace_id,
        COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
        lower(name)
    )
    WHERE visibility = 'shared';

CREATE INDEX saved_views_scope_idx
    ON saved_views (workspace_id, project_id, visibility, created_at);
