import {
  Check,
  ChevronUp,
  LogOut,
  ServerCog,
  Settings,
  UserPlus,
  X,
} from 'lucide-react';
import { ContextMenu } from '../../components/ui/ContextMenu';
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
    <ContextMenu
      className="account-switcher-menu"
      label="Switch account"
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
          return (
            <button
              key={account.user_id}
              className="account-switcher-account"
              type="button"
              role="menuitemradio"
              aria-checked={isActive}
              disabled={transitioning}
              data-menu-keep-open={!isActive ? '' : undefined}
              onClick={() => {
                if (!isActive) onSwitchAccount(account.user_id);
              }}
            >
              <span className="member-monogram" aria-hidden="true">
                {initial(account.display_name || account.email)}
              </span>
              <span className="account-switcher-copy">
                <strong>{account.display_name || account.email}</strong>
                <small>{account.email}</small>
              </span>
              {isActive && <Check aria-hidden="true" size={15} />}
            </button>
          );
        })}
      </div>
      {error && (
        <div className="account-switcher-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            aria-label="Dismiss account error"
            data-menu-keep-open
            onClick={onDismissError}
          >
            <X aria-hidden="true" size={13} />
          </button>
        </div>
      )}
      <div className="account-switcher-divider" />
      <button role="menuitem" type="button" onClick={onAddAccount}>
        <UserPlus aria-hidden="true" size={14} /> Add another account
      </button>
      {onOpenHostConsole ? (
        <button role="menuitem" type="button" onClick={onOpenHostConsole}>
          <ServerCog aria-hidden="true" size={14} /> Host Console
        </button>
      ) : null}
      {onOpenAccountSettings ? (
        <button role="menuitem" type="button" onClick={onOpenAccountSettings}>
          <Settings aria-hidden="true" size={14} /> Settings
        </button>
      ) : null}
      <div className="account-switcher-divider" />
      <button role="menuitem" type="button" onClick={onSignOutCurrent}>
        <LogOut aria-hidden="true" size={14} /> Sign out this account
      </button>
    </ContextMenu>
  );
}

function initial(value: string) {
  return value.trim().charAt(0).toUpperCase() || 'U';
}
