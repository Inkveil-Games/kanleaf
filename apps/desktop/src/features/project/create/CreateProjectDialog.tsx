import { X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/Button';
import { FormField } from '../../../components/ui/FormField';
import { IconButton } from '../../../components/ui/IconButton';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { Textarea } from '../../../components/ui/Textarea';
import { routePaths } from '../../../app/routing/routePaths';
import { ApiError } from '../../../lib/api/client';
import { normalizePublicIdentifier } from '../../../lib/publicIdentifier';
import { errorMessage } from '../../settings/utils';
import { listWorkspaceMembers, type ApiContext } from '../../workspace/api';
import type {
  Project,
  ProjectCreateInput,
  ProjectVisibility,
  Workspace,
} from '../../workspace/types';
import { ProjectIconPicker } from './ProjectIconPicker';

interface CreateProjectDialogProps {
  workspace: Workspace;
  context: ApiContext;
  currentUser: { id: string; displayName: string };
  onCreate: (input: ProjectCreateInput) => Promise<Project>;
  onClose: () => void;
}

export function CreateProjectDialog({
  workspace,
  context,
  currentUser,
  onCreate,
  onClose,
}: CreateProjectDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [identifierEdited, setIdentifierEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('folder');
  const [leadUserId, setLeadUserId] = useState(currentUser.id);
  const [visibility, setVisibility] = useState<ProjectVisibility>('private');
  const [nameError, setNameError] = useState<string | null>(null);
  const [identifierError, setIdentifierError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const members = useQuery({
    queryKey: ['workspace-members', workspace.id],
    queryFn: () => listWorkspaceMembers(context, workspace.id),
    retry: false,
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const leadOptions = [
    ...(members.data?.some(({ user_id }) => user_id === currentUser.id)
      ? []
      : [{ value: currentUser.id, label: currentUser.displayName }]),
    ...(members.data ?? [])
      .filter(({ role }) => role !== 'guest')
      .map((member) => ({
        value: member.user_id,
        label:
          member.user_id === currentUser.id
            ? `${member.display_name} (you)`
            : member.display_name,
        description:
          member.role === 'member'
            ? 'Workspace Member · Becomes Project Admin'
            : member.role === 'owner'
              ? 'Workspace Owner'
              : 'Workspace Admin',
      })),
  ];

  function close() {
    if (!submitting) onClose();
  }

  function changeName(value: string) {
    setName(value);
    setNameError(null);
    setFormError(null);
    if (!identifierEdited) {
      setIdentifier(normalizePublicIdentifier(value));
      setIdentifierError(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const normalizedName = name.trim();
    const nextIdentifierError = validateProjectIdentifier(identifier);
    if (!normalizedName || nextIdentifierError) {
      setNameError(normalizedName ? null : 'Enter a Project name');
      setIdentifierError(nextIdentifierError);
      return;
    }

    setSubmitting(true);
    setNameError(null);
    setIdentifierError(null);
    setFormError(null);
    try {
      await onCreate({
        name: normalizedName,
        identifier,
        description: description.trim(),
        icon,
        lead_user_id: leadUserId,
        visibility,
      });
      onClose();
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
    <dialog
      ref={dialogRef}
      className="project-create-dialog"
      aria-labelledby="project-create-heading"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <form
        className="project-create-window"
        onSubmit={(event) => void submit(event)}
      >
        <div className="project-cover-preview" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <ProjectIconPicker
          value={icon}
          onChange={setIcon}
          disabled={submitting}
        />
        <header>
          <div>
            <span className="dialog-step-label">New Project</span>
            <h2 id="project-create-heading">Create a Project</h2>
            <p>Shape the Project identity before inviting work into it.</p>
          </div>
          <IconButton
            type="button"
            aria-label="Close Project creation"
            disabled={submitting}
            onClick={close}
          >
            <X aria-hidden="true" size={17} />
          </IconButton>
        </header>

        <div className="project-create-content">
          <div className="project-create-identity-row">
            <FormField label="Project name" error={nameError} required>
              <Input
                autoFocus
                required
                maxLength={120}
                value={name}
                disabled={submitting}
                onChange={(event) => changeName(event.target.value)}
                placeholder="e.g. Mobile app"
              />
            </FormField>
            <FormField
              label="Project ID"
              required
              error={identifierError}
              hint={
                identifierError
                  ? undefined
                  : routePaths.project(
                      workspace.identifier,
                      identifier || 'project-id',
                    )
              }
              action={
                <Button
                  variant="text"
                  size="sm"
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    setIdentifier(normalizePublicIdentifier(name));
                    setIdentifierEdited(false);
                    setIdentifierError(null);
                  }}
                >
                  Reset
                </Button>
              }
            >
              <Input
                required
                minLength={2}
                maxLength={48}
                value={identifier}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                disabled={submitting}
                onChange={(event) => {
                  setIdentifier(event.target.value);
                  setIdentifierEdited(true);
                  setIdentifierError(null);
                }}
                placeholder="mobile-app"
              />
            </FormField>
          </div>

          <FormField
            label={
              <>
                Description <small>Optional</small>
              </>
            }
          >
            <Textarea
              rows={4}
              maxLength={2000}
              value={description}
              disabled={submitting}
              onChange={(event) => setDescription(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="What outcome is this Project responsible for?"
            />
          </FormField>

          <div className="project-create-choice-row">
            <FormField
              label="Project lead"
              error={
                members.error ? (
                  <>
                    Could not refresh members.{' '}
                    <Button
                      variant="text"
                      size="sm"
                      type="button"
                      onClick={() => void members.refetch()}
                    >
                      Retry
                    </Button>
                  </>
                ) : undefined
              }
            >
              <Select
                ariaLabel="Project lead"
                value={leadUserId}
                options={leadOptions}
                onValueChange={setLeadUserId}
                disabled={submitting}
              />
            </FormField>
            <FormField label="Visibility">
              <Select
                ariaLabel="Project visibility"
                value={visibility}
                options={[
                  {
                    value: 'private',
                    label: 'Private',
                    description: 'Project members only',
                  },
                  {
                    value: 'public',
                    label: 'Public',
                    description: 'Workspace Members can discover and join',
                  },
                ]}
                onValueChange={(value) =>
                  setVisibility(value as ProjectVisibility)
                }
                disabled={submitting}
              />
            </FormField>
          </div>
          {formError ? (
            <p className="settings-error" role="alert">
              {formError}
            </p>
          ) : null}
        </div>

        <footer>
          <Button
            variant="secondary"
            type="button"
            disabled={submitting}
            onClick={close}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            loading={submitting}
            loadingLabel="Creating…"
          >
            Create Project
          </Button>
        </footer>
      </form>
    </dialog>
  );
}

function validateProjectIdentifier(identifier: string): string | null {
  if (identifier.length < 2 || identifier.length > 48) {
    return 'Use between 2 and 48 characters';
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(identifier)) {
    return 'Use lowercase letters, numbers, and single hyphens only';
  }
  return null;
}
