CREATE TABLE workspace_operations (
    id UUID PRIMARY KEY,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    state TEXT NOT NULL,
    revision UUID NOT NULL,
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    staging_key UUID,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT workspace_operations_kind_valid CHECK (
        kind IN ('vault_sync', 'workspace_export', 'workspace_import')
    ),
    CONSTRAINT workspace_operations_state_valid CHECK (
        state IN ('preparing', 'ready', 'applying', 'completed', 'failed', 'canceled')
    ),
    CONSTRAINT workspace_operations_workspace_scope_valid CHECK (
        (kind = 'workspace_import' AND workspace_id IS NULL)
        OR (kind <> 'workspace_import' AND workspace_id IS NOT NULL)
    )
);

CREATE INDEX workspace_operations_expiry_idx
    ON workspace_operations(expires_at);

CREATE INDEX workspace_operations_actor_workspace_idx
    ON workspace_operations(actor_id, workspace_id, kind, created_at DESC);
