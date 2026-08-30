DROP TRIGGER tasks_config_projection_dirty ON tasks;

CREATE TRIGGER tasks_config_projection_dirty
AFTER INSERT OR DELETE OR UPDATE OF project_id, storage_name, archived_at, position ON tasks
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('workspace_id');

CREATE TRIGGER task_relations_config_projection_dirty
AFTER INSERT OR UPDATE OR DELETE ON task_relations
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('workspace_id');
