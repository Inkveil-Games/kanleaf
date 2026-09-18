import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type MouseEventHandler } from 'react';
import { Link } from 'react-router';
import { routePaths } from '../../../app/routing/routePaths';
import { Button } from '../../../components/ui/Button';
import { SettingsArticle } from '../../settings/SettingsArticle';
import {
  SettingsAction,
  SettingsActionsMenu,
  SettingsEmptyState,
  SettingsList,
  SettingsListCell,
  SettingsListRow,
} from '../../settings/SettingsList';
import { errorMessage } from '../../settings/utils';
import type { ApiContext } from '../../workspace/api';
import type { Workspace } from '../../workspace/types';
import { listWebhooks, setWebhookEnabled, webhookKey } from './api';

export function WebhookList({
  context,
  workspace,
  onNavigate,
  navigateTo,
}: {
  context: ApiContext;
  workspace: Workspace;
  onNavigate: MouseEventHandler<HTMLAnchorElement>;
  navigateTo: (path: string) => void;
}) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: webhookKey(context, workspace.id),
    queryFn: () => listWebhooks(context, workspace.id),
    refetchOnMount: 'always',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const newPath = routePaths.developerWebhookNew(workspace.identifier);
  async function toggle(id: string, enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      await setWebhookEnabled(context, workspace.id, id, enabled);
      await client.invalidateQueries({
        queryKey: webhookKey(context, workspace.id),
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }
  const create = (
    <Button size="sm" variant="primary" onClick={() => navigateTo(newPath)}>
      <Plus aria-hidden="true" size={14} /> Create webhook
    </Button>
  );
  return (
    <SettingsArticle
      eyebrow="Developer"
      title="Webhooks"
      description="Send Workspace events to external services."
      className="developer-page webhook-page"
      action={!query.error ? create : undefined}
    >
      {error ? (
        <p role="alert" className="settings-error">
          {error}
        </p>
      ) : null}
      {query.error ? (
        <div role="alert">
          <p>{errorMessage(query.error)}</p>
          <Button onClick={() => void query.refetch()}>Try again</Button>
        </div>
      ) : query.isPending ? (
        <p role="status">Loading webhooks…</p>
      ) : !query.data.length ? (
        <SettingsEmptyState
          title="No webhooks yet"
          description="Create a webhook to send task and comment events to an external service."
          action={
            <Button size="sm" onClick={() => navigateTo(newPath)}>
              Create your first webhook
            </Button>
          }
        />
      ) : (
        <SettingsList
          ariaLabel="Webhooks"
          className="webhook-list"
          header={
            <>
              <span>Name and endpoint</span>
              <span>Subscriptions</span>
              <span>Status</span>
              <span />
            </>
          }
        >
          {query.data.map((hook) => (
            <SettingsListRow key={hook.id}>
              <SettingsListCell primary>
                <Link
                  className="webhook-name"
                  to={routePaths.developerWebhookDetail(
                    workspace.identifier,
                    hook.id,
                  )}
                  onClick={onNavigate}
                >
                  {hook.name}
                </Link>
                <small className="webhook-endpoint">{hook.endpoint_url}</small>
              </SettingsListCell>
              <SettingsListCell>
                <small>
                  {hook.event_types.length}{' '}
                  {hook.event_types.length === 1 ? 'event' : 'events'} ·{' '}
                  {hook.project_scope === 'all'
                    ? 'All projects'
                    : hook.projects.map(({ name }) => name).join(', ') ||
                      'No Projects selected'}
                </small>
              </SettingsListCell>
              <SettingsListCell>
                <span
                  className={
                    hook.enabled ? 'settings-success' : 'webhook-muted'
                  }
                >
                  {hook.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </SettingsListCell>
              <SettingsListCell>
                <SettingsActionsMenu
                  label={`Actions for ${hook.name}`}
                  disabled={busy}
                >
                  <SettingsAction
                    onClick={() =>
                      navigateTo(
                        routePaths.developerWebhookDetail(
                          workspace.identifier,
                          hook.id,
                        ),
                      )
                    }
                  >
                    Edit webhook
                  </SettingsAction>
                  <SettingsAction
                    onClick={() => void toggle(hook.id, !hook.enabled)}
                  >
                    {hook.enabled ? 'Disable' : 'Enable'}
                  </SettingsAction>
                </SettingsActionsMenu>
              </SettingsListCell>
            </SettingsListRow>
          ))}
        </SettingsList>
      )}
    </SettingsArticle>
  );
}
