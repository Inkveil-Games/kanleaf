-- A repeat rule belongs to the latest Task in its series. A duplicate spawn
-- moves the row to the new Task, so earlier instances remain plain history; a
-- reset keeps the row on the same Task.
CREATE TABLE task_recurrences (
    task_id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    frequency TEXT NOT NULL,
    weekdays SMALLINT[] NOT NULL DEFAULT '{}',
    month_day SMALLINT,
    time_of_day TIME NOT NULL,
    timezone TEXT NOT NULL,
    mode TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'duplicate',
    anchor_date DATE NOT NULL,
    next_run_at TIMESTAMPTZ NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    paused_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT task_recurrences_task_fk
        FOREIGN KEY (workspace_id, task_id)
        REFERENCES tasks(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT task_recurrences_frequency
        CHECK (frequency IN ('daily', 'weekly', 'monthly')),
    CONSTRAINT task_recurrences_mode
        CHECK (mode IN ('schedule', 'after_completion')),
    CONSTRAINT task_recurrences_action
        CHECK (action IN ('duplicate', 'reset')),
    CONSTRAINT task_recurrences_weekdays CHECK (
        (frequency = 'weekly') = (cardinality(weekdays) > 0)
        AND weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[]
    ),
    CONSTRAINT task_recurrences_month_day CHECK (
        (frequency = 'monthly') = (month_day IS NOT NULL)
        AND (month_day IS NULL OR month_day BETWEEN 1 AND 31)
    ),
    CONSTRAINT task_recurrences_timezone_length CHECK (
        char_length(timezone) BETWEEN 1 AND 64
    )
);

CREATE INDEX task_recurrences_due_idx
    ON task_recurrences(next_run_at)
    WHERE paused_at IS NULL;

ALTER TABLE task_activity
    DROP CONSTRAINT task_activity_event_type,
    ADD CONSTRAINT task_activity_event_type CHECK (
        event_type IN (
            'task_created', 'task_updated', 'task_archived',
            'relation_added', 'relation_removed', 'document_updated',
            'task_repeat_reset'
        )
    );
