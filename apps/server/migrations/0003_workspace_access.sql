ALTER TABLE workspaces
    ADD COLUMN accent TEXT NOT NULL DEFAULT 'sage',
    ADD CONSTRAINT workspaces_accent CHECK (
        accent IN ('sage', 'blue', 'amber', 'rose', 'violet', 'slate')
    );

ALTER TABLE workspace_memberships
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    DROP CONSTRAINT workspace_memberships_role,
    ADD CONSTRAINT workspace_memberships_role CHECK (
        role IN ('owner', 'admin', 'member', 'guest')
    );

CREATE UNIQUE INDEX workspace_memberships_single_owner_idx
    ON workspace_memberships(workspace_id)
    WHERE role = 'owner';

CREATE TABLE workspace_invitations (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    token_hash BYTEA NOT NULL UNIQUE,
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    declined_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, id),
    CONSTRAINT workspace_invitations_email_normalized CHECK (
        email = lower(btrim(email))
        AND char_length(email) BETWEEN 3 AND 320
    ),
    CONSTRAINT workspace_invitations_role CHECK (
        role IN ('admin', 'member', 'guest')
    ),
    CONSTRAINT workspace_invitations_token_hash_length CHECK (
        octet_length(token_hash) = 32
    ),
    CONSTRAINT workspace_invitations_expiry CHECK (
        expires_at > created_at
    ),
    CONSTRAINT workspace_invitations_single_resolution CHECK (
        num_nonnulls(accepted_at, declined_at, revoked_at) <= 1
    )
);

CREATE UNIQUE INDEX workspace_invitations_pending_email_idx
    ON workspace_invitations(workspace_id, email)
    WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;

CREATE INDEX workspace_invitations_email_idx
    ON workspace_invitations(email, created_at DESC);

CREATE INDEX workspace_invitations_workspace_idx
    ON workspace_invitations(workspace_id, created_at DESC);
