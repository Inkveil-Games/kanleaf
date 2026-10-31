import { useId, type CSSProperties } from 'react';
import priorityCritical from '../../assets/task-properties/priority-critical.svg';
import priorityHigh from '../../assets/task-properties/priority-high.svg';
import priorityLow from '../../assets/task-properties/priority-low.svg';
import priorityMedium from '../../assets/task-properties/priority-medium.svg';
import priorityNone from '../../assets/task-properties/priority-none.svg';
import type { TaskPriority, TaskState } from '../workspace/types';
import { stateGlyphMarkup } from './stateIconMarkup';
import { priorityLabel } from './taskPropertyModel';

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
  const maskId = `state-icon-${useId().replaceAll(':', '')}`;
  const style = {
    width: size,
    height: size,
  } satisfies CSSProperties;

  return (
    <svg
      aria-hidden="true"
      className={`task-state-icon is-${role}${className ? ` ${className}` : ''}`}
      data-state-role={role}
      fill="none"
      style={style}
      viewBox="0 0 24 24"
      // The glyph is a fixed per-role constant, shared with editor node views
      // that are built outside React.
      dangerouslySetInnerHTML={{ __html: stateGlyphMarkup(role, maskId) }}
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
  const label = priority === 'none' ? 'None' : priorityLabel(priority);
  return (
    <span
      aria-label={`Priority: ${label}`}
      className={`task-priority-badge is-${priority}`}
      data-priority-value={priority}
      title={`Priority: ${label}`}
    >
      <PriorityIcon priority={priority} />
      <span>{label}</span>
    </span>
  );
}
