import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AtSign,
  Eye,
  EyeOff,
  History,
  MessageSquare,
  Pencil,
  Reply,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import { MarkdownPreview } from '../markdown/MarkdownPreview';
import { errorMessage, formatDateTime } from '../settings/utils';
import type { ApiContext } from '../workspace/api';
import {
  createComment,
  deleteComment,
  editComment,
  getTaskFeed,
  listCommentRevisions,
  listMentionCandidates,
  unwatchTask,
  watchTask,
} from './api';
import type {
  CollaborationUser,
  TaskActivityEvent,
  TaskComment,
} from './types';

interface TaskActivityProps {
  context: ApiContext;
  workspaceId: string;
  taskId: string;
  currentUserId: string;
  canComment: boolean;
  canModerate: boolean;
}

type FeedEntry =
  | { kind: 'comment'; comment: TaskComment; createdAt: string }
  | { kind: 'activity'; activity: TaskActivityEvent; createdAt: string };

interface Draft {
  body: string;
  parentId: string | null;
  editingId: string | null;
  mentions: CollaborationUser[];
}

const emptyDraft: Draft = {
  body: '',
  parentId: null,
  editingId: null,
  mentions: [],
};

export function TaskActivity({
  context,
  workspaceId,
  taskId,
  currentUserId,
  canComment,
  canModerate,
}: TaskActivityProps) {
  const queryClient = useQueryClient();
  const feedKey = ['task-feed', workspaceId, taskId];
  const feed = useQuery({
    queryKey: feedKey,
    queryFn: () => getTaskFeed(context, workspaceId, taskId),
  });
  const candidates = useQuery({
    queryKey: ['mention-candidates', workspaceId, taskId],
    queryFn: () => listMentionCandidates(context, workspaceId, taskId),
    enabled: canComment,
  });
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [mentionSearch, setMentionSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [watching, setWatching] = useState(false);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingComment, setDeletingComment] = useState<TaskComment | null>(
    null,
  );

  const entries = useMemo(() => {
    const data = feed.data;
    if (!data) return [];
    return [
      ...data.comments.map((comment): FeedEntry => ({
        kind: 'comment',
        comment,
        createdAt: comment.created_at,
      })),
      ...data.activity.map((activity): FeedEntry => ({
        kind: 'activity',
        activity,
        createdAt: activity.created_at,
      })),
    ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }, [feed.data]);

  async function refreshFeed() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: feedKey }),
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    ]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = draft.body.trim();
    if (!body) return;
    setSaving(true);
    setActionError(null);
    try {
      const mentionIds = draft.mentions.map(({ id }) => id);
      if (draft.editingId) {
        await editComment(
          context,
          workspaceId,
          taskId,
          draft.editingId,
          body,
          mentionIds,
        );
      } else {
        await createComment(
          context,
          workspaceId,
          taskId,
          body,
          draft.parentId,
          mentionIds,
        );
      }
      setDraft(emptyDraft);
      setMentionSearch('');
      await refreshFeed();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function removeComment(comment: TaskComment) {
    setActionError(null);
    await deleteComment(context, workspaceId, taskId, comment.id);
    if (draft.editingId === comment.id) setDraft(emptyDraft);
    await refreshFeed();
  }

  async function toggleWatch() {
    if (!feed.data) return;
    setWatching(true);
    setActionError(null);
    try {
      if (feed.data.watched) {
        await unwatchTask(context, workspaceId, taskId);
      } else {
        await watchTask(context, workspaceId, taskId);
      }
      await queryClient.invalidateQueries({ queryKey: feedKey });
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setWatching(false);
    }
  }

  function edit(comment: TaskComment) {
    setDraft({
      body: comment.body ?? '',
      parentId: null,
      editingId: comment.id,
      mentions: comment.mentions,
    });
    setMentionSearch('');
  }

  function reply(comment: TaskComment) {
    setDraft({
      body: '',
      parentId: comment.id,
      editingId: null,
      mentions: [],
    });
    setMentionSearch('');
  }

  if (feed.isPending) {
    return <p className="activity-state">Loading activity…</p>;
  }
  if (feed.error) {
    return (
      <div className="activity-state" role="alert">
        <p>{errorMessage(feed.error)}</p>
        <button type="button" onClick={() => void feed.refetch()}>
          Try again
        </button>
      </div>
    );
  }

  const replyingTo = draft.parentId
    ? feed.data.comments.find(({ id }) => id === draft.parentId)
    : null;
  const editing = draft.editingId
    ? feed.data.comments.find(({ id }) => id === draft.editingId)
    : null;

  return (
    <section className="task-activity" aria-label="Task activity">
      <header className="activity-header">
        <div>
          <p className="pane-eyebrow">Conversation</p>
          <h2>Activity</h2>
        </div>
        <button
          className="secondary-button compact-button"
          type="button"
          disabled={watching}
          onClick={() => void toggleWatch()}
        >
          {feed.data.watched ? (
            <EyeOff aria-hidden="true" size={14} />
          ) : (
            <Eye aria-hidden="true" size={14} />
          )}
          {feed.data.watched ? 'Unwatch' : 'Watch'}
        </button>
      </header>

      <div className="activity-feed">
        {entries.length === 0 ? (
          <div className="activity-empty">
            <MessageSquare aria-hidden="true" size={18} />
            <strong>No activity yet</strong>
            <span>Task changes and discussion will appear here.</span>
          </div>
        ) : (
          entries.map((entry) =>
            entry.kind === 'activity' ? (
              <ActivityRow
                key={`activity:${entry.activity.id}`}
                event={entry.activity}
              />
            ) : (
              <CommentRow
                key={`comment:${entry.comment.id}`}
                comment={entry.comment}
                currentUserId={currentUserId}
                canComment={canComment}
                canModerate={canModerate}
                historyOpen={historyId === entry.comment.id}
                context={context}
                workspaceId={workspaceId}
                taskId={taskId}
                onReply={reply}
                onEdit={edit}
                onDelete={setDeletingComment}
                onToggleHistory={(commentId) =>
                  setHistoryId((current) =>
                    current === commentId ? null : commentId,
                  )
                }
              />
            ),
          )
        )}
      </div>

      {canComment ? (
        <form
          className="comment-composer"
          onSubmit={(event) => void submit(event)}
        >
          {(replyingTo || editing) && (
            <div className="comment-composer-context">
              <span>
                {editing
                  ? `Editing ${editing.author?.display_name ?? 'comment'}`
                  : `Replying to ${replyingTo?.author?.display_name ?? 'comment'}`}
              </span>
              <button
                className="icon-button"
                type="button"
                aria-label="Cancel comment action"
                onClick={() => setDraft(emptyDraft)}
              >
                <X aria-hidden="true" size={14} />
              </button>
            </div>
          )}
          <label className="sr-only" htmlFor={`comment-${taskId}`}>
            {editing ? 'Edit comment' : 'Add comment'}
          </label>
          <textarea
            id={`comment-${taskId}`}
            rows={4}
            maxLength={50_000}
            placeholder="Write a Markdown comment…"
            value={draft.body}
            onChange={(event) =>
              setDraft((current) => ({ ...current, body: event.target.value }))
            }
          />
          <MentionPicker
            candidates={candidates.data ?? []}
            selected={draft.mentions}
            search={mentionSearch}
            onSearch={setMentionSearch}
            onAdd={(candidate) => {
              setDraft((current) => ({
                ...current,
                body: `${current.body}${current.body && !current.body.endsWith(' ') ? ' ' : ''}@${candidate.display_name} `,
                mentions: current.mentions.some(({ id }) => id === candidate.id)
                  ? current.mentions
                  : [...current.mentions, candidate],
              }));
              setMentionSearch('');
            }}
            onRemove={(candidateId) =>
              setDraft((current) => ({
                ...current,
                mentions: current.mentions.filter(
                  ({ id }) => id !== candidateId,
                ),
              }))
            }
          />
          <div className="comment-composer-actions">
            <span>Markdown supported</span>
            <button
              className="primary-button compact-button"
              type="submit"
              disabled={saving || !draft.body.trim()}
            >
              {saving ? 'Saving…' : editing ? 'Save comment' : 'Comment'}
            </button>
          </div>
        </form>
      ) : (
        <p className="activity-readonly">
          Your project role can read this discussion.
        </p>
      )}
      {actionError && (
        <p className="detail-error" role="alert">
          {actionError}
        </p>
      )}
      <AppDialog
        open={deletingComment !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingComment(null);
        }}
        type="confirm"
        variant="danger"
        title="Delete this comment?"
        description="Its revision history remains available."
        confirmLabel="Delete comment"
        loadingLabel="Deleting…"
        onConfirm={() => {
          if (!deletingComment) return;
          return removeComment(deletingComment);
        }}
      />
    </section>
  );
}

function ActivityRow({ event }: { event: TaskActivityEvent }) {
  return (
    <div className="activity-event">
      <span className="activity-avatar" aria-hidden="true" />
      <p>
        <strong>{event.actor?.display_name ?? 'Kanleaf'}</strong>{' '}
        {activityMessage(event)}
        <time dateTime={event.created_at}>
          {formatDateTime(event.created_at)}
        </time>
      </p>
    </div>
  );
}

function CommentRow({
  comment,
  currentUserId,
  canComment,
  canModerate,
  historyOpen,
  context,
  workspaceId,
  taskId,
  onReply,
  onEdit,
  onDelete,
  onToggleHistory,
}: {
  comment: TaskComment;
  currentUserId: string;
  canComment: boolean;
  canModerate: boolean;
  historyOpen: boolean;
  context: ApiContext;
  workspaceId: string;
  taskId: string;
  onReply: (comment: TaskComment) => void;
  onEdit: (comment: TaskComment) => void;
  onDelete: (comment: TaskComment) => void;
  onToggleHistory: (commentId: string) => void;
}) {
  const isAuthor = comment.author?.id === currentUserId;
  const canDelete = !comment.deleted_at && (isAuthor || canModerate);
  const hasHistory = Boolean(comment.edited_at || comment.deleted_at);

  return (
    <article
      className={`activity-comment${comment.parent_id ? ' activity-comment-reply' : ''}`}
    >
      <header>
        <div>
          <strong>{comment.author?.display_name ?? 'Former member'}</strong>
          <time dateTime={comment.created_at}>
            {formatDateTime(comment.created_at)}
          </time>
          {comment.edited_at && !comment.deleted_at && <span>edited</span>}
        </div>
        <div className="comment-actions">
          {canComment && !comment.parent_id && !comment.deleted_at && (
            <button type="button" onClick={() => onReply(comment)}>
              <Reply aria-hidden="true" size={13} /> Reply
            </button>
          )}
          {canComment && isAuthor && !comment.deleted_at && (
            <button type="button" onClick={() => onEdit(comment)}>
              <Pencil aria-hidden="true" size={13} /> Edit
            </button>
          )}
          {hasHistory && (
            <button type="button" onClick={() => onToggleHistory(comment.id)}>
              <History aria-hidden="true" size={13} /> History
            </button>
          )}
          {canDelete && (
            <button type="button" onClick={() => onDelete(comment)}>
              <Trash2 aria-hidden="true" size={13} /> Delete
            </button>
          )}
        </div>
      </header>
      {comment.deleted_at ? (
        <p className="comment-tombstone">Comment deleted</p>
      ) : (
        <MarkdownPreview content={comment.body ?? ''} />
      )}
      {comment.mentions.length > 0 && !comment.deleted_at && (
        <div className="comment-mentions" aria-label="Mentioned members">
          <AtSign aria-hidden="true" size={12} />
          {comment.mentions.map(({ id, display_name }) => (
            <span key={id}>{display_name}</span>
          ))}
        </div>
      )}
      {historyOpen && (
        <CommentHistory
          context={context}
          workspaceId={workspaceId}
          taskId={taskId}
          commentId={comment.id}
        />
      )}
    </article>
  );
}

function CommentHistory({
  context,
  workspaceId,
  taskId,
  commentId,
}: {
  context: ApiContext;
  workspaceId: string;
  taskId: string;
  commentId: string;
}) {
  const revisions = useQuery({
    queryKey: ['comment-revisions', workspaceId, taskId, commentId],
    queryFn: () =>
      listCommentRevisions(context, workspaceId, taskId, commentId),
  });

  if (revisions.isPending)
    return <p className="comment-history-state">Loading history…</p>;
  if (revisions.error) {
    return (
      <p className="comment-history-state">{errorMessage(revisions.error)}</p>
    );
  }
  return (
    <div className="comment-history">
      {revisions.data.map((revision) => (
        <div key={revision.id}>
          <time dateTime={revision.created_at}>
            {formatDateTime(revision.created_at)}
          </time>
          <pre>{revision.body}</pre>
        </div>
      ))}
    </div>
  );
}

function MentionPicker({
  candidates,
  selected,
  search,
  onSearch,
  onAdd,
  onRemove,
}: {
  candidates: CollaborationUser[];
  selected: CollaborationUser[];
  search: string;
  onSearch: (value: string) => void;
  onAdd: (candidate: CollaborationUser) => void;
  onRemove: (candidateId: string) => void;
}) {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const matches = normalizedSearch
    ? candidates
        .filter(
          ({ id, display_name, email }) =>
            !selected.some((candidate) => candidate.id === id) &&
            `${display_name} ${email}`
              .toLocaleLowerCase()
              .includes(normalizedSearch),
        )
        .slice(0, 6)
    : [];

  return (
    <div className="mention-picker">
      <div className="mention-input">
        <AtSign aria-hidden="true" size={14} />
        <label className="sr-only" htmlFor="mention-search">
          Mention a member
        </label>
        <input
          id="mention-search"
          type="search"
          placeholder="Mention a member"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>
      {matches.length > 0 && (
        <div
          className="mention-suggestions"
          role="listbox"
          aria-label="Mention suggestions"
        >
          {matches.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="option"
              aria-selected="false"
              onClick={() => onAdd(candidate)}
            >
              <strong>{candidate.display_name}</strong>
              <span>{candidate.email}</span>
            </button>
          ))}
        </div>
      )}
      {selected.length > 0 && (
        <div className="mention-selected" aria-label="Selected mentions">
          {selected.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              aria-label={`Remove mention ${candidate.display_name}`}
              onClick={() => onRemove(candidate.id)}
            >
              @{candidate.display_name} <X aria-hidden="true" size={11} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function activityMessage(event: TaskActivityEvent) {
  switch (event.event_type) {
    case 'task_created':
      return 'created the Task.';
    case 'task_updated': {
      const fields = event.data.fields ?? [];
      return fields.length > 0
        ? `updated ${fields.map(readableField).join(', ')}.`
        : 'updated the Task.';
    }
    case 'task_archived':
      return 'archived the Task.';
    case 'relation_added':
      return 'added a Task relation.';
    case 'relation_removed':
      return 'removed a Task relation.';
    case 'document_updated':
      return 'saved the Markdown document.';
  }
}

function readableField(field: string) {
  return field.replaceAll('_', ' ');
}
