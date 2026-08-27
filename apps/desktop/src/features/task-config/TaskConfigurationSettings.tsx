import { useQuery } from '@tanstack/react-query';
import { SettingsArticle } from '../settings/SettingsArticle';
import { LoadError } from '../settings/SettingsControls';
import type { ApiContext } from '../workspace/api';
import type { Workspace } from '../workspace/types';
import { getTaskConfiguration } from './api';
import { LabelSettings } from './LabelSettings';
import { StateSettings } from './StateSettings';
import { TaskTypeSettings } from './TaskTypeSettings';

export type TaskConfigurationSection = 'states' | 'labels' | 'task-types';

interface TaskConfigurationSettingsProps {
  context: ApiContext;
  workspace: Workspace;
  section: TaskConfigurationSection;
  onConfigurationUpdated: () => Promise<void>;
}

export function TaskConfigurationSettings({
  context,
  workspace,
  section,
  onConfigurationUpdated,
}: TaskConfigurationSettingsProps) {
  const configuration = useQuery({
    queryKey: ['task-configuration', workspace.id],
    queryFn: () => getTaskConfiguration(context, workspace.id),
  });

  if (configuration.isPending) {
    return (
      <SettingsArticle
        eyebrow="Workspace"
        title={sectionTitle(section)}
        description="Loading Workspace task configuration…"
      >
        <div className="configuration-skeleton" aria-label="Loading settings">
          <span />
          <span />
          <span />
        </div>
      </SettingsArticle>
    );
  }
  if (configuration.error) {
    return (
      <SettingsArticle
        eyebrow="Workspace"
        title={sectionTitle(section)}
        description="Shared vocabulary for Inbox and project tasks."
      >
        <LoadError
          error={configuration.error}
          onRetry={() => configuration.refetch()}
        />
      </SettingsArticle>
    );
  }

  const common = {
    context,
    workspace,
    configuration: configuration.data,
    onChanged: onConfigurationUpdated,
  };
  if (section === 'states') return <StateSettings {...common} />;
  if (section === 'labels') return <LabelSettings {...common} />;
  return <TaskTypeSettings {...common} />;
}

function sectionTitle(section: TaskConfigurationSection) {
  if (section === 'task-types') return 'Task types';
  return section[0].toUpperCase() + section.slice(1);
}
