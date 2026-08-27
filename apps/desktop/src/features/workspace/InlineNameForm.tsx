import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';

interface InlineNameFormProps {
  label: string;
  initialValue?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}

export function InlineNameForm({
  label,
  initialValue = '',
  submitLabel,
  onSubmit,
  onCancel,
}: InlineNameFormProps) {
  const [name, setName] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed');
      setSubmitting(false);
    }
  }

  return (
    <form className="inline-name-form" onSubmit={(event) => void submit(event)}>
      <label>
        <span className="sr-only">{label}</span>
        <input
          autoFocus
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancel();
          }}
        />
      </label>
      <button type="submit" disabled={submitting} aria-label={submitLabel}>
        <Plus aria-hidden="true" size={14} />
      </button>
      <button type="button" onClick={onCancel} aria-label="Cancel">
        ×
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
