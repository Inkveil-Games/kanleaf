import { X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Select, type SelectOption } from '../../components/ui/Select';
import { errorMessage } from '../settings/utils';

export function ConfigurationDeleteDialog({
  entityName,
  entityType,
  explanation,
  onClose,
  onDelete,
  replacementOptions = [],
}: {
  entityName: string;
  entityType: string;
  explanation: string;
  onClose: () => void;
  onDelete: (replacementId?: string) => Promise<void>;
  replacementOptions?: SelectOption[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [replacementId, setReplacementId] = useState(
    replacementOptions[0]?.value ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const title = `Delete ${entityName}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !window.confirm(`${title}?`)) return;
    setSaving(true);
    setError(null);
    try {
      await onDelete(replacementId || undefined);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="configuration-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <header>
          <div>
            <span className="dialog-step-label">Permanent action</span>
            <h2>{title}</h2>
            <p>{explanation}</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label={`Close ${entityType} deletion`}
            disabled={saving}
            onClick={onClose}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>
        {replacementOptions.length > 0 ? (
          <label className="settings-field">
            Replacement for {entityName}
            <Select
              ariaLabel={`Replacement for ${entityName}`}
              disabled={saving}
              value={replacementId}
              options={replacementOptions}
              onValueChange={setReplacementId}
            />
            <small>Used tasks are moved to this {entityType}.</small>
          </label>
        ) : null}
        {error ? (
          <p className="settings-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <button
            className="secondary-button"
            type="button"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="danger-button" type="submit" disabled={saving}>
            {saving ? 'Deleting…' : 'Delete'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
