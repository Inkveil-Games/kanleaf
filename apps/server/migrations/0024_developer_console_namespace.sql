ALTER TABLE workspace_identifier_registry
    DROP CONSTRAINT workspace_identifier_registry_format,
    ADD CONSTRAINT workspace_identifier_registry_format CHECK (
        char_length(identifier) BETWEEN 2 AND 48
        AND identifier ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        AND identifier NOT IN (
            'api', 'assets', 'developer', 'forgot-password', 'host', 'reset-password', 'setup', 'w'
        )
    );

ALTER TABLE workspaces
    DROP CONSTRAINT workspaces_identifier_format,
    ADD CONSTRAINT workspaces_identifier_format CHECK (
        char_length(identifier) BETWEEN 2 AND 48
        AND identifier ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        AND identifier NOT IN (
            'api', 'assets', 'developer', 'forgot-password', 'host', 'reset-password', 'setup', 'w'
        )
    );
