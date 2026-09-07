import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import { PasswordField } from '../../components/ui/PasswordField';
import { SettingsArticle } from '../settings/SettingsArticle';
import { LoadError } from '../settings/SettingsControls';
import type { ApiContext } from '../workspace/api';
import {
  deleteHostWorkspace,
  listHostWorkspaces,
  type HostWorkspace,
} from './api';

export function HostWorkspaces({ context }: { context: ApiContext }) {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<HostWorkspace | null>(null);
  const [confirmationTarget, setConfirmationTarget] =
    useState<HostWorkspace | null>(null);
  const [password, setPassword] = useState('');
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
      <AppDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        type="confirm"
        variant="danger"
        size="md"
        title={`Delete “${deleteTarget?.name ?? 'Workspace'}”${deleteTarget ? ` (/${deleteTarget.identifier})` : ''}?`}
        description={
          deleteTarget
            ? `This removes the Workspace owned by ${deleteTarget.owner.display_name} and revokes access for every member.`
            : undefined
        }
        confirmLabel="Continue"
        onConfirm={() => {
          if (deleteTarget) setConfirmationTarget(deleteTarget);
        }}
      >
        {deleteTarget ? (
          <>
            <div className="host-delete-impact">
              <strong>This cannot be undone.</strong>
              <p>
                Structured data, memberships, Tasks, Projects, Library notes,
                and every managed Markdown file will be permanently removed.
              </p>
            </div>
            <dl className="host-delete-target">
              <div>
                <dt>Workspace</dt>
                <dd>{deleteTarget.name}</dd>
              </div>
              <div>
                <dt>Workspace ID</dt>
                <dd>/{deleteTarget.identifier}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{deleteTarget.owner.email}</dd>
              </div>
            </dl>
          </>
        ) : null}
      </AppDialog>
      <AppDialog
        open={confirmationTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmationTarget(null);
            setPassword('');
          }
        }}
        type="typed-confirm"
        variant="danger"
        size="md"
        title={`Confirm permanent deletion of “${confirmationTarget?.name ?? 'Workspace'}”`}
        description="Type the exact Workspace ID and re-enter your Host password. This confirms the target and your current Host session independently."
        confirmationText={confirmationTarget?.identifier ?? ''}
        confirmationLabel={
          <>
            Enter <strong>{confirmationTarget?.identifier}</strong> without the
            slash
          </>
        }
        confirmLabel="Permanently delete Workspace"
        loadingLabel="Deleting…"
        confirmDisabled={!password}
        onConfirm={async () => {
          if (!confirmationTarget) return;
          const target = confirmationTarget;
          try {
            await deleteHostWorkspace(context, target.id, {
              identifier: target.identifier,
              password,
            });
          } catch (error) {
            setPassword('');
            throw error;
          }
          queryClient.setQueryData<HostWorkspace[]>(
            ['host-workspaces', context.serverUrl, context.token],
            (current) =>
              current?.filter((workspace) => workspace.id !== target.id) ?? [],
          );
          setAnnouncement(
            `${target.name} (/${target.identifier}) was permanently deleted`,
          );
          void queryClient.invalidateQueries({
            queryKey: ['host-workspaces', context.serverUrl, context.token],
            refetchType: 'none',
          });
        }}
      >
        <label className="settings-field">
          <span>Host password</span>
          <PasswordField
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            visibilityLabel="Host password"
            autoComplete="current-password"
          />
        </label>
      </AppDialog>
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
