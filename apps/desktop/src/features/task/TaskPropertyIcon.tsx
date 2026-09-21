import type { PinnedPropertyKey } from './taskPropertyModel';
import { TASK_PROPERTY_PRESENTATION } from './taskPropertyPresentation';

export function TaskPropertyIcon({
  propertyKey,
  size = 14,
}: {
  propertyKey: PinnedPropertyKey;
  size?: number;
}) {
  const Icon = TASK_PROPERTY_PRESENTATION[propertyKey].icon;
  return <Icon aria-hidden="true" size={size} />;
}
