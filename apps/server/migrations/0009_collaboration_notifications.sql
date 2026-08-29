ALTER TABLE users
    ADD COLUMN notify_comments BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN notify_metadata BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE task_comments (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    task_id UUID NOT NULL,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    parent_id UUID,
    body TEXT NOT NULL,
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT task_comments_scope_unique UNIQUE (workspace_id, task_id, id),
    CONSTRAINT task_comments_task_fk
        FOREIGN KEY (workspace_id, task_id)
        REFERENCES tasks(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT task_comments_parent_fk
        FOREIGN KEY (workspace_id, task_id, parent_id)
        REFERENCES task_comments(workspace_id, task_id, id),
    CONSTRAINT task_comments_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id),
    CONSTRAINT task_comments_body_length CHECK (
        char_length(body) <= 50000
        AND (deleted_at IS NOT NULL OR char_length(btrim(body)) >= 1)
    )
);

CREATE TABLE task_comment_revisions (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    task_id UUID NOT NULL,
    comment_id UUID NOT NULL,
    body TEXT NOT NULL,
    editor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT task_comment_revisions_comment_fk
        FOREIGN KEY (workspace_id, task_id, comment_id)
        REFERENCES task_comments(workspace_id, task_id, id)
        ON DELETE CASCADE,
    CONSTRAINT task_comment_revisions_body_length CHECK (
        char_length(body) <= 50000
    )
);

CREATE TABLE task_comment_mentions (
    workspace_id UUID NOT NULL,
    task_id UUID NOT NULL,
    comment_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (comment_id, user_id),
    CONSTRAINT task_comment_mentions_comment_fk
        FOREIGN KEY (workspace_id, task_id, comment_id)
        REFERENCES task_comments(workspace_id, task_id, id)
        ON DELETE CASCADE
);

CREATE TABLE task_subscriptions (
    workspace_id UUID NOT NULL,
    task_id UUID NOT NULL,
    user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, user_id),
    CONSTRAINT task_subscriptions_task_fk
        FOREIGN KEY (workspace_id, task_id)
        REFERENCES tasks(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT task_subscriptions_member_fk
        FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspace_memberships(workspace_id, user_id)
        ON DELETE CASCADE
);

CREATE TABLE task_activity (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    task_id UUID NOT NULL,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT task_activity_task_fk
        FOREIGN KEY (workspace_id, task_id)
        REFERENCES tasks(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT task_activity_event_type CHECK (
        event_type IN (
            'task_created', 'task_updated', 'task_archived',
            'relation_added', 'relation_removed', 'document_updated'
        )
    ),
    CONSTRAINT task_activity_data_object CHECK (jsonb_typeof(data) = 'object')
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY,
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    task_id UUID,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    comment_id UUID REFERENCES task_comments(id) ON DELETE CASCADE,
    invitation_id UUID REFERENCES workspace_invitations(id) ON DELETE CASCADE,
    notification_type TEXT NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT notifications_task_fk
        FOREIGN KEY (workspace_id, task_id)
        REFERENCES tasks(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT notifications_type CHECK (
        notification_type IN (
            'invitation', 'assignment', 'mention', 'comment', 'reply',
            'state_change', 'metadata_change'
        )
    ),
    CONSTRAINT notifications_source CHECK (
        (notification_type = 'invitation' AND invitation_id IS NOT NULL AND task_id IS NULL)
        OR (notification_type <> 'invitation' AND task_id IS NOT NULL)
    )
);

CREATE INDEX task_comments_feed_idx
    ON task_comments(workspace_id, task_id, created_at, id);
CREATE INDEX task_comment_revisions_comment_idx
    ON task_comment_revisions(comment_id, created_at DESC, id);
CREATE INDEX task_activity_feed_idx
    ON task_activity(workspace_id, task_id, created_at, id);
CREATE INDEX task_subscriptions_user_idx
    ON task_subscriptions(workspace_id, user_id, task_id);
CREATE INDEX notifications_recipient_idx
    ON notifications(recipient_id, created_at DESC, id);
CREATE INDEX notifications_unread_idx
    ON notifications(recipient_id, created_at DESC, id)
    WHERE read_at IS NULL;
