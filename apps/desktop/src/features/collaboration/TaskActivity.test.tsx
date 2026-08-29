import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  createComment,
  getTaskFeed,
  listMentionCandidates,
  watchTask,
} from './api';
import { TaskActivity } from './TaskActivity';
import type { TaskFeed } from './types';

vi.mock('./api', () => ({
  createComment: vi.fn(),
  deleteComment: vi.fn(),
  editComment: vi.fn(),
  getTaskFeed: vi.fn(),
  listCommentRevisions: vi.fn(),
  listMentionCandidates: vi.fn(),
  unwatchTask: vi.fn(),
  watchTask: vi.fn(),
}));

const context = {
  serverUrl: 'https://kanleaf.example.com',
  token: 'session-token',
};

const initialFeed: TaskFeed = {
  watched: false,
  activity: [
    {
      id: 'activity-1',
      event_type: 'task_created',
      actor: {
        id: 'user-1',
        email: 'alex@example.com',
        display_name: 'Alex Morgan',
      },
      data: {},
      created_at: '2026-08-29T01:00:00Z',
    },
  ],
  comments: [
    {
      id: 'comment-1',
      workspace_id: 'workspace-1',
      task_id: 'task-1',
      parent_id: null,
      body: 'Review the **API contract**.',
      author: {
        id: 'user-2',
        email: 'sam@example.com',
        display_name: 'Sam Lee',
      },
      mentions: [],
      edited_at: null,
      deleted_at: null,
      created_at: '2026-08-29T02:00:00Z',
      updated_at: '2026-08-29T02:00:00Z',
    },
  ],
};

describe('TaskActivity', () => {
  it('renders the chronological feed and watches the Task', async () => {
    vi.mocked(getTaskFeed)
      .mockResolvedValueOnce(initialFeed)
      .mockResolvedValue({ ...initialFeed, watched: true });
    vi.mocked(listMentionCandidates).mockResolvedValue([]);
    vi.mocked(watchTask).mockResolvedValue(undefined);
    renderActivity();

    expect(await screen.findByText('created the Task.')).toBeInTheDocument();
    expect(screen.getByText('API contract').tagName).toBe('STRONG');

    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
    await waitFor(() =>
      expect(watchTask).toHaveBeenCalledWith(context, 'workspace-1', 'task-1'),
    );
    expect(
      await screen.findByRole('button', { name: 'Unwatch' }),
    ).toBeInTheDocument();
  });

  it('creates a Markdown comment with a structured mention', async () => {
    vi.mocked(getTaskFeed).mockResolvedValue(initialFeed);
    vi.mocked(listMentionCandidates).mockResolvedValue([
      {
        id: 'user-2',
        email: 'sam@example.com',
        display_name: 'Sam Lee',
      },
    ]);
    vi.mocked(createComment).mockResolvedValue(initialFeed.comments[0]!);
    renderActivity();

    await screen.findByText('API contract');
    fireEvent.change(screen.getByLabelText('Mention a member'), {
      target: { value: 'sam' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /Sam Lee/ }));
    const composer = screen.getByLabelText('Add comment');
    fireEvent.change(composer, {
      target: { value: '@Sam Lee Please review `POST /comments`.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

    await waitFor(() =>
      expect(createComment).toHaveBeenCalledWith(
        context,
        'workspace-1',
        'task-1',
        '@Sam Lee Please review `POST /comments`.',
        null,
        ['user-2'],
      ),
    );
  });

  it('creates a one-level reply without converting it to a mention', async () => {
    vi.mocked(getTaskFeed).mockResolvedValue(initialFeed);
    vi.mocked(listMentionCandidates).mockResolvedValue([]);
    vi.mocked(createComment).mockResolvedValue(initialFeed.comments[0]!);
    renderActivity();

    await screen.findByText('API contract');
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(screen.getByLabelText('Add comment'), {
      target: { value: 'The boundary is covered.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Comment$/ }));

    await waitFor(() =>
      expect(createComment).toHaveBeenCalledWith(
        context,
        'workspace-1',
        'task-1',
        'The boundary is covered.',
        'comment-1',
        [],
      ),
    );
  });
});

function renderActivity() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TaskActivity
        context={context}
        workspaceId="workspace-1"
        taskId="task-1"
        currentUserId="user-1"
        canComment
        canModerate={false}
      />
    </QueryClientProvider>,
  );
}
