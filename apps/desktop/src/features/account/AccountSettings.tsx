import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { User } from '../../lib/api/types';
import { SettingsArticle } from '../settings/SettingsArticle';
import {
  FormActions,
  LoadError,
  type ActionState,
} from '../settings/SettingsControls';
import {
  errorMessage,
  formatDateTime,
  monogram,
  titleCase,
} from '../settings/utils';
import {
  acceptInvitation,
  acceptInvitationToken,
  declineInvitation,
  listPendingInvitations,
  type ApiContext,
} from '../workspace/api';
import {
  changePassword,
  getAccount,
  listAccountSessions,
  revokeAccountSession,
  revokeOtherSessions,
  updatePreferences,
  updateProfile,
} from './api';
import { applyTheme } from './theme';

export type AccountSettingsSection =
  'profile' | 'preferences' | 'security' | 'invitations';

interface AccountSettingsProps {
  context: ApiContext;
  initialUser: User;
  section: AccountSettingsSection;
}

export function AccountSettings({
  context,
  initialUser,
  section,
}: AccountSettingsProps) {
  const account = useQuery({
    queryKey: ['account', context.serverUrl, context.token],
    queryFn: () => getAccount(context),
    initialData: initialUser,
  });

  if (section === 'profile') {
    return <ProfileSettings context={context} user={account.data} />;
  }
  if (section === 'preferences') {
    return <PreferenceSettings context={context} user={account.data} />;
  }
  if (section === 'security') {
    return <SecuritySettings context={context} />;
  }
  return <PendingInvitations context={context} />;
}

function ProfileSettings({
  context,
  user,
}: {
  context: ApiContext;
  user: User;
}) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(user.display_name);
  const [state, setState] = useState<ActionState>({ status: 'idle' });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState({ status: 'saving' });
    try {
      const updated = await updateProfile(context, displayName);
      queryClient.setQueryData(
        ['account', context.serverUrl, context.token],
        updated,
      );
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      setState({ status: 'saved', message: 'Profile updated' });
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  return (
    <SettingsArticle
      eyebrow="Account"
      title="Profile"
      description="How you appear to people in shared Workspaces."
    >
      <form className="settings-form" onSubmit={(event) => void submit(event)}>
        <div className="profile-summary" aria-hidden="true">
          <span>{monogram(displayName)}</span>
          <div>
            <strong>{displayName || 'Unnamed account'}</strong>
            <small>{user.email}</small>
          </div>
        </div>
        <label className="settings-field">
          <span>Display name</span>
          <input
            required
            maxLength={120}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label className="settings-field">
          <span>Email</span>
          <input value={user.email} disabled />
          <small>Email changes require verification and are not in Core.</small>
        </label>
        <FormActions state={state} label="Save profile" />
      </form>
    </SettingsArticle>
  );
}

function PreferenceSettings({
  context,
  user,
}: {
  context: ApiContext;
  user: User;
}) {
  const queryClient = useQueryClient();
  const [theme, setTheme] = useState(user.theme);
  const [timezone, setTimezone] = useState(user.timezone);
  const [weekStart, setWeekStart] = useState(user.week_start);
  const [dateFormat, setDateFormat] = useState(user.date_format);
  const [state, setState] = useState<ActionState>({ status: 'idle' });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState({ status: 'saving' });
    try {
      const updated = await updatePreferences(context, {
        theme,
        timezone,
        week_start: weekStart,
        date_format: dateFormat,
      });
      queryClient.setQueryData(
        ['account', context.serverUrl, context.token],
        updated,
      );
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      applyTheme(updated.theme);
      setState({ status: 'saved', message: 'Preferences updated' });
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  return (
    <SettingsArticle
      eyebrow="Account"
      title="Preferences"
      description="Formatting and appearance follow you between Kanleaf clients."
    >
      <form className="settings-form" onSubmit={(event) => void submit(event)}>
        <label className="settings-field">
          <span>Theme</span>
          <select
            value={theme}
            onChange={(event) => setTheme(event.target.value as User['theme'])}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="settings-field">
          <span>Timezone</span>
          <input
            required
            maxLength={64}
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            placeholder="Asia/Ho_Chi_Minh"
          />
          <small>Use an IANA timezone name.</small>
        </label>
        <label className="settings-field">
          <span>Week starts on</span>
          <select
            value={weekStart}
            onChange={(event) =>
              setWeekStart(event.target.value as User['week_start'])
            }
          >
            <option value="monday">Monday</option>
            <option value="sunday">Sunday</option>
          </select>
        </label>
        <label className="settings-field">
          <span>Date format</span>
          <select
            value={dateFormat}
            onChange={(event) =>
              setDateFormat(event.target.value as User['date_format'])
            }
          >
            <option value="locale">Locale default</option>
            <option value="yyyy_mm_dd">YYYY-MM-DD</option>
            <option value="dd_mm_yyyy">DD-MM-YYYY</option>
            <option value="mm_dd_yyyy">MM-DD-YYYY</option>
          </select>
        </label>
        <FormActions state={state} label="Save preferences" />
      </form>
    </SettingsArticle>
  );
}

function SecuritySettings({ context }: { context: ApiContext }) {
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: ['account-sessions', context.serverUrl, context.token],
    queryFn: () => listAccountSessions(context),
  });
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [state, setState] = useState<ActionState>({ status: 'idle' });
  const [sessionError, setSessionError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState({ status: 'saving' });
    try {
      await changePassword(context, currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      await sessions.refetch();
      setState({
        status: 'saved',
        message: 'Password changed; other sessions were revoked',
      });
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  async function revoke(sessionId: string) {
    setSessionError(null);
    try {
      await revokeAccountSession(context, sessionId);
      await queryClient.invalidateQueries({ queryKey: ['account-sessions'] });
    } catch (error) {
      setSessionError(errorMessage(error));
    }
  }

  async function revokeOthers() {
    setSessionError(null);
    try {
      await revokeOtherSessions(context);
      await queryClient.invalidateQueries({ queryKey: ['account-sessions'] });
    } catch (error) {
      setSessionError(errorMessage(error));
    }
  }

  return (
    <SettingsArticle
      eyebrow="Account"
      title="Security"
      description="Change your password and review authenticated sessions."
    >
      <form className="settings-form" onSubmit={(event) => void submit(event)}>
        <label className="settings-field">
          <span>Current password</span>
          <input
            type="password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        <label className="settings-field">
          <span>New password</span>
          <input
            type="password"
            required
            minLength={10}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
          />
        </label>
        <FormActions state={state} label="Change password" />
      </form>
      <section className="settings-section" aria-labelledby="sessions-heading">
        <div className="settings-section-heading">
          <div>
            <h2 id="sessions-heading">Active sessions</h2>
            <p>Expired sessions are omitted.</p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void revokeOthers()}
          >
            Revoke other sessions
          </button>
        </div>
        {sessionError && (
          <p className="settings-error" role="alert">
            {sessionError}
          </p>
        )}
        {sessions.isPending ? (
          <p className="settings-muted">Loading sessions…</p>
        ) : sessions.error ? (
          <LoadError
            error={sessions.error}
            onRetry={() => sessions.refetch()}
          />
        ) : (
          <div className="settings-rows">
            {sessions.data.map((session) => (
              <div className="settings-row" key={session.id}>
                <div>
                  <strong>
                    {session.is_current ? 'Current session' : 'Session'}
                  </strong>
                  <small>
                    Created {formatDateTime(session.created_at)} · expires{' '}
                    {formatDateTime(session.expires_at)}
                  </small>
                </div>
                {!session.is_current && (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void revoke(session.id)}
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </SettingsArticle>
  );
}

function PendingInvitations({ context }: { context: ApiContext }) {
  const queryClient = useQueryClient();
  const invitations = useQuery({
    queryKey: ['pending-invitations', context.serverUrl, context.token],
    queryFn: () => listPendingInvitations(context),
  });
  const [token, setToken] = useState('');
  const [state, setState] = useState<ActionState>({ status: 'idle' });

  async function refreshWorkspaceData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pending-invitations'] }),
      queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
    ]);
  }

  async function accept(id: string) {
    try {
      await acceptInvitation(context, id);
      await refreshWorkspaceData();
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  async function decline(id: string) {
    try {
      await declineInvitation(context, id);
      await refreshWorkspaceData();
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  async function acceptToken(event: FormEvent) {
    event.preventDefault();
    setState({ status: 'saving' });
    try {
      await acceptInvitationToken(context, token);
      setToken('');
      await refreshWorkspaceData();
      setState({ status: 'saved', message: 'Invitation accepted' });
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  return (
    <SettingsArticle
      eyebrow="Account"
      title="Invitations"
      description="Workspaces that invited your verified account email."
    >
      {invitations.isPending ? (
        <p className="settings-muted">Loading invitations…</p>
      ) : invitations.error ? (
        <LoadError
          error={invitations.error}
          onRetry={() => invitations.refetch()}
        />
      ) : invitations.data.length === 0 ? (
        <div className="settings-empty">
          <strong>No pending invitations</strong>
          <p>You can also accept a manually shared invitation token below.</p>
        </div>
      ) : (
        <div className="settings-rows">
          {invitations.data.map((invitation) => (
            <div className="settings-row" key={invitation.id}>
              <div>
                <strong>{invitation.workspace_name}</strong>
                <small>
                  {titleCase(invitation.role)} · expires{' '}
                  {formatDateTime(invitation.expires_at)}
                </small>
              </div>
              <div className="row-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void decline(invitation.id)}
                >
                  Decline
                </button>
                <button
                  className="primary-button compact-button"
                  type="button"
                  onClick={() => void accept(invitation.id)}
                >
                  Accept
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <form
        className="settings-section token-form"
        onSubmit={(event) => void acceptToken(event)}
      >
        <label className="settings-field">
          <span>Invitation token</span>
          <input
            required
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
          />
        </label>
        <FormActions state={state} label="Accept token" />
      </form>
    </SettingsArticle>
  );
}
