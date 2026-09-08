import { createContext, useContext, type AriaAttributes } from 'react';

export interface FormFieldContextValue {
  controlId: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
}

export const FormFieldContext = createContext<FormFieldContextValue | null>(
  null,
);

interface FormFieldControlOptions {
  id?: string;
  describedBy?: string;
  ariaInvalid?: AriaAttributes['aria-invalid'];
  invalid?: boolean;
  required?: boolean;
}

export function useFormFieldControl({
  id,
  describedBy,
  ariaInvalid,
  invalid = false,
  required,
}: FormFieldControlOptions) {
  const field = useContext(FormFieldContext);
  return {
    id: id ?? field?.controlId,
    describedBy: mergeFormFieldIds(describedBy, field?.describedBy),
    ariaInvalid: ariaInvalid ?? (invalid || field?.invalid ? true : undefined),
    required: required ?? field?.required,
  };
}

export function mergeFormFieldIds(...values: (string | undefined)[]) {
  const ids = values
    .flatMap((value) => value?.split(/\s+/) ?? [])
    .filter(Boolean);
  return ids.length > 0 ? [...new Set(ids)].join(' ') : undefined;
}
