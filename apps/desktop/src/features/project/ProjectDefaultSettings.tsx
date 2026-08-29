import { useState, type FormEvent } from 'react';
import { Select } from '../../components/ui/Select';
import { SettingsArticle } from '../settings/SettingsArticle';
import { FormActions, type ActionState } from '../settings/SettingsControls';
import { errorMessage } from '../settings/utils';
import { updateProject, type ApiContext } from '../workspace/api';
import type {
  Project,
  ProjectMember,
  ProjectPatch,
  TaskConfiguration,
} from '../workspace/types';

interface ProjectDefaultSettingsProps {
  context: ApiContext;
  project: Project;
  configuration: TaskConfiguration;
  members: ProjectMember[];
  membersLoading: boolean;
  onUpdated: (project: Project) => Promise<void>;
}

export function ProjectDefaultSettings({
  context,
  project,
  configuration,
  members,
  membersLoading,
  onUpdated,
}: ProjectDefaultSettingsProps) {
  const [defaultStateId, setDefaultStateId] = useState(
    project.default_state_id,
  );
  const [defaultTypeId, setDefaultTypeId] = useState(
    project.default_task_type_id,
  );
  const [defaultAssigneeId, setDefaultAssigneeId] = useState(
    project.default_assignee_id ?? '',
  );
  const [enabledTypeIds, setEnabledTypeIds] = useState(
    project.enabled_task_type_ids,
  );
  const [state, setState] = useState<ActionState>({ status: 'idle' });
  const states = configuration.states.filter(({ archived_at }) => !archived_at);
  const taskTypes = configuration.task_types.filter(
    ({ archived_at }) => !archived_at,
  );

  function changeDefaultType(nextId: string) {
    setDefaultTypeId(nextId);
    setEnabledTypeIds((current) =>
      current.includes(nextId) ? current : [...current, nextId],
    );
  }

  function toggleType(typeId: string, enabled: boolean) {
    setEnabledTypeIds((current) =>
      enabled
        ? [...new Set([...current, typeId])]
        : current.filter((id) => id !== typeId),
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState({ status: 'saving' });
    try {
      const patch: ProjectPatch = {
        default_state_id: defaultStateId,
        default_task_type_id: defaultTypeId,
        default_assignee_id: defaultAssigneeId || null,
        enabled_task_type_ids: enabledTypeIds,
      };
      const updated = await updateProject(
        context,
        project.workspace_id,
        project.id,
        patch,
      );
      await onUpdated(updated);
      setState({ status: 'saved', message: 'Work item defaults saved.' });
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  return (
    <SettingsArticle
      eyebrow="Project"
      title="Work item defaults"
      description="Choose the initial metadata and task types available in this Project."
    >
      <form className="settings-form" onSubmit={(event) => void submit(event)}>
        <label className="settings-field">
          <span>Default state</span>
          <Select
            ariaLabel="Default state"
            value={defaultStateId}
            options={states.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
            onValueChange={setDefaultStateId}
          />
        </label>
        <label className="settings-field">
          <span>Default task type</span>
          <Select
            ariaLabel="Default task type"
            value={defaultTypeId}
            options={taskTypes.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
            onValueChange={changeDefaultType}
          />
        </label>
        <label className="settings-field">
          <span>Default assignee</span>
          <Select
            ariaLabel="Default assignee"
            value={defaultAssigneeId}
            disabled={membersLoading}
            options={[
              { value: '', label: 'Unassigned' },
              ...members.map((member) => ({
                value: member.user_id,
                label: member.display_name,
              })),
            ]}
            onValueChange={setDefaultAssigneeId}
          />
        </label>
        <fieldset className="project-type-options">
          <legend>Enabled task types</legend>
          {taskTypes.map((taskType) => (
            <label key={taskType.id}>
              <input
                type="checkbox"
                checked={enabledTypeIds.includes(taskType.id)}
                disabled={taskType.id === defaultTypeId}
                onChange={(event) =>
                  toggleType(taskType.id, event.target.checked)
                }
              />
              <span>{taskType.name}</span>
              {taskType.id === defaultTypeId && <small>default</small>}
            </label>
          ))}
        </fieldset>
        <FormActions state={state} label="Save defaults" />
      </form>
    </SettingsArticle>
  );
}
