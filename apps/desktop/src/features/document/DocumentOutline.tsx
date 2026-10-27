import { ChevronDown } from 'lucide-react';
import {
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';
import { ScrollArea } from '../../components/ui/ScrollArea';
import {
  activeHeadingIndex,
  DocumentOutlineContext,
  outlineTree,
  type OutlineNode,
  type OutlineSnapshot,
} from '../markdown/documentOutline';

// Open or closed is one device preference shared by every note, unlike the
// per-note section collapse state below.
const OUTLINE_OPEN_KEY = 'kanleaf.library.outline-open';

function readOutlineOpen() {
  try {
    return localStorage.getItem(OUTLINE_OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

function writeOutlineOpen(open: boolean) {
  try {
    localStorage.setItem(OUTLINE_OPEN_KEY, String(open));
  } catch {
    // The outline still toggles for this session without local storage.
  }
}

// Collapse state survives edits that shift offsets, so key by level and text.
const nodeKey = (node: OutlineNode) =>
  `${node.heading.depth}:${node.heading.text}`;

export function DocumentOutline() {
  const store = useContext(DocumentOutlineContext);
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.getSnapshot ?? emptySnapshot,
  );
  const [open, setOpen] = useState(readOutlineOpen);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const tree = useMemo(
    () => outlineTree(snapshot.headings),
    [snapshot.headings],
  );
  const active = activeHeadingIndex(snapshot.headings, snapshot.activeOffset);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!store) return null;
  const outline = store;

  function toggle(node: OutlineNode) {
    const key = nodeKey(node);
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    // Items inside collapsed groups are inert, so only visible ones match.
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        '.document-outline-item:not([inert] *)',
      ) ?? [],
    );
    const current = items.indexOf(
      globalThis.document.activeElement as HTMLButtonElement,
    );
    const next = items[current + (event.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  }

  function renderNodes(nodes: OutlineNode[]) {
    return nodes.map((node) => {
      const isCollapsed = collapsed.has(nodeKey(node));
      const isActive = node.index === active;
      return (
        <div
          key={`${node.index}:${nodeKey(node)}`}
          className="document-outline-node"
        >
          <div className="document-outline-row">
            <button
              type="button"
              className="document-outline-item"
              data-active={isActive}
              aria-current={isActive ? 'location' : undefined}
              title={node.heading.text}
              onClick={() => outline.reveal(node.heading)}
            >
              {node.heading.text}
            </button>
            {node.children.length > 0 && (
              <button
                type="button"
                className="document-outline-toggle"
                aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${node.heading.text}`}
                aria-expanded={!isCollapsed}
                onClick={() => toggle(node)}
              >
                <ChevronDown aria-hidden="true" size={13} />
              </button>
            )}
          </div>
          {node.children.length > 0 && (
            <div
              className="document-outline-collapsible document-outline-children"
              data-open={!isCollapsed}
              inert={isCollapsed}
            >
              <div>{renderNodes(node.children)}</div>
            </div>
          )}
        </div>
      );
    });
  }

  return (
    <section className="document-outline" aria-labelledby={titleId}>
      <h2 className="document-outline-heading">
        <button
          id={titleId}
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => {
            setOpen(!open);
            writeOutlineOpen(!open);
          }}
        >
          <ChevronDown aria-hidden="true" size={14} />
          Outline
        </button>
      </h2>
      <div
        id={bodyId}
        className="document-outline-collapsible"
        data-open={open}
        inert={!open}
      >
        <div>
          <ScrollArea
            className="document-outline-scroll-area"
            orientation="vertical"
            ref={listRef}
            viewportProps={{
              className: 'document-outline-list',
              'aria-label': 'Note outline',
              onKeyDown: moveFocus,
            }}
          >
            {tree.length > 0
              ? renderNodes(tree)
              : // Stay blank while a note loads, so nothing flashes.
                snapshot.attached && (
                  <p className="document-outline-empty">
                    This note has no sections
                  </p>
                )}
          </ScrollArea>
        </div>
      </div>
    </section>
  );
}

const EMPTY_SNAPSHOT: OutlineSnapshot = {
  headings: [],
  activeOffset: null,
  attached: false,
};
const noopSubscribe = () => () => {};
const emptySnapshot = () => EMPTY_SNAPSHOT;
