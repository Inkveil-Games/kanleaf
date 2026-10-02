import { Check, Copy } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from '../Button';
import './CopyButton.css';

export interface CopyButtonProps {
  text: string;
  label: string;
  successLabel?: string;
  errorLabel?: string;
  pendingLabel?: string;
  disabled?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
  className?: string;
}

export function CopyButton(props: CopyButtonProps) {
  // A new value owns fresh feedback; older clipboard results cannot describe it.
  return <CopyButtonValue key={props.text} {...props} />;
}

function CopyButtonValue({
  text,
  label,
  successLabel = 'Copied',
  errorLabel = 'Copy failed. Select and copy the content manually.',
  pendingLabel = 'Copying…',
  disabled,
  size = 'sm',
  variant = 'secondary',
  className,
}: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'pending' | 'success' | 'error'>(
    'idle',
  );
  const pending = useRef(false);
  const mounted = useRef(true);
  const feedbackId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (state !== 'success') return;
    const timeout = window.setTimeout(() => setState('idle'), 2500);
    return () => window.clearTimeout(timeout);
  }, [state]);

  async function copy() {
    if (pending.current || disabled) return;
    pending.current = true;
    setState('pending');
    try {
      await navigator.clipboard.writeText(text);
      if (mounted.current) setState('success');
    } catch {
      if (mounted.current) setState('error');
    } finally {
      pending.current = false;
    }
  }

  const feedback =
    state === 'success' ? successLabel : state === 'error' ? errorLabel : null;
  return (
    <span className={`ui-copy-button${className ? ` ${className}` : ''}`}>
      <Button
        size={size}
        variant={variant}
        disabled={disabled}
        loading={state === 'pending'}
        loadingLabel={pendingLabel}
        aria-describedby={feedback ? feedbackId : undefined}
        onClick={() => void copy()}
      >
        {state === 'success' ? (
          <Check size={14} aria-hidden="true" />
        ) : (
          <Copy size={14} aria-hidden="true" />
        )}
        {label}
      </Button>
      {feedback ? (
        <span
          id={feedbackId}
          className="ui-copy-button-feedback"
          role={state === 'error' ? 'alert' : 'status'}
        >
          {feedback}
        </span>
      ) : null}
    </span>
  );
}
