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
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from './api';
import type { NotificationPreferences } from './types';

export function NotificationSettings({ context }: { context: ApiContext }) {
  const preferences = useQuery({
    queryKey: ['notification-preferences', context.serverUrl, context.token],
    queryFn: () => getNotificationPreferences(context),
  });
  return (
    <SettingsArticle
      eyebrow="Account"
      title="Notifications"
      description="Choose which routine Task activity appears in your Kanleaf inbox."
    >
      {preferences.isPending ? (
        <p className="settings-muted">Loading notification preferences…</p>
      ) : preferences.error ? (
        <LoadError
          error={preferences.error}
          onRetry={() => preferences.refetch()}
        />
      ) : (
        <NotificationPreferenceForm
          context={context}
          initialValues={preferences.data}
        />
      )}
    </SettingsArticle>
  );
}

function NotificationPreferenceForm({
  context,
  initialValues,
}: {
  context: ApiContext;
  initialValues: NotificationPreferences;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(initialValues);
  const [state, setState] = useState<ActionState>({ status: 'idle' });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState({ status: 'saving' });
    try {
      const updated = await updateNotificationPreferences(context, values);
      queryClient.setQueryData(
        ['notification-preferences', context.serverUrl, context.token],
        updated,
      );
      setState({ status: 'saved', message: 'Notification preferences saved' });
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) });
    }
  }

  return (
    <form className="settings-form" onSubmit={(event) => void submit(event)}>
      <div className="settings-rows feature-toggle-rows">
        <label className="settings-row feature-toggle-row">
          <span>
            <strong>Comments and replies</strong>
            <small>
              Notify when a watched Task receives a new discussion message.
            </small>
          </span>
          <input
            type="checkbox"
            checked={values.notify_comments}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                notify_comments: event.target.checked,
              }))
            }
          />
        </label>
        <label className="settings-row feature-toggle-row">
          <span>
            <strong>Task changes</strong>
            <small>
              Notify when state or other metadata changes on a watched Task.
            </small>
          </span>
          <input
            type="checkbox"
            checked={values.notify_metadata}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                notify_metadata: event.target.checked,
              }))
            }
          />
        </label>
      </div>
      <p className="settings-muted">
        Assignments, direct mentions, replies to your comments, and Workspace
        invitations always notify you.
      </p>
      <FormActions state={state} label="Save notifications" />
    </form>
  );
}
