ALTER TABLE tasks
    ADD COLUMN metadata_version BIGINT NOT NULL DEFAULT 1,
    ADD COLUMN projected_metadata_version BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN projection_error TEXT,
    ADD COLUMN projection_attempted_at TIMESTAMPTZ,
    ADD CONSTRAINT tasks_metadata_version_positive CHECK (metadata_version > 0),
    ADD CONSTRAINT tasks_projected_metadata_version_valid CHECK (
        projected_metadata_version >= 0
        AND projected_metadata_version <= metadata_version
    );

CREATE TABLE task_projection_jobs (
    workspace_id UUID NOT NULL,
    task_id UUID NOT NULL,
    metadata_version BIGINT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, task_id),
    CONSTRAINT task_projection_jobs_task_fk
        FOREIGN KEY (workspace_id, task_id)
        REFERENCES tasks(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT task_projection_jobs_metadata_version_positive CHECK (metadata_version > 0),
    CONSTRAINT task_projection_jobs_attempts_nonnegative CHECK (attempts >= 0)
);

CREATE INDEX task_projection_jobs_due_idx
    ON task_projection_jobs(next_attempt_at, updated_at);

INSERT INTO task_projection_jobs (workspace_id, task_id, metadata_version)
SELECT workspace_id, id, metadata_version
FROM tasks;
