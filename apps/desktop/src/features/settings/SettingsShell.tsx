import {
  ArrowLeft,
  Bell,
  KeyRound,
  Mail,
  Palette,
  Shapes,
  Settings2,
  ShieldAlert,
  Tags,
  UserRound,
  UsersRound,
  Workflow,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { User } from '../../lib/api/types';
import {
  AccountSettings,
  type AccountSettingsSection,
} from '../account/AccountSettings';
import type { ApiContext } from '../workspace/api';
import {
  WorkspaceSettings,
  type WorkspaceSettingsSection,
} from '../workspace/WorkspaceSettings';
import type { Workspace } from '../workspace/types';

export type SettingsSection =
  `account:${AccountSettingsSection}` | `workspace:${WorkspaceSettingsSection}`;

interface SettingsShellProps {
  context: ApiContext;
  user: User;
  workspace: Workspace;
  workspaceCount: number;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
  onWorkspaceUpdated: () => Promise<void>;
  onConfigurationUpdated: () => Promise<void>;
  onWorkspaceRemoved: () => Promise<void>;
}

export function SettingsShell({
  context,
  user,
  workspace,
  workspaceCount,
  section,
  onSectionChange,
  onClose,
  onWorkspaceUpdated,
  onConfigurationUpdated,
  onWorkspaceRemoved,
}: SettingsShellProps) {
  const [scope, page] = section.split(':') as [
    'account' | 'workspace',
    AccountSettingsSection | WorkspaceSettingsSection,
  ];
  const canManageWorkspace =
    workspace.role === 'owner' || workspace.role === 'admin';

  return (
    <section className="settings-pane" aria-label="Settings">
      <aside className="settings-navigation">
        <div className="settings-navigation-header">
          <button className="settings-back" type="button" onClick={onClose}>
            <ArrowLeft aria-hidden="true" size={15} /> Back to Workspace
          </button>
          <strong>Settings</strong>
        </div>
        <nav aria-label="Settings sections">
          <SettingsGroup label="Account">
            <SettingsLink
              active={section === 'account:profile'}
              icon={<UserRound aria-hidden="true" size={15} />}
              label="Profile"
              onClick={() => onSectionChange('account:profile')}
            />
            <SettingsLink
              active={section === 'account:preferences'}
              icon={<Palette aria-hidden="true" size={15} />}
              label="Preferences"
              onClick={() => onSectionChange('account:preferences')}
            />
            <SettingsLink
              active={section === 'account:security'}
              icon={<KeyRound aria-hidden="true" size={15} />}
              label="Security"
              onClick={() => onSectionChange('account:security')}
            />
            <SettingsLink
              active={section === 'account:invitations'}
              icon={<Mail aria-hidden="true" size={15} />}
              label="Invitations"
              onClick={() => onSectionChange('account:invitations')}
            />
            <button
              className="settings-link"
              type="button"
              disabled
              title="In-app notifications arrive in a later Kanleaf Core stage"
            >
              <Bell aria-hidden="true" size={15} />
              <span>Notifications</span>
              <small>Later</small>
            </button>
          </SettingsGroup>
          <SettingsGroup label={workspace.name}>
            <SettingsLink
              active={section === 'workspace:general'}
              icon={<Settings2 aria-hidden="true" size={15} />}
              label="General"
              onClick={() => onSectionChange('workspace:general')}
            />
            <SettingsLink
              active={section === 'workspace:members'}
              icon={<UsersRound aria-hidden="true" size={15} />}
              label="Members"
              onClick={() => onSectionChange('workspace:members')}
            />
            <SettingsLink
              active={section === 'workspace:states'}
              icon={<Workflow aria-hidden="true" size={15} />}
              label="States"
              onClick={() => onSectionChange('workspace:states')}
            />
            <SettingsLink
              active={section === 'workspace:labels'}
              icon={<Tags aria-hidden="true" size={15} />}
              label="Labels"
              onClick={() => onSectionChange('workspace:labels')}
            />
            <SettingsLink
              active={section === 'workspace:task-types'}
              icon={<Shapes aria-hidden="true" size={15} />}
              label="Task types"
              onClick={() => onSectionChange('workspace:task-types')}
            />
            {canManageWorkspace && (
              <SettingsLink
                active={section === 'workspace:invitations'}
                icon={<Mail aria-hidden="true" size={15} />}
                label="Invitations"
                onClick={() => onSectionChange('workspace:invitations')}
              />
            )}
            <SettingsLink
              active={section === 'workspace:danger'}
              icon={<ShieldAlert aria-hidden="true" size={15} />}
              label="Danger zone"
              onClick={() => onSectionChange('workspace:danger')}
              danger
            />
          </SettingsGroup>
        </nav>
      </aside>
      <div className="settings-content">
        {scope === 'account' ? (
          <AccountSettings
            key={`account:${page}`}
            context={context}
            initialUser={user}
            section={page as AccountSettingsSection}
          />
        ) : (
          <WorkspaceSettings
            key={`${workspace.id}:${page}`}
            context={context}
            workspace={workspace}
            userId={user.id}
            workspaceCount={workspaceCount}
            section={page as WorkspaceSettingsSection}
            onWorkspaceUpdated={onWorkspaceUpdated}
            onConfigurationUpdated={onConfigurationUpdated}
            onWorkspaceRemoved={onWorkspaceRemoved}
          />
        )}
      </div>
    </section>
  );
}

function SettingsGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-nav-group">
      <h2>{label}</h2>
      {children}
    </section>
  );
}

function SettingsLink({
  active,
  icon,
  label,
  onClick,
  danger = false,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      className={`settings-link${danger ? ' settings-link-danger' : ''}`}
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
