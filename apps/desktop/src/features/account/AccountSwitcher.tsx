import {
  Check,
  ChevronUp,
  LogOut,
  ServerCog,
  Settings,
  UserPlus,
} from 'lucide-react';
import { Avatar } from '../../components/ui/Avatar';
import { InlineAlert } from '../../components/ui/InlineAlert';
import { Popover, PopoverClose } from '../../components/ui/Popover';
import type { AccountSession } from '../auth/accountSessionStore';

interface AccountSwitcherProps {
  compact?: boolean;
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
  compact = false,
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
      key={compact ? 'compact' : 'full'}
      className={`account-switcher-menu${compact ? ' account-switcher-compact' : ''}`}
      label="Switch account"
      align="start"
      placement={compact ? 'right' : 'up'}
      triggerTooltip={compact ? displayName : undefined}
      trigger={
        <>
          <Avatar
            name={displayName}
            fallback="U"
            size="sm"
            aria-hidden="true"
          />
          {!compact ? (
            <>
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
          ) : null}
        </>
      }
    >
      <div className="account-switcher-heading">
        <span>Signed in accounts</span>
        <small>Kanleaf server</small>
      </div>
      <div
        className="account-switcher-list ui-native-scrollbar"
        role="group"
        aria-label="Accounts"
      >
        {accounts.map((account) => {
          const isActive = account.user_id === activeUserId;
          const content = (
            <>
              <Avatar
                name={account.display_name || account.email}
                fallback="U"
                size="sm"
                aria-hidden="true"
              />
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
        <InlineAlert
          variant="danger"
          onDismiss={onDismissError}
          dismissLabel="Dismiss account error"
        >
          {error}
        </InlineAlert>
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
