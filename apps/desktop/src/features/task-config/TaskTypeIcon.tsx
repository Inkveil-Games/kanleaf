import { createElement } from 'react';
import { resolveTaskTypeIcon } from './taskTypeIcons';

export function TaskTypeIcon({
  iconKey,
  size = 16,
}: {
  iconKey: string;
  size?: number;
}) {
  return createElement(resolveTaskTypeIcon(iconKey), {
    'aria-hidden': true,
    size,
    strokeWidth: 1.8,
  });
}
