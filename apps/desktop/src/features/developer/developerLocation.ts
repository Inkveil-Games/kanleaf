import { routePaths } from '../../app/routing/routePaths';

export type DeveloperSection =
  'overview' | 'webhooks' | 'webhook-new' | 'webhook-detail';

export function developerPath(
  workspaceIdentifier: string,
  section: DeveloperSection,
  webhookId?: string,
) {
  switch (section) {
    case 'overview':
      return routePaths.developerWorkspace(workspaceIdentifier);
    case 'webhook-new':
      return routePaths.developerWebhookNew(workspaceIdentifier);
    case 'webhook-detail':
      return webhookId
        ? routePaths.developerWebhookDetail(workspaceIdentifier, webhookId)
        : routePaths.developerWebhooks(workspaceIdentifier);
    case 'webhooks':
      return routePaths.developerWebhooks(workspaceIdentifier);
  }
}
