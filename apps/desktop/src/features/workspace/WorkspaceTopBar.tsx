import { Search } from 'lucide-react';
import { AppTopBar } from '../app-shell/AppTopBar';
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
    <AppTopBar
      context={context}
      onOpenNotificationTask={onOpenNotificationTask}
      onOpenInvitations={onOpenInvitations}
      command={
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
      }
    />
  );
}
