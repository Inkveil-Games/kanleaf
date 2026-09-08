import {
  Check,
  ChevronUp,
  LogOut,
  ServerCog,
  Settings,
  UserPlus,
  X,
} from 'lucide-react';
import { Popover, PopoverClose } from '../../components/ui/Popover';
import { IconButton } from '../../components/ui/IconButton';
import type { AccountSession } from '../auth/accountSessionStore';

interface AccountSwitcherProps {
  accounts: AccountSession[];
  activeUserId: string;
  transitioning: boolean;
  error: string | null;
  onSwitchAccount: (userId: string) => void;
  onAddAccount: () => void;
  onOpenAccountSettings?: () => void;
  onOpenHostConsole?: () => void;
  onSignOutCurrent: () => void;
  onDismissError: () => void;
}

export function AccountSwitcher({
  accounts,
  activeUserId,
  transitioning,
  error,
  onSwitchAccount,
  onAddAccount,
  onOpenAccountSettings,
  onOpenHostConsole,
  onSignOutCurrent,
  onDismissError,
}: AccountSwitcherProps) {
  const active = accounts.find(({ user_id }) => user_id === activeUserId);
  const displayName = active?.display_name || active?.email || 'Account';

  return (
    <Popover
      className="account-switcher-menu"
      label="Switch account"
      align="start"
      placement="up"
      trigger={
        <>
          <span className="member-monogram" aria-hidden="true">
            {initial(displayName)}
          </span>
          <span className="account-switcher-copy">
            <strong>{displayName}</strong>
            <small>{active?.email}</small>
          </span>
          <ChevronUp
            className="account-switcher-chevron"
            aria-hidden="true"
            size={14}
          />
        </>
      }
    >
      <div className="account-switcher-heading">
        <span>Signed in accounts</span>
        <small>Kanleaf server</small>
      </div>
      <div className="account-switcher-list" role="group" aria-label="Accounts">
        {accounts.map((account) => {
          const isActive = account.user_id === activeUserId;
          const content = (
            <>
              <span className="member-monogram" aria-hidden="true">
                {initial(account.display_name || account.email)}
              </span>
              <span className="account-switcher-copy">
                <strong>{account.display_name || account.email}</strong>
                <small>{account.email}</small>
              </span>
              {isActive && <Check aria-hidden="true" size={15} />}
            </>
          );

          return isActive ? (
            <PopoverClose
              key={account.user_id}
              className="account-switcher-account"
              ariaPressed
              disabled={transitioning}
            >
              {content}
            </PopoverClose>
          ) : (
            <button
              key={account.user_id}
              className="account-switcher-account"
              type="button"
              aria-pressed={false}
              disabled={transitioning}
              onClick={() => onSwitchAccount(account.user_id)}
            >
              {content}
            </button>
          );
        })}
      </div>
      {error && (
        <div className="account-switcher-error" role="alert">
          <span>{error}</span>
          <IconButton
            variant="ghost"
            size="sm"
            type="button"
            aria-label="Dismiss account error"
            onClick={onDismissError}
          >
            <X aria-hidden="true" size={13} />
          </IconButton>
        </div>
      )}
      <div className="account-switcher-divider" />
      <PopoverClose onClick={onAddAccount}>
        <UserPlus aria-hidden="true" size={14} /> Add another account
      </PopoverClose>
      {onOpenHostConsole ? (
        <PopoverClose onClick={onOpenHostConsole}>
          <ServerCog aria-hidden="true" size={14} /> Host Console
        </PopoverClose>
      ) : null}
      {onOpenAccountSettings ? (
        <PopoverClose onClick={onOpenAccountSettings}>
          <Settings aria-hidden="true" size={14} /> Settings
        </PopoverClose>
      ) : null}
      <div className="account-switcher-divider" />
      <PopoverClose onClick={onSignOutCurrent}>
        <LogOut aria-hidden="true" size={14} /> Sign out this account
      </PopoverClose>
    </Popover>
  );
}

function initial(value: string) {
  return value.trim().charAt(0).toUpperCase() || 'U';
}
