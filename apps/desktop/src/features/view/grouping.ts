import type { Project, Task, TaskState } from '../workspace/types';
import { priorityLabel } from '../task/taskPropertyModel';
import type { TaskGroupField } from './types';

export interface TaskGroup {
  id: string;
  label: string;
  color?: string;
  taskIds: Set<string>;
}

export interface TaskGroupBranch {
  group: TaskGroup;
  tasks: Task[];
  secondary: TaskGroupBranch[];
}

export function buildTaskGroupTree(
  primary: TaskGroupField,
  secondary: TaskGroupField | null,
  tasks: Task[],
  projects: Project[],
  states: TaskState[],
): TaskGroupBranch[] {
  return nonEmptyGroups(primary, tasks, projects, states).map((group) => {
    const groupedTasks = tasks.filter((task) => group.taskIds.has(task.id));
    return {
      group,
      tasks: groupedTasks,
      secondary: secondary
        ? nonEmptyGroups(secondary, groupedTasks, projects, states).map(
            (secondaryGroup) => ({
              group: secondaryGroup,
              tasks: groupedTasks.filter((task) =>
                secondaryGroup.taskIds.has(task.id),
              ),
              secondary: [],
            }),
          )
        : [],
    };
  });
}

export function buildTaskGroups(
  field: TaskGroupField,
  tasks: Task[],
  projects: Project[],
  states: TaskState[],
): TaskGroup[] {
  if (field === 'state') {
    const visibleStates: Task['state'][] = states
      .filter(({ archived_at }) => !archived_at)
      .sort((left, right) => left.position - right.position)
      .map(({ id, name, color, system_role }) => ({
        id,
        name,
        color,
        system_role,
      }));
    const visibleStateIds = new Set(visibleStates.map(({ id }) => id));
    for (const task of tasks) {
      if (!visibleStateIds.has(task.state.id)) {
        visibleStateIds.add(task.state.id);
        visibleStates.push(task.state);
      }
    }
    return visibleStates.map((state) =>
      group(
        state.id,
        state.name,
        tasks,
        (task) => task.state.id === state.id,
        state.color,
      ),
    );
  }
  if (field === 'priority') {
    return (['none', 'low', 'medium', 'high', 'critical'] as const).map(
      (priority) =>
        group(
          priority,
          priorityLabel(priority),
          tasks,
          (task) => task.priority === priority,
        ),
    );
  }
  if (field === 'project') {
    return [
      group('none', 'Inbox', tasks, (task) => !task.project_id),
      ...projects.map((project) =>
        group(
          project.id,
          project.name,
          tasks,
          (task) => task.project_id === project.id,
        ),
      ),
    ];
  }
  const values = new Map<string, string>();
  for (const task of tasks) {
    for (const item of taskGroupValues(task, field)) {
      values.set(item.id, item.label);
    }
  }
  const groups = [...values].map(([id, label]) =>
    group(id, label, tasks, (task) =>
      taskGroupValues(task, field).some((item) => item.id === id),
    ),
  );
  const unassigned = group(
    'none',
    'No value',
    tasks,
    (task) => taskGroupValues(task, field).length === 0,
  );
  return unassigned.taskIds.size ? [...groups, unassigned] : groups;
}

function nonEmptyGroups(
  field: TaskGroupField,
  tasks: Task[],
  projects: Project[],
  states: TaskState[],
) {
  return buildTaskGroups(field, tasks, projects, states).filter(
    ({ taskIds }) => taskIds.size > 0,
  );
}

function taskGroupValues(task: Task, field: TaskGroupField) {
  if (field === 'assignee') {
    return task.assignees.map((item) => ({
      id: item.user_id,
      label: item.display_name,
    }));
  }
  if (field === 'label') {
    return task.labels.map((item) => ({ id: item.id, label: item.name }));
  }
  if (field === 'cycle') {
    return task.cycle ? [{ id: task.cycle.id, label: task.cycle.name }] : [];
  }
  if (field === 'module') {
    return task.modules.map((item) => ({ id: item.id, label: item.name }));
  }
  if (field === 'due_date') {
    return task.due_date
      ? [{ id: task.due_date, label: formatShortDate(task.due_date) }]
      : [];
  }
  return [];
}

function group(
  id: string,
  label: string,
  tasks: Task[],
  matches: (task: Task) => boolean,
  color?: string,
): TaskGroup {
  return {
    id,
    label,
    color,
    taskIds: new Set(tasks.filter(matches).map(({ id }) => id)),
  };
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(parseDate(value));
}

function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}
