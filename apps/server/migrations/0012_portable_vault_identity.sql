ALTER TABLE workspaces
    ADD COLUMN vault_layout_version SMALLINT NOT NULL DEFAULT 0,
    ADD CONSTRAINT workspaces_vault_layout_version_supported CHECK (
        vault_layout_version IN (0, 2)
    );

ALTER TABLE projects
    ADD COLUMN storage_name TEXT;

ALTER TABLE tasks
    ADD COLUMN storage_name TEXT;

CREATE FUNCTION kanleaf_migration_vault_storage_name(initial_name TEXT, resource_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
    stem TEXT := trim(BOTH '-' FROM regexp_replace(lower(btrim(initial_name)), '[^[:alnum:]]+', '-', 'g'));
    suffix TEXT := '--' || left(replace(resource_id::text, '-', ''), 6);
BEGIN
    IF stem = '' THEN
        stem := 'item';
    END IF;
    WHILE octet_length(stem) + octet_length(suffix) > 120 LOOP
        stem := left(stem, char_length(stem) - 1);
    END LOOP;
    stem := trim(TRAILING '-' FROM stem);
    IF stem = '' THEN
        stem := 'item';
    END IF;
    RETURN stem || suffix;
END;
$$;

UPDATE projects
SET storage_name = kanleaf_migration_vault_storage_name(name, id);

UPDATE tasks
SET storage_name = kanleaf_migration_vault_storage_name(title, id);

DROP FUNCTION kanleaf_migration_vault_storage_name(TEXT, UUID);

ALTER TABLE projects
    ALTER COLUMN storage_name SET NOT NULL,
    ADD CONSTRAINT projects_storage_name_portable CHECK (
        octet_length(storage_name) BETWEEN 9 AND 120
        AND storage_name = lower(storage_name)
        AND storage_name ~ '^[[:alnum:]]+(-[[:alnum:]]+)*--[0-9a-f]{6}$'
    ),
    ADD CONSTRAINT projects_storage_name_unique UNIQUE (workspace_id, storage_name);

ALTER TABLE tasks
    ALTER COLUMN storage_name SET NOT NULL,
    ADD CONSTRAINT tasks_storage_name_portable CHECK (
        octet_length(storage_name) BETWEEN 9 AND 120
        AND storage_name = lower(storage_name)
        AND storage_name ~ '^[[:alnum:]]+(-[[:alnum:]]+)*--[0-9a-f]{6}$'
    ),
    ADD CONSTRAINT tasks_storage_name_unique UNIQUE (workspace_id, storage_name);
