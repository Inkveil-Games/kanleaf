DROP INDEX projects_workspace_name_active_idx;

ALTER TABLE projects
    DROP CONSTRAINT projects_workspace_identifier_unique,
    DROP CONSTRAINT projects_identifier_format,
    DROP CONSTRAINT projects_visibility;

DO $$
DECLARE
    project_row RECORD;
    base_identifier TEXT;
    candidate TEXT;
    ordinal INTEGER;
BEGIN
    FOR project_row IN
        SELECT id, workspace_id, name
        FROM projects
        ORDER BY workspace_id, created_at, id
    LOOP
        base_identifier := trim(BOTH '-' FROM regexp_replace(
            regexp_replace(
                normalize(replace(lower(project_row.name), 'đ', 'd'), NFKD),
                U&'[\0300-\036f]',
                '',
                'g'
            ),
            '[^a-z0-9]+',
            '-',
            'g'
        ));
        IF char_length(base_identifier) < 2 THEN
            base_identifier := 'project';
        END IF;
        base_identifier := trim(TRAILING '-' FROM left(base_identifier, 48));
        IF char_length(base_identifier) < 2 THEN
            base_identifier := 'project';
        END IF;
        candidate := base_identifier;
        ordinal := 2;
        WHILE EXISTS (
            SELECT 1
            FROM projects
            WHERE workspace_id = project_row.workspace_id
              AND id <> project_row.id
              AND identifier = candidate
        ) LOOP
            candidate := trim(TRAILING '-' FROM left(
                base_identifier,
                48 - char_length(ordinal::TEXT) - 1
            )) || '-' || ordinal;
            ordinal := ordinal + 1;
        END LOOP;
        UPDATE projects SET identifier = candidate WHERE id = project_row.id;
    END LOOP;
END
$$;

UPDATE projects SET visibility = 'public' WHERE visibility = 'open';

-- Earlier migrations install deferred tenant constraints and projection
-- triggers on Projects. Drain those events before changing the table shape.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE projects
    ADD COLUMN icon TEXT NOT NULL DEFAULT 'folder',
    ADD CONSTRAINT projects_workspace_identifier_unique
        UNIQUE (workspace_id, identifier),
    ADD CONSTRAINT projects_identifier_format CHECK (
        char_length(identifier) BETWEEN 2 AND 48
        AND identifier ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ),
    ADD CONSTRAINT projects_visibility CHECK (
        visibility IN ('private', 'public')
    ),
    ADD CONSTRAINT projects_icon CHECK (
        icon IN (
            'folder', 'rocket', 'target', 'flag', 'bug', 'lightbulb',
            'briefcase-business', 'code-2', 'palette', 'megaphone',
            'chart-no-axes-combined', 'boxes', 'compass', 'globe-2',
            'heart', 'star', 'zap', 'layout-dashboard', 'list-checks',
            'calendar-days', 'clipboard-check', 'git-branch', 'database',
            'terminal', 'shield-check', 'wrench', 'cpu', 'brush',
            'pen-tool', 'camera', 'sparkles'
        )
    );

UPDATE tasks SET metadata_version = metadata_version + 1;

INSERT INTO task_projection_jobs (workspace_id, task_id, metadata_version)
SELECT workspace_id, id, metadata_version
FROM tasks
ON CONFLICT (workspace_id, task_id) DO UPDATE
SET metadata_version = EXCLUDED.metadata_version,
    attempts = 0,
    next_attempt_at = now(),
    last_error = NULL,
    updated_at = now();
