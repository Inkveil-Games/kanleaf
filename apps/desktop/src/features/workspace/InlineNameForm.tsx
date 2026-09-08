import { Plus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { IconButton } from '../../components/ui/IconButton';
import { Input } from '../../components/ui/Input';

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
        <Input
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
      <IconButton
        variant="primary"
        size="sm"
        type="submit"
        loading={submitting}
        aria-label={submitLabel}
      >
        <Plus aria-hidden="true" size={14} />
      </IconButton>
      <IconButton
        variant="ghost"
        size="sm"
        type="button"
        onClick={onCancel}
        aria-label="Cancel"
      >
        <X aria-hidden="true" size={14} />
      </IconButton>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
