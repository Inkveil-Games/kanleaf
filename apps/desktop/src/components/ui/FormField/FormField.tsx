import {
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';
import { FormFieldContext, mergeFormFieldIds } from './FormFieldContext';
import './FormField.css';

export interface FormFieldProps {
  label: ReactNode;
  children: ReactElement;
  description?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  action?: ReactNode;
  required?: boolean;
  controlId?: string;
  className?: string;
}

export function FormField({
  label,
  children,
  description,
  hint,
  error,
  action,
  required = false,
  controlId,
  className,
}: FormFieldProps) {
  const generatedId = useId();
  const childId = isValidElement<{ id?: string }>(children)
    ? children.props.id
    : undefined;
  const resolvedControlId = controlId ?? childId ?? `${generatedId}-control`;
  const descriptionId = description ? `${generatedId}-description` : undefined;
  const hintId = hint ? `${generatedId}-hint` : undefined;
  const errorId = error ? `${generatedId}-error` : undefined;
  const describedBy = mergeFormFieldIds(descriptionId, hintId, errorId);

  return (
    <div className={`ui-form-field${className ? ` ${className}` : ''}`}>
      <div className="ui-form-field-label-row">
        <label className="ui-form-field-label" htmlFor={resolvedControlId}>
          {label}
          {required ? (
            <span className="ui-form-field-required" aria-hidden="true" />
          ) : null}
        </label>
        {action ? <span className="ui-form-field-action">{action}</span> : null}
      </div>
      {description ? (
        <p className="ui-form-field-description" id={descriptionId}>
          {description}
        </p>
      ) : null}
      <FormFieldContext.Provider
        value={{
          controlId: resolvedControlId,
          describedBy,
          invalid: Boolean(error),
          required,
        }}
      >
        {children}
      </FormFieldContext.Provider>
      {hint || error ? (
        <div className="ui-form-field-messages">
          {hint ? (
            <p className="ui-form-field-hint" id={hintId}>
              {hint}
            </p>
          ) : null}
          {error ? (
            <p className="ui-form-field-error" id={errorId} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
