import { Building2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { User } from '../../lib/api/types';
import { AccountSwitcher } from '../account/AccountSwitcher';
import type { AccountSession } from '../auth/accountSessionStore';
import {
  SettingsFrame,
  SettingsGroup,
  SettingsLink,
} from '../settings/SettingsShell';
import type { ApiContext } from '../workspace/api';
import { HostAccessSettings } from './HostAccessSettings';
import { HostWorkspaces } from './HostWorkspaces';

type HostSection = 'workspaces' | 'access';

interface HostConsoleProps {
  context: ApiContext;
  user: User;
  accountSessions: AccountSession[];
  accountTransitioning: boolean;
  accountError: string | null;
  onSwitchAccount: (userId: string) => void;
  onAddAccount: () => void;
  onDismissAccountError: () => void;
  onSignOut: () => void;
  onClose: () => void;
}

export function HostConsole({
  context,
  user,
  accountSessions,
  accountTransitioning,
  accountError,
  onSwitchAccount,
  onAddAccount,
  onDismissAccountError,
  onSignOut,
  onClose,
}: HostConsoleProps) {
  const [section, setSection] = useState<HostSection>('workspaces');

  return (
    <main className="host-console">
      <SettingsFrame
        label="Host Console"
        onClose={onClose}
        navigation={
          <SettingsGroup label="Host">
            <SettingsLink
              active={section === 'workspaces'}
              icon={<Building2 aria-hidden="true" size={15} />}
              label="Workspaces"
              onClick={() => setSection('workspaces')}
            />
            <SettingsLink
              active={section === 'access'}
              icon={<ShieldCheck aria-hidden="true" size={15} />}
              label="Access"
              onClick={() => setSection('access')}
            />
          </SettingsGroup>
        }
        footer={
          <AccountSwitcher
            accounts={accountSessions}
            activeUserId={user.id}
            transitioning={accountTransitioning}
            error={accountError}
            onSwitchAccount={onSwitchAccount}
            onAddAccount={onAddAccount}
            onSignOutCurrent={onSignOut}
            onDismissError={onDismissAccountError}
          />
        }
      >
        {section === 'workspaces' ? (
          <HostWorkspaces context={context} />
        ) : (
          <HostAccessSettings context={context} />
        )}
      </SettingsFrame>
    </main>
  );
}
