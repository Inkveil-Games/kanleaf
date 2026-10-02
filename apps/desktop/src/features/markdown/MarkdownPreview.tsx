import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useEffect,
  useContext,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import ReactMarkdown, {
  defaultUrlTransform,
  type ExtraProps,
} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { mathOptions } from './markdownExtensions';
import { remarkSmartPunctuation } from './smartPunctuation';
import { MermaidDiagram } from './MermaidDiagram';
import { readMarkdownAsset, type DocumentContext } from './api';

interface MarkdownPreviewProps {
  content: string;
  onTaskToggle?: (content: string) => void;
  assetContext?: DocumentContext;
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
const MarkdownAssetContext = createContext<DocumentContext | null>(null);

export function MarkdownPreview({
  content,
  onTaskToggle,
  assetContext,
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
      <MarkdownAssetContext.Provider value={assetContext ?? null}>
        <MarkdownTaskContext.Provider value={{ content, onTaskToggle }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath, remarkSmartPunctuation]}
            rehypePlugins={[[rehypeKatex, mathOptions]]}
            skipHtml
            urlTransform={(url, key) =>
              key === 'src' &&
              /^kanleaf-asset:\/\/images\/[0-9a-f-]+\.(?:png|jpg|gif|webp)$/.test(
                url,
              )
                ? url
                : defaultUrlTransform(url)
            }
            components={{
              a: ({ children, ...props }) => (
                <a {...props} target="_blank" rel="noreferrer noopener">
                  {children}
                </a>
              ),
              pre: ({ className, children, ...props }) => {
                const child = Children.toArray(children)[0];
                if (
                  isValidElement<{ className?: string; children?: ReactNode }>(
                    child,
                  ) &&
                  child.props.className === 'language-mermaid'
                ) {
                  return (
                    <MermaidDiagram
                      source={String(child.props.children ?? '').replace(
                        /\n$/,
                        '',
                      )}
                    />
                  );
                }
                return (
                  <pre
                    {...props}
                    className={nativeScrollbarClassName(className)}
                  >
                    {children}
                  </pre>
                );
              },
              table: ({ className, ...props }) => (
                <table
                  {...props}
                  className={nativeScrollbarClassName(className)}
                />
              ),
              li: MarkdownListItem,
              img: MarkdownImage,
            }}
          >
            {content}
          </ReactMarkdown>
        </MarkdownTaskContext.Provider>
      </MarkdownAssetContext.Provider>
    </article>
  );
}

function MarkdownImage({
  node,
  src,
  alt,
  ...props
}: ComponentProps<'img'> & ExtraProps) {
  void node;
  const context = useContext(MarkdownAssetContext);
  const [resolved, setResolved] = useState<{
    source: string;
    objectUrl: string;
  } | null>(null);
  const isManaged = src?.startsWith('kanleaf-asset://') ?? false;

  useEffect(() => {
    if (!isManaged || !src || !context) return;
    let active = true;
    let objectUrl: string | null = null;
    void readMarkdownAsset(context, src)
      .then((next) => {
        objectUrl = next;
        if (active) setResolved({ source: src, objectUrl: next });
        else URL.revokeObjectURL(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [context, isManaged, src]);

  const resolvedSource =
    resolved && resolved.source === src ? resolved.objectUrl : null;
  if (isManaged && !resolvedSource) {
    return (
      <span className="markdown-image-loading">{alt || 'Loading image…'}</span>
    );
  }
  return <img {...props} src={resolvedSource ?? src} alt={alt ?? ''} />;
}

function nativeScrollbarClassName(className: string | undefined) {
  return ['ui-native-scrollbar', className].filter(Boolean).join(' ');
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
