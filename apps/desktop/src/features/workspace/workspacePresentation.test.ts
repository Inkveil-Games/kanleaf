import { describe, expect, it } from 'vitest';
import type { SavedView } from '../view/types';
import {
  deriveWorkspacePresentation,
  type WorkspacePresentation,
} from './workspacePresentation';
import type { WorkspaceLocation } from './workspaceLocation';

const workspaceId = 'workspace-id';
const projectId = 'project-id';

describe('deriveWorkspacePresentation', () => {
  it.each<{
    location: WorkspaceLocation;
    expected: Partial<WorkspacePresentation>;
  }>([
    {
      location: { kind: 'my-work', workspaceId, taskId: 'task-id' },
      expected: {
        surface: 'tasks',
        collection: { kind: 'my-work' },
        selectedTaskId: 'task-id',
      },
    },
    {
      location: { kind: 'inbox', workspaceId, taskId: null },
      expected: { surface: 'tasks', collection: { kind: 'inbox' } },
    },
    {
      location: { kind: 'all-tasks', workspaceId, taskId: null },
      expected: { surface: 'tasks', collection: { kind: 'all' } },
    },
    {
      location: {
        kind: 'project-work-items',
        workspaceId,
        projectId,
        taskId: null,
      },
      expected: {
        surface: 'tasks',
        collection: { kind: 'project', projectId },
        activeProjectId: projectId,
      },
    },
    {
      location: { kind: 'workspace-library', workspaceId, documentId: 'doc' },
      expected: {
        surface: 'documents',
        selectedDocumentId: 'doc',
        activeProjectId: null,
      },
    },
    {
      location: {
        kind: 'project-cycles',
        workspaceId,
        projectId,
        cycleId: 'cycle',
      },
      expected: {
        surface: 'cycles',
        planningSelectedId: 'cycle',
        activeProjectId: projectId,
      },
    },
    {
      location: {
        kind: 'project-modules',
        workspaceId,
        projectId,
        moduleId: 'module',
      },
      expected: {
        surface: 'modules',
        planningSelectedId: 'module',
        activeProjectId: projectId,
      },
    },
    {
      location: { kind: 'project-views', workspaceId, projectId },
      expected: { surface: 'views', activeProjectId: projectId },
    },
    {
      location: { kind: 'project-overview', workspaceId, projectId },
      expected: { surface: 'project-overview', activeProjectId: projectId },
    },
  ])('derives $location.kind', ({ location, expected }) => {
    expect(deriveWorkspacePresentation(location, null)).toMatchObject(expected);
  });

  it('derives a saved View collection from its canonical query', () => {
    const location: WorkspaceLocation = {
      kind: 'workspace-view',
      workspaceId,
      viewId: 'view-id',
      taskId: null,
    };
    const view = {
      id: 'view-id',
      project_id: null,
      query: {
        scope: { kind: 'inbox' },
      },
    } as SavedView;

    expect(deriveWorkspacePresentation(location, view)).toMatchObject({
      surface: 'tasks',
      collection: { kind: 'inbox' },
      activeViewId: 'view-id',
    });
  });

  it('renders Settings over its validated return target', () => {
    const returnTo = {
      kind: 'project-library' as const,
      workspaceId,
      projectId,
      documentId: 'doc-id',
    };

    expect(
      deriveWorkspacePresentation(
        {
          kind: 'account-settings',
          workspaceId,
          section: 'profile',
          returnTo,
        },
        null,
      ),
    ).toMatchObject({
      content: returnTo,
      surface: 'documents',
      activeProjectId: projectId,
      selectedDocumentId: 'doc-id',
      settings: { kind: 'account-settings', section: 'profile' },
    });
  });
});
