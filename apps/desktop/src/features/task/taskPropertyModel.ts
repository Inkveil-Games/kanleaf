import type { Task, TaskState, TaskType } from '../workspace/types';

export type PropertyKey =
  'state' | 'assignees' | 'priority' | 'due-date' | ExtendedPropertyKey;

export type ExtendedPropertyKey =
  | 'type'
  | 'project'
  | 'labels'
  | 'start-date'
  | 'estimate'
  | 'parent'
  | 'cycle'
  | 'modules';

export interface TaskPropertyDefinition {
  key: ExtendedPropertyKey;
  label: string;
}

export const EXTENDED_PROPERTIES: TaskPropertyDefinition[] = [
  { key: 'type', label: 'Type' },
  { key: 'project', label: 'Project' },
  { key: 'labels', label: 'Labels' },
  { key: 'start-date', label: 'Start date' },
  { key: 'estimate', label: 'Estimate' },
  { key: 'parent', label: 'Parent' },
  { key: 'cycle', label: 'Cycle' },
  { key: 'modules', label: 'Modules' },
];

export function hasPropertyValue(task: Task, key: ExtendedPropertyKey) {
  switch (key) {
    case 'type':
      return true;
    case 'project':
      return task.project_id !== null;
    case 'labels':
      return task.labels.length > 0;
    case 'start-date':
      return task.start_date !== null;
    case 'estimate':
      return task.estimate !== null;
    case 'parent':
      return task.parent !== null;
    case 'cycle':
      return task.cycle !== null;
    case 'modules':
      return task.modules.length > 0;
  }
}

export function isExtendedProperty(
  key: PropertyKey,
): key is ExtendedPropertyKey {
  return EXTENDED_PROPERTIES.some((property) => property.key === key);
}

export function selectableStates(states: TaskState[], task: Task) {
  const active = states.filter(({ archived_at }) => !archived_at);
  if (active.some(({ id }) => id === task.state.id)) return active;
  return [
    {
      ...task.state,
      workspace_id: task.workspace_id,
      position: -1,
      archived_at: task.updated_at,
      created_at: task.created_at,
      updated_at: task.updated_at,
    },
    ...active,
  ];
}

export function selectableTypes(taskTypes: TaskType[], task: Task) {
  const active = taskTypes.filter(({ archived_at }) => !archived_at);
  if (active.some(({ id }) => id === task.task_type.id)) return active;
  return [
    {
      ...task.task_type,
      workspace_id: task.workspace_id,
      description: '',
      position: -1,
      is_protected: false,
      archived_at: task.updated_at,
      created_at: task.created_at,
      updated_at: task.updated_at,
    },
    ...active,
  ];
}
