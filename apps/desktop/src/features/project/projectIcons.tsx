import {
  Blocks,
  Boxes,
  Brush,
  BriefcaseBusiness,
  Bug,
  CalendarDays,
  Camera,
  ChartNoAxesCombined,
  ClipboardCheck,
  Code2,
  Compass,
  Cpu,
  Database,
  Flag,
  Folder,
  GitBranch,
  Globe2,
  Heart,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Megaphone,
  Palette,
  PenTool,
  Rocket,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Terminal,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export interface ProjectIconOption {
  key: string;
  label: string;
  group: 'General' | 'Product' | 'Engineering' | 'Creative' | 'Growth';
  icon: LucideIcon;
}

export const projectIconOptions: ProjectIconOption[] = [
  { key: 'folder', label: 'Folder', group: 'General', icon: Folder },
  { key: 'target', label: 'Target', group: 'General', icon: Target },
  { key: 'flag', label: 'Flag', group: 'General', icon: Flag },
  { key: 'compass', label: 'Compass', group: 'General', icon: Compass },
  { key: 'globe-2', label: 'Globe', group: 'General', icon: Globe2 },
  { key: 'star', label: 'Star', group: 'General', icon: Star },
  { key: 'heart', label: 'Heart', group: 'General', icon: Heart },
  { key: 'zap', label: 'Lightning', group: 'General', icon: Zap },
  { key: 'rocket', label: 'Rocket', group: 'Product', icon: Rocket },
  { key: 'lightbulb', label: 'Idea', group: 'Product', icon: Lightbulb },
  {
    key: 'briefcase-business',
    label: 'Briefcase',
    group: 'Product',
    icon: BriefcaseBusiness,
  },
  {
    key: 'layout-dashboard',
    label: 'Dashboard',
    group: 'Product',
    icon: LayoutDashboard,
  },
  {
    key: 'list-checks',
    label: 'Checklist',
    group: 'Product',
    icon: ListChecks,
  },
  {
    key: 'calendar-days',
    label: 'Calendar',
    group: 'Product',
    icon: CalendarDays,
  },
  {
    key: 'clipboard-check',
    label: 'Clipboard',
    group: 'Product',
    icon: ClipboardCheck,
  },
  { key: 'bug', label: 'Bug', group: 'Engineering', icon: Bug },
  { key: 'code-2', label: 'Code', group: 'Engineering', icon: Code2 },
  { key: 'boxes', label: 'Boxes', group: 'Engineering', icon: Boxes },
  {
    key: 'git-branch',
    label: 'Git branch',
    group: 'Engineering',
    icon: GitBranch,
  },
  { key: 'database', label: 'Database', group: 'Engineering', icon: Database },
  { key: 'terminal', label: 'Terminal', group: 'Engineering', icon: Terminal },
  {
    key: 'shield-check',
    label: 'Shield',
    group: 'Engineering',
    icon: ShieldCheck,
  },
  { key: 'wrench', label: 'Wrench', group: 'Engineering', icon: Wrench },
  { key: 'cpu', label: 'Processor', group: 'Engineering', icon: Cpu },
  { key: 'palette', label: 'Palette', group: 'Creative', icon: Palette },
  { key: 'brush', label: 'Brush', group: 'Creative', icon: Brush },
  { key: 'pen-tool', label: 'Pen tool', group: 'Creative', icon: PenTool },
  { key: 'camera', label: 'Camera', group: 'Creative', icon: Camera },
  { key: 'sparkles', label: 'Sparkles', group: 'Creative', icon: Sparkles },
  { key: 'megaphone', label: 'Megaphone', group: 'Growth', icon: Megaphone },
  {
    key: 'chart-no-axes-combined',
    label: 'Growth chart',
    group: 'Growth',
    icon: ChartNoAxesCombined,
  },
];

const projectIcons = new Map(
  projectIconOptions.map((option) => [option.key, option.icon]),
);

export function projectIcon(key: string): LucideIcon {
  return projectIcons.get(key) ?? Blocks;
}
