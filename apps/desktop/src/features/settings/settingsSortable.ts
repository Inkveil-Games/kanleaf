import { arrayMove } from '@dnd-kit/helpers';

export function reorderSettingsIds(
  ids: string[],
  initialIndex: number,
  index: number,
) {
  return arrayMove(ids, initialIndex, index);
}
