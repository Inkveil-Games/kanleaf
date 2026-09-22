import type { ReactElement, ReactNode } from 'react';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';

interface SelectPropertyEditorProps {
  name: string;
  onNameChange?: (name: string) => void;
  nameReadOnly?: boolean;
  nameAutoFocus?: boolean;
  typeLabel: string;
  typeControl?: ReactElement;
  typeHint?: string;
  description: string;
  onDescriptionChange: (description: string) => void;
  values: ReactNode;
  footer: ReactNode;
  disabled?: boolean;
  error?: string | null;
}

export function SelectPropertyEditor({
  name,
  onNameChange,
  nameReadOnly = false,
  nameAutoFocus = false,
  typeLabel,
  typeControl,
  typeHint,
  description,
  onDescriptionChange,
  values,
  footer,
  disabled = false,
  error,
}: SelectPropertyEditorProps) {
  return (
    <div className="select-property-editor">
      <div className="select-property-identity">
        <FormField label="Name" required={!nameReadOnly}>
          <Input
            autoFocus={nameAutoFocus}
            required={!nameReadOnly}
            maxLength={120}
            disabled={disabled || nameReadOnly}
            value={name}
            onChange={(event) => onNameChange?.(event.target.value)}
          />
        </FormField>
        <FormField label="Type" hint={typeHint}>
          {typeControl ?? <Input disabled value={typeLabel} />}
        </FormField>
      </div>
      <section className="select-property-description">
        <h2>Property description</h2>
        <Textarea
          aria-label="Property description"
          maxLength={500}
          disabled={disabled}
          value={description}
          placeholder="What should this property capture?"
          onChange={(event) => onDescriptionChange(event.target.value)}
        />
      </section>
      <section className="select-property-values">{values}</section>
      {error ? (
        <p className="settings-error select-property-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer className="property-editor-actions">{footer}</footer>
    </div>
  );
}
