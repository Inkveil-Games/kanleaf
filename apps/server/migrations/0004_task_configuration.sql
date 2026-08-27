CREATE TABLE task_states (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    state_group TEXT NOT NULL,
    position INTEGER NOT NULL,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, id),
    CONSTRAINT task_states_name_length CHECK (
        char_length(btrim(name)) BETWEEN 1 AND 120
    ),
    CONSTRAINT task_states_color CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
    CONSTRAINT task_states_group CHECK (
        state_group IN ('backlog', 'todo', 'in_progress', 'done', 'canceled')
    ),
    CONSTRAINT task_states_position CHECK (position >= 0)
);

CREATE UNIQUE INDEX task_states_workspace_name_active_idx
    ON task_states(workspace_id, lower(name))
    WHERE archived_at IS NULL;
CREATE UNIQUE INDEX task_states_workspace_position_active_idx
    ON task_states(workspace_id, position)
    WHERE archived_at IS NULL;

CREATE TABLE task_labels (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, id),
    CONSTRAINT task_labels_name_length CHECK (
        char_length(btrim(name)) BETWEEN 1 AND 120
    ),
    CONSTRAINT task_labels_color CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
    CONSTRAINT task_labels_description_length CHECK (
        char_length(description) <= 500
    )
);

CREATE UNIQUE INDEX task_labels_workspace_name_active_idx
    ON task_labels(workspace_id, lower(name))
    WHERE archived_at IS NULL;

CREATE TABLE task_types (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL,
    is_protected BOOLEAN NOT NULL DEFAULT false,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, id),
    CONSTRAINT task_types_name_length CHECK (
        char_length(btrim(name)) BETWEEN 1 AND 120
    ),
    CONSTRAINT task_types_icon CHECK (icon ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
    CONSTRAINT task_types_color CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
    CONSTRAINT task_types_description_length CHECK (
        char_length(description) <= 500
    ),
    CONSTRAINT task_types_position CHECK (position >= 0),
    CONSTRAINT task_types_protected_active CHECK (
        NOT is_protected OR archived_at IS NULL
    )
);

CREATE UNIQUE INDEX task_types_workspace_name_active_idx
    ON task_types(workspace_id, lower(name))
    WHERE archived_at IS NULL;
CREATE UNIQUE INDEX task_types_workspace_position_active_idx
    ON task_types(workspace_id, position)
    WHERE archived_at IS NULL;
CREATE UNIQUE INDEX task_types_workspace_protected_idx
    ON task_types(workspace_id)
    WHERE is_protected;

INSERT INTO task_states (id, workspace_id, name, color, state_group, position)
SELECT gen_random_uuid(), workspaces.id, defaults.name, defaults.color,
       defaults.state_group, defaults.position
FROM workspaces
CROSS JOIN (
    VALUES
        ('Backlog', '#6B7280', 'backlog', 0),
        ('Todo', '#64748B', 'todo', 1),
        ('In Progress', '#3B82F6', 'in_progress', 2),
        ('Done', '#22A06B', 'done', 3),
        ('Canceled', '#A1A1AA', 'canceled', 4)
) AS defaults(name, color, state_group, position);

INSERT INTO task_types (
    id, workspace_id, name, icon, color, description, position, is_protected
)
SELECT gen_random_uuid(), id, 'Task', 'check-square', '#64748B',
       'General work item', 0, true
FROM workspaces;

ALTER TABLE workspaces
    ADD COLUMN default_inbox_state_id UUID,
    ADD COLUMN default_task_type_id UUID;

UPDATE workspaces
SET default_inbox_state_id = task_states.id
FROM task_states
WHERE task_states.workspace_id = workspaces.id
  AND task_states.state_group = 'todo';

UPDATE workspaces
SET default_task_type_id = task_types.id
FROM task_types
WHERE task_types.workspace_id = workspaces.id
  AND task_types.is_protected;

ALTER TABLE workspaces
    ALTER COLUMN default_inbox_state_id SET NOT NULL,
    ALTER COLUMN default_task_type_id SET NOT NULL,
    ADD CONSTRAINT workspaces_default_state_fk
        FOREIGN KEY (id, default_inbox_state_id)
        REFERENCES task_states(workspace_id, id)
        DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT workspaces_default_task_type_fk
        FOREIGN KEY (id, default_task_type_id)
        REFERENCES task_types(workspace_id, id)
        DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE projects
    ADD COLUMN default_state_id UUID,
    ADD COLUMN default_task_type_id UUID;

UPDATE projects
SET default_state_id = workspaces.default_inbox_state_id,
    default_task_type_id = workspaces.default_task_type_id
FROM workspaces
WHERE workspaces.id = projects.workspace_id;

ALTER TABLE projects
    ALTER COLUMN default_state_id SET NOT NULL,
    ALTER COLUMN default_task_type_id SET NOT NULL,
    ADD CONSTRAINT projects_default_state_fk
        FOREIGN KEY (workspace_id, default_state_id)
        REFERENCES task_states(workspace_id, id)
        DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT projects_default_task_type_fk
        FOREIGN KEY (workspace_id, default_task_type_id)
        REFERENCES task_types(workspace_id, id)
        DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE project_task_types (
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    task_type_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, task_type_id),
    CONSTRAINT project_task_types_project_fk
        FOREIGN KEY (workspace_id, project_id)
        REFERENCES projects(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT project_task_types_type_fk
        FOREIGN KEY (workspace_id, task_type_id)
        REFERENCES task_types(workspace_id, id)
        ON DELETE CASCADE
);

INSERT INTO project_task_types (workspace_id, project_id, task_type_id)
SELECT projects.workspace_id, projects.id, projects.default_task_type_id
FROM projects;

ALTER TABLE tasks
    ADD COLUMN state_id UUID,
    ADD COLUMN task_type_id UUID;

UPDATE tasks
SET state_id = task_states.id
FROM task_states
WHERE task_states.workspace_id = tasks.workspace_id
  AND task_states.state_group = CASE tasks.status
      WHEN 'todo' THEN 'todo'
      WHEN 'in_progress' THEN 'in_progress'
      WHEN 'done' THEN 'done'
  END;

UPDATE tasks
SET task_type_id = workspaces.default_task_type_id
FROM workspaces
WHERE workspaces.id = tasks.workspace_id;

ALTER TABLE tasks
    ALTER COLUMN state_id SET NOT NULL,
    ALTER COLUMN task_type_id SET NOT NULL,
    ADD CONSTRAINT tasks_state_fk
        FOREIGN KEY (workspace_id, state_id)
        REFERENCES task_states(workspace_id, id),
    ADD CONSTRAINT tasks_task_type_fk
        FOREIGN KEY (workspace_id, task_type_id)
        REFERENCES task_types(workspace_id, id),
    DROP CONSTRAINT tasks_status,
    DROP COLUMN status,
    DROP CONSTRAINT tasks_priority,
    ADD CONSTRAINT tasks_priority CHECK (
        priority IN ('none', 'low', 'medium', 'high', 'urgent')
    );

CREATE INDEX task_states_workspace_idx
    ON task_states(workspace_id, archived_at, position);
CREATE INDEX task_labels_workspace_idx
    ON task_labels(workspace_id, archived_at, lower(name));
CREATE INDEX task_types_workspace_idx
    ON task_types(workspace_id, archived_at, position);
