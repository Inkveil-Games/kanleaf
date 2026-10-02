import {
  Bold,
  Braces,
  Code,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Sigma,
  Strikethrough,
  Table,
} from 'lucide-react';
import { IconButton } from '../../components/ui/IconButton';
import { Select } from '../../components/ui/Select';
import { Tooltip } from '../../components/ui/Tooltip';

export type EditorAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inlineCode'
  | 'link'
  | 'bullet'
  | 'ordered'
  | 'checklist'
  | 'image'
  | 'table'
  | 'codeBlock'
  | 'math'
  | 'divider';
export interface EditorToolbarState {
  style: string;
  active: string[];
}

const controls = [
  { action: 'bold', label: 'Bold', Icon: Bold },
  { action: 'italic', label: 'Italic', Icon: Italic },
  { action: 'strike', label: 'Strikethrough', Icon: Strikethrough },
  { action: 'inlineCode', label: 'Inline code', Icon: Code },
  { action: 'link', label: 'Link', Icon: Link },
  { action: 'bullet', label: 'Bullet list', Icon: List },
  { action: 'ordered', label: 'Ordered list', Icon: ListOrdered },
  { action: 'checklist', label: 'Checklist', Icon: ListChecks },
  { action: 'codeBlock', label: 'Code block', Icon: Braces },
  { action: 'image', label: 'Insert image', Icon: Image },
  { action: 'table', label: 'Insert table', Icon: Table },
  { action: 'math', label: 'Insert math', Icon: Sigma },
  { action: 'divider', label: 'Divider', Icon: Minus },
] satisfies { action: EditorAction; label: string; Icon: typeof Bold }[];

export function MarkdownEditorToolbar({
  state,
  disabled,
  onAction,
  onStyle,
}: {
  state: EditorToolbarState;
  disabled: boolean;
  onAction: (action: EditorAction) => void;
  onStyle: (style: string) => void;
}) {
  return (
    <div
      className="markdown-format-toolbar ui-native-scrollbar"
      role="toolbar"
      aria-label="Markdown formatting"
    >
      <Select
        ariaLabel="Text style"
        triggerTooltip="Text style"
        value={state.style}
        disabled={disabled}
        onValueChange={onStyle}
        options={[
          { value: 'paragraph', label: 'Normal text' },
          { value: 'h1', label: 'Heading 1' },
          { value: 'h2', label: 'Heading 2' },
          { value: 'h3', label: 'Heading 3' },
          { value: 'quote', label: 'Quote' },
          { value: 'codeBlock', label: 'Code block' },
        ]}
      />
      {controls.map(({ action, label, Icon }, index) => (
        <span
          key={action}
          className={
            index === 0 || index === 5 || index === 8
              ? 'toolbar-group-start'
              : undefined
          }
        >
          <Tooltip
            label={label}
            trigger={
              <IconButton
                aria-label={label}
                disabled={disabled}
                aria-pressed={state.active.includes(action)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => onAction(action)}
              >
                <Icon size={16} aria-hidden="true" />
              </IconButton>
            }
          />
        </span>
      ))}
    </div>
  );
}
