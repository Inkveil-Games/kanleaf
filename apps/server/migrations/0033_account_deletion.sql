ALTER TABLE saved_views
    ALTER COLUMN owner_id DROP NOT NULL,
    DROP CONSTRAINT saved_views_owner_fk,
    ADD CONSTRAINT saved_views_owner_fk
        FOREIGN KEY (workspace_id, owner_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE SET NULL (owner_id),
    ADD CONSTRAINT saved_views_personal_owner_required
        CHECK (visibility = 'shared' OR owner_id IS NOT NULL);

CREATE FUNCTION kanleaf_remove_personal_views_on_departure()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM saved_views
    WHERE workspace_id = OLD.workspace_id AND owner_id = OLD.user_id
      AND visibility = 'personal';
    RETURN OLD;
END;
$$;

CREATE TRIGGER workspace_memberships_remove_personal_views
BEFORE DELETE ON workspace_memberships
FOR EACH ROW EXECUTE FUNCTION kanleaf_remove_personal_views_on_departure();

ALTER TABLE workspace_operations
    ALTER COLUMN actor_id DROP NOT NULL,
    DROP CONSTRAINT workspace_operations_actor_id_fkey,
    ADD CONSTRAINT workspace_operations_actor_id_fkey
        FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL;
