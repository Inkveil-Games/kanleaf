import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ListChecks,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  UsersRound,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  listProjectMembers,
  listWorkspaceMembers,
  type ApiContext,
} from '../workspace/api';
import type { Project, TaskConfiguration, Workspace } from '../workspace/types';
import { ProjectDangerSettings } from './ProjectDangerSettings';
import { ProjectDefaultSettings } from './ProjectDefaultSettings';
import { ProjectFeatureSettings } from './ProjectFeatureSettings';
import { ProjectGeneralSettings } from './ProjectGeneralSettings';
import { ProjectMemberSettings } from './ProjectMemberSettings';
import type { ProjectSettingsSection } from './settingsSections';

export type { ProjectSettingsSection } from './settingsSections';

interface ProjectSettingsProps {
  context: ApiContext;
  workspace: Workspace;
  project: Project;
  userId: string;
  configuration: TaskConfiguration;
  section: ProjectSettingsSection;
  onSectionChange: (section: ProjectSettingsSection) => void;
  onClose: () => void;
  onUpdated: (project: Project) => Promise<void>;
  onRemoved: () => Promise<void>;
}

export function ProjectSettings({
  context,
  workspace,
  project,
  userId,
  configuration,
  section,
  onSectionChange,
  onClose,
  onUpdated,
  onRemoved,
}: ProjectSettingsProps) {
  const members = useQuery({
    queryKey: ['project-members', workspace.id, project.id],
    queryFn: () => listProjectMembers(context, workspace.id, project.id),
  });
  const workspaceMembers = useQuery({
    queryKey: ['workspace-members', workspace.id],
    queryFn: () => listWorkspaceMembers(context, workspace.id),
    enabled: section === 'members',
  });

  return (
    <section className="settings-pane" aria-label="Project settings">
      <aside className="settings-navigation">
        <div className="settings-navigation-header">
          <button className="settings-back" type="button" onClick={onClose}>
            <ArrowLeft aria-hidden="true" size={15} /> Back to Project
          </button>
          <strong>{project.name}</strong>
        </div>
        <nav aria-label="Project settings sections">
          <SettingsGroup label="Project">
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
              active={section === 'features'}
              icon={<ListChecks aria-hidden="true" size={15} />}
              label="Features"
              onClick={() => onSectionChange('features')}
            />
            <SettingsLink
              active={section === 'defaults'}
              icon={<SlidersHorizontal aria-hidden="true" size={15} />}
              label="Defaults"
              onClick={() => onSectionChange('defaults')}
            />
            <SettingsLink
              active={section === 'danger'}
              icon={<ShieldAlert aria-hidden="true" size={15} />}
              label="Danger zone"
              onClick={() => onSectionChange('danger')}
              danger
            />
          </SettingsGroup>
        </nav>
      </aside>
      <div className="settings-content">
        {section === 'general' && (
          <ProjectGeneralSettings
            context={context}
            project={project}
            members={members.data ?? []}
            membersLoading={members.isPending}
            onUpdated={onUpdated}
          />
        )}
        {section === 'members' && (
          <ProjectMemberSettings
            context={context}
            workspace={workspace}
            project={project}
            userId={userId}
            membersQuery={members}
            workspaceMembersQuery={workspaceMembers}
          />
        )}
        {section === 'features' && (
          <ProjectFeatureSettings
            context={context}
            project={project}
            onUpdated={onUpdated}
          />
        )}
        {section === 'defaults' && (
          <ProjectDefaultSettings
            context={context}
            project={project}
            configuration={configuration}
            members={members.data ?? []}
            membersLoading={members.isPending}
            onUpdated={onUpdated}
          />
        )}
        {section === 'danger' && (
          <ProjectDangerSettings
            context={context}
            workspace={workspace}
            project={project}
            onRemoved={onRemoved}
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
