import { useQuery } from '@tanstack/react-query';
import { ArchiveRestore, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import { SettingsArticle } from '../settings/SettingsArticle';
import { errorMessage } from '../settings/utils';
import {
  deleteProject,
  listArchivedProjects,
  restoreProject,
  type ApiContext,
} from '../workspace/api';
import type { Project, Workspace } from '../workspace/types';
import { ProjectIconGlyph } from './ProjectIconGlyph';

interface ArchivedProjectsSettingsProps {
  context: ApiContext;
  workspace: Workspace;
  onProjectsChanged: () => Promise<void>;
}

export function ArchivedProjectsSettings({
  context,
  workspace,
  onProjectsChanged,
}: ArchivedProjectsSettingsProps) {
  const archived = useQuery({
    queryKey: ['archived-projects', workspace.id],
    queryFn: () => listArchivedProjects(context, workspace.id),
    retry: false,
  });
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function restore(project: Project) {
    setBusyProjectId(project.id);
    setActionError(null);
    try {
      await restoreProject(context, workspace.id, project.id);
      await Promise.all([archived.refetch(), onProjectsChanged()]);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyProjectId(null);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusyProjectId(deleteTarget.id);
    try {
      await deleteProject(
        context,
        workspace.id,
        deleteTarget.id,
        deleteTarget.identifier,
      );
      await Promise.all([archived.refetch(), onProjectsChanged()]);
    } finally {
      setBusyProjectId(null);
    }
  }

  return (
    <SettingsArticle
      eyebrow="Workspace"
      title="Archived Projects"
      description="Restore Project structure and content, or permanently remove its complete footprint."
    >
      {archived.isPending ? (
        <p className="settings-muted">Loading archived Projects…</p>
      ) : archived.error ? (
        <div className="settings-inline-error" role="alert">
          <span>{errorMessage(archived.error)}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void archived.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : archived.data.length === 0 ? (
        <div className="archived-projects-empty">
          <ArchiveRestore aria-hidden="true" size={20} />
          <div>
            <strong>No archived Projects</strong>
            <p>Projects you archive will stay recoverable here.</p>
          </div>
        </div>
      ) : (
        <div className="archived-projects-list">
          {archived.data.map((project) => {
            return (
              <article key={project.id} className="archived-project-row">
                <span className="archived-project-icon" aria-hidden="true">
                  <ProjectIconGlyph name={project.icon} size={17} />
                </span>
                <div>
                  <strong>{project.name}</strong>
                  <small>
                    {project.identifier} · Archived{' '}
                    {formatArchiveDate(project.archived_at)}
                  </small>
                </div>
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busyProjectId !== null}
                    onClick={() => void restore(project)}
                  >
                    <ArchiveRestore aria-hidden="true" size={14} /> Restore
                  </Button>
                  <IconButton
                    variant="danger"
                    aria-label={`Permanently delete ${project.name}`}
                    disabled={busyProjectId !== null}
                    onClick={() => {
                      setDeleteTarget(project);
                      setActionError(null);
                    }}
                  >
                    <Trash2 aria-hidden="true" size={14} />
                  </IconButton>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <AppDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        type="typed-confirm"
        variant="danger"
        title={`Delete ${deleteTarget?.name ?? 'Project'} permanently?`}
        description="Every Task, document, view, planning record, membership, and Markdown file owned by this Project will be removed."
        confirmationText={deleteTarget?.identifier ?? ''}
        confirmLabel="Delete Project permanently"
        loadingLabel="Deleting…"
        onConfirm={remove}
      />
      {actionError ? (
        <p className="settings-error" role="alert">
          {actionError}
        </p>
      ) : null}
    </SettingsArticle>
  );
}

function formatArchiveDate(value: string | null) {
  if (!value) return 'recently';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
    new Date(value),
  );
}
