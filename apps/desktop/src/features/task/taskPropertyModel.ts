import type { Task, TaskState } from '../workspace/types';

export type PinnedPropertyKey =
  'state' | 'priority' | 'assignees' | 'start-date' | 'due-date';

export type PropertyKey = PinnedPropertyKey | ExtendedPropertyKey;

export type ExtendedPropertyKey =
  'project' | 'labels' | 'estimate' | 'parent' | 'cycle' | 'modules';

export interface TaskPropertyDefinition {
  key: ExtendedPropertyKey;
  label: string;
}

export const PINNED_PROPERTY_KEYS = [
  'state',
  'priority',
  'assignees',
  'start-date',
  'due-date',
] as const satisfies ReadonlyArray<PinnedPropertyKey>;

export const TASK_PRIORITY_OPTIONS = [
  { value: 'none', label: 'No priority' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
] as const;

export const EXTENDED_PROPERTIES: TaskPropertyDefinition[] = [
  { key: 'project', label: 'Project' },
  { key: 'labels', label: 'Labels' },
  { key: 'estimate', label: 'Estimate' },
  { key: 'parent', label: 'Parent' },
  { key: 'cycle', label: 'Cycle' },
  { key: 'modules', label: 'Modules' },
];

export function hasPropertyValue(task: Task, key: ExtendedPropertyKey) {
  switch (key) {
    case 'project':
      return task.project_id !== null;
    case 'labels':
      return task.labels.length > 0;
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

export function isPinnedProperty(key: PropertyKey): key is PinnedPropertyKey {
  return PINNED_PROPERTY_KEYS.some((property) => property === key);
}

export function priorityLabel(priority: Task['priority']) {
  return (
    TASK_PRIORITY_OPTIONS.find(({ value }) => value === priority)?.label ??
    priority
  );
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
