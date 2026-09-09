CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    consumed_at TIMESTAMPTZ,
    CONSTRAINT password_reset_tokens_hash_length
        CHECK (octet_length(token_hash) = 32)
);

CREATE INDEX password_reset_tokens_user_idx
    ON password_reset_tokens(user_id);

CREATE INDEX password_reset_tokens_expiry_idx
    ON password_reset_tokens(expires_at);

ALTER TABLE workspace_identifier_registry
    DROP CONSTRAINT workspace_identifier_registry_format,
    ADD CONSTRAINT workspace_identifier_registry_format CHECK (
        char_length(identifier) BETWEEN 2 AND 48
        AND identifier ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        AND identifier NOT IN (
            'api', 'assets', 'forgot-password', 'host', 'reset-password', 'setup', 'w'
        )
    );

ALTER TABLE workspaces
    DROP CONSTRAINT workspaces_identifier_format,
    ADD CONSTRAINT workspaces_identifier_format CHECK (
        char_length(identifier) BETWEEN 2 AND 48
        AND identifier ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        AND identifier NOT IN (
            'api', 'assets', 'forgot-password', 'host', 'reset-password', 'setup', 'w'
        )
    );
