LOCK TABLE task_relations IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (
        WITH RECURSIVE edges AS (
            SELECT workspace_id,
                   CASE WHEN task_a_blocks THEN task_a_id ELSE task_b_id END AS source,
                   CASE WHEN task_a_blocks THEN task_b_id ELSE task_a_id END AS target
            FROM task_relations WHERE relation_type = 'blocks'
        ), reachable(workspace_id, source, target) AS (
            SELECT workspace_id, source, target FROM edges
            UNION
            SELECT reachable.workspace_id, reachable.source, edges.target
            FROM reachable JOIN edges
              ON edges.workspace_id = reachable.workspace_id
             AND edges.source = reachable.target
        )
        SELECT 1 FROM reachable WHERE source = target
    ) THEN
        RAISE EXCEPTION 'Existing blocking relations contain a dependency cycle. Remove the cycle using Task Detail before upgrading. No relations have been changed.'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

ALTER TABLE saved_views
    DROP CONSTRAINT saved_views_layout,
    ADD CONSTRAINT saved_views_layout CHECK (
        layout IN ('list', 'board', 'calendar', 'table', 'timeline', 'graph')
    ),
    ADD COLUMN graph_settings JSONB NOT NULL DEFAULT
        '{"direction":"vertical","showParentEdges":true,"showBlockEdges":true,"showCompleted":true}',
    ADD CONSTRAINT saved_views_graph_settings CHECK (
        jsonb_typeof(graph_settings) = 'object'
        AND graph_settings -> 'direction' = '"vertical"'::jsonb
        AND jsonb_typeof(graph_settings -> 'showParentEdges') = 'boolean'
        AND jsonb_typeof(graph_settings -> 'showBlockEdges') = 'boolean'
        AND jsonb_typeof(graph_settings -> 'showCompleted') = 'boolean'
        AND graph_settings ?& ARRAY['direction', 'showParentEdges', 'showBlockEdges', 'showCompleted']
        AND graph_settings - ARRAY['direction', 'showParentEdges', 'showBlockEdges', 'showCompleted'] = '{}'
    );
