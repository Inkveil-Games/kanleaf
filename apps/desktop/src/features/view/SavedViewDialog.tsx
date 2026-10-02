import { useId, useRef, useState, type FormEvent } from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import type { SavedViewVisibility } from './types';
import './SavedViewDialog.css';

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

  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(false);
  const composingRef = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pendingRef.current || composingRef.current || !name.trim()) return;
    pendingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(name, visibility);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'View save failed');
      pendingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <AppDialog
      type="custom"
      open
      title={title}
      formId={formId}
      initialFocus={nameRef}
      loading={submitting}
      error={error}
      confirmLabel={submitLabel}
      loadingLabel="Saving View"
      onOpenChange={(open) => {
        if (!open && !pendingRef.current) onClose();
      }}
    >
      <form
        id={formId}
        className="saved-view-form"
        onSubmit={(event) => void submit(event)}
      >
        <FormField label="Name" required>
          <Input
            ref={nameRef}
            required
            maxLength={120}
            value={name}
            readOnly={submitting}
            onChange={(event) => setName(event.target.value)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={(event) => {
              if (
                composingRef.current ||
                event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229
              ) {
                event.stopPropagation();
                if (event.key === 'Enter') event.preventDefault();
              }
            }}
          />
        </FormField>
        {showVisibility && (
          <fieldset disabled={submitting}>
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
      </form>
    </AppDialog>
  );
}
