import {
  CalendarCheck,
  CalendarDays,
  CircleDot,
  Flag,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  PINNED_PROPERTY_KEYS,
  type PinnedPropertyKey,
} from './taskPropertyModel';

export const TASK_PROPERTY_PRESENTATION: Record<
  PinnedPropertyKey,
  { label: string; icon: LucideIcon }
> = {
  state: { label: 'State', icon: CircleDot },
  priority: { label: 'Priority', icon: Flag },
  assignees: { label: 'Assignees', icon: Users },
  'start-date': { label: 'Start date', icon: CalendarDays },
  'due-date': { label: 'Due', icon: CalendarCheck },
};

export const PINNED_PROPERTIES = PINNED_PROPERTY_KEYS.map((key) => ({
  key,
  label: TASK_PROPERTY_PRESENTATION[key].label,
}));
