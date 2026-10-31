import type { TaskState } from '../workspace/types';

/** Standalone SVG markup for DOM code that renders outside React. */
export function stateIconMarkup(
  role: TaskState['system_role'],
  maskId: string,
  size = 24,
) {
  return `<svg aria-hidden="true" class="task-state-icon is-${role}" data-state-role="${role}" fill="none" width="${size}" height="${size}" viewBox="0 0 24 24">${stateGlyphMarkup(role, maskId)}</svg>`;
}

export function stateGlyphMarkup(
  role: TaskState['system_role'],
  maskId: string,
) {
  const masked = (cutout: string) =>
    `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><circle cx="12" cy="12" r="8.5" fill="white"/>${cutout}</mask><circle cx="12" cy="12" r="8.5" fill="currentColor" mask="url(#${maskId})"/>`;
  switch (role) {
    case 'backlog':
      return '<circle cx="12" cy="12" r="8" pathLength="70" stroke="currentColor" stroke-dasharray="5 5" stroke-dashoffset="2.5" stroke-linecap="round" stroke-width="2.4" transform="rotate(-90 12 12)"/>';
    case 'todo':
      return '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2.6"/>';
    case 'in_progress':
      return '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2.6"/><path d="M12 4A8 8 0 0 1 12 20V4Z" fill="currentColor"/>';
    case 'done':
      return masked(
        '<path d="M8.2 12.1L10.8 14.7L16 9.3" stroke="black" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.35"/>',
      );
    case 'cancelled':
      return masked(
        '<path d="M9 9L15 15M15 9L9 15" stroke="black" stroke-linecap="round" stroke-width="2.35"/>',
      );
  }
}
