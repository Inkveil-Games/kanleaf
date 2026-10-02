import type { ReactElement, ReactNode } from 'react';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { InlineAlert } from '../../components/ui/InlineAlert';
import { PropertyTypeInput } from './PropertyTypeInput';
import { Textarea } from '../../components/ui/Textarea';

interface SelectPropertyEditorProps {
  name: string;
  onNameChange?: (name: string) => void;
  nameReadOnly?: boolean;
  nameAutoFocus?: boolean;
  typeLabel: string;
  typeControl?: ReactElement;
  description: string;
  descriptionReadOnly?: boolean;
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
  description,
  descriptionReadOnly = false,
  onDescriptionChange,
  values,
  footer,
  disabled = false,
  error,
}: SelectPropertyEditorProps) {
  return (
    <div className="select-property-editor">
      <div className="select-property-metadata">
        <div className="select-property-identity">
          <FormField label="Name" required={!nameReadOnly}>
            <Input
              autoFocus={nameAutoFocus}
              required={!nameReadOnly}
              maxLength={120}
              disabled={disabled && !nameReadOnly}
              readOnly={nameReadOnly}
              value={name}
              onChange={(event) => onNameChange?.(event.target.value)}
            />
          </FormField>
          <FormField label="Type">
            {typeControl ?? <PropertyTypeInput value={typeLabel} />}
          </FormField>
        </div>
        <FormField
          label="Property description"
          className="select-property-description"
        >
          <Textarea
            rows={2}
            maxLength={500}
            disabled={disabled && !descriptionReadOnly}
            readOnly={descriptionReadOnly}
            value={description}
            placeholder="What should this property capture?"
            onChange={(event) => onDescriptionChange(event.target.value)}
          />
        </FormField>
      </div>
      <section className="select-property-values ui-native-scrollbar">
        {values}
      </section>
      {error ? (
        <InlineAlert variant="danger" className="select-property-error">
          {error}
        </InlineAlert>
      ) : null}
      <footer className="property-editor-actions">{footer}</footer>
    </div>
  );
}
