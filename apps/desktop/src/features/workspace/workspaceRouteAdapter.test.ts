import { describe, expect, it } from 'vitest';
import { workspaceLocationFromRoute } from './workspaceRouteAdapter';

describe('Workspace route compatibility', () => {
  it('maps a resolved Page selection query to the internal document ID', () => {
    expect(
      workspaceLocationFromRoute(
        'workspace-library',
        'workspace-1',
        {},
        '?page=document-uuid',
        null,
      ),
    ).toEqual({
      kind: 'workspace-library',
      workspaceId: 'workspace-1',
      documentId: 'document-uuid',
    });
  });

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
