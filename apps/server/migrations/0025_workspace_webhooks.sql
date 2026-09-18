CREATE TABLE domain_events (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID,
    event_type TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    raw_body TEXT NOT NULL,
    UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id)
        ON DELETE SET NULL (project_id),
    CHECK (jsonb_typeof(raw_body::jsonb) = 'object')
);
CREATE INDEX domain_events_workspace_time_idx ON domain_events(workspace_id, occurred_at, id);

CREATE TABLE domain_event_outbox (
    event_id UUID NOT NULL REFERENCES domain_events(id) ON DELETE CASCADE,
    consumer TEXT NOT NULL,
    processed_at TIMESTAMPTZ,
    PRIMARY KEY (event_id, consumer)
);
CREATE INDEX domain_event_outbox_pending_idx ON domain_event_outbox(consumer, event_id)
    WHERE processed_at IS NULL;

CREATE TABLE webhooks (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    endpoint_url TEXT NOT NULL CHECK (char_length(endpoint_url) BETWEEN 1 AND 2048),
    enabled BOOLEAN NOT NULL DEFAULT true,
    enabled_since TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    project_scope TEXT NOT NULL CHECK (project_scope IN ('all', 'selected')),
    secret_nonce BYTEA NOT NULL CHECK (octet_length(secret_nonce) = 32),
    signing_key_id TEXT NOT NULL,
    secret_regenerated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, id)
);
CREATE INDEX webhooks_workspace_idx ON webhooks(workspace_id, created_at, id);

CREATE TABLE webhook_projects (
    workspace_id UUID NOT NULL,
    webhook_id UUID NOT NULL,
    project_id UUID NOT NULL,
    PRIMARY KEY (webhook_id, project_id),
    FOREIGN KEY (workspace_id, webhook_id) REFERENCES webhooks(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE webhook_event_subscriptions (
    webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'task.created', 'task.updated', 'task.deleted',
        'comment.created', 'comment.updated', 'comment.deleted'
    )),
    PRIMARY KEY (webhook_id, event_type)
);

CREATE TABLE webhook_deliveries (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    webhook_id UUID NOT NULL,
    event_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    is_test BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'canceled')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 6),
    http_status INTEGER CHECK (http_status BETWEEN 100 AND 599),
    duration_ms INTEGER CHECK (duration_ms >= 0),
    last_error TEXT,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at TIMESTAMPTZ,
    UNIQUE (webhook_id, event_id),
    FOREIGN KEY (workspace_id, webhook_id) REFERENCES webhooks(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, event_id) REFERENCES domain_events(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX webhook_deliveries_pending_idx ON webhook_deliveries(next_attempt_at, id)
    WHERE status = 'pending';
CREATE INDEX webhook_deliveries_recent_idx ON webhook_deliveries(webhook_id, created_at DESC, id);
