import type { ReactNode } from 'react';
import { Wordmark } from '../../components/ui/Wordmark';
import { Notifications } from '../collaboration/Notifications';
import type { ApiContext } from '../workspace/api';

interface AppTopBarProps {
  context: ApiContext;
  area?: string;
  command?: ReactNode;
  onOpenNotificationTask: (workspaceId: string, taskId: string) => void;
  onOpenInvitations: () => void;
}

export function AppTopBar({
  context,
  area,
  command,
  onOpenNotificationTask,
  onOpenInvitations,
}: AppTopBarProps) {
  return (
    <header className="workspace-topbar">
      {area ? (
        <div className="app-area-brand">
          <Wordmark quiet />
          <span>/ {area}</span>
        </div>
      ) : (
        <Wordmark quiet />
      )}
      {command ?? <span />}
      <Notifications
        context={context}
        onOpenTask={onOpenNotificationTask}
        onOpenInvitations={onOpenInvitations}
      />
    </header>
  );
}
