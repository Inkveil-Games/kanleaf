import { Search } from 'lucide-react';
import { Wordmark } from '../../components/ui/Wordmark';
import { Notifications } from '../collaboration/Notifications';
import type { ApiContext } from './api';

interface WorkspaceTopBarProps {
  context: ApiContext;
  onOpenNotificationTask: (workspaceId: string, taskId: string) => void;
  onOpenInvitations: () => void;
  onOpenCommandPalette: () => void;
}

export function WorkspaceTopBar({
  context,
  onOpenNotificationTask,
  onOpenInvitations,
  onOpenCommandPalette,
}: WorkspaceTopBarProps) {
  return (
    <header className="workspace-topbar">
      <Wordmark quiet />
      <button
        className="topbar-command-trigger"
        type="button"
        aria-label="Search and commands (Ctrl or Command K)"
        onClick={onOpenCommandPalette}
      >
        <Search aria-hidden="true" size={15} />
        <span>Search or jump</span>
        <kbd>Ctrl/⌘ K</kbd>
      </button>
      <Notifications
        context={context}
        onOpenTask={onOpenNotificationTask}
        onOpenInvitations={onOpenInvitations}
      />
    </header>
  );
}
