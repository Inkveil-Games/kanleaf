ALTER TABLE workspaces
    DROP CONSTRAINT workspaces_vault_layout_version_supported;

ALTER TABLE workspaces
    ALTER COLUMN vault_layout_version SET DEFAULT 3,
    ADD CONSTRAINT workspaces_vault_layout_version_supported CHECK (
        vault_layout_version IN (0, 2, 3)
    );
