import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { routePaths } from '../../../app/routing/routePaths';
import { AppDialog } from '../../../components/ui/AppDialog';
import { Button } from '../../../components/ui/Button';
import { ApiError } from '../../../lib/api/client';
import { SettingsArticle } from '../../settings/SettingsArticle';
import { errorMessage } from '../../settings/utils';
import type { ApiContext } from '../../workspace/api';
import type { Workspace } from '../../workspace/types';
import {
  deleteWebhook,
  getWebhook,
  getWebhookDelivery,
  listWebhookDeliveries,
  regenerateWebhookSecret,
  sendTestWebhook,
  updateWebhook,
  webhookKey,
} from './api';
import { WebhookDeliveries } from './WebhookDeliveries';
import { deliverySummary } from './deliverySummary';
import { WebhookForm } from './WebhookForm';
import { WebhookSecret } from './WebhookSecret';
import type { WebhookDelivery } from './types';

export function WebhookDetail({
  context,
  workspace,
  id,
  navigateTo,
}: {
  context: ApiContext;
  workspace: Workspace;
  id: string;
  navigateTo: (path: string) => void;
}) {
  const client = useQueryClient();
  const queryKey = [...webhookKey(context, workspace.id), 'detail', id];
  const query = useQuery({
    queryKey,
    queryFn: () => getWebhook(context, workspace.id, id),
    refetchOnMount: 'always',
  });
  const deliveriesKey = [
    ...webhookKey(context, workspace.id),
    'deliveries',
    id,
  ];
  const deliveries = useQuery({
    queryKey: deliveriesKey,
    queryFn: () => listWebhookDeliveries(context, workspace.id, id),
    enabled: query.isFetchedAfterMount && !query.error && !!query.data,
    refetchInterval: (query) =>
      query.state.data?.some(({ status }) => status === 'pending')
        ? 1000
        : 10000,
  });
  const [confirmation, setConfirmation] = useState<
    'regenerate' | 'delete' | null
  >(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [submittedTest, setSubmittedTest] = useState<WebhookDelivery | null>(
    null,
  );
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const testQuery = useQuery({
    queryKey: [...deliveriesKey, 'test', submittedTest?.id],
    queryFn: () =>
      getWebhookDelivery(context, workspace.id, id, submittedTest?.id ?? ''),
    enabled:
      !!submittedTest &&
      query.isFetchedAfterMount &&
      !query.error &&
      !!query.data,
    refetchInterval: (query) =>
      query.state.data?.status === 'pending' ? 1000 : false,
  });
  const testResult = testQuery.data ?? submittedTest;
  async function sendTest() {
    setTesting(true);
    setError(null);
    try {
      const result = await sendTestWebhook(context, workspace.id, id);
      setSubmittedTest(result);
      await client.invalidateQueries({ queryKey: deliveriesKey });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setTesting(false);
    }
  }
  const backAction = {
    label: 'Back to Webhooks',
    onClick: () =>
      navigateTo(routePaths.developerWebhooks(workspace.identifier)),
  };
  const accessDenied =
    query.error instanceof ApiError &&
    [401, 403, 404, 422].includes(query.error.status);
  if (
    query.error &&
    (!query.data || !query.isFetchedAfterMount || accessDenied)
  )
    return (
      <SettingsArticle
        eyebrow="Developer"
        title="Webhook unavailable"
        description="The webhook could not be opened."
        className="developer-page webhook-page"
        backAction={backAction}
      >
        <div role="alert">
          <p>{errorMessage(query.error)}</p>
          <Button onClick={() => void query.refetch()}>Try again</Button>
        </div>
      </SettingsArticle>
    );
  if (!query.data || !query.isFetchedAfterMount)
    return (
      <p className="developer-page" role="status">
        Opening webhook…
      </p>
    );
  return (
    <SettingsArticle
      eyebrow="Developer"
      title={query.data.name}
      description="Manage endpoint, events, and delivery settings."
      className="developer-page webhook-page"
      backAction={backAction}
    >
      {query.error ? (
        <div role="alert">
          <p>{errorMessage(query.error)}</p>
          <Button onClick={() => void query.refetch()}>Retry webhook</Button>
        </div>
      ) : null}
      <section className="settings-section">
        <h2>Configuration</h2>
        <WebhookForm
          context={context}
          workspace={workspace}
          webhook={query.data}
          submitLabel="Save changes"
          onSubmit={async (input) => {
            const result = await updateWebhook(
              context,
              workspace.id,
              id,
              input,
            );
            client.setQueryData(queryKey, result);
            void client.invalidateQueries({
              queryKey: webhookKey(context, workspace.id),
            });
          }}
        />
      </section>
      {secret ? (
        <WebhookSecret key={secret} secret={secret} />
      ) : (
        <section className="settings-section">
          <h2>Signing secret</h2>
          <p>
            The signing secret is stored securely and cannot be displayed again.
          </p>
        </section>
      )}
      <Button size="sm" onClick={() => setConfirmation('regenerate')}>
        Regenerate secret
      </Button>
      <section className="settings-section">
        <h2>Send a test</h2>
        <p>
          Send a signed webhook.test request to the saved endpoint. Tests also
          work while a webhook is disabled.
        </p>
        <Button
          size="sm"
          loading={testing}
          disabled={testResult?.status === 'pending'}
          onClick={() => void sendTest()}
        >
          Send test webhook
        </Button>
        {submittedTest ? (
          <p role="status">
            {testResult ? deliverySummary(testResult) : 'Test queued…'}
            {testResult?.last_error ? ` · ${testResult.last_error}` : ''}
          </p>
        ) : null}
        {testQuery.error ? (
          <div role="alert">
            <p>{errorMessage(testQuery.error)}</p>
            <Button size="sm" onClick={() => void testQuery.refetch()}>
              Retry test result
            </Button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="settings-error">
            {error}
          </p>
        ) : null}
      </section>
      {deliveries.error ? (
        <div role="alert">
          <p>{errorMessage(deliveries.error)}</p>
          <Button onClick={() => void deliveries.refetch()}>
            Retry deliveries
          </Button>
        </div>
      ) : deliveries.data ? (
        <WebhookDeliveries deliveries={deliveries.data} />
      ) : (
        <p role="status">Loading recent deliveries…</p>
      )}
      <section className="settings-section">
        <h2>Danger zone</h2>
        <p>
          Deleting a webhook stops future deliveries and removes its delivery
          history.
        </p>
        <Button
          size="sm"
          variant="danger"
          onClick={() => setConfirmation('delete')}
        >
          Delete webhook
        </Button>
      </section>
      <AppDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
        type="confirm"
        variant={confirmation === 'delete' ? 'danger' : 'warning'}
        title={
          confirmation === 'delete'
            ? 'Delete webhook?'
            : 'Regenerate signing secret?'
        }
        description={
          confirmation === 'delete'
            ? 'This permanently deletes the webhook and its delivery history.'
            : 'The previous secret will stop signing new attempts. Update your receiver after copying the replacement.'
        }
        confirmLabel={
          confirmation === 'delete' ? 'Delete webhook' : 'Regenerate secret'
        }
        onConfirm={async () => {
          if (confirmation === 'delete') {
            await deleteWebhook(context, workspace.id, id);
            void client.invalidateQueries({
              queryKey: webhookKey(context, workspace.id),
            });
            navigateTo(routePaths.developerWebhooks(workspace.identifier));
          } else {
            const result = await regenerateWebhookSecret(
              context,
              workspace.id,
              id,
            );
            setSecret(result.signing_secret);
            void client.invalidateQueries({ queryKey });
          }
        }}
      />
    </SettingsArticle>
  );
}
