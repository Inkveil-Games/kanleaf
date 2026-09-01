import { Copy } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Select } from '../../components/ui/Select';
import { ActionMessage, type ActionState } from '../settings/SettingsControls';
import { errorMessage } from '../settings/utils';
import { createWorkspaceInvitation, type ApiContext } from './api';
import type {
  AssignableWorkspaceRole,
  IssuedWorkspaceInvitation,
} from './types';

interface InvitationComposerProps {
  context: ApiContext;
  workspaceId: string;
  onInvitationCreated?: (
    invitation: IssuedWorkspaceInvitation,
  ) => void | Promise<void>;
}

export function InvitationComposer({
  context,
  workspaceId,
  onInvitationCreated,
}: InvitationComposerProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableWorkspaceRole>('member');
  const [issued, setIssued] = useState<IssuedWorkspaceInvitation | null>(null);
  const [state, setState] = useState<ActionState>({ status: 'idle' });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: 'saving' });
    try {
      const invitation = await createWorkspaceInvitation(
        context,
        workspaceId,
        email,
        role,
      );
      setIssued(invitation);
      setEmail('');
      await onInvitationCreated?.(invitation);
      setState({ status: 'saved', message: 'Invitation created' });
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  return (
    <div className="invitation-composer">
      <form
        className="settings-form invite-form"
        onSubmit={(event) => void submit(event)}
      >
        <label className="settings-field">
          <span>Email</span>
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={state.status === 'saving'}
          />
        </label>
        <label className="settings-field">
          <span>Role</span>
          <Select
            ariaLabel="Invitation role"
            value={role}
            options={[
              { value: 'admin', label: 'Admin' },
              { value: 'member', label: 'Member' },
              { value: 'guest', label: 'Guest' },
            ]}
            onValueChange={(value) => setRole(value as AssignableWorkspaceRole)}
            disabled={state.status === 'saving'}
          />
        </label>
        <div className="settings-form-actions">
          <button
            className="primary-button compact-button"
            type="submit"
            disabled={state.status === 'saving'}
          >
            {state.status === 'saving' ? 'Creating…' : 'Create invitation'}
          </button>
          <ActionMessage state={state} />
        </div>
      </form>
      {issued ? <IssuedInvitationToken invitation={issued} /> : null}
    </div>
  );
}

export function IssuedInvitationToken({
  invitation,
}: {
  invitation: IssuedWorkspaceInvitation;
}) {
  const [copyState, setCopyState] = useState<string | null>(null);

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(invitation.token);
      setCopyState('Copied');
    } catch {
      setCopyState('Select and copy the token manually');
    }
  }

  return (
    <section className="issued-token" aria-label="Issued invitation">
      <div>
        <strong>Copy this invitation token now</strong>
        <small>Kanleaf stores only its hash and cannot show it again.</small>
      </div>
      <div className="token-copy-row">
        <input
          readOnly
          value={invitation.token}
          aria-label="Issued invitation token"
        />
        <button
          className="secondary-button"
          type="button"
          onClick={() => void copyToken()}
        >
          <Copy aria-hidden="true" size={14} /> Copy
        </button>
      </div>
      {copyState ? <small role="status">{copyState}</small> : null}
    </section>
  );
}
