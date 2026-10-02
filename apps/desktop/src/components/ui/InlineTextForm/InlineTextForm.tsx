import { X } from 'lucide-react';
import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Button } from '../Button';
import { IconButton } from '../IconButton';
import { Input } from '../Input';
import './InlineTextForm.css';

export interface InlineTextFormProps {
  label: string;
  initialValue?: string;
  placeholder?: string;
  maxLength: number;
  submitLabel: string;
  loadingLabel?: string;
  cancelLabel?: string;
  errorLabel?: string;
  onSubmit: (value: string) => Promise<void>;
  onCancel: () => void;
  leading?: ReactNode;
  submitIcon?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function InlineTextForm({
  label,
  initialValue = '',
  placeholder,
  maxLength,
  submitLabel,
  loadingLabel,
  cancelLabel = 'Cancel',
  errorLabel = 'Request failed',
  onSubmit,
  onCancel,
  leading,
  submitIcon,
  className,
  style,
}: InlineTextFormProps) {
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const composingRef = useRef(false);
  const errorId = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || composingRef.current || !value.trim()) return;
    pendingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(value);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : errorLabel);
    } finally {
      pendingRef.current = false;
      setSubmitting(false);
    }
  }

  function cancel() {
    if (!pendingRef.current && !composingRef.current) onCancel();
  }

  return (
    <form
      className={`ui-inline-text-form${className ? ` ${className}` : ''}`}
      style={style}
      data-leading={leading ? true : undefined}
      aria-busy={submitting || undefined}
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          composingRef.current ||
          event.nativeEvent.isComposing ||
          event.nativeEvent.keyCode === 229
        ) {
          if (event.key === 'Enter') event.preventDefault();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
    >
      {leading && (
        <span className="ui-inline-text-form-leading">{leading}</span>
      )}
      <Input
        autoFocus
        required
        aria-label={label}
        aria-describedby={error ? errorId : undefined}
        invalid={Boolean(error)}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        readOnly={submitting}
        onChange={(event) => setValue(event.target.value)}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
      />
      {submitIcon ? (
        <IconButton
          variant="primary"
          size="sm"
          type="submit"
          aria-label={submitLabel}
          loading={submitting}
          loadingLabel={loadingLabel}
        >
          {submitIcon}
        </IconButton>
      ) : (
        <Button
          variant="primary"
          size="sm"
          type="submit"
          loading={submitting}
          loadingLabel={loadingLabel}
        >
          {submitLabel}
        </Button>
      )}
      <IconButton
        variant="ghost"
        size="sm"
        type="button"
        aria-label={cancelLabel}
        disabled={submitting}
        onClick={cancel}
      >
        <X aria-hidden="true" size={14} />
      </IconButton>
      {error && (
        <p id={errorId} className="ui-inline-text-form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
