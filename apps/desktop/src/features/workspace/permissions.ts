import type { Workspace } from './types';

export function canManageWorkspace(workspace: Workspace) {
  return workspace.role === 'owner' || workspace.role === 'admin';
}
