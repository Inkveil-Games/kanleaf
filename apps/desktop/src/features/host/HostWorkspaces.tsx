import { useQuery } from '@tanstack/react-query';
import { SettingsArticle } from '../settings/SettingsArticle';
import { LoadError } from '../settings/SettingsControls';
import type { ApiContext } from '../workspace/api';
import { listHostWorkspaces } from './api';

export function HostWorkspaces({ context }: { context: ApiContext }) {
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
          <p>Workspaces will appear here after accounts are created.</p>
        </div>
      ) : (
        <>
          <div className="host-workspace-summary">
            <strong className="host-workspace-summary-count">
              {workspaces.data.length}{' '}
              {workspaces.data.length === 1 ? 'workspace' : 'workspaces'}
            </strong>
            <span className="host-workspace-summary-note">
              Owner metadata only
            </span>
          </div>
          <WorkspaceTable workspaces={workspaces.data} />
        </>
      )}
    </SettingsArticle>
  );
}

function WorkspaceTable({
  workspaces = [],
  loading = false,
}: {
  workspaces?: Awaited<ReturnType<typeof listHostWorkspaces>>;
  loading?: boolean;
}) {
  return (
    <div className="host-workspace-table-wrap">
      <table className="host-workspace-table" aria-busy={loading || undefined}>
        <caption className="sr-only">All Workspaces and their Owners</caption>
        <thead>
          <tr>
            <th scope="col">Workspace</th>
            <th scope="col">Owner</th>
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
                </tr>
              ))
            : workspaces.map((workspace) => (
                <tr key={workspace.id}>
                  <th scope="row">{workspace.name}</th>
                  <td>
                    <span className="host-owner-copy">
                      <strong>{workspace.owner.display_name}</strong>
                      <small>{workspace.owner.email}</small>
                    </span>
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
