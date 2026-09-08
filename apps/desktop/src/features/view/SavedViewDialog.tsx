import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { IconButton } from '../../components/ui/IconButton';
import { Input } from '../../components/ui/Input';
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
          <IconButton
            variant="ghost"
            size="sm"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            <X aria-hidden="true" size={15} />
          </IconButton>
        </header>
        <form onSubmit={(event) => void submit(event)}>
          <FormField label="Name" required>
            <Input
              autoFocus
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
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
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              loading={submitting}
              loadingLabel="Saving View"
            >
              {submitLabel}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  );
}
