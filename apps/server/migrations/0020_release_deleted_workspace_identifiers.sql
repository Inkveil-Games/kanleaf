DELETE FROM workspace_identifier_registry AS identifiers
WHERE identifiers.retired_at IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM workspaces
      WHERE workspaces.id = identifiers.workspace_id
  );
