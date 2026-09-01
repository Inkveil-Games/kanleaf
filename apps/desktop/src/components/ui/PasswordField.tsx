import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useState, type InputHTMLAttributes } from 'react';

export interface PasswordFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type'
> {
  visibilityLabel?: string;
}

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField(
    { visibilityLabel = 'password', disabled, ...inputProps },
    ref,
  ) {
    const [visible, setVisible] = useState(false);
    const action = visible ? 'Hide' : 'Show';
    const Icon = visible ? EyeOff : Eye;

    return (
      <span className="password-field">
        <input
          {...inputProps}
          ref={ref}
          disabled={disabled}
          type={visible ? 'text' : 'password'}
        />
        <button
          className="password-field-toggle"
          type="button"
          aria-label={`${action} ${visibilityLabel}`}
          aria-pressed={visible}
          disabled={disabled}
          onClick={() => setVisible((current) => !current)}
        >
          <Icon aria-hidden="true" size={16} />
        </button>
      </span>
    );
  },
);
