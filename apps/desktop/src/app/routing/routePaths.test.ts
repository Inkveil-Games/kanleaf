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
  withPage,
  withTask,
  withoutPage,
  withoutTask,
} from './routePaths';

describe('routePatterns', () => {
  it('declares the complete canonical matching contract', () => {
    expect(routePatterns).toEqual({
      root: '/',
      invite: '/invite',
      forgotPassword: '/forgot-password',
      resetPassword: '/reset-password',
      host: '/host',
      hostAccess: '/host/access',
      setupAccount: '/setup/account',
      setupWorkspace: '/setup/workspace',
      setupInvite: '/setup/invite',
      setupWildcard: '/setup/*',
      legacyWorkspace: '/:legacyWorkspaceIdentifier',
      legacyWorkspaceWildcard: '/:legacyWorkspaceIdentifier/*',
      legacyProject: '/w/:legacyWorkspaceIdentifier/projects/:legacyProjectId',
      legacyProjectWildcard:
        '/w/:legacyWorkspaceIdentifier/projects/:legacyProjectId/*',
      workspace: '/w/:workspaceIdentifier',
      workspaceMyWork: '/w/:workspaceIdentifier/my-work',
      workspaceInbox: '/w/:workspaceIdentifier/inbox',
      workspaceTasks: '/w/:workspaceIdentifier/tasks',
      workspaceView: '/w/:workspaceIdentifier/views/:viewId',
      workspaceLibrary: '/w/:workspaceIdentifier/library',
      legacyWorkspaceDocument: '/w/:workspaceIdentifier/library/:documentId',
      project: '/w/:workspaceIdentifier/p/:projectIdentifier',
      projectWorkItems:
        '/w/:workspaceIdentifier/p/:projectIdentifier/work-items',
      projectCycles: '/w/:workspaceIdentifier/p/:projectIdentifier/cycles',
      projectCycle:
        '/w/:workspaceIdentifier/p/:projectIdentifier/cycles/:cycleId',
      projectModules: '/w/:workspaceIdentifier/p/:projectIdentifier/modules',
      projectModule:
        '/w/:workspaceIdentifier/p/:projectIdentifier/modules/:moduleId',
      projectLibrary: '/w/:workspaceIdentifier/p/:projectIdentifier/library',
      legacyProjectDocument:
        '/w/:workspaceIdentifier/p/:projectIdentifier/library/:documentId',
      projectViews: '/w/:workspaceIdentifier/p/:projectIdentifier/views',
      projectView: '/w/:workspaceIdentifier/p/:projectIdentifier/views/:viewId',
      accountSettings: '/w/:workspaceIdentifier/settings/account/:section',
      workspaceSettings: '/w/:workspaceIdentifier/settings/workspace/:section',
      workspaceSettingsDetail:
        '/w/:workspaceIdentifier/settings/workspace/:section/:detail',
      projectSettings:
        '/w/:workspaceIdentifier/p/:projectIdentifier/settings/:section',
    });
  });
});

describe('routePaths', () => {
  it('uses compact Workspace, Project, and numeric Task locators', () => {
    expect(routePaths.workspaceMyWork('kanleaf-core')).toBe(
      '/w/kanleaf-core/my-work',
    );
    expect(routePaths.projectWorkItems('kanleaf-core', 'desktop')).toBe(
      '/w/kanleaf-core/p/desktop/work-items',
    );
    expect(withTask('/w/kanleaf-core/p/desktop/work-items', '42')).toBe(
      '/w/kanleaf-core/p/desktop/work-items?task=42',
    );
  });

  it('adds and removes a numeric Page locator without losing other URL state', () => {
    expect(
      withPage('/w/kanleaf-core/library?filter=recent#content', '42'),
    ).toBe('/w/kanleaf-core/library?filter=recent&page=42#content');
    expect(
      withoutPage('/w/kanleaf-core/library?filter=recent&page=42#content'),
    ).toBe('/w/kanleaf-core/library?filter=recent#content');
  });

  it.each<{
    label: string;
    actual: () => string;
    expected: string;
  }>([
    { label: 'root', actual: routePaths.root, expected: '/' },
    {
      label: 'Workspace invitation',
      actual: routePaths.invite,
      expected: '/invite',
    },
    {
      label: 'Forgot password',
      actual: routePaths.forgotPassword,
      expected: '/forgot-password',
    },
    {
      label: 'Reset password',
      actual: routePaths.resetPassword,
      expected: '/reset-password',
    },
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
      expected: '/w/workspace-id',
    },
    {
      label: 'My Work',
      actual: () => routePaths.workspaceMyWork('workspace-id'),
      expected: '/w/workspace-id/my-work',
    },
    {
      label: 'Inbox',
      actual: () => routePaths.workspaceInbox('workspace-id'),
      expected: '/w/workspace-id/inbox',
    },
    {
      label: 'All Tasks',
      actual: () => routePaths.workspaceTasks('workspace-id'),
      expected: '/w/workspace-id/tasks',
    },
    {
      label: 'Workspace Saved View',
      actual: () => routePaths.workspaceView('workspace-id', 'view-id'),
      expected: '/w/workspace-id/views/view-id',
    },
    {
      label: 'Workspace Library',
      actual: () => routePaths.workspaceLibrary('workspace-id'),
      expected: '/w/workspace-id/library',
    },
    {
      label: 'Project Overview',
      actual: () => routePaths.project('workspace-id', 'project-id'),
      expected: '/w/workspace-id/p/project-id',
    },
    {
      label: 'Project work items',
      actual: () => routePaths.projectWorkItems('workspace-id', 'project-id'),
      expected: '/w/workspace-id/p/project-id/work-items',
    },
    {
      label: 'Project Cycles',
      actual: () => routePaths.projectCycles('workspace-id', 'project-id'),
      expected: '/w/workspace-id/p/project-id/cycles',
    },
    {
      label: 'selected Cycle',
      actual: () =>
        routePaths.projectCycle('workspace-id', 'project-id', 'cycle-id'),
      expected: '/w/workspace-id/p/project-id/cycles/cycle-id',
    },
    {
      label: 'Project Modules',
      actual: () => routePaths.projectModules('workspace-id', 'project-id'),
      expected: '/w/workspace-id/p/project-id/modules',
    },
    {
      label: 'selected Module',
      actual: () =>
        routePaths.projectModule('workspace-id', 'project-id', 'module-id'),
      expected: '/w/workspace-id/p/project-id/modules/module-id',
    },
    {
      label: 'Project Library',
      actual: () => routePaths.projectLibrary('workspace-id', 'project-id'),
      expected: '/w/workspace-id/p/project-id/library',
    },
    {
      label: 'Project Saved Views',
      actual: () => routePaths.projectViews('workspace-id', 'project-id'),
      expected: '/w/workspace-id/p/project-id/views',
    },
    {
      label: 'selected Project Saved View',
      actual: () =>
        routePaths.projectView('workspace-id', 'project-id', 'view-id'),
      expected: '/w/workspace-id/p/project-id/views/view-id',
    },
    {
      label: 'Account Settings',
      actual: () => routePaths.accountSettings('workspace-id', 'security'),
      expected: '/w/workspace-id/settings/account/security',
    },
    {
      label: 'Workspace Settings',
      actual: () => routePaths.workspaceSettings('workspace-id', 'task-types'),
      expected: '/w/workspace-id/settings/workspace/task-types',
    },
    {
      label: 'Workspace Settings detail',
      actual: () =>
        routePaths.workspaceSettingsDetail(
          'workspace-id',
          'properties',
          'property/id',
        ),
      expected: '/w/workspace-id/settings/workspace/properties/property%2Fid',
    },
    {
      label: 'Project Settings',
      actual: () =>
        routePaths.projectSettings('workspace-id', 'project-id', 'defaults'),
      expected: '/w/workspace-id/p/project-id/settings/defaults',
    },
  ])('builds the canonical $label path', ({ actual, expected }) => {
    expect(actual()).toBe(expected);
  });

  it('encodes every resource path segment', () => {
    expect(
      routePaths.projectModule(
        'workspace/with space',
        'project?#',
        'module%2Fid',
      ),
    ).toBe('/w/workspace%2Fwith%20space/p/project%3F%23/modules/module%252Fid');
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
      '/w/workspace-id/settings/account/notifications',
    );
    expect(routePaths.workspaceSettings('workspace-id', workspace)).toBe(
      '/w/workspace-id/settings/workspace/storage',
    );
    expect(
      routePaths.projectSettings('workspace-id', 'project-id', project),
    ).toBe('/w/workspace-id/p/project-id/settings/features');
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
    ['properties', true],
    ['invitations', false],
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
