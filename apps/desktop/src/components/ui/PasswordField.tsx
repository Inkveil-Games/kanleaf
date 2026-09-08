import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useState } from 'react';
import { IconButton } from './IconButton';
import { Input, type InputProps } from './Input';
import './PasswordField.css';

export interface PasswordFieldProps extends Omit<InputProps, 'type'> {
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
        <Input
          {...inputProps}
          ref={ref}
          disabled={disabled}
          type={visible ? 'text' : 'password'}
        />
        <IconButton
          className="password-field-toggle"
          aria-label={`${action} ${visibilityLabel}`}
          aria-pressed={visible}
          disabled={disabled}
          onClick={() => setVisible((current) => !current)}
        >
          <Icon aria-hidden="true" size={16} />
        </IconButton>
      </span>
    );
  },
);
