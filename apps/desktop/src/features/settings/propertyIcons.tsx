import {
  Archive,
  Award,
  Bell,
  BookOpen,
  Bookmark,
  Boxes,
  BriefcaseBusiness,
  Brush,
  Bug,
  Calendar,
  CalendarDays,
  Camera,
  ChartNoAxesCombined,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  ClipboardCheck,
  Clock,
  Code2,
  Compass,
  Cpu,
  Database,
  Eye,
  FileText,
  Flag,
  Folder,
  GitBranch,
  Globe2,
  Heart,
  LayoutDashboard,
  Lightbulb,
  Link,
  ListChecks,
  ListTodo,
  LoaderCircle,
  Mail,
  MapPin,
  Megaphone,
  MessageSquare,
  Milestone,
  Minus,
  Package,
  Palette,
  Paperclip,
  PenTool,
  Phone,
  Pin,
  Puzzle,
  Rocket,
  Send,
  Shapes,
  ShieldCheck,
  Sparkles,
  SquareCheck,
  Star,
  Tag,
  Tags,
  Target,
  Terminal,
  ThumbsUp,
  User,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { IconPickerOption } from '../../components/ui/IconPicker';

type PropertyIconGroup =
  | 'Status'
  | 'Work'
  | 'Communication'
  | 'People'
  | 'Objects'
  | 'Direction'
  | 'Symbols';

function option(
  key: string,
  label: string,
  group: PropertyIconGroup,
  icon: LucideIcon,
): IconPickerOption {
  return { key, label, group, icon };
}

export const propertyIconOptions: IconPickerOption[] = [
  option('circle', 'Circle', 'Status', Circle),
  option('circle-check', 'Complete', 'Status', CircleCheck),
  option('circle-dashed', 'Unscheduled', 'Status', CircleDashed),
  option('circle-dot', 'Active', 'Status', CircleDot),
  option('circle-x', 'Canceled', 'Status', CircleX),
  option('loader-circle', 'In progress', 'Status', LoaderCircle),
  option('check-square', 'Task', 'Status', SquareCheck),
  option('clock', 'Clock', 'Status', Clock),
  option('archive', 'Archive', 'Status', Archive),

  option('briefcase-business', 'Briefcase', 'Work', BriefcaseBusiness),
  option('bug', 'Bug', 'Work', Bug),
  option('calendar', 'Calendar', 'Work', Calendar),
  option('calendar-days', 'Calendar days', 'Work', CalendarDays),
  option('chart-no-axes-combined', 'Growth chart', 'Work', ChartNoAxesCombined),
  option('clipboard-check', 'Clipboard', 'Work', ClipboardCheck),
  option('code-2', 'Code', 'Work', Code2),
  option('layout-dashboard', 'Dashboard', 'Work', LayoutDashboard),
  option('list-checks', 'Checklist', 'Work', ListChecks),
  option('list-todo', 'Todo list', 'Work', ListTodo),
  option('milestone', 'Milestone', 'Work', Milestone),
  option('target', 'Target', 'Work', Target),
  option('terminal', 'Terminal', 'Work', Terminal),
  option('wrench', 'Maintenance', 'Work', Wrench),

  option('bell', 'Bell', 'Communication', Bell),
  option('mail', 'Mail', 'Communication', Mail),
  option('megaphone', 'Announcement', 'Communication', Megaphone),
  option('message-square', 'Discussion', 'Communication', MessageSquare),
  option('phone', 'Phone', 'Communication', Phone),
  option('send', 'Send', 'Communication', Send),

  option('user', 'Person', 'People', User),
  option('users', 'People', 'People', Users),
  option('heart', 'Heart', 'People', Heart),
  option('thumbs-up', 'Approval', 'People', ThumbsUp),

  option('book-open', 'Documentation', 'Objects', BookOpen),
  option('bookmark', 'Bookmark', 'Objects', Bookmark),
  option('boxes', 'Boxes', 'Objects', Boxes),
  option('brush', 'Brush', 'Objects', Brush),
  option('camera', 'Camera', 'Objects', Camera),
  option('cpu', 'Processor', 'Objects', Cpu),
  option('database', 'Database', 'Objects', Database),
  option('file-text', 'Document', 'Objects', FileText),
  option('folder', 'Folder', 'Objects', Folder),
  option('package', 'Package', 'Objects', Package),
  option('palette', 'Palette', 'Objects', Palette),
  option('paperclip', 'Attachment', 'Objects', Paperclip),
  option('pen-tool', 'Pen tool', 'Objects', PenTool),
  option('puzzle', 'Integration', 'Objects', Puzzle),

  option('compass', 'Compass', 'Direction', Compass),
  option('flag', 'Flag', 'Direction', Flag),
  option('git-branch', 'Git branch', 'Direction', GitBranch),
  option('globe-2', 'Globe', 'Direction', Globe2),
  option('link', 'Link', 'Direction', Link),
  option('map-pin', 'Map pin', 'Direction', MapPin),
  option('pin', 'Pin', 'Direction', Pin),
  option('rocket', 'Rocket', 'Direction', Rocket),

  option('award', 'Award', 'Symbols', Award),
  option('eye', 'Visible', 'Symbols', Eye),
  option('lightbulb', 'Idea', 'Symbols', Lightbulb),
  option('shield-check', 'Shield', 'Symbols', ShieldCheck),
  option('sparkles', 'Feature', 'Symbols', Sparkles),
  option('star', 'Star', 'Symbols', Star),
  option('tag', 'Tag', 'Symbols', Tag),
  option('tags', 'Tags', 'Symbols', Tags),
  option('zap', 'Improvement', 'Symbols', Zap),
];

const propertyIcons = new Map(
  propertyIconOptions.map(({ key, icon }) => [key, icon]),
);

export function propertyIcon(key: string | null): LucideIcon {
  if (key === null) return Minus;
  return propertyIcons.get(key) ?? Shapes;
}
