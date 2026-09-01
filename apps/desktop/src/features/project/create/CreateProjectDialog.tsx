import { X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Select } from '../../../components/ui/Select';
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
  const nameId = useId();
  const identifierId = useId();
  const descriptionId = useId();
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
          <button
            type="button"
            aria-label="Close Project creation"
            disabled={submitting}
            onClick={close}
          >
            <X aria-hidden="true" size={17} />
          </button>
        </header>

        <div className="project-create-content">
          <div className="project-create-identity-row">
            <label className="project-create-field" htmlFor={nameId}>
              <span>Project name</span>
              <input
                id={nameId}
                autoFocus
                required
                maxLength={120}
                value={name}
                disabled={submitting}
                aria-invalid={nameError ? true : undefined}
                onChange={(event) => changeName(event.target.value)}
                placeholder="e.g. Mobile app"
              />
              {nameError ? <small role="alert">{nameError}</small> : null}
            </label>
            <div className="project-create-field">
              <span className="field-label-row">
                <label htmlFor={identifierId}>Project ID</label>
                <button
                  className="text-button field-reset-button"
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    setIdentifier(normalizePublicIdentifier(name));
                    setIdentifierEdited(false);
                    setIdentifierError(null);
                  }}
                >
                  Reset
                </button>
              </span>
              <input
                id={identifierId}
                required
                minLength={2}
                maxLength={48}
                value={identifier}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                disabled={submitting}
                aria-invalid={identifierError ? true : undefined}
                onChange={(event) => {
                  setIdentifier(event.target.value);
                  setIdentifierEdited(true);
                  setIdentifierError(null);
                }}
                placeholder="mobile-app"
              />
              {identifierError ? (
                <small role="alert">{identifierError}</small>
              ) : (
                <small>
                  {routePaths.project(
                    workspace.identifier,
                    identifier || 'project-id',
                  )}
                </small>
              )}
            </div>
          </div>

          <label className="project-create-field" htmlFor={descriptionId}>
            <span>
              Description <small>Optional</small>
            </span>
            <textarea
              id={descriptionId}
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
          </label>

          <div className="project-create-choice-row">
            <label className="project-create-field">
              <span>Project lead</span>
              <Select
                ariaLabel="Project lead"
                value={leadUserId}
                options={leadOptions}
                onValueChange={setLeadUserId}
                disabled={submitting}
              />
              {members.error ? (
                <small className="project-lead-error">
                  Could not refresh members.{' '}
                  <button type="button" onClick={() => void members.refetch()}>
                    Retry
                  </button>
                </small>
              ) : null}
            </label>
            <label className="project-create-field">
              <span>Visibility</span>
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
            </label>
          </div>
          {formError ? (
            <p className="settings-error" role="alert">
              {formError}
            </p>
          ) : null}
        </div>

        <footer>
          <button
            className="secondary-button"
            type="button"
            disabled={submitting}
            onClick={close}
          >
            Cancel
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={submitting}
          >
            {submitting ? 'Creating…' : 'Create Project'}
          </button>
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
