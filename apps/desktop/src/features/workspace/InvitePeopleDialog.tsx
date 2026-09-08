import { X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { IconButton } from '../../components/ui/IconButton';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { ActionMessage, type ActionState } from '../settings/SettingsControls';
import { errorMessage } from '../settings/utils';
import { createWorkspaceInvitation, type ApiContext } from './api';
import { IssuedInvitationToken } from './InvitationComposer';
import type {
  AssignableWorkspaceRole,
  IssuedWorkspaceInvitation,
} from './types';

interface InvitePeopleDialogProps {
  context: ApiContext;
  workspaceId: string;
  initialInvitation?: IssuedWorkspaceInvitation;
  onInvitationCreated: (
    invitation: IssuedWorkspaceInvitation,
  ) => void | Promise<void>;
  onClose: () => void;
}

export function InvitePeopleDialog({
  context,
  workspaceId,
  initialInvitation,
  onInvitationCreated,
  onClose,
}: InvitePeopleDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableWorkspaceRole>('member');
  const [issued, setIssued] = useState(initialInvitation ?? null);
  const [state, setState] = useState<ActionState>({ status: 'idle' });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const saving = state.status === 'saving';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setState({ status: 'saving' });
    try {
      const invitation = await createWorkspaceInvitation(
        context,
        workspaceId,
        email,
        role,
      );
      setIssued(invitation);
      await onInvitationCreated(invitation);
      setState({ status: 'saved' });
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  function close() {
    if (!saving) onClose();
  }

  function inviteAnother() {
    setEmail('');
    setRole('member');
    setIssued(null);
    setState({ status: 'idle' });
  }

  return (
    <dialog
      ref={dialogRef}
      className="workspace-invite-dialog"
      aria-labelledby="workspace-invite-heading"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <form
        className="workspace-invite-window"
        onSubmit={(event) => void submit(event)}
      >
        <header>
          <div>
            <span className="dialog-step-label">Workspace access</span>
            <h2 id="workspace-invite-heading">
              {issued ? 'Share this invitation' : 'Invite people'}
            </h2>
            <p>
              {issued
                ? 'Save the one-time link or token before closing this window.'
                : 'Create a seven-day invitation for one email address.'}
            </p>
          </div>
          <IconButton
            type="button"
            aria-label="Close invitation dialog"
            disabled={saving}
            onClick={close}
          >
            <X aria-hidden="true" size={17} />
          </IconButton>
        </header>

        <div className="workspace-invite-content">
          {issued ? (
            <IssuedInvitationToken invitation={issued} />
          ) : (
            <div className="workspace-invite-fields">
              <FormField
                label="Email address"
                hint="The token can only be accepted by this address."
                required
              >
                <Input
                  autoFocus
                  required
                  type="email"
                  aria-label="Email address"
                  value={email}
                  placeholder="teammate@example.com"
                  disabled={saving}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </FormField>
              <FormField label="Workspace role">
                <Select
                  ariaLabel="Invitation role"
                  value={role}
                  options={[
                    {
                      value: 'admin',
                      label: 'Admin',
                      description: 'Manage settings, members, and all content',
                    },
                    {
                      value: 'member',
                      label: 'Member',
                      description: 'Work in shared and assigned Projects',
                    },
                    {
                      value: 'guest',
                      label: 'Guest',
                      description: 'Access only explicitly shared Projects',
                    },
                  ]}
                  onValueChange={(value) =>
                    setRole(value as AssignableWorkspaceRole)
                  }
                  disabled={saving}
                />
              </FormField>
              <ActionMessage state={state} />
            </div>
          )}
        </div>

        <footer>
          {issued ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={inviteAnother}
              >
                Invite another
              </Button>
              <Button variant="primary" size="sm" type="button" onClick={close}>
                Done
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={close}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                type="submit"
                loading={saving}
                loadingLabel="Creating…"
              >
                Create invitation
              </Button>
            </>
          )}
        </footer>
      </form>
    </dialog>
  );
}
