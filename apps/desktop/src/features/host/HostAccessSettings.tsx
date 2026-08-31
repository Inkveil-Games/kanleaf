import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { SettingsArticle } from '../settings/SettingsArticle';
import {
  FormActions,
  LoadError,
  type ActionState,
} from '../settings/SettingsControls';
import { errorMessage } from '../settings/utils';
import type { ApiContext } from '../workspace/api';
import { getHostAccess, updateHostAccess, type HostAccessPolicy } from './api';

export function HostAccessSettings({ context }: { context: ApiContext }) {
  const access = useQuery({
    queryKey: accessQueryKey(context),
    queryFn: () => getHostAccess(context),
  });

  return (
    <SettingsArticle
      eyebrow="Host Console"
      title="Access"
      description="Control which exact email addresses can use this Kanleaf host."
      className="host-settings-article"
    >
      {access.isPending ? (
        <p className="settings-muted" aria-live="polite">
          Loading access policy…
        </p>
      ) : access.error ? (
        <LoadError error={access.error} onRetry={() => access.refetch()} />
      ) : (
        <AccessPolicyForm context={context} initialPolicy={access.data} />
      )}
    </SettingsArticle>
  );
}

function AccessPolicyForm({
  context,
  initialPolicy,
}: {
  context: ApiContext;
  initialPolicy: HostAccessPolicy;
}) {
  const queryClient = useQueryClient();
  const [restricted, setRestricted] = useState(initialPolicy.restricted);
  const [allowedEmails, setAllowedEmails] = useState(
    initialPolicy.allowed_emails.join('\n'),
  );
  const [state, setState] = useState<ActionState>({ status: 'idle' });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      restricted &&
      !window.confirm(
        'Saving Restricted access will immediately sign out accounts that are not approved. Continue?',
      )
    ) {
      return;
    }

    const draft = {
      restricted,
      allowed_emails: allowedEmails
        .split(/\r?\n/)
        .map((email) => email.trim())
        .filter(Boolean),
    };
    setState({ status: 'saving' });
    try {
      const saved = await updateHostAccess(context, draft);
      queryClient.setQueryData(accessQueryKey(context), saved);
      setRestricted(saved.restricted);
      setAllowedEmails(saved.allowed_emails.join('\n'));
      setState({ status: 'saved', message: 'Access policy saved' });
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  return (
    <form className="settings-form" onSubmit={(event) => void submit(event)}>
      <div className="settings-rows feature-toggle-rows">
        <label className="settings-row feature-toggle-row">
          <span>
            <strong>Restricted access</strong>
            <small>
              Require approval for registration, sign-in, and active sessions.
            </small>
          </span>
          <span className="host-policy-control">
            <span className="host-policy-state">
              {restricted ? 'Restricted' : 'Open'}
            </span>
            <input
              type="checkbox"
              aria-label="Restricted access"
              checked={restricted}
              onChange={(event) => setRestricted(event.target.checked)}
            />
          </span>
        </label>
      </div>
      <div className="settings-field">
        <label htmlFor="approved-emails">Approved emails</label>
        <textarea
          id="approved-emails"
          value={allowedEmails}
          aria-describedby="approved-emails-hint"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => setAllowedEmails(event.target.value)}
        />
        <small id="approved-emails-hint">
          Enter one exact email address per line. Stored entries remain ready
          while access is Open.
        </small>
      </div>
      <p className="settings-muted">
        The configured Host account is always permitted and does not need to be
        listed.
      </p>
      <FormActions state={state} label="Save access policy" />
    </form>
  );
}

function accessQueryKey(context: ApiContext) {
  return ['host-access', context.serverUrl, context.token] as const;
}
