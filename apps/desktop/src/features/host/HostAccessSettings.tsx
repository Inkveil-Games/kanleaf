import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LockKeyhole, Mail, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { IconButton } from '../../components/ui/IconButton';
import { Input } from '../../components/ui/Input';
import { Switch } from '../../components/ui/Switch';
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
  const serverPolicy = draftPolicy(initialPolicy, hostEmail);
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft | null>(null);
  const policy = policyDraft?.policy ?? serverPolicy;
  const restricted = policy.restricted;
  const allowedEmails = policy.allowed_emails;
  const [emailDraft, setEmailDraft] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [pendingRestrictedPolicy, setPendingRestrictedPolicy] =
    useState<HostAccessPolicy | null>(null);
  const [state, setState] = useState<ActionState>({ status: 'idle' });
  const saving = state.status === 'saving';
  const policyDirty = Boolean(
    policyDraft && !samePolicy(policyDraft.policy, policyDraft.baseline),
  );
  const dirty = policyDirty || emailDraft.trim().length > 0;

  function stagePolicy(nextPolicy: HostAccessPolicy) {
    setPolicyDraft((current) => {
      const baseline = current?.baseline ?? serverPolicy;
      return samePolicy(nextPolicy, baseline)
        ? null
        : { baseline, policy: nextPolicy };
    });
  }

  function addEmail() {
    const parsed = validateNewEmail(emailDraft, hostEmail, allowedEmails);
    if ('error' in parsed) {
      setEmailError(parsed.error);
      return;
    }

    stagePolicy({
      restricted,
      allowed_emails: [...allowedEmails, parsed.email],
    });
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
    stagePolicy({
      restricted,
      allowed_emails: allowedEmails.filter((candidate) => candidate !== email),
    });
    setState({ status: 'idle' });
  }

  function discard() {
    setPolicyDraft(null);
    setEmailDraft('');
    setEmailError(null);
    setState({ status: 'idle' });
  }

  async function savePolicy(draft: HostAccessPolicy, rethrow = false) {
    stagePolicy(draft);
    setEmailDraft('');
    setEmailError(null);
    setState({ status: 'saving' });
    try {
      const saved = await updateHostAccess(context, draft);
      queryClient.setQueryData(accessQueryKey(context), saved);
      setPolicyDraft(null);
      setEmailDraft('');
      setEmailError(null);
      setState({ status: 'saved', message: 'Access policy saved' });
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
      if (rethrow) throw error;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || saving) return;

    let nextAllowedEmails = allowedEmails;
    if (emailDraft.trim()) {
      const parsed = validateNewEmail(emailDraft, hostEmail, allowedEmails);
      if ('error' in parsed) {
        setEmailError(parsed.error);
        return;
      }
      nextAllowedEmails = [...allowedEmails, parsed.email];
    }

    const draft = { restricted, allowed_emails: nextAllowedEmails };
    if (restricted) {
      setPendingRestrictedPolicy(draft);
      return;
    }
    await savePolicy(draft);
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
          <Switch
            aria-label="Restricted access"
            checked={restricted}
            disabled={saving}
            onCheckedChange={(checked) => {
              stagePolicy({
                restricted: checked,
                allowed_emails: allowedEmails,
              });
              setState({ status: 'idle' });
            }}
          />
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
          <FormField
            className="host-email-field"
            label="Email address"
            hint="Add one exact address at a time. Addresses are stored in lowercase."
            error={emailError}
          >
            <Input
              type="email"
              value={emailDraft}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              disabled={saving}
              spellCheck={false}
              onChange={(event) => {
                setEmailDraft(event.target.value);
                setEmailError(null);
                setState({ status: 'idle' });
              }}
              onKeyDown={addEmailOnEnter}
            />
          </FormField>
          <Button
            className="host-add-email"
            variant="secondary"
            size="sm"
            type="button"
            disabled={saving}
            onClick={addEmail}
          >
            <Plus aria-hidden="true" size={14} /> Add email
          </Button>
        </div>

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
                <IconButton
                  className="host-email-remove"
                  type="button"
                  disabled={saving}
                  aria-label={`Remove ${email}`}
                  onClick={() => removeEmail(email)}
                >
                  <Trash2 aria-hidden="true" size={14} />
                </IconButton>
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
        <Button
          variant="primary"
          size="sm"
          type="submit"
          disabled={!dirty}
          loading={saving}
          loadingLabel="Saving…"
        >
          Save access policy
        </Button>
        <Button
          variant="text"
          size="sm"
          type="button"
          disabled={!dirty || saving}
          onClick={discard}
        >
          Discard changes
        </Button>
        {dirty && !saving ? (
          <span className="host-unsaved-state">Unsaved changes</span>
        ) : null}
        <ActionMessage state={state} />
      </div>
      <AppDialog
        open={pendingRestrictedPolicy !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRestrictedPolicy(null);
        }}
        type="confirm"
        variant="warning"
        title="Save Restricted access?"
        description="Accounts that are not approved will be signed out immediately."
        confirmLabel="Save access policy"
        loadingLabel="Saving…"
        onConfirm={async () => {
          if (!pendingRestrictedPolicy) return;
          await savePolicy(pendingRestrictedPolicy, true);
        }}
      />
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

interface PolicyDraft {
  baseline: HostAccessPolicy;
  policy: HostAccessPolicy;
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

function validateNewEmail(
  value: string,
  hostEmail: string,
  allowedEmails: string[],
): { email: string } | { error: string } {
  const parsed = normalizeDraftEmail(value);
  if ('error' in parsed) return parsed;
  if (parsed.email === hostEmail.trim().toLowerCase()) {
    return { error: 'The Host account is already always allowed' };
  }
  if (allowedEmails.includes(parsed.email)) {
    return { error: 'This email is already approved' };
  }
  return parsed;
}

function sameEmailSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((email, index) => email === sortedRight[index]);
}

function samePolicy(left: HostAccessPolicy, right: HostAccessPolicy) {
  return (
    left.restricted === right.restricted &&
    sameEmailSet(left.allowed_emails, right.allowed_emails)
  );
}

function accessQueryKey(context: ApiContext) {
  return ['host-access', context.serverUrl, context.token] as const;
}
