import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { ApiError } from '../../lib/api/client';
import { errorMessage } from '../settings/utils';
import { normalizeWorkspaceIdentifier } from './workspaceIdentifier';

const RESERVED_IDENTIFIERS = new Set(['api', 'assets', 'host', 'setup', 'w']);

export interface WorkspaceIdentity {
  name: string;
  identifier: string;
}

interface WorkspaceIdentityFormProps {
  submitLabel: string;
  onSubmit: (identity: WorkspaceIdentity) => Promise<unknown>;
  onCancel?: () => void;
  initialName?: string;
}

export function WorkspaceIdentityForm({
  submitLabel,
  onSubmit,
  onCancel,
  initialName = '',
}: WorkspaceIdentityFormProps) {
  const [name, setName] = useState(initialName);
  const [identifier, setIdentifier] = useState(() =>
    normalizeWorkspaceIdentifier(initialName),
  );
  const [identifierEdited, setIdentifierEdited] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [identifierError, setIdentifierError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function changeName(nextName: string) {
    setName(nextName);
    setNameError(null);
    setFormError(null);
    if (!identifierEdited) {
      setIdentifier(normalizeWorkspaceIdentifier(nextName));
      setIdentifierError(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName) {
      setNameError('Enter a Workspace name');
      setIdentifierError(null);
      setFormError(null);
      return;
    }
    const validationError = validateWorkspaceIdentifier(identifier);
    if (validationError) {
      setNameError(null);
      setIdentifierError(validationError);
      setFormError(null);
      return;
    }

    setSubmitting(true);
    setNameError(null);
    setIdentifierError(null);
    setFormError(null);
    try {
      await onSubmit({ name: normalizedName, identifier });
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 409 || error.code.includes('conflict'))
      ) {
        setIdentifierError(error.message);
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="settings-form workspace-identity-form"
      onSubmit={(event) => void submit(event)}
    >
      <FormField label="Workspace name" error={nameError} required>
        <Input
          required
          maxLength={120}
          value={name}
          onChange={(event) => changeName(event.target.value)}
          autoFocus
        />
      </FormField>
      <FormField
        label="Workspace ID"
        required
        error={identifierError}
        hint={
          identifierError
            ? undefined
            : `Your Workspace URL starts with /${identifier || 'workspace-id'}.`
        }
        action={
          <Button
            variant="text"
            size="sm"
            type="button"
            onClick={() => {
              setIdentifier(normalizeWorkspaceIdentifier(name));
              setIdentifierEdited(false);
              setIdentifierError(null);
              setFormError(null);
            }}
          >
            Reset from name
          </Button>
        }
      >
        <Input
          required
          minLength={2}
          maxLength={48}
          value={identifier}
          onChange={(event) => {
            setIdentifier(event.target.value);
            setIdentifierEdited(true);
            setIdentifierError(null);
            setFormError(null);
          }}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
        />
      </FormField>
      {formError ? (
        <p className="settings-error" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="workspace-identity-actions">
        {onCancel ? (
          <Button
            variant="secondary"
            type="button"
            disabled={submitting}
            onClick={onCancel}
          >
            Cancel
          </Button>
        ) : null}
        <Button
          variant="primary"
          type="submit"
          loading={submitting}
          loadingLabel="Creating…"
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function validateWorkspaceIdentifier(identifier: string) {
  if (RESERVED_IDENTIFIERS.has(identifier)) {
    return 'This Workspace ID is reserved';
  }
  if (identifier.length < 2 || identifier.length > 48) {
    return 'Use between 2 and 48 characters';
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(identifier)) {
    return 'Use lowercase letters, numbers, and single hyphens only';
  }
  return null;
}
