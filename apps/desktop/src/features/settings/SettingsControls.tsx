import { Button } from '../../components/ui/Button';
import { errorMessage } from './utils';

export interface ActionState {
  status: 'idle' | 'saving' | 'saved' | 'error';
  message?: string;
}

export function FormActions({
  state,
  label,
}: {
  state: ActionState;
  label: string;
}) {
  return (
    <div className="settings-form-actions">
      <Button
        variant="primary"
        size="sm"
        type="submit"
        loading={state.status === 'saving'}
      >
        {label}
      </Button>
      <ActionMessage state={state} />
    </div>
  );
}

export function ActionMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <span
      className={
        state.status === 'error' ? 'settings-error' : 'settings-success'
      }
      role={state.status === 'error' ? 'alert' : 'status'}
    >
      {state.message}
    </span>
  );
}

export function LoadError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => unknown;
}) {
  return (
    <div className="settings-empty" role="alert">
      <strong>Could not load this setting</strong>
      <p>{errorMessage(error)}</p>
      <button className="secondary-button" type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
