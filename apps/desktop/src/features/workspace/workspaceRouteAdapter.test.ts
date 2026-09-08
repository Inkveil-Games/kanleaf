import { describe, expect, it } from 'vitest';
import { workspaceLocationFromRoute } from './workspaceRouteAdapter';

describe('Workspace route compatibility', () => {
  it('maps a nested Workspace Settings detail to durable location state', () => {
    expect(
      workspaceLocationFromRoute(
        'workspace-settings',
        'workspace-1',
        { section: 'properties', detail: 'property-1' },
        '',
        null,
      ),
    ).toEqual({
      kind: 'workspace-settings',
      workspaceId: 'workspace-1',
      section: 'properties',
      detail: 'property-1',
      returnTo: null,
    });
  });

  it('ignores a property definition query on an existing detail route', () => {
    expect(
      workspaceLocationFromRoute(
        'workspace-settings',
        'workspace-1',
        { section: 'properties', detail: 'missing-property' },
        '?define=External+score',
        null,
      ),
    ).toEqual({
      kind: 'workspace-settings',
      workspaceId: 'workspace-1',
      section: 'properties',
      detail: 'missing-property',
      definePropertyName: undefined,
      returnTo: null,
    });
  });

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
