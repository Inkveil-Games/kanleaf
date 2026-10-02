import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { InlineAlert } from '../../components/ui/InlineAlert';
import { LoadError } from '../../components/ui/LoadError';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Popover, PopoverClose } from '../../components/ui/Popover';
import { errorMessage, formatDateTime } from '../settings/utils';
import type { ApiContext } from '../workspace/api';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './api';
import type { Notification, NotificationType } from './types';

interface NotificationsProps {
  context: ApiContext;
  onOpenTask: (workspaceId: string, taskId: string) => void;
  onOpenInvitations: () => void;
}

export function Notifications({
  context,
  onOpenTask,
  onOpenInvitations,
}: NotificationsProps) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [actionError, setActionError] = useState<string | null>(null);
  const notifications = useQuery({
    queryKey: ['notifications', context.serverUrl, context.token],
    queryFn: () => listNotifications(context),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const items = (notifications.data ?? []).filter(
    (notification) => filter === 'all' || !notification.read_at,
  );
  const unreadCount =
    notifications.data?.filter(({ read_at }) => !read_at).length ?? 0;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  async function markAllRead() {
    setActionError(null);
    try {
      await markAllNotificationsRead(context);
      await refresh();
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  async function openNotification(notification: Notification) {
    setActionError(null);
    try {
      if (!notification.read_at) {
        await markNotificationRead(context, notification.id);
      }
      if (notification.task_id) {
        onOpenTask(notification.workspace_id, notification.task_id);
      } else if (notification.notification_type === 'invitation') {
        onOpenInvitations();
      }
      await refresh();
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  return (
    <Popover
      label="Notifications"
      className="notification-menu"
      trigger={
        <span className="notification-trigger">
          <Bell aria-hidden="true" size={16} />
          {unreadCount > 0 && (
            <Badge
              variant="accent"
              className="notification-badge"
              aria-label={`${unreadCount} unread`}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </span>
      }
    >
      <div className="notification-header">
        <strong>Notifications</strong>
        <Button
          variant="text"
          size="sm"
          type="button"
          disabled={unreadCount === 0}
          onClick={() => void markAllRead()}
        >
          <CheckCheck aria-hidden="true" size={14} /> Mark all read
        </Button>
      </div>
      <div className="notification-filters">
        <SegmentedControl
          aria-label="Notification filter"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            {
              value: 'unread',
              label: `Unread ${unreadCount > 0 ? unreadCount : ''}`.trim(),
            },
          ]}
        />
      </div>
      {notifications.isPending ? (
        <EmptyState
          className="notification-empty"
          title="Loading notifications…"
        />
      ) : notifications.error ? (
        <LoadError
          className="notification-empty"
          title="Could not load notifications"
          description={errorMessage(notifications.error)}
          onRetry={() => void notifications.refetch()}
          retrying={notifications.isFetching}
        />
      ) : items.length === 0 ? (
        <EmptyState
          className="notification-empty"
          icon={<Bell aria-hidden="true" size={17} />}
          title={
            filter === 'unread'
              ? 'You are all caught up'
              : 'No notifications yet'
          }
          description="Updates about your work will appear here."
        />
      ) : (
        <div className="notification-list ui-native-scrollbar">
          {items.map((notification) => (
            <PopoverClose
              key={notification.id}
              className={notification.read_at ? '' : 'is-unread'}
              onClick={() => void openNotification(notification)}
            >
              <span className="notification-unread-dot" aria-hidden="true" />
              <span>
                <strong>{notificationMessage(notification)}</strong>
                <small>
                  {notification.workspace_name} ·{' '}
                  {formatDateTime(notification.created_at)}
                </small>
              </span>
            </PopoverClose>
          ))}
        </div>
      )}
      {actionError && (
        <InlineAlert className="notification-error" variant="danger">
          {actionError}
        </InlineAlert>
      )}
    </Popover>
  );
}

function notificationMessage(notification: Notification) {
  const actor = notification.actor_display_name ?? 'A teammate';
  const task = notification.task_reference
    ? `${notification.task_reference} ${notification.task_title ?? ''}`.trim()
    : (notification.task_title ?? 'a Task');
  const actions: Record<NotificationType, string> = {
    invitation: `You were invited to ${notification.workspace_name}`,
    assignment: `${actor} assigned you to ${task}`,
    mention: `${actor} mentioned you in ${task}`,
    comment: `${actor} commented on ${task}`,
    reply: `${actor} replied in ${task}`,
    state_change: `${actor} changed the state of ${task}`,
    metadata_change: `${actor} updated ${task}`,
  };
  return actions[notification.notification_type];
}
