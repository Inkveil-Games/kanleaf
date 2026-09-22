import { useQuery } from '@tanstack/react-query';
import { SettingsArticle } from '../settings/SettingsArticle';
import { LoadError } from '../settings/SettingsControls';
import type { ApiContext } from '../workspace/api';
import type { TaskConfiguration, Workspace } from '../workspace/types';
import { getTaskConfiguration } from './api';
import { LabelSettings } from './LabelSettings';
import { StateSettings } from './StateSettings';

export type TaskConfigurationSection = 'states' | 'labels';

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
  if (section === 'states') {
    return (
      <StateSettings key={stateEditorKey(configuration.data)} {...common} />
    );
  }
  return <LabelSettings key={labelEditorKey(configuration.data)} {...common} />;
}

function stateEditorKey(configuration: TaskConfiguration) {
  return JSON.stringify([
    configuration.default_state_id,
    configuration.state_property_description,
    configuration.states.map((state) => [
      state.id,
      state.updated_at,
      state.position,
      state.archived_at,
    ]),
  ]);
}

function labelEditorKey(configuration: TaskConfiguration) {
  return JSON.stringify([
    configuration.label_property_description,
    configuration.labels.map((label) => [
      label.id,
      label.updated_at,
      label.position,
      label.archived_at,
    ]),
  ]);
}

function sectionTitle(section: TaskConfigurationSection) {
  return section[0].toUpperCase() + section.slice(1);
}
