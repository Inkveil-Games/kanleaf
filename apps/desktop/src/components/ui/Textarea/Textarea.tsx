import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { useFormFieldControl } from '../FormField/FormFieldContext';
import '../formControl.css';
import './Textarea.css';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      invalid = false,
      className,
      id,
      required,
      'aria-describedby': ariaDescribedBy,
      'aria-invalid': ariaInvalid,
      ...textareaProps
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
      <textarea
        {...textareaProps}
        ref={ref}
        className={`ui-textarea${className ? ` ${className}` : ''}`}
        id={field.id}
        required={field.required}
        aria-describedby={field.describedBy}
        aria-invalid={field.ariaInvalid}
      />
    );
  },
);
