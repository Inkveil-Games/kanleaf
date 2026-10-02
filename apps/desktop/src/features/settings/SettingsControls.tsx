import { useId, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { LoadError as SharedLoadError } from '../../components/ui/LoadError';
import { Switch } from '../../components/ui/Switch';
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
  retrying,
}: {
  error: unknown;
  onRetry: () => unknown;
  retrying?: boolean;
}) {
  return (
    <SharedLoadError
      title="Could not load this setting"
      description={errorMessage(error)}
      onRetry={onRetry}
      retrying={retrying}
    />
  );
}

export function SettingsToggleRow({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  description: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const switchId = useId();
  const labelId = useId();
  const descriptionId = useId();

  return (
    <label className="settings-row settings-toggle-row" htmlFor={switchId}>
      <span>
        <strong id={labelId}>{label}</strong>
        <small id={descriptionId}>{description}</small>
      </span>
      <Switch
        id={switchId}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(nextChecked) => onCheckedChange(nextChecked)}
      />
    </label>
  );
}
