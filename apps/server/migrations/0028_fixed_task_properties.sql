ALTER TABLE task_states
    DROP CONSTRAINT task_states_system_fields_valid,
    DROP CONSTRAINT task_states_system_role_valid;

ALTER TABLE tasks
    DROP CONSTRAINT tasks_priority;

CREATE TEMP TABLE fixed_state_ids (
    workspace_id UUID NOT NULL,
    role TEXT NOT NULL,
    state_id UUID NOT NULL,
    PRIMARY KEY (workspace_id, role),
    UNIQUE (workspace_id, state_id)
) ON COMMIT DROP;

INSERT INTO fixed_state_ids (workspace_id, role, state_id)
SELECT workspaces.id,
       roles.role,
       COALESCE(candidate.id, gen_random_uuid())
FROM workspaces
CROSS JOIN (
    VALUES
        ('backlog', 'Backlog'),
        ('todo', 'Todo'),
        ('in_progress', 'In Progress'),
        ('done', 'Done'),
        ('cancelled', 'Cancelled')
) AS roles(role, canonical_name)
LEFT JOIN LATERAL (
    SELECT task_states.id
    FROM task_states
    WHERE task_states.workspace_id = workspaces.id
      AND (
          (
              roles.role IN ('todo', 'in_progress', 'done')
              AND task_states.system_role = roles.role
          )
          OR (
              roles.role IN ('backlog', 'cancelled')
              AND task_states.archived_at IS NULL
              AND lower(task_states.name) = lower(roles.canonical_name)
          )
      )
    ORDER BY task_states.position, task_states.id
    LIMIT 1
) AS candidate ON true;

CREATE TEMP TABLE state_id_map (
    workspace_id UUID NOT NULL,
    source_id UUID NOT NULL,
    task_target_id UUID NOT NULL,
    default_target_id UUID NOT NULL,
    PRIMARY KEY (workspace_id, source_id)
) ON COMMIT DROP;

INSERT INTO state_id_map (
    workspace_id, source_id, task_target_id, default_target_id
)
SELECT task_states.workspace_id,
       task_states.id,
       COALESCE(
           selected_state.state_id,
           canonical_name_state.state_id,
           backlog_state.state_id
       ),
       COALESCE(
           selected_state.state_id,
           canonical_name_state.state_id,
           todo_state.state_id
       )
FROM task_states
JOIN fixed_state_ids AS backlog_state
  ON backlog_state.workspace_id = task_states.workspace_id
 AND backlog_state.role = 'backlog'
JOIN fixed_state_ids AS todo_state
  ON todo_state.workspace_id = task_states.workspace_id
 AND todo_state.role = 'todo'
LEFT JOIN fixed_state_ids AS selected_state
  ON selected_state.workspace_id = task_states.workspace_id
 AND selected_state.state_id = task_states.id
LEFT JOIN fixed_state_ids AS canonical_name_state
  ON canonical_name_state.workspace_id = task_states.workspace_id
 AND canonical_name_state.role = CASE
     WHEN task_states.system_role IN ('todo', 'in_progress', 'done')
         THEN task_states.system_role
     WHEN lower(task_states.name) = 'backlog' THEN 'backlog'
     WHEN lower(task_states.name) = 'todo' THEN 'todo'
     WHEN lower(task_states.name) = 'in progress' THEN 'in_progress'
     WHEN lower(task_states.name) = 'done' THEN 'done'
     WHEN lower(task_states.name) = 'cancelled' THEN 'cancelled'
     ELSE NULL
 END;

INSERT INTO task_states (
    id, workspace_id, name, icon, color, description,
    system_role, position, archived_at
)
SELECT fixed_state_ids.state_id,
       fixed_state_ids.workspace_id,
       '__fixed_' || fixed_state_ids.role || '_'
           || replace(fixed_state_ids.state_id::text, '-', ''),
       NULL,
       '#000000',
       '',
       fixed_state_ids.role,
       0,
       now()
FROM fixed_state_ids
LEFT JOIN task_states
  ON task_states.workspace_id = fixed_state_ids.workspace_id
 AND task_states.id = fixed_state_ids.state_id
WHERE task_states.id IS NULL;

UPDATE tasks
SET state_id = state_id_map.task_target_id
FROM state_id_map
WHERE tasks.workspace_id = state_id_map.workspace_id
  AND tasks.state_id = state_id_map.source_id
  AND tasks.state_id IS DISTINCT FROM state_id_map.task_target_id;

UPDATE workspaces
SET default_inbox_state_id = state_id_map.default_target_id
FROM state_id_map
WHERE workspaces.id = state_id_map.workspace_id
  AND workspaces.default_inbox_state_id = state_id_map.source_id
  AND workspaces.default_inbox_state_id
      IS DISTINCT FROM state_id_map.default_target_id;

UPDATE projects
SET default_state_id = state_id_map.default_target_id
FROM state_id_map
WHERE projects.workspace_id = state_id_map.workspace_id
  AND projects.default_state_id = state_id_map.source_id
  AND projects.default_state_id IS DISTINCT FROM state_id_map.default_target_id;

WITH normalized_state_filters AS (
    SELECT saved_views.id,
           COALESCE(
               (
                   SELECT jsonb_agg(mapped_state.state_id::text ORDER BY mapped_state.first_ordinal)
                   FROM (
                       SELECT state_id_map.task_target_id AS state_id,
                              min(requested_state.ordinality) AS first_ordinal
                       FROM jsonb_array_elements_text(
                           saved_views.query #> '{filters,states,values}'
                       ) WITH ORDINALITY AS requested_state(value, ordinality)
                       JOIN state_id_map
                         ON state_id_map.workspace_id = saved_views.workspace_id
                        AND state_id_map.source_id = requested_state.value::UUID
                       GROUP BY state_id_map.task_target_id
                   ) AS mapped_state
               ),
               '[]'::jsonb
           ) AS values
    FROM saved_views
    WHERE saved_views.query_version = 2
      AND saved_views.query #> '{filters,states,values}' IS NOT NULL
)
UPDATE saved_views
SET query = jsonb_set(
        saved_views.query,
        '{filters,states,values}',
        normalized_state_filters.values,
        true
    ),
    updated_at = now()
FROM normalized_state_filters
WHERE saved_views.id = normalized_state_filters.id;

DELETE FROM task_states
WHERE NOT EXISTS (
    SELECT 1
    FROM fixed_state_ids
    WHERE fixed_state_ids.workspace_id = task_states.workspace_id
      AND fixed_state_ids.state_id = task_states.id
);

UPDATE task_states
SET archived_at = now()
FROM fixed_state_ids
WHERE task_states.workspace_id = fixed_state_ids.workspace_id
  AND task_states.id = fixed_state_ids.state_id;

UPDATE task_states
SET name = CASE fixed_state_ids.role
        WHEN 'backlog' THEN 'Backlog'
        WHEN 'todo' THEN 'Todo'
        WHEN 'in_progress' THEN 'In Progress'
        WHEN 'done' THEN 'Done'
        WHEN 'cancelled' THEN 'Cancelled'
    END,
    color = CASE fixed_state_ids.role
        WHEN 'backlog' THEN '#727480'
        WHEN 'todo' THEN '#7A4DD1'
        WHEN 'in_progress' THEN '#296DD6'
        WHEN 'done' THEN '#2F945C'
        WHEN 'cancelled' THEN '#D63D3C'
    END,
    description = CASE fixed_state_ids.role
        WHEN 'backlog' THEN 'Ideas and unprioritized work.'
        WHEN 'todo' THEN 'Ready to be worked on.'
        WHEN 'in_progress' THEN 'Currently being worked on.'
        WHEN 'done' THEN 'Completed and ready to close.'
        WHEN 'cancelled' THEN 'Won''t be completed.'
    END,
    system_role = fixed_state_ids.role,
    position = CASE fixed_state_ids.role
        WHEN 'backlog' THEN 0
        WHEN 'todo' THEN 1
        WHEN 'in_progress' THEN 2
        WHEN 'done' THEN 3
        WHEN 'cancelled' THEN 4
    END,
    archived_at = NULL,
    updated_at = now()
FROM fixed_state_ids
WHERE task_states.workspace_id = fixed_state_ids.workspace_id
  AND task_states.id = fixed_state_ids.state_id;

UPDATE tasks
SET priority = 'critical'
WHERE priority = 'urgent';

WITH normalized_priority_filters AS (
    SELECT saved_views.id,
           COALESCE(
               (
                   SELECT jsonb_agg(
                              mapped_priority.priority
                              ORDER BY mapped_priority.first_ordinal
                          )
                   FROM (
                       SELECT CASE requested_priority.value
                                  WHEN 'urgent' THEN 'critical'
                                  ELSE requested_priority.value
                              END AS priority,
                              min(requested_priority.ordinality) AS first_ordinal
                       FROM jsonb_array_elements_text(
                           saved_views.query #> '{filters,priorities}'
                       ) WITH ORDINALITY AS requested_priority(value, ordinality)
                       GROUP BY CASE requested_priority.value
                           WHEN 'urgent' THEN 'critical'
                           ELSE requested_priority.value
                       END
                   ) AS mapped_priority
               ),
               '[]'::jsonb
           ) AS values
    FROM saved_views
    WHERE saved_views.query_version = 2
      AND saved_views.query #> '{filters,priorities}' IS NOT NULL
)
UPDATE saved_views
SET query = jsonb_set(
        saved_views.query,
        '{filters,priorities}',
        normalized_priority_filters.values,
        true
    ),
    updated_at = now()
FROM normalized_priority_filters
WHERE saved_views.id = normalized_priority_filters.id;

INSERT INTO task_projection_jobs (
    workspace_id, task_id, metadata_version
)
SELECT tasks.workspace_id, tasks.id, tasks.metadata_version
FROM tasks
ON CONFLICT (workspace_id, task_id) DO UPDATE
SET metadata_version = greatest(
        task_projection_jobs.metadata_version,
        EXCLUDED.metadata_version
    ),
    attempts = 0,
    next_attempt_at = now(),
    last_error = NULL,
    updated_at = now();

INSERT INTO workspace_config_projection_jobs (workspace_id, config_version)
SELECT workspaces.id, workspaces.config_version
FROM workspaces
ON CONFLICT (workspace_id) DO UPDATE
SET config_version = greatest(
        workspace_config_projection_jobs.config_version,
        EXCLUDED.config_version
    ),
    attempts = 0,
    next_attempt_at = now(),
    last_error = NULL,
    updated_at = now();

-- State/default foreign keys are deferred and the normalization above leaves
-- their constraint-trigger events pending until commit. Drain them before
-- changing the Task configuration table shapes.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE task_states
    DROP CONSTRAINT task_states_icon_valid,
    DROP COLUMN icon;

ALTER TABLE task_labels
    DROP CONSTRAINT task_labels_icon_valid,
    DROP COLUMN icon;

ALTER TABLE custom_property_options
    DROP CONSTRAINT custom_property_options_icon_valid,
    DROP COLUMN icon;

ALTER TABLE task_states
    ALTER COLUMN system_role SET NOT NULL,
    ADD CONSTRAINT task_states_system_role_valid CHECK (
        system_role IN ('backlog', 'todo', 'in_progress', 'done', 'cancelled')
    ),
    ADD CONSTRAINT task_states_system_fields_valid CHECK (
        archived_at IS NULL
        AND (system_role, name, color, description, position) IN (
            (
                'backlog', 'Backlog', '#727480',
                'Ideas and unprioritized work.', 0
            ),
            (
                'todo', 'Todo', '#7A4DD1',
                'Ready to be worked on.', 1
            ),
            (
                'in_progress', 'In Progress', '#296DD6',
                'Currently being worked on.', 2
            ),
            (
                'done', 'Done', '#2F945C',
                'Completed and ready to close.', 3
            ),
            (
                'cancelled', 'Cancelled', '#D63D3C',
                'Won''t be completed.', 4
            )
        )
    );

ALTER TABLE tasks
    ADD CONSTRAINT tasks_priority CHECK (
        priority IN ('none', 'low', 'medium', 'high', 'critical')
    );
