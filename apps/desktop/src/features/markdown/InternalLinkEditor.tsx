import { ExternalLink, FileText, SquareCheckBig, Unlink } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../components/ui/Button';
import type { InternalLinkEdit } from './internalLinkController';
import {
  formatInternalLink,
  internalLinkLabel,
  parseInternalLink,
  searchInternalLinks,
  type InternalLinkEntry,
  type InternalLinkIndex,
} from './internalLinks';

export function InternalLinkEditor({
  edit,
  index,
  onOpen,
  onClose,
}: {
  edit: InternalLinkEdit;
  index: InternalLinkIndex | null;
  onOpen: (raw: string) => void;
  onClose: () => void;
}) {
  const parts = parseInternalLink(edit.raw);
  const current = parts && index ? index.resolve(parts.target) : null;
  const [alias, setAlias] = useState(parts?.alias ?? '');
  const [chosen, setChosen] = useState<InternalLinkEntry | null>(null);
  const [query, setQuery] = useState(current?.title ?? parts?.target ?? '');
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(0);
  const panelRef = useRef<HTMLFormElement>(null);
  const aliasId = useId();
  const targetId = useId();
  const listId = useId();

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', closeOutside, true);
    return () =>
      document.removeEventListener('pointerdown', closeOutside, true);
  }, [onClose]);

  if (!parts) return null;
  const target = chosen ?? current;
  const results = listOpen && index ? searchInternalLinks(index, query, 6) : [];
  const naturalLabel = internalLinkLabel(
    {
      target: parts.target,
      heading: chosen ? null : parts.heading,
      alias: null,
    },
    target,
  );
  const below = edit.rect.bottom + 280 < window.innerHeight;

  function cancel() {
    onClose();
    edit.dismiss();
  }

  function choose(entry: InternalLinkEntry) {
    setChosen(entry);
    setQuery(entry.title);
    setListOpen(false);
  }

  function targetKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!listOpen) {
        setListOpen(true);
        setActive(0);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((value) =>
        results.length ? (value + step + results.length) % results.length : 0,
      );
    } else if (event.key === 'Enter' && listOpen) {
      // Enter picks the suggestion; it only saves once the list is closed.
      event.preventDefault();
      const entry = results[active];
      if (entry) choose(entry);
    } else if (event.key === 'Escape' && listOpen) {
      event.preventDefault();
      event.stopPropagation();
      setListOpen(false);
    }
  }

  return createPortal(
    <form
      ref={panelRef}
      className="internal-link-editor"
      role="dialog"
      aria-label="Edit link"
      style={{
        left: Math.max(8, Math.min(edit.rect.left, window.innerWidth - 328)),
        ...(below
          ? { top: edit.rect.bottom + 6 }
          : { bottom: window.innerHeight - edit.rect.top + 6 }),
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!parts) return;
        const retargeted = chosen && chosen.id !== current?.id;
        onClose();
        edit.setRaw(
          formatInternalLink({
            target:
              retargeted && index ? index.linkTarget(chosen) : parts.target,
            heading: retargeted ? null : parts.heading,
            alias: alias.trim() || null,
          }),
        );
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
    >
      <div className="internal-link-editor-target">
        {current?.kind === 'task' ? (
          <SquareCheckBig aria-hidden="true" size={14} />
        ) : (
          <FileText aria-hidden="true" size={14} />
        )}
        <span>
          {current
            ? internalLinkLabel({ ...parts, alias: null }, current)
            : `${parts.target} (not found)`}
        </span>
        {current && (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => {
              onClose();
              onOpen(edit.raw);
            }}
          >
            <ExternalLink aria-hidden="true" size={14} /> Open
          </Button>
        )}
      </div>
      <label className="internal-link-editor-field" htmlFor={targetId}>
        Link to
      </label>
      <div className="internal-link-editor-combobox">
        <input
          id={targetId}
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            listOpen && results[active] ? `${listId}-${active}` : undefined
          }
          autoComplete="off"
          value={query}
          placeholder="Search pages and Tasks"
          onChange={(event) => {
            setQuery(event.target.value);
            setListOpen(true);
            setActive(0);
          }}
          onKeyDown={targetKeyDown}
          onBlur={() => setListOpen(false)}
        />
        {listOpen && (
          <div
            id={listId}
            role="listbox"
            aria-label="Pages and Tasks"
            className="internal-link-editor-results"
          >
            {results.map((entry, position) => (
              <div
                key={`${entry.kind}:${entry.id}`}
                id={`${listId}-${position}`}
                role="option"
                aria-selected={position === active}
                className="internal-link-picker-option"
                onMouseEnter={() => setActive(position)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(entry);
                }}
              >
                {entry.kind === 'task' ? (
                  <SquareCheckBig aria-hidden="true" size={14} />
                ) : (
                  <FileText aria-hidden="true" size={14} />
                )}
                <span className="internal-link-picker-title">
                  {entry.title}
                </span>
                <span className="internal-link-picker-hint">{entry.hint}</span>
              </div>
            ))}
            {results.length === 0 && (
              <p className="internal-link-picker-empty">
                {index ? 'No page or Task matches' : 'Loading pages and Tasks…'}
              </p>
            )}
          </div>
        )}
      </div>
      <label className="internal-link-editor-field" htmlFor={aliasId}>
        Display text
      </label>
      <input
        id={aliasId}
        autoFocus
        maxLength={200}
        value={alias}
        placeholder={naturalLabel}
        onChange={(event) => setAlias(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
      />
      <p className="internal-link-editor-hint">
        Leave empty to show the current title.
      </p>
      <div className="internal-link-editor-actions">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => {
            onClose();
            edit.setRaw(null);
          }}
        >
          <Unlink aria-hidden="true" size={14} /> Remove link
        </Button>
        <Button variant="primary" size="sm" type="submit">
          Save
        </Button>
      </div>
    </form>,
    document.body,
  );
}
