import { describe, expect, it } from 'vitest';
import {
  isAccountSettingsSection,
  type AccountSettingsSection,
} from '../../features/account/settingsSections';
import {
  isProjectSettingsSection,
  type ProjectSettingsSection,
} from '../../features/project/settingsSections';
import {
  isWorkspaceSettingsSection,
  type WorkspaceSettingsSection,
} from '../../features/workspace/settingsSections';
import {
  routePaths,
  routePatterns,
  setupPathForStage,
  withTask,
  withoutTask,
} from './routePaths';

describe('routePatterns', () => {
  it('declares the complete canonical matching contract', () => {
    expect(routePatterns).toEqual({
      root: '/',
      host: '/host',
      hostAccess: '/host/access',
      setupAccount: '/setup/account',
      setupWorkspace: '/setup/workspace',
      setupInvite: '/setup/invite',
      setupWildcard: '/setup/*',
      legacyWorkspace: '/w/:workspaceUuid',
      legacyWorkspaceWildcard: '/w/:workspaceUuid/*',
      workspace: '/:workspaceIdentifier',
      workspaceMyWork: '/:workspaceIdentifier/my-work',
      workspaceInbox: '/:workspaceIdentifier/inbox',
      workspaceTasks: '/:workspaceIdentifier/tasks',
      workspaceView: '/:workspaceIdentifier/views/:viewId',
      workspaceLibrary: '/:workspaceIdentifier/library',
      workspaceDocument: '/:workspaceIdentifier/library/:documentId',
      project: '/:workspaceIdentifier/projects/:projectId',
      projectWorkItems: '/:workspaceIdentifier/projects/:projectId/work-items',
      projectCycles: '/:workspaceIdentifier/projects/:projectId/cycles',
      projectCycle: '/:workspaceIdentifier/projects/:projectId/cycles/:cycleId',
      projectModules: '/:workspaceIdentifier/projects/:projectId/modules',
      projectModule:
        '/:workspaceIdentifier/projects/:projectId/modules/:moduleId',
      projectLibrary: '/:workspaceIdentifier/projects/:projectId/library',
      projectDocument:
        '/:workspaceIdentifier/projects/:projectId/library/:documentId',
      projectViews: '/:workspaceIdentifier/projects/:projectId/views',
      projectView: '/:workspaceIdentifier/projects/:projectId/views/:viewId',
      accountSettings: '/:workspaceIdentifier/settings/account/:section',
      workspaceSettings: '/:workspaceIdentifier/settings/workspace/:section',
      projectSettings:
        '/:workspaceIdentifier/projects/:projectId/settings/:section',
    });
  });
});

describe('routePaths', () => {
  it.each<{
    label: string;
    actual: () => string;
    expected: string;
  }>([
    { label: 'root', actual: routePaths.root, expected: '/' },
    { label: 'Host Workspaces', actual: routePaths.host, expected: '/host' },
    {
      label: 'Host Access',
      actual: routePaths.hostAccess,
      expected: '/host/access',
    },
    {
      label: 'Account setup',
      actual: routePaths.setupAccount,
      expected: '/setup/account',
    },
    {
      label: 'Workspace setup',
      actual: routePaths.setupWorkspace,
      expected: '/setup/workspace',
    },
    {
      label: 'Invite setup',
      actual: routePaths.setupInvite,
      expected: '/setup/invite',
    },
    {
      label: 'Workspace index',
      actual: () => routePaths.workspace('workspace-id'),
      expected: '/workspace-id',
    },
    {
      label: 'My Work',
      actual: () => routePaths.workspaceMyWork('workspace-id'),
      expected: '/workspace-id/my-work',
    },
    {
      label: 'Inbox',
      actual: () => routePaths.workspaceInbox('workspace-id'),
      expected: '/workspace-id/inbox',
    },
    {
      label: 'All Tasks',
      actual: () => routePaths.workspaceTasks('workspace-id'),
      expected: '/workspace-id/tasks',
    },
    {
      label: 'Workspace Saved View',
      actual: () => routePaths.workspaceView('workspace-id', 'view-id'),
      expected: '/workspace-id/views/view-id',
    },
    {
      label: 'Workspace Library',
      actual: () => routePaths.workspaceLibrary('workspace-id'),
      expected: '/workspace-id/library',
    },
    {
      label: 'Workspace Library note',
      actual: () => routePaths.workspaceDocument('workspace-id', 'document-id'),
      expected: '/workspace-id/library/document-id',
    },
    {
      label: 'Project Overview',
      actual: () => routePaths.project('workspace-id', 'project-id'),
      expected: '/workspace-id/projects/project-id',
    },
    {
      label: 'Project work items',
      actual: () => routePaths.projectWorkItems('workspace-id', 'project-id'),
      expected: '/workspace-id/projects/project-id/work-items',
    },
    {
      label: 'Project Cycles',
      actual: () => routePaths.projectCycles('workspace-id', 'project-id'),
      expected: '/workspace-id/projects/project-id/cycles',
    },
    {
      label: 'selected Cycle',
      actual: () =>
        routePaths.projectCycle('workspace-id', 'project-id', 'cycle-id'),
      expected: '/workspace-id/projects/project-id/cycles/cycle-id',
    },
    {
      label: 'Project Modules',
      actual: () => routePaths.projectModules('workspace-id', 'project-id'),
      expected: '/workspace-id/projects/project-id/modules',
    },
    {
      label: 'selected Module',
      actual: () =>
        routePaths.projectModule('workspace-id', 'project-id', 'module-id'),
      expected: '/workspace-id/projects/project-id/modules/module-id',
    },
    {
      label: 'Project Library',
      actual: () => routePaths.projectLibrary('workspace-id', 'project-id'),
      expected: '/workspace-id/projects/project-id/library',
    },
    {
      label: 'Project Library note',
      actual: () =>
        routePaths.projectDocument('workspace-id', 'project-id', 'document-id'),
      expected: '/workspace-id/projects/project-id/library/document-id',
    },
    {
      label: 'Project Saved Views',
      actual: () => routePaths.projectViews('workspace-id', 'project-id'),
      expected: '/workspace-id/projects/project-id/views',
    },
    {
      label: 'selected Project Saved View',
      actual: () =>
        routePaths.projectView('workspace-id', 'project-id', 'view-id'),
      expected: '/workspace-id/projects/project-id/views/view-id',
    },
    {
      label: 'Account Settings',
      actual: () => routePaths.accountSettings('workspace-id', 'security'),
      expected: '/workspace-id/settings/account/security',
    },
    {
      label: 'Workspace Settings',
      actual: () => routePaths.workspaceSettings('workspace-id', 'task-types'),
      expected: '/workspace-id/settings/workspace/task-types',
    },
    {
      label: 'Project Settings',
      actual: () =>
        routePaths.projectSettings('workspace-id', 'project-id', 'defaults'),
      expected: '/workspace-id/projects/project-id/settings/defaults',
    },
  ])('builds the canonical $label path', ({ actual, expected }) => {
    expect(actual()).toBe(expected);
  });

  it('encodes every resource path segment', () => {
    expect(
      routePaths.projectDocument(
        'workspace/with space',
        'project?#',
        'document%2Fid',
      ),
    ).toBe(
      '/workspace%2Fwith%20space/projects/project%3F%23/library/document%252Fid',
    );
  });

  it.each([
    ['account', '/setup/account'],
    ['workspace', '/setup/workspace'],
    ['invite', '/setup/invite'],
  ] as const)(
    'maps setup stage %s to its canonical route',
    (stage, expected) => {
      expect(setupPathForStage(stage)).toBe(expected);
    },
  );

  it('only accepts a declared section type in Settings builders', () => {
    const account: AccountSettingsSection = 'notifications';
    const workspace: WorkspaceSettingsSection = 'storage';
    const project: ProjectSettingsSection = 'features';

    expect(routePaths.accountSettings('workspace-id', account)).toBe(
      '/workspace-id/settings/account/notifications',
    );
    expect(routePaths.workspaceSettings('workspace-id', workspace)).toBe(
      '/workspace-id/settings/workspace/storage',
    );
    expect(
      routePaths.projectSettings('workspace-id', 'project-id', project),
    ).toBe('/workspace-id/projects/project-id/settings/features');
  });
});

describe('Task search parameter', () => {
  it('sets one encoded Task ID while preserving unrelated search and hash state', () => {
    expect(
      withTask(
        '/workspace-id/tasks?layout=calendar&task=old#selection',
        'task/id',
      ),
    ).toBe('/workspace-id/tasks?layout=calendar&task=task%2Fid#selection');
  });

  it('removes every Task parameter without discarding unrelated search and hash state', () => {
    expect(
      withoutTask(
        '/workspace-id/tasks?task=first&layout=list&task=second#selection',
      ),
    ).toBe('/workspace-id/tasks?layout=list#selection');
  });

  it('does not leave an empty query delimiter after removing the only parameter', () => {
    expect(withoutTask('/workspace-id/my-work?task=task-id')).toBe(
      '/workspace-id/my-work',
    );
  });
});

describe('Settings section contracts', () => {
  it.each([
    ['profile', true],
    ['preferences', true],
    ['security', true],
    ['invitations', true],
    ['notifications', true],
    ['general', false],
    ['', false],
    [undefined, false],
  ])('validates Account section %s', (section, expected) => {
    expect(isAccountSettingsSection(section)).toBe(expected);
  });

  it.each([
    ['general', true],
    ['members', true],
    ['states', true],
    ['labels', true],
    ['task-types', true],
    ['invitations', true],
    ['storage', true],
    ['danger', true],
    ['profile', false],
    ['', false],
    [undefined, false],
  ])('validates Workspace section %s', (section, expected) => {
    expect(isWorkspaceSettingsSection(section)).toBe(expected);
  });

  it.each([
    ['general', true],
    ['members', true],
    ['features', true],
    ['defaults', true],
    ['danger', true],
    ['states', false],
    ['', false],
    [undefined, false],
  ])('validates Project section %s', (section, expected) => {
    expect(isProjectSettingsSection(section)).toBe(expected);
  });
});
