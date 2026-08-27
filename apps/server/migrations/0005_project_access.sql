ALTER TABLE projects
    ADD COLUMN identifier TEXT,
    ADD COLUMN description TEXT NOT NULL DEFAULT '',
    ADD COLUMN lead_user_id UUID,
    ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private',
    ADD COLUMN default_assignee_id UUID,
    ADD COLUMN cycles_enabled BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN modules_enabled BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN pages_enabled BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN views_enabled BOOLEAN NOT NULL DEFAULT true;

WITH numbered AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY workspace_id ORDER BY created_at, id
           ) AS ordinal
    FROM projects
)
UPDATE projects
SET identifier = 'PRJ' || numbered.ordinal
FROM numbered
WHERE projects.id = numbered.id;

ALTER TABLE projects
    ALTER COLUMN identifier SET NOT NULL,
    ADD CONSTRAINT projects_workspace_identifier_unique
        UNIQUE (workspace_id, identifier),
    ADD CONSTRAINT projects_identifier_format CHECK (
        identifier ~ '^[A-Z0-9][A-Z0-9-]{1,11}$'
    ),
    ADD CONSTRAINT projects_description_length CHECK (
        char_length(description) <= 2000
    ),
    ADD CONSTRAINT projects_visibility CHECK (
        visibility IN ('private', 'open')
    ),
    ADD CONSTRAINT projects_lead_workspace_fk
        FOREIGN KEY (workspace_id, lead_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id),
    ADD CONSTRAINT projects_default_assignee_workspace_fk
        FOREIGN KEY (workspace_id, default_assignee_id)
        REFERENCES workspace_memberships(workspace_id, user_id);

CREATE TABLE project_memberships (
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id),
    CONSTRAINT project_memberships_project_fk
        FOREIGN KEY (workspace_id, project_id)
        REFERENCES projects(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT project_memberships_workspace_member_fk
        FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE CASCADE,
    CONSTRAINT project_memberships_role CHECK (
        role IN ('admin', 'contributor', 'commenter', 'viewer')
    )
);

CREATE INDEX project_memberships_user_idx
    ON project_memberships(workspace_id, user_id, project_id);
CREATE INDEX projects_workspace_visibility_idx
    ON projects(workspace_id, visibility, created_at)
    WHERE archived_at IS NULL;
