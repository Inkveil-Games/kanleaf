import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Bell,
  KeyRound,
  Mail,
  Palette,
  Plus,
  SlidersHorizontal,
  Shapes,
  Settings2,
  ShieldAlert,
  Tags,
  UserRound,
  UsersRound,
  Workflow,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
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
  onWorkspaceJoined: (workspace: Workspace) => void | Promise<void>;
  onClose: () => void;
}

export function AccountSettingsShell({
  context,
  user,
  section,
  onSectionChange,
  onWorkspaceJoined,
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
        onWorkspaceJoined={onWorkspaceJoined}
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
  onProjectsChanged: () => Promise<void>;
  onRemoveWorkspace: (remove: () => Promise<void>) => Promise<void>;
  definePropertyName?: string;
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
  onProjectsChanged,
  onRemoveWorkspace,
  definePropertyName,
}: WorkspaceSettingsShellProps) {
  const canManageWorkspace =
    workspace.role === 'owner' || workspace.role === 'admin';
  const [propertyCreateRequest, setPropertyCreateRequest] = useState(0);

  return (
    <SettingsFrame
      label="Workspace settings"
      onClose={onClose}
      navigation={
        <>
          <SettingsGroup label="General">
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
            {workspace.role !== 'guest' && (
              <SettingsLink
                active={section === 'projects'}
                icon={<ArchiveRestore aria-hidden="true" size={15} />}
                label="Archived Projects"
                onClick={() => onSectionChange('projects')}
              />
            )}
            {canManageWorkspace && (
              <SettingsLink
                active={section === 'storage'}
                icon={<Archive aria-hidden="true" size={15} />}
                label="Storage & backup"
                onClick={() => onSectionChange('storage')}
              />
            )}
            <SettingsLink
              active={section === 'danger'}
              icon={<ShieldAlert aria-hidden="true" size={15} />}
              label="Danger zone"
              onClick={() => onSectionChange('danger')}
              danger
            />
          </SettingsGroup>
          <SettingsGroup
            label="Task properties"
            action={
              canManageWorkspace ? (
                <button
                  className="settings-group-action"
                  type="button"
                  aria-label="New property"
                  title="New property"
                  onClick={() => {
                    setPropertyCreateRequest((current) => current + 1);
                    onSectionChange('properties');
                  }}
                >
                  <Plus aria-hidden="true" size={14} />
                  <span className="sr-only">New property</span>
                </button>
              ) : undefined
            }
          >
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
            <SettingsLink
              active={section === 'properties'}
              icon={<SlidersHorizontal aria-hidden="true" size={15} />}
              label="Properties"
              onClick={() => onSectionChange('properties')}
            />
          </SettingsGroup>
        </>
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
        onProjectsChanged={onProjectsChanged}
        onRemoveWorkspace={onRemoveWorkspace}
        propertyCreateRequest={propertyCreateRequest}
        onPropertyCreateRequestHandled={() => setPropertyCreateRequest(0)}
        definePropertyName={definePropertyName}
        onDefinePropertyClosed={() => onSectionChange('properties')}
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
  action,
}: {
  label: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="settings-nav-group" aria-label={label}>
      <div className="settings-nav-group-header">
        <h2>{label}</h2>
        {action}
      </div>
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
