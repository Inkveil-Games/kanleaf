ALTER TABLE tasks
    ADD CONSTRAINT tasks_workspace_project_id_unique
        UNIQUE (workspace_id, project_id, id);

CREATE TABLE project_cycles (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    start_date DATE NOT NULL,
    due_date DATE NOT NULL,
    completed_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT project_cycles_workspace_project_id_unique
        UNIQUE (workspace_id, project_id, id),
    CONSTRAINT project_cycles_project_fk
        FOREIGN KEY (workspace_id, project_id)
        REFERENCES projects(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT project_cycles_name_length CHECK (
        char_length(btrim(name)) BETWEEN 1 AND 120
    ),
    CONSTRAINT project_cycles_description_length CHECK (
        char_length(description) <= 2000
    ),
    CONSTRAINT project_cycles_date_order CHECK (start_date <= due_date)
);

CREATE UNIQUE INDEX project_cycles_active_name_unique
    ON project_cycles(workspace_id, project_id, lower(name))
    WHERE archived_at IS NULL;
CREATE INDEX project_cycles_project_dates_idx
    ON project_cycles(workspace_id, project_id, start_date, due_date)
    WHERE archived_at IS NULL;

CREATE TABLE project_modules (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    lead_user_id UUID,
    status TEXT NOT NULL DEFAULT 'backlog',
    start_date DATE,
    due_date DATE,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT project_modules_workspace_project_id_unique
        UNIQUE (workspace_id, project_id, id),
    CONSTRAINT project_modules_project_fk
        FOREIGN KEY (workspace_id, project_id)
        REFERENCES projects(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT project_modules_lead_workspace_fk
        FOREIGN KEY (workspace_id, lead_user_id)
        REFERENCES workspace_memberships(workspace_id, user_id),
    CONSTRAINT project_modules_name_length CHECK (
        char_length(btrim(name)) BETWEEN 1 AND 120
    ),
    CONSTRAINT project_modules_description_length CHECK (
        char_length(description) <= 2000
    ),
    CONSTRAINT project_modules_status CHECK (
        status IN ('backlog', 'planned', 'in_progress', 'paused', 'completed', 'canceled')
    ),
    CONSTRAINT project_modules_date_order CHECK (
        start_date IS NULL OR due_date IS NULL OR start_date <= due_date
    )
);

CREATE UNIQUE INDEX project_modules_active_name_unique
    ON project_modules(workspace_id, project_id, lower(name))
    WHERE archived_at IS NULL;
CREATE INDEX project_modules_project_status_idx
    ON project_modules(workspace_id, project_id, status, created_at)
    WHERE archived_at IS NULL;

CREATE TABLE task_cycle_assignments (
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    task_id UUID PRIMARY KEY,
    cycle_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT task_cycle_assignments_task_fk
        FOREIGN KEY (workspace_id, project_id, task_id)
        REFERENCES tasks(workspace_id, project_id, id)
        ON DELETE CASCADE,
    CONSTRAINT task_cycle_assignments_cycle_fk
        FOREIGN KEY (workspace_id, project_id, cycle_id)
        REFERENCES project_cycles(workspace_id, project_id, id)
        ON DELETE CASCADE
);

CREATE INDEX task_cycle_assignments_cycle_idx
    ON task_cycle_assignments(workspace_id, project_id, cycle_id, task_id);

CREATE TABLE task_module_assignments (
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    task_id UUID NOT NULL,
    module_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, module_id),
    CONSTRAINT task_module_assignments_task_fk
        FOREIGN KEY (workspace_id, project_id, task_id)
        REFERENCES tasks(workspace_id, project_id, id)
        ON DELETE CASCADE,
    CONSTRAINT task_module_assignments_module_fk
        FOREIGN KEY (workspace_id, project_id, module_id)
        REFERENCES project_modules(workspace_id, project_id, id)
        ON DELETE CASCADE
);

CREATE INDEX task_module_assignments_module_idx
    ON task_module_assignments(workspace_id, project_id, module_id, task_id);
