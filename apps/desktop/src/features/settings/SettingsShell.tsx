import {
  ArrowLeft,
  Archive,
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
import { AccountSettings } from '../account/AccountSettings';
import type { AccountSettingsSection } from '../account/settingsSections';
import type { ApiContext } from '../workspace/api';
import type { WorkspaceSettingsSection } from '../workspace/settingsSections';
import type { Workspace } from '../workspace/types';
import { WorkspaceSettings } from '../workspace/WorkspaceSettings';

interface AccountSettingsShellProps {
  context: ApiContext;
  user: User;
  section: AccountSettingsSection;
  onSectionChange: (section: AccountSettingsSection) => void;
  onClose: () => void;
}

export function AccountSettingsShell({
  context,
  user,
  section,
  onSectionChange,
  onClose,
}: AccountSettingsShellProps) {
  return (
    <SettingsFrame
      label="Account settings"
      onClose={onClose}
      navigation={
        <SettingsGroup label="Account">
          <SettingsLink
            active={section === 'profile'}
            icon={<UserRound aria-hidden="true" size={15} />}
            label="Profile"
            onClick={() => onSectionChange('profile')}
          />
          <SettingsLink
            active={section === 'preferences'}
            icon={<Palette aria-hidden="true" size={15} />}
            label="Preferences"
            onClick={() => onSectionChange('preferences')}
          />
          <SettingsLink
            active={section === 'security'}
            icon={<KeyRound aria-hidden="true" size={15} />}
            label="Security"
            onClick={() => onSectionChange('security')}
          />
          <SettingsLink
            active={section === 'invitations'}
            icon={<Mail aria-hidden="true" size={15} />}
            label="Invitations"
            onClick={() => onSectionChange('invitations')}
          />
          <SettingsLink
            active={section === 'notifications'}
            icon={<Bell aria-hidden="true" size={15} />}
            label="Notifications"
            onClick={() => onSectionChange('notifications')}
          />
        </SettingsGroup>
      }
    >
      <AccountSettings
        key={section}
        context={context}
        initialUser={user}
        section={section}
      />
    </SettingsFrame>
  );
}

interface WorkspaceSettingsShellProps {
  context: ApiContext;
  user: User;
  workspace: Workspace;
  workspaceCount: number;
  section: WorkspaceSettingsSection;
  onSectionChange: (section: WorkspaceSettingsSection) => void;
  onClose: () => void;
  onWorkspaceUpdated: () => Promise<void>;
  onConfigurationUpdated: () => Promise<void>;
  onRemoveWorkspace: (remove: () => Promise<void>) => Promise<void>;
}

export function WorkspaceSettingsShell({
  context,
  user,
  workspace,
  workspaceCount,
  section,
  onSectionChange,
  onClose,
  onWorkspaceUpdated,
  onConfigurationUpdated,
  onRemoveWorkspace,
}: WorkspaceSettingsShellProps) {
  const canManageWorkspace =
    workspace.role === 'owner' || workspace.role === 'admin';

  return (
    <SettingsFrame
      label="Workspace settings"
      onClose={onClose}
      navigation={
        <SettingsGroup label={workspace.name}>
          <SettingsLink
            active={section === 'general'}
            icon={<Settings2 aria-hidden="true" size={15} />}
            label="General"
            onClick={() => onSectionChange('general')}
          />
          <SettingsLink
            active={section === 'members'}
            icon={<UsersRound aria-hidden="true" size={15} />}
            label="Members"
            onClick={() => onSectionChange('members')}
          />
          <SettingsLink
            active={section === 'states'}
            icon={<Workflow aria-hidden="true" size={15} />}
            label="States"
            onClick={() => onSectionChange('states')}
          />
          <SettingsLink
            active={section === 'labels'}
            icon={<Tags aria-hidden="true" size={15} />}
            label="Labels"
            onClick={() => onSectionChange('labels')}
          />
          <SettingsLink
            active={section === 'task-types'}
            icon={<Shapes aria-hidden="true" size={15} />}
            label="Task types"
            onClick={() => onSectionChange('task-types')}
          />
          {canManageWorkspace && (
            <>
              <SettingsLink
                active={section === 'invitations'}
                icon={<Mail aria-hidden="true" size={15} />}
                label="Invitations"
                onClick={() => onSectionChange('invitations')}
              />
              <SettingsLink
                active={section === 'storage'}
                icon={<Archive aria-hidden="true" size={15} />}
                label="Storage & backup"
                onClick={() => onSectionChange('storage')}
              />
            </>
          )}
          <SettingsLink
            active={section === 'danger'}
            icon={<ShieldAlert aria-hidden="true" size={15} />}
            label="Danger zone"
            onClick={() => onSectionChange('danger')}
            danger
          />
        </SettingsGroup>
      }
    >
      <WorkspaceSettings
        key={`${workspace.id}:${section}`}
        context={context}
        workspace={workspace}
        userId={user.id}
        workspaceCount={workspaceCount}
        section={section}
        onWorkspaceUpdated={onWorkspaceUpdated}
        onConfigurationUpdated={onConfigurationUpdated}
        onRemoveWorkspace={onRemoveWorkspace}
      />
    </SettingsFrame>
  );
}

export function SettingsFrame({
  label,
  navigation,
  children,
  onClose,
  footer,
}: {
  label: string;
  navigation: ReactNode;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
}) {
  return (
    <section className="settings-pane" aria-label={label}>
      <aside className="settings-navigation">
        <div className="settings-navigation-body">
          <div className="settings-navigation-header">
            <button className="settings-back" type="button" onClick={onClose}>
              <ArrowLeft aria-hidden="true" size={15} /> Back to Workspace
            </button>
            <strong>{label}</strong>
          </div>
          <nav aria-label={`${label} sections`}>{navigation}</nav>
        </div>
        {footer ? (
          <div className="settings-navigation-footer">{footer}</div>
        ) : null}
      </aside>
      <div className="settings-content">{children}</div>
    </section>
  );
}

export function SettingsGroup({
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

export function SettingsLink({
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
