import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { PasswordField } from '../../components/ui/PasswordField';
import { Select } from '../../components/ui/Select';
import type { User } from '../../lib/api/types';
import { NotificationSettings } from '../collaboration/NotificationSettings';
import { SettingsArticle } from '../settings/SettingsArticle';
import {
  FormActions,
  LoadError,
  type ActionState,
} from '../settings/SettingsControls';
import { errorMessage, formatDateTime, monogram } from '../settings/utils';
import type { ApiContext } from '../workspace/api';
import type { Workspace } from '../workspace/types';
import { WorkspaceJoinPanel } from '../workspace/WorkspaceJoinPanel';
import {
  changePassword,
  getAccount,
  listAccountSessions,
  revokeAccountSession,
  revokeOtherSessions,
  updatePreferences,
  updateProfile,
} from './api';
import type { AccountSettingsSection } from './settingsSections';
import { applyTheme } from './theme';

export type { AccountSettingsSection } from './settingsSections';

interface AccountSettingsProps {
  context: ApiContext;
  initialUser: User;
  section: AccountSettingsSection;
  onWorkspaceJoined: (workspace: Workspace) => void | Promise<void>;
}

export function AccountSettings({
  context,
  initialUser,
  section,
  onWorkspaceJoined,
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
  if (section === 'notifications') {
    return <NotificationSettings context={context} />;
  }
  return (
    <PendingInvitations
      context={context}
      onWorkspaceJoined={onWorkspaceJoined}
    />
  );
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
        <FormField label="Display name" required>
          <Input
            required
            maxLength={120}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </FormField>
        <FormField
          label="Email"
          hint="Email changes require verification and are not in Core."
        >
          <Input value={user.email} disabled />
        </FormField>
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
        <FormField label="Theme">
          <Select
            ariaLabel="Theme"
            value={theme}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            onValueChange={(value) => setTheme(value as User['theme'])}
          />
        </FormField>
        <FormField label="Timezone" hint="Use an IANA timezone name." required>
          <Input
            required
            maxLength={64}
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            placeholder="Asia/Ho_Chi_Minh"
          />
        </FormField>
        <FormField label="Week starts on">
          <Select
            ariaLabel="Week starts on"
            value={weekStart}
            options={[
              { value: 'monday', label: 'Monday' },
              { value: 'sunday', label: 'Sunday' },
            ]}
            onValueChange={(value) => setWeekStart(value as User['week_start'])}
          />
        </FormField>
        <FormField label="Date format">
          <Select
            ariaLabel="Date format"
            value={dateFormat}
            options={[
              { value: 'locale', label: 'Locale default' },
              { value: 'yyyy_mm_dd', label: 'YYYY-MM-DD' },
              { value: 'dd_mm_yyyy', label: 'DD-MM-YYYY' },
              { value: 'mm_dd_yyyy', label: 'MM-DD-YYYY' },
            ]}
            onValueChange={(value) =>
              setDateFormat(value as User['date_format'])
            }
          />
        </FormField>
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
        <FormField label="Current password" required>
          <PasswordField
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
          />
        </FormField>
        <FormField label="New password" required>
          <PasswordField
            required
            minLength={10}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
          />
        </FormField>
        <FormActions state={state} label="Change password" />
      </form>
      <section className="settings-section" aria-labelledby="sessions-heading">
        <div className="settings-section-heading">
          <div>
            <h2 id="sessions-heading">Active sessions</h2>
            <p>Expired sessions are omitted.</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void revokeOthers()}
          >
            Revoke other sessions
          </Button>
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
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void revoke(session.id)}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </SettingsArticle>
  );
}

function PendingInvitations({
  context,
  onWorkspaceJoined,
}: {
  context: ApiContext;
  onWorkspaceJoined: (workspace: Workspace) => void | Promise<void>;
}) {
  const queryClient = useQueryClient();

  return (
    <SettingsArticle
      eyebrow="Account"
      title="Invitations"
      description="Workspaces that invited your verified account email."
    >
      <WorkspaceJoinPanel
        context={context}
        onJoined={async (workspace) => {
          await onWorkspaceJoined(workspace);
          await queryClient.invalidateQueries({ queryKey: ['session'] });
        }}
      />
    </SettingsArticle>
  );
}
