ALTER TABLE saved_views
    DROP CONSTRAINT saved_views_query_version;

WITH mapped_groupings AS (
    SELECT id,
           query,
           CASE query #>> '{grouping,primary}'
               WHEN 'task_type' THEN NULL
               WHEN 'state_group' THEN 'state'
               ELSE query #>> '{grouping,primary}'
           END AS mapped_primary,
           CASE query #>> '{grouping,secondary}'
               WHEN 'task_type' THEN NULL
               WHEN 'state_group' THEN 'state'
               ELSE query #>> '{grouping,secondary}'
           END AS mapped_secondary
    FROM saved_views
), normalized_views AS (
    SELECT saved_views.id,
           saved_views.query,
           COALESCE(
               (
                   SELECT jsonb_agg(state_id ORDER BY state_id)
                   FROM (
                       SELECT DISTINCT existing_state.value AS state_id
                       FROM jsonb_array_elements_text(
                           COALESCE(
                               saved_views.query #> '{filters,states,values}',
                               '[]'::jsonb
                           )
                       ) AS existing_state(value)
                       UNION
                       SELECT task_states.id::text
                       FROM jsonb_array_elements_text(
                           COALESCE(
                               saved_views.query #> '{filters,state_groups}',
                               '[]'::jsonb
                           )
                       ) AS requested_group(value)
                       JOIN task_states
                         ON task_states.workspace_id = saved_views.workspace_id
                        AND task_states.state_group = requested_group.value
                   ) AS migrated_states
               ),
               '[]'::jsonb
           ) AS state_ids,
           CASE
               WHEN mapped_groupings.mapped_primary IS NOT NULL
                   THEN mapped_groupings.mapped_primary
               ELSE mapped_groupings.mapped_secondary
           END AS primary_grouping,
           CASE
               WHEN mapped_groupings.mapped_primary IS NOT NULL
                AND mapped_groupings.mapped_secondary IS NOT NULL
                AND mapped_groupings.mapped_primary
                    <> mapped_groupings.mapped_secondary
                   THEN mapped_groupings.mapped_secondary
               ELSE NULL
           END AS secondary_grouping,
           COALESCE(
               (
                   SELECT jsonb_agg(display_value ORDER BY first_ordinal)
                   FROM (
                       SELECT mapped.value AS display_value,
                              min(display.ordinality) AS first_ordinal
                       FROM jsonb_array_elements_text(
                           COALESCE(saved_views.query -> 'display', '[]'::jsonb)
                       ) WITH ORDINALITY AS display(value, ordinality)
                       CROSS JOIN LATERAL (
                           SELECT CASE display.value
                               WHEN 'task_type' THEN NULL
                               WHEN 'state_group' THEN 'state'
                               ELSE display.value
                           END AS value
                       ) AS mapped
                       WHERE mapped.value IS NOT NULL
                       GROUP BY mapped.value
                   ) AS migrated_display
               ),
               '[]'::jsonb
           ) AS display
    FROM saved_views
    JOIN mapped_groupings ON mapped_groupings.id = saved_views.id
)
UPDATE saved_views
SET query_version = 2,
    query = normalized_views.query || jsonb_build_object(
        'version', 2,
        'filters', (
            COALESCE(normalized_views.query -> 'filters', '{}'::jsonb)
                - 'state_groups'
                - 'task_types'
        ) || jsonb_build_object(
            'states', jsonb_build_object(
                'values', normalized_views.state_ids,
                'include_none', false
            )
        ),
        'grouping', jsonb_build_object(
            'primary', normalized_views.primary_grouping,
            'secondary', normalized_views.secondary_grouping
        ),
        'display', normalized_views.display
    ),
    updated_at = now()
FROM normalized_views
WHERE saved_views.id = normalized_views.id;

ALTER TABLE saved_views
    ADD CONSTRAINT saved_views_query_version CHECK (query_version = 2);

DROP TRIGGER workspaces_config_projection_dirty ON workspaces;
CREATE TRIGGER workspaces_config_projection_dirty
AFTER INSERT OR UPDATE OF name, accent, default_inbox_state_id,
    vault_layout_version, state_property_description,
    label_property_description
ON workspaces
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('id');

ALTER TABLE tasks
    DROP CONSTRAINT tasks_task_type_fk,
    DROP COLUMN task_type_id;

ALTER TABLE projects
    DROP CONSTRAINT projects_default_task_type_fk,
    DROP COLUMN default_task_type_id;

ALTER TABLE workspaces
    DROP CONSTRAINT workspaces_default_task_type_fk,
    DROP COLUMN default_task_type_id;

DROP TABLE project_task_types;
DROP TABLE task_types;

ALTER TABLE task_states
    DROP CONSTRAINT task_states_group,
    DROP COLUMN state_group;
