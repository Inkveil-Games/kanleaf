import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LockKeyhole, Mail, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { SettingsArticle } from '../settings/SettingsArticle';
import {
  ActionMessage,
  LoadError,
  type ActionState,
} from '../settings/SettingsControls';
import { errorMessage } from '../settings/utils';
import type { ApiContext } from '../workspace/api';
import { getHostAccess, updateHostAccess, type HostAccessPolicy } from './api';

interface HostAccessSettingsProps {
  context: ApiContext;
  hostEmail: string;
}

export function HostAccessSettings({
  context,
  hostEmail,
}: HostAccessSettingsProps) {
  const access = useQuery({
    queryKey: accessQueryKey(context),
    queryFn: () => getHostAccess(context),
  });

  return (
    <SettingsArticle
      eyebrow="Host Console"
      title="Access"
      description="Choose who can register, sign in, and keep an active session on this Kanleaf host."
      className="host-settings-article"
    >
      {access.isPending ? (
        <AccessPolicySkeleton />
      ) : access.error ? (
        <LoadError error={access.error} onRetry={() => access.refetch()} />
      ) : (
        <AccessPolicyForm
          context={context}
          hostEmail={hostEmail}
          initialPolicy={access.data}
        />
      )}
    </SettingsArticle>
  );
}

function AccessPolicyForm({
  context,
  hostEmail,
  initialPolicy,
}: {
  context: ApiContext;
  hostEmail: string;
  initialPolicy: HostAccessPolicy;
}) {
  const queryClient = useQueryClient();
  const initialDraft = draftPolicy(initialPolicy, hostEmail);
  const [baseline, setBaseline] = useState(initialDraft);
  const [restricted, setRestricted] = useState(initialDraft.restricted);
  const [allowedEmails, setAllowedEmails] = useState(
    initialDraft.allowed_emails,
  );
  const [emailDraft, setEmailDraft] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [state, setState] = useState<ActionState>({ status: 'idle' });
  const saving = state.status === 'saving';
  const dirty =
    restricted !== baseline.restricted ||
    !sameEmailSet(allowedEmails, baseline.allowed_emails);

  function addEmail() {
    const parsed = normalizeDraftEmail(emailDraft);
    if ('error' in parsed) {
      setEmailError(parsed.error);
      return;
    }
    if (parsed.email === hostEmail.trim().toLowerCase()) {
      setEmailError('The Host account is already always allowed');
      return;
    }
    if (allowedEmails.includes(parsed.email)) {
      setEmailError('This email is already approved');
      return;
    }

    setAllowedEmails((current) => [...current, parsed.email]);
    setEmailDraft('');
    setEmailError(null);
    setState({ status: 'idle' });
  }

  function addEmailOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addEmail();
  }

  function removeEmail(email: string) {
    setAllowedEmails((current) =>
      current.filter((candidate) => candidate !== email),
    );
    setState({ status: 'idle' });
  }

  function discard() {
    setRestricted(baseline.restricted);
    setAllowedEmails(baseline.allowed_emails);
    setEmailDraft('');
    setEmailError(null);
    setState({ status: 'idle' });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || saving) return;
    if (
      restricted &&
      !window.confirm(
        'Saving Restricted access will immediately sign out accounts that are not approved. Continue?',
      )
    ) {
      return;
    }

    const draft = { restricted, allowed_emails: allowedEmails };
    setState({ status: 'saving' });
    try {
      const saved = await updateHostAccess(context, draft);
      const savedDraft = draftPolicy(saved, hostEmail);
      queryClient.setQueryData(accessQueryKey(context), saved);
      setBaseline(savedDraft);
      setRestricted(savedDraft.restricted);
      setAllowedEmails(savedDraft.allowed_emails);
      setEmailDraft('');
      setEmailError(null);
      setState({ status: 'saved', message: 'Access policy saved' });
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  return (
    <form
      className="settings-form host-access-form"
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <section
        className="host-policy-section"
        aria-labelledby="host-access-mode-heading"
      >
        <div className="host-policy-copy">
          <span className="host-section-icon" aria-hidden="true">
            <ShieldCheck size={16} />
          </span>
          <span>
            <strong id="host-access-mode-heading">Access mode</strong>
            <small>
              {restricted
                ? 'Only the Host and approved emails can use this instance.'
                : 'Anyone can register or sign in. The approved list stays prepared.'}
            </small>
          </span>
        </div>
        <span className="host-policy-control">
          <span className="host-policy-state">
            {restricted ? 'Restricted' : 'Open'}
          </span>
          <label className="host-policy-toggle">
            <span className="sr-only">Restricted access</span>
            <input
              type="checkbox"
              aria-label="Restricted access"
              checked={restricted}
              disabled={saving}
              onChange={(event) => {
                setRestricted(event.target.checked);
                setState({ status: 'idle' });
              }}
            />
            <span className="host-policy-switch" aria-hidden="true" />
          </label>
        </span>
      </section>

      <section
        className="host-allowlist-section"
        aria-labelledby="approved-emails-heading"
      >
        <div className="settings-section-heading host-allowlist-heading">
          <div>
            <h2 id="approved-emails-heading">Approved emails</h2>
            <p>
              {restricted
                ? 'These addresses can register and sign in.'
                : 'Prepared now, enforced when access becomes Restricted.'}
            </p>
          </div>
          <span className="host-email-count">
            {allowedEmails.length} approved
          </span>
        </div>

        <div className="host-email-add-row">
          <label className="settings-field host-email-field">
            <span>Email address</span>
            <input
              type="email"
              value={emailDraft}
              aria-describedby={`host-email-hint${
                emailError ? ' host-email-error' : ''
              }`}
              aria-invalid={emailError ? 'true' : undefined}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              disabled={saving}
              spellCheck={false}
              onChange={(event) => {
                setEmailDraft(event.target.value);
                setEmailError(null);
              }}
              onKeyDown={addEmailOnEnter}
            />
          </label>
          <button
            className="secondary-button host-add-email"
            type="button"
            disabled={saving}
            onClick={addEmail}
          >
            <Plus aria-hidden="true" size={14} /> Add email
          </button>
        </div>
        <small id="host-email-hint" className="host-email-hint">
          Add one exact address at a time. Addresses are stored in lowercase.
        </small>
        {emailError ? (
          <p id="host-email-error" className="settings-error" role="alert">
            {emailError}
          </p>
        ) : null}

        <div className="settings-rows host-email-rows">
          <div className="settings-row host-email-row host-email-row-fixed">
            <span className="host-email-icon" aria-hidden="true">
              <LockKeyhole size={14} />
            </span>
            <span className="host-email-copy">
              <strong>{hostEmail}</strong>
              <small>Host account</small>
            </span>
            <span className="host-email-badge">Always allowed</span>
            <span className="host-email-lock" aria-hidden="true">
              <LockKeyhole size={13} />
            </span>
          </div>
          {allowedEmails.length === 0 ? (
            <div className="host-email-empty">
              <Mail aria-hidden="true" size={16} />
              <span>
                <strong>No additional emails</strong>
                <small>Add an address above to prepare this allowlist.</small>
              </span>
            </div>
          ) : (
            allowedEmails.map((email) => (
              <div className="settings-row host-email-row" key={email}>
                <span className="host-email-icon" aria-hidden="true">
                  <Mail size={14} />
                </span>
                <span className="host-email-copy">
                  <strong>{email}</strong>
                  <small>Approved account</small>
                </span>
                <span className="host-email-badge">Approved</span>
                <button
                  className="icon-button host-email-remove"
                  type="button"
                  disabled={saving}
                  aria-label={`Remove ${email}`}
                  onClick={() => removeEmail(email)}
                >
                  <Trash2 aria-hidden="true" size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      {restricted ? (
        <div className="host-policy-warning">
          <ShieldCheck aria-hidden="true" size={16} />
          <span>
            <strong>Saving can sign people out</strong>
            <small>
              Active sessions belonging to accounts outside this list are
              revoked immediately.
            </small>
          </span>
        </div>
      ) : null}

      <div className="settings-form-actions host-policy-actions">
        <button
          className="primary-button compact-button"
          type="submit"
          disabled={!dirty || saving}
        >
          {saving ? 'Saving…' : 'Save access policy'}
        </button>
        <button
          className="text-button"
          type="button"
          disabled={!dirty || saving}
          onClick={discard}
        >
          Discard changes
        </button>
        {dirty && !saving ? (
          <span className="host-unsaved-state">Unsaved changes</span>
        ) : null}
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

function AccessPolicySkeleton() {
  return (
    <>
      <p className="sr-only" role="status">
        Loading access policy…
      </p>
      <div className="host-access-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
    </>
  );
}

function draftPolicy(
  policy: HostAccessPolicy,
  hostEmail: string,
): HostAccessPolicy {
  const normalizedHost = hostEmail.trim().toLowerCase();
  return {
    restricted: policy.restricted,
    allowed_emails: policy.allowed_emails.filter(
      (email) => email !== normalizedHost,
    ),
  };
}

function normalizeDraftEmail(
  value: string,
): { email: string } | { error: string } {
  const email = value.trim().toLowerCase();
  if (!email) return { error: 'Enter an email address' } as const;

  const separator = email.indexOf('@');
  const invalid =
    separator <= 0 ||
    separator === email.length - 1 ||
    email.indexOf('@', separator + 1) !== -1 ||
    [...email].length > 320 ||
    /\s/u.test(email);
  if (invalid) return { error: 'Enter a valid email address' } as const;
  return { email } as const;
}

function sameEmailSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((email, index) => email === sortedRight[index]);
}

function accessQueryKey(context: ApiContext) {
  return ['host-access', context.serverUrl, context.token] as const;
}
