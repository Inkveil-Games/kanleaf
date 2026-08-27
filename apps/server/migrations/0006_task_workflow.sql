ALTER TABLE workspaces
    ADD COLUMN next_task_number BIGINT NOT NULL DEFAULT 1,
    ADD CONSTRAINT workspaces_next_task_number_positive CHECK (next_task_number > 0);

ALTER TABLE tasks
    ADD COLUMN task_number BIGINT,
    ADD COLUMN start_date DATE,
    ADD COLUMN due_date DATE,
    ADD COLUMN estimate INTEGER,
    ADD COLUMN parent_id UUID,
    ADD COLUMN position BIGINT;

WITH numbered AS (
    SELECT id, workspace_id,
           row_number() OVER (
               PARTITION BY workspace_id ORDER BY created_at, id
           ) AS task_number
    FROM tasks
)
UPDATE tasks
SET task_number = numbered.task_number,
    position = numbered.task_number * 1024
FROM numbered
WHERE tasks.id = numbered.id;

UPDATE workspaces
SET next_task_number = counters.next_task_number
FROM (
    SELECT workspace_id, max(task_number) + 1 AS next_task_number
    FROM tasks
    GROUP BY workspace_id
) AS counters
WHERE workspaces.id = counters.workspace_id;

ALTER TABLE tasks
    ALTER COLUMN task_number SET NOT NULL,
    ALTER COLUMN position SET NOT NULL,
    ADD CONSTRAINT tasks_workspace_id_unique UNIQUE (workspace_id, id),
    ADD CONSTRAINT tasks_workspace_number_unique UNIQUE (workspace_id, task_number),
    ADD CONSTRAINT tasks_number_positive CHECK (task_number > 0),
    ADD CONSTRAINT tasks_estimate_non_negative CHECK (estimate >= 0),
    ADD CONSTRAINT tasks_date_order CHECK (
        start_date IS NULL OR due_date IS NULL OR start_date <= due_date
    ),
    ADD CONSTRAINT tasks_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id),
    ADD CONSTRAINT tasks_parent_workspace_fk
        FOREIGN KEY (workspace_id, parent_id)
        REFERENCES tasks(workspace_id, id);

CREATE TABLE task_assignees (
    workspace_id UUID NOT NULL,
    task_id UUID NOT NULL,
    user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, user_id),
    CONSTRAINT task_assignees_task_fk
        FOREIGN KEY (workspace_id, task_id)
        REFERENCES tasks(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT task_assignees_workspace_member_fk
        FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE CASCADE
);

CREATE TABLE task_label_assignments (
    workspace_id UUID NOT NULL,
    task_id UUID NOT NULL,
    label_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, label_id),
    CONSTRAINT task_label_assignments_task_fk
        FOREIGN KEY (workspace_id, task_id)
        REFERENCES tasks(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT task_label_assignments_label_fk
        FOREIGN KEY (workspace_id, label_id)
        REFERENCES task_labels(workspace_id, id)
        ON DELETE CASCADE
);

CREATE TABLE task_relations (
    workspace_id UUID NOT NULL,
    task_a_id UUID NOT NULL,
    task_b_id UUID NOT NULL,
    relation_type TEXT NOT NULL,
    task_a_blocks BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, task_a_id, task_b_id),
    CONSTRAINT task_relations_task_a_fk
        FOREIGN KEY (workspace_id, task_a_id)
        REFERENCES tasks(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT task_relations_task_b_fk
        FOREIGN KEY (workspace_id, task_b_id)
        REFERENCES tasks(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT task_relations_canonical_order CHECK (task_a_id < task_b_id),
    CONSTRAINT task_relations_type CHECK (
        relation_type IN ('blocks', 'relates_to', 'duplicate')
    ),
    CONSTRAINT task_relations_direction CHECK (
        (relation_type = 'blocks' AND task_a_blocks IS NOT NULL)
        OR (relation_type <> 'blocks' AND task_a_blocks IS NULL)
    )
);

CREATE INDEX task_assignees_user_idx
    ON task_assignees(workspace_id, user_id, task_id);
CREATE INDEX task_label_assignments_label_idx
    ON task_label_assignments(workspace_id, label_id, task_id);
CREATE INDEX tasks_workspace_state_idx
    ON tasks(workspace_id, state_id, position)
    WHERE archived_at IS NULL;
CREATE INDEX tasks_workspace_type_idx
    ON tasks(workspace_id, task_type_id, position)
    WHERE archived_at IS NULL;
CREATE INDEX tasks_workspace_due_idx
    ON tasks(workspace_id, due_date, position)
    WHERE archived_at IS NULL AND due_date IS NOT NULL;
CREATE INDEX tasks_workspace_start_idx
    ON tasks(workspace_id, start_date, position)
    WHERE archived_at IS NULL AND start_date IS NOT NULL;
CREATE INDEX tasks_workspace_priority_idx
    ON tasks(workspace_id, priority, position)
    WHERE archived_at IS NULL;
CREATE INDEX tasks_parent_idx
    ON tasks(workspace_id, parent_id, position)
    WHERE archived_at IS NULL AND parent_id IS NOT NULL;

DROP INDEX tasks_workspace_inbox_idx;
CREATE INDEX tasks_workspace_inbox_idx
    ON tasks(workspace_id, position, task_number)
    WHERE project_id IS NULL AND archived_at IS NULL;

DROP INDEX tasks_project_idx;
CREATE INDEX tasks_project_idx
    ON tasks(workspace_id, project_id, position, task_number)
    WHERE archived_at IS NULL;
