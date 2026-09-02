import { describe, expect, it } from 'vitest';
import { workspaceLocationFromRoute } from './workspaceRouteAdapter';

describe('Workspace route compatibility', () => {
  it('canonicalizes the removed Workspace Invitations section to Members', () => {
    expect(
      workspaceLocationFromRoute(
        'workspace-settings',
        'workspace-1',
        { section: 'invitations' },
        '',
        null,
      ),
    ).toEqual({
      kind: 'workspace-settings',
      workspaceId: 'workspace-1',
      section: 'members',
      returnTo: null,
    });
  });
});
