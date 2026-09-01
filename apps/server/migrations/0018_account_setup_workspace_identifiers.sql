ALTER TABLE users
    ADD COLUMN setup_stage TEXT NOT NULL DEFAULT 'complete';

ALTER TABLE users
    ALTER COLUMN setup_stage SET DEFAULT 'account',
    ADD CONSTRAINT users_setup_stage CHECK (
        setup_stage IN ('account', 'workspace', 'invite', 'complete')
    );

CREATE TABLE workspace_identifier_registry (
    identifier TEXT PRIMARY KEY,
    workspace_id UUID NOT NULL UNIQUE,
    retired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT workspace_identifier_registry_format CHECK (
        char_length(identifier) BETWEEN 2 AND 48
        AND identifier ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        AND identifier NOT IN ('api', 'assets', 'host', 'setup', 'w')
    ),
    CONSTRAINT workspace_identifier_registry_pair UNIQUE (identifier, workspace_id)
);

ALTER TABLE workspaces
    ADD COLUMN identifier TEXT;

WITH normalized AS (
    SELECT id,
           btrim(regexp_replace(lower(btrim(name)), '[^a-z0-9]+', '-', 'g'), '-') AS base
    FROM workspaces
), candidates AS (
    SELECT id,
           COALESCE(NULLIF(btrim(left(base, 15), '-'), ''), 'workspace')
               || '-' || replace(id::text, '-', '') AS identifier
    FROM normalized
)
UPDATE workspaces
SET identifier = candidates.identifier
FROM candidates
WHERE workspaces.id = candidates.id;

INSERT INTO workspace_identifier_registry (identifier, workspace_id)
SELECT identifier, id
FROM workspaces;

ALTER TABLE workspaces
    ALTER COLUMN identifier SET NOT NULL,
    ADD CONSTRAINT workspaces_identifier_unique UNIQUE (identifier),
    ADD CONSTRAINT workspaces_identifier_format CHECK (
        char_length(identifier) BETWEEN 2 AND 48
        AND identifier ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        AND identifier NOT IN ('api', 'assets', 'host', 'setup', 'w')
    ),
    ADD CONSTRAINT workspaces_identifier_registry_fk
        FOREIGN KEY (identifier, id)
        REFERENCES workspace_identifier_registry(identifier, workspace_id)
        DEFERRABLE INITIALLY DEFERRED;
