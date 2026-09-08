import { forwardRef, type InputHTMLAttributes } from 'react';
import { useFormFieldControl } from '../FormField/FormFieldContext';
import '../formControl.css';
import './Input.css';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    invalid = false,
    className,
    id,
    required,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    ...inputProps
  },
  ref,
) {
  const field = useFormFieldControl({
    id,
    describedBy: ariaDescribedBy,
    ariaInvalid,
    invalid,
    required,
  });

  return (
    <input
      {...inputProps}
      ref={ref}
      className={`ui-input${className ? ` ${className}` : ''}`}
      id={field.id}
      required={field.required}
      aria-describedby={field.describedBy}
      aria-invalid={field.ariaInvalid}
    />
  );
});
