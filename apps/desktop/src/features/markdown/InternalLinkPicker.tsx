import { FileText, SquareCheckBig } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { InternalLinkTrigger } from './internalLinkController';
import type { InternalLinkEntry } from './internalLinks';

export function InternalLinkPicker({
  trigger,
  results,
  activeIndex,
  loading,
  onHover,
  onPick,
}: {
  trigger: InternalLinkTrigger;
  results: InternalLinkEntry[];
  activeIndex: number;
  loading: boolean;
  onHover: (index: number) => void;
  onPick: (entry: InternalLinkEntry) => void;
}) {
  const below = trigger.rect.bottom + 260 < window.innerHeight;
  const style = {
    left: Math.max(8, Math.min(trigger.rect.left, window.innerWidth - 328)),
    ...(below
      ? { top: trigger.rect.bottom + 6 }
      : { bottom: window.innerHeight - trigger.rect.top + 6 }),
  };

  return createPortal(
    <div className="internal-link-picker" style={style}>
      <div
        className="internal-link-picker-list"
        role="listbox"
        aria-label="Link to page or Task"
      >
        {results.map((entry, index) => (
          <div
            key={`${entry.kind}:${entry.id}`}
            role="option"
            aria-selected={index === activeIndex}
            className="internal-link-picker-option"
            onMouseEnter={() => onHover(index)}
            onMouseDown={(event) => {
              // Keep focus (and the caret) in the editor that opened the list.
              event.preventDefault();
              onPick(entry);
            }}
          >
            {entry.kind === 'task' ? (
              <SquareCheckBig aria-hidden="true" size={14} />
            ) : (
              <FileText aria-hidden="true" size={14} />
            )}
            <span className="internal-link-picker-title">{entry.title}</span>
            <span className="internal-link-picker-hint">{entry.hint}</span>
          </div>
        ))}
        {results.length === 0 && (
          <p className="internal-link-picker-empty">
            {loading
              ? 'Loading pages and Tasks…'
              : trigger.query
                ? `No page or Task matches “${trigger.query}”`
                : 'No pages or Tasks yet'}
          </p>
        )}
      </div>
      <p className="internal-link-picker-footer" aria-hidden="true">
        <kbd>↑</kbd>
        <kbd>↓</kbd> choose · <kbd>↵</kbd> link · <kbd>esc</kbd> close
      </p>
    </div>,
    document.body,
  );
}
