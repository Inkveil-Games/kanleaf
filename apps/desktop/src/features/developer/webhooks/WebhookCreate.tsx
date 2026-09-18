import { useQueryClient } from '@tanstack/react-query';
import { useState, type MouseEventHandler } from 'react';
import { Link } from 'react-router';
import { routePaths } from '../../../app/routing/routePaths';
import { SettingsArticle } from '../../settings/SettingsArticle';
import type { ApiContext } from '../../workspace/api';
import type { Workspace } from '../../workspace/types';
import { createWebhook, webhookKey } from './api';
import type { Webhook } from './types';
import { WebhookForm } from './WebhookForm';
import { WebhookSecret } from './WebhookSecret';

export function WebhookCreate({
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
  const [created, setCreated] = useState<{
    webhook: Webhook;
    signing_secret: string;
  } | null>(null);
  return (
    <SettingsArticle
      eyebrow="Developer"
      title={created ? 'Webhook created' : 'Create webhook'}
      description={
        created
          ? 'Save your signing secret before leaving this page.'
          : 'Choose the events and Projects to send to your endpoint.'
      }
      className="developer-page webhook-page"
      backAction={{
        label: 'Back to Webhooks',
        onClick: () =>
          navigateTo(routePaths.developerWebhooks(workspace.identifier)),
      }}
    >
      {created ? (
        <>
          <WebhookSecret secret={created.signing_secret} />
          <Link
            className="developer-text-link"
            to={routePaths.developerWebhookDetail(
              workspace.identifier,
              created.webhook.id,
            )}
            onClick={onNavigate}
          >
            Open webhook
          </Link>
        </>
      ) : (
        <WebhookForm
          context={context}
          workspace={workspace}
          submitLabel="Create webhook"
          onSubmit={async (input) => {
            const result = await createWebhook(context, workspace.id, input);
            setCreated(result);
            void client.invalidateQueries({
              queryKey: webhookKey(context, workspace.id),
            });
          }}
        />
      )}
    </SettingsArticle>
  );
}
