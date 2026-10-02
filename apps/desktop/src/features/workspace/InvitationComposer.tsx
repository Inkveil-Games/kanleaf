import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { CopyButton } from '../../components/ui/CopyButton';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
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
        <FormField label="Email" required>
          <Input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={state.status === 'saving'}
          />
        </FormField>
        <FormField label="Role">
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
        </FormField>
        <div className="settings-form-actions">
          <Button
            variant="primary"
            size="sm"
            type="submit"
            loading={state.status === 'saving'}
            loadingLabel="Creating…"
          >
            Create invitation
          </Button>
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
  const invitationUrl = invitation.invitation_url;

  return (
    <section className="issued-token" aria-label="Issued invitation">
      <div>
        <strong role={invitation.delivery === 'failed' ? 'alert' : 'status'}>
          {deliveryMessage(invitation.delivery)}
        </strong>
        <small>
          Save the link or token now. Kanleaf stores only the token hash and
          cannot show it again.
        </small>
      </div>
      {invitationUrl ? (
        <div className="token-copy-row">
          <Input readOnly value={invitationUrl} aria-label="Invitation link" />
          <CopyButton
            text={invitationUrl}
            label="Copy link"
            successLabel="Invitation link copied"
            errorLabel="Select and copy the invitation link manually"
          />
        </div>
      ) : null}
      <div className="token-copy-row">
        <Input
          readOnly
          value={invitation.token}
          aria-label="Issued invitation token"
        />
        <CopyButton
          text={invitation.token}
          label="Copy token"
          successLabel="Token copied"
          errorLabel="Select and copy the token manually"
        />
      </div>
    </section>
  );
}

function deliveryMessage(delivery: IssuedWorkspaceInvitation['delivery']) {
  switch (delivery) {
    case 'sent':
      return 'Invitation email sent';
    case 'failed':
      return 'Invitation created, but the email could not be sent';
    default:
      return 'Invitation created. Email is not configured';
  }
}
