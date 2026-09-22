ALTER TABLE workspaces
    ADD COLUMN state_property_description TEXT NOT NULL
        DEFAULT 'The current step of work.',
    ADD COLUMN label_property_description TEXT NOT NULL
        DEFAULT 'Shared tags used to organize work.',
    ADD CONSTRAINT workspaces_state_property_description_length CHECK (
        char_length(state_property_description) <= 500
    ),
    ADD CONSTRAINT workspaces_label_property_description_length CHECK (
        char_length(label_property_description) <= 500
    );

ALTER TABLE task_states
    ADD COLUMN icon TEXT,
    ADD COLUMN description TEXT NOT NULL DEFAULT '',
    ADD COLUMN system_role TEXT;

ALTER TABLE task_labels
    ADD COLUMN icon TEXT,
    ADD COLUMN position INTEGER;

ALTER TABLE custom_property_options
    ADD COLUMN icon TEXT,
    ADD COLUMN description TEXT NOT NULL DEFAULT '';

ALTER TABLE custom_property_definitions
    ADD COLUMN default_option_id UUID;

WITH ordered_labels AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY workspace_id
               ORDER BY lower(name), id
           ) - 1 AS position
    FROM task_labels
)
UPDATE task_labels
SET position = ordered_labels.position
FROM ordered_labels
WHERE task_labels.id = ordered_labels.id;

CREATE TEMP TABLE migrated_core_states (
    workspace_id UUID NOT NULL,
    state_id UUID NOT NULL,
    system_role TEXT NOT NULL,
    role_position INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, system_role),
    UNIQUE (workspace_id, state_id)
) ON COMMIT DROP;

INSERT INTO migrated_core_states (
    workspace_id, state_id, system_role, role_position
)
SELECT workspaces.id,
       COALESCE(candidate.id, gen_random_uuid()),
       roles.system_role,
       roles.role_position
FROM workspaces
CROSS JOIN (
    VALUES
        ('todo', 'Todo', 1),
        ('in_progress', 'In Progress', 2),
        ('done', 'Done', 3)
) AS roles(system_role, canonical_name, role_position)
LEFT JOIN LATERAL (
    SELECT task_states.id
    FROM task_states
    WHERE task_states.workspace_id = workspaces.id
      AND task_states.state_group = roles.system_role
      AND task_states.archived_at IS NULL
    ORDER BY
        (lower(task_states.name) = lower(roles.canonical_name)) DESC,
        task_states.position,
        task_states.id
    LIMIT 1
) AS candidate ON true;

INSERT INTO task_states (
    id, workspace_id, name, color, state_group, position
)
SELECT migrated_core_states.state_id,
       migrated_core_states.workspace_id,
       '__system_' || migrated_core_states.system_role || '_'
           || replace(migrated_core_states.state_id::text, '-', ''),
       CASE migrated_core_states.system_role
           WHEN 'todo' THEN '#64748B'
           WHEN 'in_progress' THEN '#3B82F6'
           WHEN 'done' THEN '#22A06B'
       END,
       migrated_core_states.system_role,
       COALESCE(existing_positions.maximum_position, -1)
           + migrated_core_states.role_position
FROM migrated_core_states
LEFT JOIN task_states
  ON task_states.workspace_id = migrated_core_states.workspace_id
 AND task_states.id = migrated_core_states.state_id
LEFT JOIN LATERAL (
    SELECT max(existing.position) AS maximum_position
    FROM task_states AS existing
    WHERE existing.workspace_id = migrated_core_states.workspace_id
      AND existing.archived_at IS NULL
) AS existing_positions ON true
WHERE task_states.id IS NULL;

UPDATE task_states
SET icon = CASE state_group
        WHEN 'backlog' THEN 'circle-dashed'
        WHEN 'todo' THEN 'circle'
        WHEN 'in_progress' THEN 'loader-circle'
        WHEN 'done' THEN 'circle-check'
        WHEN 'canceled' THEN 'circle-x'
    END
WHERE icon IS NULL;

UPDATE task_states
SET name = left(name, 91) || ' (legacy '
        || left(replace(id::text, '-', ''), 8) || ')'
WHERE archived_at IS NULL
  AND lower(name) IN ('todo', 'in progress', 'done')
  AND NOT EXISTS (
      SELECT 1
      FROM migrated_core_states
      WHERE migrated_core_states.workspace_id = task_states.workspace_id
        AND migrated_core_states.state_id = task_states.id
  );

UPDATE task_states
SET name = '__system_' || migrated_core_states.system_role || '_'
        || replace(task_states.id::text, '-', '')
FROM migrated_core_states
WHERE task_states.workspace_id = migrated_core_states.workspace_id
  AND task_states.id = migrated_core_states.state_id;

UPDATE task_states
SET name = CASE migrated_core_states.system_role
        WHEN 'todo' THEN 'Todo'
        WHEN 'in_progress' THEN 'In Progress'
        WHEN 'done' THEN 'Done'
    END,
    icon = CASE migrated_core_states.system_role
        WHEN 'todo' THEN 'circle'
        WHEN 'in_progress' THEN 'loader-circle'
        WHEN 'done' THEN 'circle-check'
    END,
    color = CASE migrated_core_states.system_role
        WHEN 'todo' THEN '#64748B'
        WHEN 'in_progress' THEN '#3B82F6'
        WHEN 'done' THEN '#22A06B'
    END,
    system_role = migrated_core_states.system_role,
    archived_at = NULL,
    updated_at = now()
FROM migrated_core_states
WHERE task_states.workspace_id = migrated_core_states.workspace_id
  AND task_states.id = migrated_core_states.state_id;

CREATE TEMP TABLE migrated_type_properties (
    workspace_id UUID PRIMARY KEY,
    property_id UUID NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO migrated_type_properties (workspace_id, property_id)
SELECT workspace_id, gen_random_uuid()
FROM task_types
GROUP BY workspace_id
HAVING count(*) FILTER (
    WHERE NOT (
        is_protected
        AND name = 'Task'
        AND archived_at IS NULL
    )
) > 0;

INSERT INTO custom_property_definitions (
    id, workspace_id, name, property_type, description, position
)
SELECT migrated_type_properties.property_id,
       migrated_type_properties.workspace_id,
       'Type',
       'single_select',
       'The kind of work this task represents.',
       COALESCE(existing_positions.maximum_position + 1, 0)
FROM migrated_type_properties
LEFT JOIN LATERAL (
    SELECT max(existing.position) AS maximum_position
    FROM custom_property_definitions AS existing
    WHERE existing.workspace_id = migrated_type_properties.workspace_id
      AND existing.archived_at IS NULL
) AS existing_positions ON true;

ALTER TABLE custom_property_options
    DROP CONSTRAINT custom_property_options_color_valid,
    ADD CONSTRAINT custom_property_options_color_valid CHECK (
        color ~ '^#[0-9A-Fa-f]{6}$'
    );

WITH ranked_types AS (
    SELECT task_types.*,
           row_number() OVER (
               PARTITION BY task_types.workspace_id, lower(task_types.name)
               ORDER BY
                   (task_types.archived_at IS NULL) DESC,
                   task_types.position,
                   task_types.id
           ) AS duplicate_ordinal
    FROM task_types
    JOIN migrated_type_properties
      ON migrated_type_properties.workspace_id = task_types.workspace_id
), normalized_types AS (
    SELECT ranked_types.*,
           ' (archived '
               || left(replace(ranked_types.id::text, '-', ''), 8)
               || ')' AS duplicate_suffix
    FROM ranked_types
)
INSERT INTO custom_property_options (
    id, workspace_id, property_id, name, color, position, archived_at,
    created_at, updated_at, icon, description
)
SELECT normalized_types.id,
       normalized_types.workspace_id,
       migrated_type_properties.property_id,
       CASE
           WHEN normalized_types.duplicate_ordinal = 1
               THEN normalized_types.name
           ELSE left(
               normalized_types.name,
               120 - char_length(normalized_types.duplicate_suffix)
           ) || normalized_types.duplicate_suffix
       END,
       normalized_types.color,
       normalized_types.position,
       normalized_types.archived_at,
       normalized_types.created_at,
       normalized_types.updated_at,
       normalized_types.icon,
       normalized_types.description
FROM normalized_types
JOIN migrated_type_properties
  ON migrated_type_properties.workspace_id = normalized_types.workspace_id;

INSERT INTO task_custom_property_values (
    workspace_id, task_id, property_id, value, created_at, updated_at
)
SELECT tasks.workspace_id,
       tasks.id,
       migrated_type_properties.property_id,
       to_jsonb(tasks.task_type_id::text),
       tasks.created_at,
       tasks.updated_at
FROM tasks
JOIN migrated_type_properties
  ON migrated_type_properties.workspace_id = tasks.workspace_id;

UPDATE custom_property_definitions
SET default_option_id = workspaces.default_task_type_id,
    updated_at = now()
FROM migrated_type_properties
JOIN workspaces
  ON workspaces.id = migrated_type_properties.workspace_id
WHERE custom_property_definitions.workspace_id = migrated_type_properties.workspace_id
  AND custom_property_definitions.id = migrated_type_properties.property_id;

INSERT INTO task_projection_jobs (
    workspace_id, task_id, metadata_version, cleanup_property_names
)
SELECT tasks.workspace_id,
       tasks.id,
       tasks.metadata_version,
       ARRAY['Type']::TEXT[]
FROM tasks
ON CONFLICT (workspace_id, task_id) DO UPDATE
SET metadata_version = greatest(
        task_projection_jobs.metadata_version,
        EXCLUDED.metadata_version
    ),
    attempts = 0,
    next_attempt_at = now(),
    last_error = NULL,
    cleanup_property_names = ARRAY(
        SELECT DISTINCT cleanup_name
        FROM unnest(
            task_projection_jobs.cleanup_property_names
                || EXCLUDED.cleanup_property_names
        ) AS cleanup_name
        ORDER BY cleanup_name
    ),
    updated_at = now();

ALTER TABLE task_labels
    ALTER COLUMN position SET NOT NULL,
    ADD CONSTRAINT task_labels_position_valid CHECK (position >= 0),
    ADD CONSTRAINT task_labels_icon_valid CHECK (
        icon IS NULL OR icon ~ '^[a-z0-9][a-z0-9_-]{0,31}$'
    );

CREATE UNIQUE INDEX task_labels_workspace_position_active_idx
    ON task_labels(workspace_id, position)
    WHERE archived_at IS NULL;

ALTER TABLE task_states
    ADD CONSTRAINT task_states_icon_valid CHECK (
        icon IS NULL OR icon ~ '^[a-z0-9][a-z0-9_-]{0,31}$'
    ),
    ADD CONSTRAINT task_states_description_valid CHECK (
        char_length(description) <= 500
    ),
    ADD CONSTRAINT task_states_system_role_valid CHECK (
        system_role IS NULL
        OR system_role IN ('todo', 'in_progress', 'done')
    ),
    ADD CONSTRAINT task_states_system_fields_valid CHECK (
        system_role IS NULL
        OR (
            archived_at IS NULL
            AND (system_role, name, icon, color) IN (
                ('todo', 'Todo', 'circle', '#64748B'),
                ('in_progress', 'In Progress', 'loader-circle', '#3B82F6'),
                ('done', 'Done', 'circle-check', '#22A06B')
            )
        )
    );

CREATE UNIQUE INDEX task_states_workspace_system_role_idx
    ON task_states(workspace_id, system_role)
    WHERE system_role IS NOT NULL;

ALTER TABLE custom_property_options
    ADD CONSTRAINT custom_property_options_icon_valid CHECK (
        icon IS NULL OR icon ~ '^[a-z0-9][a-z0-9_-]{0,31}$'
    ),
    ADD CONSTRAINT custom_property_options_description_valid CHECK (
        char_length(description) <= 500
    );

ALTER TABLE custom_property_definitions
    ADD CONSTRAINT custom_property_default_type_valid CHECK (
        default_option_id IS NULL OR property_type = 'single_select'
    ),
    ADD CONSTRAINT custom_property_default_option_fk
        FOREIGN KEY (workspace_id, id, default_option_id)
        REFERENCES custom_property_options(workspace_id, property_id, id)
        DEFERRABLE INITIALLY DEFERRED;

DROP TRIGGER workspaces_config_projection_dirty ON workspaces;
CREATE TRIGGER workspaces_config_projection_dirty
AFTER INSERT OR UPDATE OF name, accent, default_inbox_state_id,
    default_task_type_id, vault_layout_version, state_property_description,
    label_property_description
ON workspaces
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('id');
