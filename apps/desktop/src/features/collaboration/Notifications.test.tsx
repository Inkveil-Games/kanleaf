import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './api';
import { Notifications } from './Notifications';
import type { Notification } from './types';

vi.mock('./api', () => ({
  listNotifications: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
}));

const context = {
  serverUrl: 'https://kanleaf.example.com',
  token: 'session-token',
};

const assignment: Notification = {
  id: 'notification-1',
  notification_type: 'assignment',
  workspace_id: 'workspace-1',
  workspace_name: 'Kanleaf Core',
  task_id: 'task-1',
  task_reference: 'KAN-12',
  task_title: 'Review collaboration',
  comment_id: null,
  invitation_id: null,
  actor_id: 'user-2',
  actor_email: 'sam@example.com',
  actor_display_name: 'Sam Lee',
  read_at: null,
  created_at: '2026-08-29T02:00:00Z',
};

describe('Notifications', () => {
  it('shows unread work, opens its Task, and closes outside', async () => {
    vi.mocked(listNotifications).mockResolvedValue([assignment]);
    vi.mocked(markNotificationRead).mockResolvedValue(undefined);
    const onOpenTask = vi.fn();
    renderNotifications(onOpenTask);

    expect(await screen.findByLabelText('1 unread')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: /Sam Lee assigned you to KAN-12 Review collaboration/,
      }),
    );

    await waitFor(() => {
      expect(markNotificationRead).toHaveBeenCalledWith(
        context,
        'notification-1',
      );
      expect(onOpenTask).toHaveBeenCalledWith('workspace-1', 'task-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(
      screen.getByRole('dialog', { name: 'Notifications' }),
    ).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
  });

  it('filters unread items and marks all as read without closing the popover', async () => {
    vi.mocked(listNotifications).mockResolvedValue([
      assignment,
      { ...assignment, id: 'notification-2', read_at: '2026-08-29T03:00:00Z' },
    ]);
    vi.mocked(markAllNotificationsRead).mockResolvedValue(undefined);
    renderNotifications(vi.fn());

    await screen.findByLabelText('1 unread');
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unread 1' }));
    expect(
      screen.getAllByRole('button', { name: /assigned you/ }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() =>
      expect(markAllNotificationsRead).toHaveBeenCalledWith(context),
    );
    expect(
      screen.getByRole('dialog', { name: 'Notifications' }),
    ).toBeInTheDocument();
  });
});

function renderNotifications(
  onOpenTask: (workspaceId: string, taskId: string) => void,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Notifications
        context={context}
        onOpenTask={onOpenTask}
        onOpenInvitations={vi.fn()}
      />
      <button type="button">Outside</button>
    </QueryClientProvider>,
  );
}
