import { useQuery } from '@tanstack/react-query';
import { ArchiveRestore, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
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
  const [confirmation, setConfirmation] = useState('');
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

  async function remove(event: FormEvent) {
    event.preventDefault();
    if (!deleteTarget || confirmation !== deleteTarget.identifier) return;
    setBusyProjectId(deleteTarget.id);
    setActionError(null);
    try {
      await deleteProject(context, workspace.id, deleteTarget.id, confirmation);
      setDeleteTarget(null);
      setConfirmation('');
      await Promise.all([archived.refetch(), onProjectsChanged()]);
    } catch (error) {
      setActionError(errorMessage(error));
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
          <button type="button" onClick={() => void archived.refetch()}>
            Retry
          </button>
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
                  <button
                    className="secondary-button compact-button"
                    type="button"
                    disabled={busyProjectId !== null}
                    onClick={() => void restore(project)}
                  >
                    <ArchiveRestore aria-hidden="true" size={14} /> Restore
                  </button>
                  <button
                    className="icon-button danger-icon-button"
                    type="button"
                    aria-label={`Permanently delete ${project.name}`}
                    disabled={busyProjectId !== null}
                    onClick={() => {
                      setDeleteTarget(project);
                      setConfirmation('');
                      setActionError(null);
                    }}
                  >
                    <Trash2 aria-hidden="true" size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {deleteTarget ? (
        <form
          className="archived-project-delete"
          onSubmit={(event) => void remove(event)}
        >
          <header>
            <div>
              <h2>Delete {deleteTarget.name} permanently?</h2>
              <p>
                Every Task, document, view, planning record, membership, and
                Markdown file owned by this Project will be removed.
              </p>
            </div>
            <button
              type="button"
              aria-label="Cancel permanent Project deletion"
              onClick={() => setDeleteTarget(null)}
            >
              <X aria-hidden="true" size={15} />
            </button>
          </header>
          <label className="settings-field">
            <span>
              Enter <strong>{deleteTarget.identifier}</strong> to confirm
            </span>
            <input
              autoFocus
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          <button
            className="danger-button"
            type="submit"
            disabled={
              confirmation !== deleteTarget.identifier || busyProjectId !== null
            }
          >
            <Trash2 aria-hidden="true" size={14} /> Delete Project permanently
          </button>
        </form>
      ) : null}
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
