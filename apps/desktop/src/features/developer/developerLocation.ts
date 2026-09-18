import { routePaths } from '../../app/routing/routePaths';

export type DeveloperSection = 'overview' | 'webhooks';

export function developerPath(
  workspaceIdentifier: string,
  section: DeveloperSection,
) {
  return section === 'webhooks'
    ? routePaths.developerWebhooks(workspaceIdentifier)
    : routePaths.developerWorkspace(workspaceIdentifier);
}
