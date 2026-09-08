import { useQuery } from '@tanstack/react-query';
import {
  ListChecks,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  UsersRound,
} from 'lucide-react';
import {
  SettingsFrame,
  SettingsGroup,
  SettingsLink,
} from '../settings/SettingsShell';
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
  accessSettled: boolean;
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
  accessSettled,
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
    enabled: accessSettled,
  });
  const workspaceMembers = useQuery({
    queryKey: ['workspace-members', workspace.id],
    queryFn: () => listWorkspaceMembers(context, workspace.id),
    enabled: accessSettled && section === 'members',
  });

  return (
    <SettingsFrame
      label="Project settings"
      title={project.name}
      backLabel="Back to Project"
      onBack={onClose}
      navigation={
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
      }
    >
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
    </SettingsFrame>
  );
}
