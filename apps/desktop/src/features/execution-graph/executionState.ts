import type { Task, TaskState } from '../workspace/types';
import type { TaskExecutionState } from './types';

export function isCompletedRole(role: TaskState['system_role'] | undefined) {
  return role === 'done' || role === 'cancelled';
}

export function taskExecutionState(
  task: Task,
  hasUnresolvedBlocker: boolean,
): TaskExecutionState {
  const role = task.state.system_role;
  if (role === 'done' || role === 'cancelled') return role;
  if (hasUnresolvedBlocker) return 'blocked';
  return role === 'in_progress' ? 'in_progress' : 'ready';
}

export function executionStateLabel(task: Task, state: TaskExecutionState) {
  return state === 'blocked' ? 'Blocked' : task.state.name;
}
