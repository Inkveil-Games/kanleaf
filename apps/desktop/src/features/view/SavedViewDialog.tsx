import { useEffect, useState, type FormEvent } from 'react';
import type { SavedViewVisibility } from './types';

interface SavedViewDialogProps {
  title: string;
  initialName: string;
  initialVisibility: SavedViewVisibility;
  showVisibility?: boolean;
  canShare: boolean;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (name: string, visibility: SavedViewVisibility) => Promise<void>;
}

export function SavedViewDialog({
  title,
  initialName,
  initialVisibility,
  showVisibility = true,
  canShare,
  submitLabel,
  onClose,
  onSubmit,
}: SavedViewDialogProps) {
  const [name, setName] = useState(initialName);
  const [visibility, setVisibility] = useState(initialVisibility);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', closeWithEscape);
    return () => document.removeEventListener('keydown', closeWithEscape);
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(name, visibility);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'View save failed');
      setSubmitting(false);
    }
  }

  return (
    <div
      className="view-dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="view-dialog" role="dialog" aria-modal="true">
        <header>
          <h2>{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            <span>Name</span>
            <input
              autoFocus
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {showVisibility && (
            <fieldset>
              <legend>Visibility</legend>
              <label>
                <input
                  type="radio"
                  name="view-visibility"
                  value="personal"
                  checked={visibility === 'personal'}
                  onChange={() => setVisibility('personal')}
                />
                <span>
                  Personal
                  <small>Only you can open this View.</small>
                </span>
              </label>
              <label aria-disabled={!canShare}>
                <input
                  type="radio"
                  name="view-visibility"
                  value="shared"
                  disabled={!canShare}
                  checked={visibility === 'shared'}
                  onChange={() => setVisibility('shared')}
                />
                <span>
                  Shared
                  <small>Visible to everyone with access to this scope.</small>
                </span>
              </label>
            </fieldset>
          )}
          {error && <p role="alert">{error}</p>}
          <footer>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Saving…' : submitLabel}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
