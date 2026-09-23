import type { CSSProperties } from 'react';
import priorityCritical from '../../assets/task-properties/priority-critical.svg';
import priorityHigh from '../../assets/task-properties/priority-high.svg';
import priorityLow from '../../assets/task-properties/priority-low.svg';
import priorityMedium from '../../assets/task-properties/priority-medium.svg';
import priorityNone from '../../assets/task-properties/priority-none.svg';
import stateBacklog from '../../assets/task-properties/state-backlog.svg';
import stateCancelled from '../../assets/task-properties/state-cancelled.svg';
import stateDone from '../../assets/task-properties/state-done.svg';
import stateInProgress from '../../assets/task-properties/state-in-progress.svg';
import stateTodo from '../../assets/task-properties/state-todo.svg';
import type { TaskPriority, TaskState } from '../workspace/types';
import { priorityLabel } from './taskPropertyModel';

const stateAssets = {
  backlog: stateBacklog,
  todo: stateTodo,
  in_progress: stateInProgress,
  done: stateDone,
  cancelled: stateCancelled,
} satisfies Record<TaskState['system_role'], string>;

const priorityAssets = {
  none: priorityNone,
  low: priorityLow,
  medium: priorityMedium,
  high: priorityHigh,
  critical: priorityCritical,
} satisfies Record<TaskPriority, string>;

interface TaskValueIconProps {
  size?: number;
  className?: string;
}

export function StateIcon({
  role,
  size = 24,
  className,
}: TaskValueIconProps & { role: TaskState['system_role'] }) {
  const asset = stateAssets[role];
  const style = {
    width: size,
    height: size,
    WebkitMaskImage: `url(${asset})`,
    maskImage: `url(${asset})`,
  } satisfies CSSProperties;

  return (
    <span
      aria-hidden="true"
      className={`task-state-icon is-${role}${className ? ` ${className}` : ''}`}
      data-state-role={role}
      style={style}
    />
  );
}

export function PriorityIcon({
  priority,
  size = 15,
  className,
}: TaskValueIconProps & { priority: TaskPriority }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={`task-priority-icon is-${priority}${className ? ` ${className}` : ''}`}
      data-priority-value={priority}
      height={size}
      src={priorityAssets[priority]}
      width={size}
    />
  );
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <span
      className={`task-priority-badge is-${priority}`}
      data-priority-value={priority}
    >
      <PriorityIcon priority={priority} />
      <span>{priorityLabel(priority)}</span>
    </span>
  );
}
