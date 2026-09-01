import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { SettingsArticle } from '../settings/SettingsArticle';
import { LoadError } from '../settings/SettingsControls';
import type { ApiContext } from '../workspace/api';
import {
  deleteHostWorkspace,
  listHostWorkspaces,
  type HostWorkspace,
} from './api';
import { HostWorkspaceDeleteDialog } from './HostWorkspaceDeleteDialog';

export function HostWorkspaces({ context }: { context: ApiContext }) {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<HostWorkspace | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const workspaces = useQuery({
    queryKey: ['host-workspaces', context.serverUrl, context.token],
    queryFn: () => listHostWorkspaces(context),
  });

  return (
    <SettingsArticle
      eyebrow="Host Console"
      title="Workspaces"
      description="Every Workspace on this Kanleaf host and its current Owner."
      className="host-settings-article"
    >
      {workspaces.error ? (
        <LoadError
          error={workspaces.error}
          onRetry={() => workspaces.refetch()}
        />
      ) : workspaces.isPending ? (
        <>
          <p className="sr-only" role="status">
            Loading Workspaces…
          </p>
          <WorkspaceTable loading />
        </>
      ) : workspaces.data.length === 0 ? (
        <div className="settings-empty">
          <strong>No Workspaces yet</strong>
          <p>Workspaces will appear here after someone creates one.</p>
        </div>
      ) : (
        <>
          <div className="host-workspace-summary">
            <strong className="host-workspace-summary-count">
              {workspaces.data.length}{' '}
              {workspaces.data.length === 1 ? 'workspace' : 'workspaces'}
            </strong>
            <span className="host-workspace-summary-note">
              Owner metadata · lifecycle controls
            </span>
          </div>
          <WorkspaceTable
            workspaces={workspaces.data}
            onDelete={setDeleteTarget}
          />
        </>
      )}
      {announcement && (
        <p className="sr-only" role="status">
          {announcement}
        </p>
      )}
      {deleteTarget && (
        <HostWorkspaceDeleteDialog
          workspace={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDelete={async (identifier, password) => {
            await deleteHostWorkspace(context, deleteTarget.id, {
              identifier,
              password,
            });
            queryClient.setQueryData<HostWorkspace[]>(
              ['host-workspaces', context.serverUrl, context.token],
              (current) =>
                current?.filter(
                  (workspace) => workspace.id !== deleteTarget.id,
                ) ?? [],
            );
            setAnnouncement(
              `${deleteTarget.name} (/${deleteTarget.identifier}) was permanently deleted`,
            );
            void queryClient.invalidateQueries({
              queryKey: ['host-workspaces', context.serverUrl, context.token],
              refetchType: 'none',
            });
          }}
        />
      )}
    </SettingsArticle>
  );
}

function WorkspaceTable({
  workspaces = [],
  loading = false,
  onDelete,
}: {
  workspaces?: HostWorkspace[];
  loading?: boolean;
  onDelete?: (workspace: HostWorkspace) => void;
}) {
  return (
    <div className="host-workspace-table-wrap">
      <table className="host-workspace-table" aria-busy={loading || undefined}>
        <caption className="sr-only">All Workspaces and their Owners</caption>
        <thead>
          <tr>
            <th scope="col">Workspace</th>
            <th scope="col">Owner</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 3 }, (_, index) => (
                <tr key={index} aria-hidden="true">
                  <td>
                    <span className="host-table-skeleton" />
                  </td>
                  <td>
                    <span className="host-table-skeleton host-table-skeleton-owner" />
                  </td>
                  <td>
                    <span className="host-table-skeleton host-table-skeleton-action" />
                  </td>
                </tr>
              ))
            : workspaces.map((workspace) => (
                <tr key={workspace.id}>
                  <th scope="row">
                    <span className="host-workspace-copy">
                      <strong>{workspace.name}</strong>
                      <small>/{workspace.identifier}</small>
                    </span>
                  </th>
                  <td>
                    <span className="host-owner-copy">
                      <strong>{workspace.owner.display_name}</strong>
                      <small>{workspace.owner.email}</small>
                    </span>
                  </td>
                  <td className="host-workspace-actions">
                    <button
                      className="icon-button danger-icon-button"
                      type="button"
                      aria-label={`Delete Workspace “${workspace.name}” (/${workspace.identifier})`}
                      onClick={() => onDelete?.(workspace)}
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
