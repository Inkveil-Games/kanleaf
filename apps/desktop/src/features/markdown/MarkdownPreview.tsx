import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  type ChangeEvent,
  type ComponentProps,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownPreviewProps {
  content: string;
  onTaskToggle?: (content: string) => void;
}

interface TaskMarker {
  checked: boolean;
  offset: number;
}

interface MarkdownTaskContextValue {
  content: string;
  onTaskToggle?: (content: string) => void;
}

const MarkdownTaskContext = createContext<MarkdownTaskContextValue | null>(
  null,
);

export function MarkdownPreview({
  content,
  onTaskToggle,
}: MarkdownPreviewProps) {
  if (!content.trim()) {
    return (
      <div className="markdown-empty">
        <p>Nothing to preview yet.</p>
      </div>
    );
  }

  return (
    <article className="markdown-preview">
      <MarkdownTaskContext.Provider value={{ content, onTaskToggle }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          components={{
            a: ({ children, ...props }) => (
              <a {...props} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            ),
            li: MarkdownListItem,
          }}
        >
          {content}
        </ReactMarkdown>
      </MarkdownTaskContext.Provider>
    </article>
  );
}

function MarkdownListItem({
  node,
  children,
  ...props
}: ComponentProps<'li'> & ExtraProps) {
  const taskContext = useContext(MarkdownTaskContext);
  const marker = taskContext
    ? taskMarkerAt(taskContext.content, node?.position?.start.offset)
    : null;
  return (
    <li {...props}>
      {marker && taskContext
        ? taskChildren(
            children,
            marker,
            taskContext.content,
            taskContext.onTaskToggle,
          )
        : children}
    </li>
  );
}

function taskMarkerAt(
  content: string,
  sourceOffset: number | undefined,
): TaskMarker | null {
  if (sourceOffset === undefined) return null;
  const lineEnd = content.indexOf('\n', sourceOffset);
  const line = content.slice(
    sourceOffset,
    lineEnd === -1 ? content.length : lineEnd,
  );
  const match = /^([ \t]*(?:[-+*]|\d+[.)])[ \t]+\[)([ xX])(\])/.exec(line);
  if (!match) return null;
  const prefix = match[1];
  if (!prefix) return null;
  return {
    checked: match[2]?.toLowerCase() === 'x',
    offset: sourceOffset + prefix.length,
  };
}

function taskChildren(
  children: ReactNode,
  marker: TaskMarker,
  content: string,
  onTaskToggle: ((content: string) => void) | undefined,
) {
  let patched = false;
  const patchCheckbox = (child: ReactNode) => {
    if (patched) return child;
    if (
      !isValidElement<InputHTMLAttributes<HTMLInputElement>>(child) ||
      child.type !== 'input' ||
      child.props.type !== 'checkbox'
    ) {
      return child;
    }
    patched = true;
    return cloneElement(child, {
      checked: marker.checked,
      disabled: !onTaskToggle,
      'aria-label': marker.checked
        ? 'Mark task incomplete'
        : 'Mark task complete',
      onClick: (event) => event.stopPropagation(),
      onChange: onTaskToggle
        ? (event: ChangeEvent<HTMLInputElement>) => {
            event.stopPropagation();
            if (!/[ xX]/.test(content[marker.offset] ?? '')) return;
            const replacement = event.currentTarget.checked ? 'x' : ' ';
            const nextContent =
              content.slice(0, marker.offset) +
              replacement +
              content.slice(marker.offset + 1);
            onTaskToggle(nextContent);
          }
        : undefined,
    });
  };

  return Children.map(children, (child) => {
    const directCheckbox = patchCheckbox(child);
    if (directCheckbox !== child) return directCheckbox;
    if (
      patched ||
      !isValidElement<{ children?: ReactNode }>(child) ||
      child.type !== 'p'
    ) {
      return child;
    }
    const paragraphChildren = Children.map(child.props.children, patchCheckbox);
    return patched ? cloneElement(child, undefined, paragraphChildren) : child;
  });
}
