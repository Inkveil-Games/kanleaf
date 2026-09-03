import {
  BookOpen,
  Bookmark,
  Bug,
  CircleDot,
  FileText,
  Flag,
  Lightbulb,
  ListTodo,
  MessageSquare,
  Milestone,
  Puzzle,
  Shapes,
  Sparkles,
  SquareCheck,
  Target,
  Wrench,
  Zap,
} from 'lucide-react';
import type { IconPickerOption } from '../../components/ui/IconPicker';

export const TASK_TYPE_ICON_FALLBACK = Shapes;

export const TASK_TYPE_ICON_OPTIONS: IconPickerOption[] = [
  { key: 'circle-dot', label: 'Circle', group: 'Common', icon: CircleDot },
  { key: 'check-square', label: 'Task', group: 'Common', icon: SquareCheck },
  { key: 'bug', label: 'Bug', group: 'Common', icon: Bug },
  { key: 'bookmark', label: 'Bookmark', group: 'Common', icon: Bookmark },
  { key: 'lightbulb', label: 'Idea', group: 'Common', icon: Lightbulb },
  { key: 'sparkles', label: 'Feature', group: 'Common', icon: Sparkles },
  { key: 'flag', label: 'Flag', group: 'Planning', icon: Flag },
  { key: 'milestone', label: 'Milestone', group: 'Planning', icon: Milestone },
  { key: 'target', label: 'Target', group: 'Planning', icon: Target },
  { key: 'list-todo', label: 'Checklist', group: 'Planning', icon: ListTodo },
  {
    key: 'book-open',
    label: 'Documentation',
    group: 'Content',
    icon: BookOpen,
  },
  { key: 'file-text', label: 'Document', group: 'Content', icon: FileText },
  {
    key: 'message-square',
    label: 'Discussion',
    group: 'Content',
    icon: MessageSquare,
  },
  { key: 'wrench', label: 'Maintenance', group: 'Technical', icon: Wrench },
  { key: 'zap', label: 'Improvement', group: 'Technical', icon: Zap },
  { key: 'puzzle', label: 'Integration', group: 'Technical', icon: Puzzle },
];

export function resolveTaskTypeIcon(key: string) {
  return (
    TASK_TYPE_ICON_OPTIONS.find((option) => option.key === key)?.icon ??
    TASK_TYPE_ICON_FALLBACK
  );
}
