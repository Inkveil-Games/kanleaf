import type { SavedView } from '../view/types';
import { collectionFromScope } from '../view/types';
import type { Collection } from './types';
import {
  settingsReturnTarget,
  type WorkspaceContentLocation,
  type WorkspaceLocation,
  type WorkspaceSettingsLocation,
} from './workspaceLocation';

export type WorkspacePresentationSurface =
  'tasks' | 'project-overview' | 'cycles' | 'modules' | 'documents' | 'views';

export interface WorkspacePresentation {
  content: WorkspaceContentLocation;
  workspaceId: string;
  collection: Collection;
  surface: WorkspacePresentationSurface;
  activeProjectId: string | null;
  activeViewId: string | null;
  selectedTaskId: string | null;
  selectedDocumentId: string | null;
  planningSelectedId: string | null;
  settings: Pick<WorkspaceSettingsLocation, 'kind' | 'section'> | null;
}

export function deriveWorkspacePresentation(
  location: WorkspaceLocation,
  savedView: SavedView | null,
): WorkspacePresentation {
  const settings = isSettingsLocation(location)
    ? { kind: location.kind, section: location.section }
    : null;
  const content = isSettingsLocation(location)
    ? settingsReturnTarget(location)
    : location;

  return {
    content,
    workspaceId: content.workspaceId,
    collection: collectionFor(content, savedView),
    surface: surfaceFor(content),
    activeProjectId: 'projectId' in content ? content.projectId : null,
    activeViewId:
      content.kind === 'workspace-view' || content.kind === 'project-view'
        ? content.viewId
        : null,
    selectedTaskId: 'taskId' in content ? content.taskId : null,
    selectedDocumentId:
      content.kind === 'workspace-library' || content.kind === 'project-library'
        ? content.documentId
        : null,
    planningSelectedId:
      content.kind === 'project-cycles'
        ? content.cycleId
        : content.kind === 'project-modules'
          ? content.moduleId
          : null,
    settings,
  };
}

function collectionFor(
  location: WorkspaceContentLocation,
  savedView: SavedView | null,
): Collection {
  switch (location.kind) {
    case 'my-work':
      return { kind: 'my-work' };
    case 'inbox':
      return { kind: 'inbox' };
    case 'all-tasks':
      return { kind: 'all' };
    case 'workspace-view':
      return savedView
        ? collectionFromScope(savedView.query.scope)
        : { kind: 'all' };
    case 'workspace-library':
      return { kind: 'my-work' };
    case 'project-view':
      return savedView
        ? collectionFromScope(savedView.query.scope)
        : { kind: 'project', projectId: location.projectId };
    default:
      return { kind: 'project', projectId: location.projectId };
  }
}

function surfaceFor(
  location: WorkspaceContentLocation,
): WorkspacePresentationSurface {
  switch (location.kind) {
    case 'project-overview':
      return 'project-overview';
    case 'project-cycles':
      return 'cycles';
    case 'project-modules':
      return 'modules';
    case 'workspace-library':
    case 'project-library':
      return 'documents';
    case 'project-views':
      return 'views';
    default:
      return 'tasks';
  }
}

function isSettingsLocation(
  location: WorkspaceLocation,
): location is WorkspaceSettingsLocation {
  return location.kind.endsWith('-settings');
}
