import { useId, type CSSProperties, type ReactNode } from 'react';
import priorityCritical from '../../assets/task-properties/priority-critical.svg';
import priorityHigh from '../../assets/task-properties/priority-high.svg';
import priorityLow from '../../assets/task-properties/priority-low.svg';
import priorityMedium from '../../assets/task-properties/priority-medium.svg';
import priorityNone from '../../assets/task-properties/priority-none.svg';
import type { TaskPriority, TaskState } from '../workspace/types';
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
    >
      <StateGlyph maskId={maskId} role={role} />
    </svg>
  );
}

function StateGlyph({
  maskId,
  role,
}: {
  maskId: string;
  role: TaskState['system_role'];
}): ReactNode {
  switch (role) {
    case 'backlog':
      return (
        <circle
          cx="12"
          cy="12"
          r="8"
          pathLength="70"
          stroke="currentColor"
          strokeDasharray="5 5"
          strokeDashoffset="2.5"
          strokeLinecap="round"
          strokeWidth="2.4"
          transform="rotate(-90 12 12)"
        />
      );
    case 'todo':
      return (
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2.6" />
      );
    case 'in_progress':
      return (
        <>
          <circle
            cx="12"
            cy="12"
            r="8"
            stroke="currentColor"
            strokeWidth="2.6"
          />
          <path d="M12 4A8 8 0 0 1 12 20V4Z" fill="currentColor" />
        </>
      );
    case 'done':
      return (
        <>
          <mask
            id={maskId}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="24"
            height="24"
          >
            <circle cx="12" cy="12" r="8.5" fill="white" />
            <path
              d="M8.2 12.1L10.8 14.7L16 9.3"
              stroke="black"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.35"
            />
          </mask>
          <circle
            cx="12"
            cy="12"
            r="8.5"
            fill="currentColor"
            mask={`url(#${maskId})`}
          />
        </>
      );
    case 'cancelled':
      return (
        <>
          <mask
            id={maskId}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="24"
            height="24"
          >
            <circle cx="12" cy="12" r="8.5" fill="white" />
            <path
              d="M9 9L15 15M15 9L9 15"
              stroke="black"
              strokeLinecap="round"
              strokeWidth="2.35"
            />
          </mask>
          <circle
            cx="12"
            cy="12"
            r="8.5"
            fill="currentColor"
            mask={`url(#${maskId})`}
          />
        </>
      );
  }
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
