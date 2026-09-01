import { AlertTriangle, Trash2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { PasswordField } from '../../components/ui/PasswordField';
import { errorMessage } from '../settings/utils';
import type { HostWorkspace } from './api';

interface HostWorkspaceDeleteDialogProps {
  workspace: HostWorkspace;
  onDelete: (identifier: string, password: string) => Promise<void>;
  onClose: () => void;
}

export function HostWorkspaceDeleteDialog({
  workspace,
  onDelete,
  onClose,
}: HostWorkspaceDeleteDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const formId = useId();
  const identifierId = useId();
  const identifierHelpId = useId();
  const passwordId = useId();
  const [stage, setStage] = useState<'warning' | 'confirm'>('warning');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  useEffect(() => {
    if (stage === 'confirm') confirmationRef.current?.focus();
  }, [stage]);

  function close() {
    if (!busy) onClose();
  }

  async function remove(event: FormEvent) {
    event.preventDefault();
    if (busy || identifier !== workspace.identifier || !password) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(identifier, password);
      onClose();
    } catch (caught) {
      setPassword('');
      setError(errorMessage(caught));
      requestAnimationFrame(() => passwordRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  const title =
    stage === 'warning'
      ? `Delete “${workspace.name}” (/${workspace.identifier})?`
      : `Confirm permanent deletion of “${workspace.name}” (/${workspace.identifier})`;

  return (
    <dialog
      ref={dialogRef}
      className="host-delete-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="host-delete-window">
        <header>
          <span className="host-delete-warning-mark" aria-hidden="true">
            <AlertTriangle size={18} />
          </span>
          <div>
            <span className="pane-eyebrow">
              {stage === 'warning'
                ? 'Destructive action'
                : 'Final confirmation'}
            </span>
            <h2 ref={titleRef} id={titleId} tabIndex={-1}>
              {title}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Cancel Workspace deletion"
            disabled={busy}
            onClick={close}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        {stage === 'warning' ? (
          <div className="host-delete-content">
            <p id={descriptionId}>
              This removes the Workspace owned by{' '}
              <strong>{workspace.owner.display_name}</strong> and revokes access
              for every member.
            </p>
            <div className="host-delete-impact">
              <strong>This cannot be undone.</strong>
              <p>
                Structured data, memberships, Tasks, Projects, Library notes,
                and every managed Markdown file will be permanently removed.
              </p>
            </div>
            <dl className="host-delete-target">
              <div>
                <dt>Workspace</dt>
                <dd>{workspace.name}</dd>
              </div>
              <div>
                <dt>Workspace ID</dt>
                <dd>/{workspace.identifier}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{workspace.owner.email}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <form
            id={formId}
            className="host-delete-content"
            onSubmit={(event) => void remove(event)}
          >
            <p id={descriptionId}>
              Type the exact Workspace ID and re-enter your Host password. This
              confirms the target and your current Host session independently.
            </p>
            <div className="settings-field">
              <label htmlFor={identifierId}>Workspace ID</label>
              <input
                id={identifierId}
                ref={confirmationRef}
                required
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                aria-invalid={
                  identifier.length > 0 && identifier !== workspace.identifier
                    ? true
                    : undefined
                }
                aria-describedby={identifierHelpId}
                autoComplete="off"
                spellCheck={false}
              />
              <small id={identifierHelpId}>
                Enter <strong>{workspace.identifier}</strong> without the slash.
              </small>
            </div>
            <div className="settings-field">
              <label htmlFor={passwordId}>Host password</label>
              <PasswordField
                id={passwordId}
                ref={passwordRef}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                visibilityLabel="Host password"
                autoComplete="current-password"
              />
            </div>
            {error && (
              <p className="settings-error" role="alert">
                {error}
              </p>
            )}
          </form>
        )}

        <footer>
          {stage === 'warning' ? (
            <>
              <button
                className="secondary-button"
                type="button"
                autoFocus
                onClick={close}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={() => setStage('confirm')}
              >
                Continue
              </button>
            </>
          ) : (
            <>
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setPassword('');
                  setStage('warning');
                  requestAnimationFrame(() => titleRef.current?.focus());
                }}
              >
                Back
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={close}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                type="submit"
                form={formId}
                aria-label={
                  busy
                    ? `Deleting “${workspace.name}” (/${workspace.identifier})…`
                    : `Permanently delete “${workspace.name}” (/${workspace.identifier})`
                }
                disabled={
                  busy || identifier !== workspace.identifier || !password
                }
              >
                <Trash2 aria-hidden="true" size={14} />
                {busy ? 'Deleting…' : 'Permanently delete Workspace'}
              </button>
            </>
          )}
        </footer>
      </div>
    </dialog>
  );
}
