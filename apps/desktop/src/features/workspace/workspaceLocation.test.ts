import { describe, expect, it } from 'vitest';
import {
  parseWorkspaceContentPath,
  reconcileWorkspaceLocation,
  settingsReturnTarget,
  workspaceBaseLocation,
  workspaceContentPath,
  workspaceLocationIdentity,
  type WorkspaceLocationAccess,
  type WorkspaceContentLocation,
  type WorkspaceSettingsLocation,
} from './workspaceLocation';

const baseAccess: WorkspaceLocationAccess = {
  activeWorkspaceId: 'workspace-1',
  workspaces: {
    status: 'resolved',
    value: [{ id: 'workspace-1', role: 'owner' }],
  },
};

function resolveWorkspaceId(identifier: string) {
  if (identifier === 'kanleaf-core') return 'workspace one';
  if (identifier === 'workspace-1') return 'workspace-1';
  return null;
}

describe('Workspace content path parsing', () => {
  it('round-trips a typed Task collection through its canonical serializer', () => {
    const location: WorkspaceContentLocation = {
      kind: 'project-view',
      workspaceId: 'workspace one',
      projectId: 'project/one',
      viewId: 'view-1',
      taskId: 'task one',
    };

    const path = workspaceContentPath(location, 'kanleaf-core');

    expect(path).toBe(
      '/w/kanleaf-core/p/project%2Fone/views/view-1?task=task+one',
    );
    expect(parseWorkspaceContentPath(path, resolveWorkspaceId)).toEqual(
      location,
    );
  });

  it.each([
    [
      '/w/workspace-1/my-work?task=task-1',
      {
        kind: 'my-work',
        workspaceId: 'workspace-1',
        taskId: 'task-1',
      },
    ],
    [
      '/w/workspace-1/inbox',
      { kind: 'inbox', workspaceId: 'workspace-1', taskId: null },
    ],
    [
      '/w/workspace-1/tasks',
      { kind: 'all-tasks', workspaceId: 'workspace-1', taskId: null },
    ],
    [
      '/w/workspace-1/views/view-1?task=task-1',
      {
        kind: 'workspace-view',
        workspaceId: 'workspace-1',
        viewId: 'view-1',
        taskId: 'task-1',
      },
    ],
    [
      '/w/workspace-1/library',
      {
        kind: 'workspace-library',
        workspaceId: 'workspace-1',
        documentId: null,
      },
    ],
    [
      '/w/workspace-1/library?page=42',
      {
        kind: 'workspace-library',
        workspaceId: 'workspace-1',
        documentId: '42',
      },
    ],
    [
      '/w/workspace-1/p/project-1',
      {
        kind: 'project-overview',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
      },
    ],
    [
      '/w/workspace-1/p/project-1/work-items?task=task-1',
      {
        kind: 'project-work-items',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        taskId: 'task-1',
      },
    ],
    [
      '/w/workspace-1/p/project-1/cycles/cycle-1',
      {
        kind: 'project-cycles',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        cycleId: 'cycle-1',
      },
    ],
    [
      '/w/workspace-1/p/project-1/modules',
      {
        kind: 'project-modules',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        moduleId: null,
      },
    ],
    [
      '/w/workspace-1/p/project-1/library?page=42',
      {
        kind: 'project-library',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        documentId: '42',
      },
    ],
    [
      '/w/workspace-1/p/project-1/views',
      {
        kind: 'project-views',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
      },
    ],
    [
      '/w/workspace-1/p/project-1/views/view-1',
      {
        kind: 'project-view',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        viewId: 'view-1',
        taskId: null,
      },
    ],
    [
      '/w/kanleaf-core/my-work?task=task+one',
      {
        kind: 'my-work',
        workspaceId: 'workspace one',
        taskId: 'task one',
      },
    ],
  ] as const)('parses canonical content route %s', (path, expected) => {
    expect(parseWorkspaceContentPath(path, resolveWorkspaceId)).toEqual(
      expected,
    );
  });

  it.each([
    'https://example.com/workspace-1/my-work',
    '//example.com/workspace-1/my-work',
    '/host',
    '/missing/my-work',
    '/workspace-1/my-work',
    '/w/workspace-1',
    '/w/workspace-1/my-work/',
    '/w/workspace-1/settings/account/profile',
    '/w/workspace-1/p/project-1/settings/general',
    '/w/workspace-1/library?task=task-1',
    '/w/workspace-1/my-work?page=42',
    '/w/workspace-1/library?page=',
    '/w/workspace-1/library?page=1&page=2',
    '/w/workspace-1/library/document-1',
    '/w/workspace-1/my-work?filter=open',
    '/w/workspace-1/my-work?task=one&task=two',
    '/w/workspace-1/my-work?task=',
    '/w/workspace-1/my-work#section',
    '/w/%E0%A4%A/my-work',
    '/w/workspace+one/my-work',
    '/w/workspace-1/library/..',
    '/w/workspace-1/p/../work-items',
  ])('rejects unsafe or non-canonical return target %s', (path) => {
    expect(parseWorkspaceContentPath(path, resolveWorkspaceId)).toBeNull();
  });

  it('resolves a public Page number to the internal document UUID', () => {
    expect(
      parseWorkspaceContentPath(
        '/w/workspace-1/library?page=42',
        resolveWorkspaceId,
        undefined,
        undefined,
        (number) => (number === '42' ? 'document-uuid' : null),
      ),
    ).toEqual({
      kind: 'workspace-library',
      workspaceId: 'workspace-1',
      documentId: 'document-uuid',
    });
  });
});

describe('workspace location identity', () => {
  it('keeps task detail out of the collection draft identity', () => {
    const location: WorkspaceContentLocation = {
      kind: 'project-view',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      viewId: 'view-1',
      taskId: 'task-1',
    };

    expect(workspaceBaseLocation(location)).toEqual({
      ...location,
      taskId: null,
    });
    expect(workspaceLocationIdentity(location)).toBe(
      'workspace-1:project-view:project-1:view-1',
    );
  });

  it('uses the validated Settings background as the draft identity', () => {
    const returnTo: WorkspaceContentLocation = {
      kind: 'workspace-view',
      workspaceId: 'workspace-1',
      viewId: 'view-1',
      taskId: 'task-1',
    };
    const location: WorkspaceSettingsLocation = {
      kind: 'workspace-settings',
      workspaceId: 'workspace-1',
      section: 'general',
      returnTo,
    };

    expect(workspaceBaseLocation(location)).toEqual({
      ...returnTo,
      taskId: null,
    });
    expect(workspaceLocationIdentity(location)).toBe(
      'workspace-1:workspace-view:view-1',
    );
  });

  it('distinguishes explicit resource selections from their parent surfaces', () => {
    const document: WorkspaceContentLocation = {
      kind: 'project-library',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      documentId: 'document-1',
    };
    const cycle: WorkspaceContentLocation = {
      kind: 'project-cycles',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      cycleId: 'cycle-1',
    };

    expect(workspaceLocationIdentity(document)).toBe(
      'workspace-1:project-library:project-1:document-1',
    );
    expect(workspaceLocationIdentity({ ...document, documentId: null })).toBe(
      'workspace-1:project-library:project-1',
    );
    expect(workspaceLocationIdentity(cycle)).toBe(
      'workspace-1:project-cycles:project-1:cycle-1',
    );
  });
});

describe('Settings return target', () => {
  it('accepts any content location in the same Workspace for Account Settings', () => {
    const settings: WorkspaceSettingsLocation = {
      kind: 'account-settings',
      workspaceId: 'workspace-1',
      section: 'profile',
      returnTo: {
        kind: 'project-library',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        documentId: 'document-1',
      },
    };

    expect(settingsReturnTarget(settings)).toEqual(settings.returnTo);
  });

  it('rejects another Workspace and falls back to My Work', () => {
    const settings: WorkspaceSettingsLocation = {
      kind: 'workspace-settings',
      workspaceId: 'workspace-1',
      section: 'general',
      returnTo: {
        kind: 'all-tasks',
        workspaceId: 'workspace-2',
        taskId: null,
      },
    };

    expect(settingsReturnTarget(settings)).toEqual({
      kind: 'my-work',
      workspaceId: 'workspace-1',
      taskId: null,
    });
  });

  it('requires a Project Settings return target to use the same Project', () => {
    const settings: WorkspaceSettingsLocation = {
      kind: 'project-settings',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      section: 'general',
      returnTo: {
        kind: 'project-overview',
        workspaceId: 'workspace-1',
        projectId: 'project-2',
      },
    };

    expect(settingsReturnTarget(settings)).toEqual({
      kind: 'project-overview',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
    });
  });

  it('uses deterministic fallbacks for direct Settings links', () => {
    const account: WorkspaceSettingsLocation = {
      kind: 'account-settings',
      workspaceId: 'workspace-1',
      section: 'profile',
      returnTo: null,
    };
    const project: WorkspaceSettingsLocation = {
      kind: 'project-settings',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      section: 'general',
      returnTo: null,
    };

    expect(settingsReturnTarget(account)).toEqual({
      kind: 'my-work',
      workspaceId: 'workspace-1',
      taskId: null,
    });
    expect(settingsReturnTarget(project)).toEqual({
      kind: 'project-overview',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
    });
  });
});

describe('workspace reconciliation query state', () => {
  const location: WorkspaceContentLocation = {
    kind: 'all-tasks',
    workspaceId: 'workspace-1',
    taskId: null,
  };

  it('waits while the owning Workspace list is pending', () => {
    expect(
      reconcileWorkspaceLocation(location, {
        ...baseAccess,
        workspaces: { status: 'pending' },
      }),
    ).toEqual({ status: 'wait' });
  });

  it('keeps the requested URL when the owning Workspace list fails transiently', () => {
    expect(
      reconcileWorkspaceLocation(location, {
        ...baseAccess,
        workspaces: { status: 'transient-error' },
      }),
    ).toEqual({ status: 'keep' });
  });

  it('keeps a valid resolved Workspace location', () => {
    expect(reconcileWorkspaceLocation(location, baseAccess)).toEqual({
      status: 'keep',
    });
  });
});

describe('Workspace membership reconciliation', () => {
  it('replaces a missing Workspace with the visible active Workspace', () => {
    expect(
      reconcileWorkspaceLocation(
        {
          kind: 'workspace-library',
          workspaceId: 'missing-workspace',
          documentId: 'document-1',
        },
        {
          activeWorkspaceId: 'workspace-2',
          workspaces: {
            status: 'resolved',
            value: [
              { id: 'workspace-1', role: 'member' },
              { id: 'workspace-2', role: 'owner' },
            ],
          },
        },
      ),
    ).toEqual({
      status: 'replace',
      location: {
        kind: 'my-work',
        workspaceId: 'workspace-2',
        taskId: null,
      },
    });
  });

  it('uses the first visible Workspace when the active one is stale', () => {
    expect(
      reconcileWorkspaceLocation(
        {
          kind: 'all-tasks',
          workspaceId: 'missing-workspace',
          taskId: null,
        },
        {
          activeWorkspaceId: 'stale-workspace',
          workspaces: {
            status: 'resolved',
            value: [{ id: 'workspace-1', role: 'member' }],
          },
        },
      ),
    ).toEqual({
      status: 'replace',
      location: {
        kind: 'my-work',
        workspaceId: 'workspace-1',
        taskId: null,
      },
    });
  });

  it('returns to root when no Workspace is accessible', () => {
    expect(
      reconcileWorkspaceLocation(
        {
          kind: 'my-work',
          workspaceId: 'missing-workspace',
          taskId: null,
        },
        {
          activeWorkspaceId: null,
          workspaces: { status: 'resolved', value: [] },
        },
      ),
    ).toEqual({
      status: 'replace',
      location: { kind: 'root' },
    });
  });
});

describe('guest Workspace routes', () => {
  const guestAccess: WorkspaceLocationAccess = {
    activeWorkspaceId: 'workspace-1',
    workspaces: {
      status: 'resolved',
      value: [{ id: 'workspace-1', role: 'guest' }],
    },
  };

  it('canonicalizes restricted Workspace content to My Work', () => {
    expect(
      reconcileWorkspaceLocation(
        {
          kind: 'workspace-library',
          workspaceId: 'workspace-1',
          documentId: 'document-1',
        },
        guestAccess,
      ),
    ).toEqual({
      status: 'replace',
      location: {
        kind: 'my-work',
        workspaceId: 'workspace-1',
        taskId: null,
      },
    });
  });

  it('removes a Task detail from the restricted My Work state', () => {
    expect(
      reconcileWorkspaceLocation(
        {
          kind: 'my-work',
          workspaceId: 'workspace-1',
          taskId: 'task-1',
        },
        guestAccess,
      ),
    ).toEqual({
      status: 'replace',
      location: {
        kind: 'my-work',
        workspaceId: 'workspace-1',
        taskId: null,
      },
    });
  });

  it('keeps the bare My Work restricted state', () => {
    expect(
      reconcileWorkspaceLocation(
        {
          kind: 'my-work',
          workspaceId: 'workspace-1',
          taskId: null,
        },
        guestAccess,
      ),
    ).toEqual({ status: 'keep' });
  });
});

describe('Project access reconciliation', () => {
  const project = {
    id: 'project-1',
    workspace_id: 'workspace-1',
    visibility: 'private' as const,
    effective_role: 'admin' as const,
    can_join: false,
    cycles_enabled: true,
    modules_enabled: true,
    pages_enabled: true,
    views_enabled: true,
  };
  const projectLocation: WorkspaceContentLocation = {
    kind: 'project-work-items',
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    taskId: null,
  };

  it('waits for a pending Project query and keeps transient failures', () => {
    expect(
      reconcileWorkspaceLocation(projectLocation, {
        ...baseAccess,
        project: { status: 'pending' },
      }),
    ).toEqual({ status: 'wait' });
    expect(
      reconcileWorkspaceLocation(projectLocation, {
        ...baseAccess,
        project: { status: 'transient-error' },
      }),
    ).toEqual({ status: 'keep' });
  });

  it.each(['absent', 'forbidden'] as const)(
    'returns an authoritative %s Project to Workspace My Work',
    (status) => {
      expect(
        reconcileWorkspaceLocation(projectLocation, {
          ...baseAccess,
          project: { status },
        }),
      ).toEqual({
        status: 'replace',
        location: {
          kind: 'my-work',
          workspaceId: 'workspace-1',
          taskId: null,
        },
      });
    },
  );

  it('keeps a discoverable unjoined Open Project at Overview', () => {
    const openProject = {
      ...project,
      visibility: 'public' as const,
      effective_role: null,
      can_join: true,
    };

    expect(
      reconcileWorkspaceLocation(
        {
          kind: 'project-overview',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
        },
        {
          ...baseAccess,
          project: { status: 'resolved', value: openProject },
        },
      ),
    ).toEqual({ status: 'keep' });
  });

  it('returns unjoined Project child routes to the joinable Overview', () => {
    expect(
      reconcileWorkspaceLocation(projectLocation, {
        ...baseAccess,
        project: {
          status: 'resolved',
          value: {
            ...project,
            visibility: 'public',
            effective_role: null,
            can_join: true,
          },
        },
      }),
    ).toEqual({
      status: 'replace',
      location: {
        kind: 'project-overview',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
      },
    });
  });

  it('does not retain an undisclosed Project with no effective role', () => {
    expect(
      reconcileWorkspaceLocation(
        {
          kind: 'project-overview',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
        },
        {
          ...baseAccess,
          project: {
            status: 'resolved',
            value: { ...project, effective_role: null },
          },
        },
      ),
    ).toEqual({
      status: 'replace',
      location: {
        kind: 'my-work',
        workspaceId: 'workspace-1',
        taskId: null,
      },
    });
  });

  it.each([
    [
      'cycles_enabled',
      {
        kind: 'project-cycles',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        cycleId: null,
      },
    ],
    [
      'modules_enabled',
      {
        kind: 'project-modules',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        moduleId: null,
      },
    ],
    [
      'pages_enabled',
      {
        kind: 'project-library',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        documentId: null,
      },
    ],
    [
      'views_enabled',
      {
        kind: 'project-views',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
      },
    ],
  ] as const)(
    'returns to Overview when %s is disabled',
    (feature, location) => {
      expect(
        reconcileWorkspaceLocation(location, {
          ...baseAccess,
          project: {
            status: 'resolved',
            value: { ...project, [feature]: false },
          },
        }),
      ).toEqual({
        status: 'replace',
        location: {
          kind: 'project-overview',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
        },
      });
    },
  );

  it('allows a guest Workspace member to use a Project with an effective role', () => {
    expect(
      reconcileWorkspaceLocation(projectLocation, {
        ...baseAccess,
        workspaces: {
          status: 'resolved',
          value: [{ id: 'workspace-1', role: 'guest' }],
        },
        project: {
          status: 'resolved',
          value: { ...project, effective_role: 'viewer' },
        },
      }),
    ).toEqual({ status: 'keep' });
  });

  it('returns non-Admin Project Settings to Project Overview', () => {
    expect(
      reconcileWorkspaceLocation(
        {
          kind: 'project-settings',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          section: 'general',
          returnTo: null,
        },
        {
          ...baseAccess,
          project: {
            status: 'resolved',
            value: { ...project, effective_role: 'contributor' },
          },
        },
      ),
    ).toEqual({
      status: 'replace',
      location: {
        kind: 'project-overview',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
      },
    });
  });
});

describe('Saved View reconciliation', () => {
  const project = {
    id: 'project-1',
    workspace_id: 'workspace-1',
    visibility: 'private' as const,
    effective_role: 'admin' as const,
    can_join: false,
    cycles_enabled: true,
    modules_enabled: true,
    pages_enabled: true,
    views_enabled: true,
  };
  const workspaceView: WorkspaceContentLocation = {
    kind: 'workspace-view',
    workspaceId: 'workspace-1',
    viewId: 'view-1',
    taskId: null,
  };

  it('waits for a pending View and keeps its URL on transient failure', () => {
    expect(
      reconcileWorkspaceLocation(workspaceView, {
        ...baseAccess,
        savedView: { status: 'pending' },
      }),
    ).toEqual({ status: 'wait' });
    expect(
      reconcileWorkspaceLocation(workspaceView, {
        ...baseAccess,
        savedView: { status: 'transient-error' },
      }),
    ).toEqual({ status: 'keep' });
  });

  it.each(['absent', 'forbidden'] as const)(
    'returns an authoritative %s Workspace View to All Tasks',
    (status) => {
      expect(
        reconcileWorkspaceLocation(workspaceView, {
          ...baseAccess,
          savedView: { status },
        }),
      ).toEqual({
        status: 'replace',
        location: {
          kind: 'all-tasks',
          workspaceId: 'workspace-1',
          taskId: null,
        },
      });
    },
  );

  it('returns a missing Project View to the Project Views index', () => {
    expect(
      reconcileWorkspaceLocation(
        {
          kind: 'project-view',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          viewId: 'view-1',
          taskId: null,
        },
        {
          ...baseAccess,
          project: { status: 'resolved', value: project },
          savedView: { status: 'absent' },
        },
      ),
    ).toEqual({
      status: 'replace',
      location: {
        kind: 'project-views',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
      },
    });
  });

  it('corrects an authorized Project View opened under Workspace scope', () => {
    expect(
      reconcileWorkspaceLocation(
        { ...workspaceView, taskId: 'task-1' },
        {
          ...baseAccess,
          savedView: {
            status: 'resolved',
            value: {
              id: 'view-1',
              workspace_id: 'workspace-1',
              project_id: 'project-2',
            },
          },
        },
      ),
    ).toEqual({
      status: 'replace',
      location: {
        kind: 'project-view',
        workspaceId: 'workspace-1',
        projectId: 'project-2',
        viewId: 'view-1',
        taskId: 'task-1',
      },
    });
  });

  it('corrects an authorized Workspace View opened under Project scope', () => {
    expect(
      reconcileWorkspaceLocation(
        {
          kind: 'project-view',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          viewId: 'view-1',
          taskId: null,
        },
        {
          ...baseAccess,
          project: { status: 'resolved', value: project },
          savedView: {
            status: 'resolved',
            value: {
              id: 'view-1',
              workspace_id: 'workspace-1',
              project_id: null,
            },
          },
        },
      ),
    ).toEqual({
      status: 'replace',
      location: {
        kind: 'workspace-view',
        workspaceId: 'workspace-1',
        viewId: 'view-1',
        taskId: null,
      },
    });
  });

  it('does not resolve a View through a missing or undisclosed routed Project', () => {
    expect(
      reconcileWorkspaceLocation(
        {
          kind: 'project-view',
          workspaceId: 'workspace-1',
          projectId: 'stale-project',
          viewId: 'view-1',
          taskId: null,
        },
        {
          ...baseAccess,
          project: { status: 'absent' },
          savedView: {
            status: 'resolved',
            value: {
              id: 'view-1',
              workspace_id: 'workspace-1',
              project_id: 'project-1',
            },
          },
        },
      ),
    ).toEqual({
      status: 'replace',
      location: {
        kind: 'my-work',
        workspaceId: 'workspace-1',
        taskId: null,
      },
    });
  });

  it('corrects scope after establishing access to a routed Project with Views disabled', () => {
    expect(
      reconcileWorkspaceLocation(
        {
          kind: 'project-view',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          viewId: 'view-1',
          taskId: null,
        },
        {
          ...baseAccess,
          project: {
            status: 'resolved',
            value: { ...project, views_enabled: false },
          },
          savedView: {
            status: 'resolved',
            value: {
              id: 'view-1',
              workspace_id: 'workspace-1',
              project_id: 'project-2',
            },
          },
        },
      ),
    ).toEqual({
      status: 'replace',
      location: {
        kind: 'project-view',
        workspaceId: 'workspace-1',
        projectId: 'project-2',
        viewId: 'view-1',
        taskId: null,
      },
    });
  });

  it('does not canonicalize a View response from another Workspace', () => {
    expect(
      reconcileWorkspaceLocation(workspaceView, {
        ...baseAccess,
        savedView: {
          status: 'resolved',
          value: {
            id: 'view-1',
            workspace_id: 'workspace-2',
            project_id: null,
          },
        },
      }),
    ).toEqual({
      status: 'replace',
      location: {
        kind: 'all-tasks',
        workspaceId: 'workspace-1',
        taskId: null,
      },
    });
  });

  it('keeps a View whose resolved scope matches the route', () => {
    expect(
      reconcileWorkspaceLocation(workspaceView, {
        ...baseAccess,
        savedView: {
          status: 'resolved',
          value: {
            id: 'view-1',
            workspace_id: 'workspace-1',
            project_id: null,
          },
        },
      }),
    ).toEqual({ status: 'keep' });
  });
});

describe('Library document reconciliation', () => {
  const documentLocation: WorkspaceContentLocation = {
    kind: 'workspace-library',
    workspaceId: 'workspace-1',
    documentId: 'document-1',
  };

  it('keeps the parent Library route without resolving an implicit selection', () => {
    expect(
      reconcileWorkspaceLocation(
        { ...documentLocation, documentId: null },
        baseAccess,
      ),
    ).toEqual({ status: 'keep' });
  });

  it('defers an explicit document to the controlled child when no resolution is supplied', () => {
    expect(reconcileWorkspaceLocation(documentLocation, baseAccess)).toEqual({
      status: 'keep',
    });
  });

  it('waits for a pending document and keeps its URL on transient failure', () => {
    expect(
      reconcileWorkspaceLocation(documentLocation, {
        ...baseAccess,
        document: { status: 'pending' },
      }),
    ).toEqual({ status: 'wait' });
    expect(
      reconcileWorkspaceLocation(documentLocation, {
        ...baseAccess,
        document: { status: 'transient-error' },
      }),
    ).toEqual({ status: 'keep' });
  });

  it.each(['absent', 'forbidden'] as const)(
    'returns an authoritative %s document to its Library parent',
    (status) => {
      expect(
        reconcileWorkspaceLocation(documentLocation, {
          ...baseAccess,
          document: { status },
        }),
      ).toEqual({
        status: 'replace',
        location: {
          kind: 'workspace-library',
          workspaceId: 'workspace-1',
          documentId: null,
        },
      });
    },
  );

  it('returns a resolved document outside the routed scope to the parent', () => {
    expect(
      reconcileWorkspaceLocation(documentLocation, {
        ...baseAccess,
        document: {
          status: 'resolved',
          value: {
            id: 'document-1',
            workspace_id: 'workspace-1',
            project_id: 'project-1',
          },
        },
      }),
    ).toEqual({
      status: 'replace',
      location: {
        kind: 'workspace-library',
        workspaceId: 'workspace-1',
        documentId: null,
      },
    });
  });

  it('keeps a resolved document in the routed scope', () => {
    expect(
      reconcileWorkspaceLocation(documentLocation, {
        ...baseAccess,
        document: {
          status: 'resolved',
          value: {
            id: 'document-1',
            workspace_id: 'workspace-1',
            project_id: null,
          },
        },
      }),
    ).toEqual({ status: 'keep' });
  });
});

describe('Project planning reconciliation', () => {
  const project = {
    id: 'project-1',
    workspace_id: 'workspace-1',
    visibility: 'private' as const,
    effective_role: 'admin' as const,
    can_join: false,
    cycles_enabled: true,
    modules_enabled: true,
    pages_enabled: true,
    views_enabled: true,
  };

  it('keeps planning parents without resolving an implicit selection', () => {
    expect(
      reconcileWorkspaceLocation(
        {
          kind: 'project-cycles',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          cycleId: null,
        },
        {
          ...baseAccess,
          project: { status: 'resolved', value: project },
        },
      ),
    ).toEqual({ status: 'keep' });
  });

  it('defers an explicit planning item to the controlled child when no resolution is supplied', () => {
    expect(
      reconcileWorkspaceLocation(
        {
          kind: 'project-modules',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          moduleId: 'module-1',
        },
        {
          ...baseAccess,
          project: { status: 'resolved', value: project },
        },
      ),
    ).toEqual({ status: 'keep' });
  });

  it('waits for a selected Cycle and keeps transient failures', () => {
    const location: WorkspaceContentLocation = {
      kind: 'project-cycles',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      cycleId: 'cycle-1',
    };
    const access = {
      ...baseAccess,
      project: { status: 'resolved' as const, value: project },
    };

    expect(
      reconcileWorkspaceLocation(location, {
        ...access,
        cycle: { status: 'pending' },
      }),
    ).toEqual({ status: 'wait' });
    expect(
      reconcileWorkspaceLocation(location, {
        ...access,
        cycle: { status: 'transient-error' },
      }),
    ).toEqual({ status: 'keep' });
  });

  it('returns a missing Cycle to the Cycles parent', () => {
    expect(
      reconcileWorkspaceLocation(
        {
          kind: 'project-cycles',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          cycleId: 'cycle-1',
        },
        {
          ...baseAccess,
          project: { status: 'resolved', value: project },
          cycle: { status: 'forbidden' },
        },
      ),
    ).toEqual({
      status: 'replace',
      location: {
        kind: 'project-cycles',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        cycleId: null,
      },
    });
  });

  it('returns a Module outside the routed Project to the Modules parent', () => {
    expect(
      reconcileWorkspaceLocation(
        {
          kind: 'project-modules',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          moduleId: 'module-1',
        },
        {
          ...baseAccess,
          project: { status: 'resolved', value: project },
          module: {
            status: 'resolved',
            value: {
              id: 'module-1',
              workspace_id: 'workspace-1',
              project_id: 'project-2',
            },
          },
        },
      ),
    ).toEqual({
      status: 'replace',
      location: {
        kind: 'project-modules',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        moduleId: null,
      },
    });
  });

  it('keeps a resolved planning item in the routed Project', () => {
    expect(
      reconcileWorkspaceLocation(
        {
          kind: 'project-modules',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          moduleId: 'module-1',
        },
        {
          ...baseAccess,
          project: { status: 'resolved', value: project },
          module: {
            status: 'resolved',
            value: {
              id: 'module-1',
              workspace_id: 'workspace-1',
              project_id: 'project-1',
            },
          },
        },
      ),
    ).toEqual({ status: 'keep' });
  });
});

describe('Settings section reconciliation', () => {
  const accountSettings: WorkspaceSettingsLocation = {
    kind: 'account-settings',
    workspaceId: 'workspace-1',
    section: 'not-a-section',
    returnTo: {
      kind: 'all-tasks',
      workspaceId: 'workspace-1',
      taskId: null,
    },
  };

  it('waits for pending permission data and keeps transient failures', () => {
    expect(
      reconcileWorkspaceLocation(accountSettings, {
        ...baseAccess,
        settingsSections: { status: 'pending' },
      }),
    ).toEqual({ status: 'wait' });
    expect(
      reconcileWorkspaceLocation(accountSettings, {
        ...baseAccess,
        settingsSections: { status: 'transient-error' },
      }),
    ).toEqual({ status: 'keep' });
  });

  it('replaces an invalid section with the first permitted section', () => {
    expect(
      reconcileWorkspaceLocation(accountSettings, {
        ...baseAccess,
        settingsSections: {
          status: 'resolved',
          value: ['profile', 'preferences'],
        },
      }),
    ).toEqual({
      status: 'replace',
      location: { ...accountSettings, section: 'profile' },
    });
  });

  it('drops a nested Workspace Settings detail when canonicalizing its section', () => {
    const location: WorkspaceSettingsLocation = {
      kind: 'workspace-settings',
      workspaceId: 'workspace-1',
      section: 'missing',
      detail: 'property-1',
      definePropertyName: 'Priority',
      returnTo: {
        kind: 'my-work',
        workspaceId: 'workspace-1',
        taskId: null,
      },
    };

    expect(
      reconcileWorkspaceLocation(location, {
        ...baseAccess,
        settingsSections: {
          status: 'resolved',
          value: ['general', 'properties'],
        },
      }),
    ).toEqual({
      status: 'replace',
      location: {
        ...location,
        section: 'general',
        detail: undefined,
        definePropertyName: undefined,
      },
    });
  });

  it('sanitizes return state when canonicalizing a section', () => {
    const location: WorkspaceSettingsLocation = {
      kind: 'workspace-settings',
      workspaceId: 'workspace-1',
      section: 'storage',
      returnTo: {
        kind: 'all-tasks',
        workspaceId: 'workspace-2',
        taskId: null,
      },
    };

    expect(
      reconcileWorkspaceLocation(location, {
        ...baseAccess,
        settingsSections: {
          status: 'resolved',
          value: ['general', 'members'],
        },
      }),
    ).toEqual({
      status: 'replace',
      location: {
        ...location,
        section: 'general',
        returnTo: {
          kind: 'my-work',
          workspaceId: 'workspace-1',
          taskId: null,
        },
      },
    });
  });

  it('keeps a permitted Settings section', () => {
    expect(
      reconcileWorkspaceLocation(
        { ...accountSettings, section: 'preferences' },
        {
          ...baseAccess,
          settingsSections: {
            status: 'resolved',
            value: ['profile', 'preferences'],
          },
        },
      ),
    ).toEqual({ status: 'keep' });
  });

  it('sanitizes a cross-Workspace return target for a permitted section', () => {
    const location: WorkspaceSettingsLocation = {
      kind: 'account-settings',
      workspaceId: 'workspace-1',
      section: 'profile',
      returnTo: {
        kind: 'all-tasks',
        workspaceId: 'workspace-2',
        taskId: null,
      },
    };

    expect(
      reconcileWorkspaceLocation(location, {
        ...baseAccess,
        settingsSections: { status: 'resolved', value: ['profile'] },
      }),
    ).toEqual({
      status: 'replace',
      location: {
        ...location,
        returnTo: {
          kind: 'my-work',
          workspaceId: 'workspace-1',
          taskId: null,
        },
      },
    });
  });

  it('sanitizes a wrong-Project return target for permitted Project Settings', () => {
    const location: WorkspaceSettingsLocation = {
      kind: 'project-settings',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      section: 'general',
      returnTo: {
        kind: 'project-overview',
        workspaceId: 'workspace-1',
        projectId: 'project-2',
      },
    };

    expect(
      reconcileWorkspaceLocation(location, {
        ...baseAccess,
        project: {
          status: 'resolved',
          value: {
            id: 'project-1',
            workspace_id: 'workspace-1',
            visibility: 'private',
            effective_role: 'admin',
            can_join: false,
            cycles_enabled: true,
            modules_enabled: true,
            pages_enabled: true,
            views_enabled: true,
          },
        },
        settingsSections: { status: 'resolved', value: ['general'] },
      }),
    ).toEqual({
      status: 'replace',
      location: {
        ...location,
        returnTo: {
          kind: 'project-overview',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
        },
      },
    });
  });

  it('closes Settings to its safe background when no section is permitted', () => {
    expect(
      reconcileWorkspaceLocation(accountSettings, {
        ...baseAccess,
        settingsSections: { status: 'resolved', value: [] },
      }),
    ).toEqual({
      status: 'replace',
      location: {
        kind: 'all-tasks',
        workspaceId: 'workspace-1',
        taskId: null,
      },
    });
  });

  it('canonicalizes an Admin Project Settings section within its Project', () => {
    const project = {
      id: 'project-1',
      workspace_id: 'workspace-1',
      visibility: 'private' as const,
      effective_role: 'admin' as const,
      can_join: false,
      cycles_enabled: true,
      modules_enabled: true,
      pages_enabled: true,
      views_enabled: true,
    };
    const location: WorkspaceSettingsLocation = {
      kind: 'project-settings',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      section: 'unknown',
      returnTo: {
        kind: 'project-work-items',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        taskId: null,
      },
    };

    expect(
      reconcileWorkspaceLocation(location, {
        ...baseAccess,
        project: { status: 'resolved', value: project },
        settingsSections: {
          status: 'resolved',
          value: ['general', 'members'],
        },
      }),
    ).toEqual({
      status: 'replace',
      location: { ...location, section: 'general' },
    });
  });

  it('replaces a stale same-Workspace return target before rendering Settings', () => {
    const location: WorkspaceSettingsLocation = {
      kind: 'account-settings',
      workspaceId: 'workspace-1',
      section: 'profile',
      returnTo: {
        kind: 'project-overview',
        workspaceId: 'workspace-1',
        projectId: 'private-project',
      },
    };

    expect(
      reconcileWorkspaceLocation(location, {
        ...baseAccess,
        project: { status: 'forbidden' },
        settingsSections: { status: 'resolved', value: ['profile'] },
      }),
    ).toEqual({
      status: 'replace',
      location: {
        ...location,
        returnTo: {
          kind: 'my-work',
          workspaceId: 'workspace-1',
          taskId: null,
        },
      },
    });
  });

  it('sanitizes an unavailable background Task without closing Settings', () => {
    const location: WorkspaceSettingsLocation = {
      kind: 'workspace-settings',
      workspaceId: 'workspace-1',
      section: 'general',
      returnTo: {
        kind: 'all-tasks',
        workspaceId: 'workspace-1',
        taskId: 'task-1',
      },
    };

    expect(
      reconcileWorkspaceLocation(location, {
        ...baseAccess,
        task: { status: 'absent' },
        settingsSections: { status: 'resolved', value: ['general'] },
      }),
    ).toEqual({
      status: 'replace',
      location: {
        ...location,
        returnTo: { ...location.returnTo, taskId: null },
      },
      notice: 'task-unavailable',
    });
  });

  it('waits for the owning query of the Settings background', () => {
    expect(
      reconcileWorkspaceLocation(
        {
          kind: 'account-settings',
          workspaceId: 'workspace-1',
          section: 'profile',
          returnTo: {
            kind: 'project-overview',
            workspaceId: 'workspace-1',
            projectId: 'project-1',
          },
        },
        {
          ...baseAccess,
          project: { status: 'pending' },
          settingsSections: { status: 'resolved', value: ['profile'] },
        },
      ),
    ).toEqual({ status: 'wait' });
  });
});

describe('Task detail reconciliation', () => {
  const location: WorkspaceContentLocation = {
    kind: 'all-tasks',
    workspaceId: 'workspace-1',
    taskId: 'task-1',
  };

  it('waits for a pending Task and keeps its URL on transient failure', () => {
    expect(
      reconcileWorkspaceLocation(location, {
        ...baseAccess,
        task: { status: 'pending' },
      }),
    ).toEqual({ status: 'wait' });
    expect(
      reconcileWorkspaceLocation(location, {
        ...baseAccess,
        task: { status: 'transient-error' },
      }),
    ).toEqual({ status: 'keep' });
  });

  it.each(['absent', 'forbidden'] as const)(
    'removes only an authoritative %s Task and requests generic feedback',
    (status) => {
      expect(
        reconcileWorkspaceLocation(location, {
          ...baseAccess,
          task: { status },
        }),
      ).toEqual({
        status: 'replace',
        location: { ...location, taskId: null },
        notice: 'task-unavailable',
      });
    },
  );

  it('preserves the Saved View identity while removing its unavailable Task', () => {
    const viewLocation: WorkspaceContentLocation = {
      kind: 'workspace-view',
      workspaceId: 'workspace-1',
      viewId: 'view-1',
      taskId: 'task-1',
    };

    expect(
      reconcileWorkspaceLocation(viewLocation, {
        ...baseAccess,
        savedView: {
          status: 'resolved',
          value: {
            id: 'view-1',
            workspace_id: 'workspace-1',
            project_id: null,
          },
        },
        task: { status: 'absent' },
      }),
    ).toEqual({
      status: 'replace',
      location: { ...viewLocation, taskId: null },
      notice: 'task-unavailable',
    });
  });

  it('removes a Task whose resolved Workspace does not match', () => {
    expect(
      reconcileWorkspaceLocation(location, {
        ...baseAccess,
        task: {
          status: 'resolved',
          value: {
            id: 'task-1',
            workspace_id: 'workspace-2',
            project_id: null,
          },
        },
      }),
    ).toEqual({
      status: 'replace',
      location: { ...location, taskId: null },
      notice: 'task-unavailable',
    });
  });

  it('allows Project Tasks in a Workspace collection', () => {
    expect(
      reconcileWorkspaceLocation(location, {
        ...baseAccess,
        task: {
          status: 'resolved',
          value: {
            id: 'task-1',
            workspace_id: 'workspace-1',
            project_id: 'project-1',
          },
        },
      }),
    ).toEqual({ status: 'keep' });
  });

  it('removes a Task outside the routed Project collection', () => {
    const project = {
      id: 'project-1',
      workspace_id: 'workspace-1',
      visibility: 'private' as const,
      effective_role: 'viewer' as const,
      can_join: false,
      cycles_enabled: true,
      modules_enabled: true,
      pages_enabled: true,
      views_enabled: true,
    };
    const projectLocation: WorkspaceContentLocation = {
      kind: 'project-work-items',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      taskId: 'task-1',
    };

    expect(
      reconcileWorkspaceLocation(projectLocation, {
        ...baseAccess,
        project: { status: 'resolved', value: project },
        task: {
          status: 'resolved',
          value: {
            id: 'task-1',
            workspace_id: 'workspace-1',
            project_id: 'project-2',
          },
        },
      }),
    ).toEqual({
      status: 'replace',
      location: { ...projectLocation, taskId: null },
      notice: 'task-unavailable',
    });
  });
});
