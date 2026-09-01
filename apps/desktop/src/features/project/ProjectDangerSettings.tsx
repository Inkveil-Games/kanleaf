import { Archive, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { SettingsArticle } from '../settings/SettingsArticle';
import { ActionMessage, type ActionState } from '../settings/SettingsControls';
import { errorMessage } from '../settings/utils';
import {
  archiveProject,
  deleteProject,
  type ApiContext,
} from '../workspace/api';
import type { Project, Workspace } from '../workspace/types';

interface ProjectDangerSettingsProps {
  context: ApiContext;
  workspace: Workspace;
  project: Project;
  onRemoved: () => Promise<void>;
}

export function ProjectDangerSettings({
  context,
  workspace,
  project,
  onRemoved,
}: ProjectDangerSettingsProps) {
  const [identifier, setIdentifier] = useState('');
  const [state, setState] = useState<ActionState>({ status: 'idle' });

  async function archive() {
    if (
      !window.confirm(
        `Archive ${project.name}? Its tasks, documents, and settings will stay intact.`,
      )
    )
      return;
    setState({ status: 'saving' });
    try {
      await archiveProject(context, workspace.id, project.id);
      await onRemoved();
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  async function remove(event: FormEvent) {
    event.preventDefault();
    setState({ status: 'saving' });
    try {
      await deleteProject(context, workspace.id, project.id, identifier);
      await onRemoved();
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  return (
    <SettingsArticle
      eyebrow="Project"
      title="Danger zone"
      description="Archive a Project for reversible cleanup, or permanently delete it."
    >
      <section className="danger-section">
        <div>
          <h2>Archive Project</h2>
          <p>
            Hide this Project from navigation while keeping its tasks,
            documents, settings, and Markdown ready to restore.
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => void archive()}
        >
          <Archive aria-hidden="true" size={14} /> Archive Project
        </button>
      </section>
      <form
        className="danger-section project-delete-form"
        onSubmit={(event) => void remove(event)}
      >
        <div>
          <h2>Delete Project permanently</h2>
          <p>
            Removes every Project Task, document, view, planning record,
            membership, setting, and Markdown file. This cannot be recovered.
          </p>
        </div>
        <label className="settings-field">
          <span>Type {project.identifier} to confirm</span>
          <input
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
          />
        </label>
        <button
          className="danger-button"
          type="submit"
          disabled={
            identifier !== project.identifier || state.status === 'saving'
          }
        >
          <Trash2 aria-hidden="true" size={14} /> Delete Project
        </button>
        <ActionMessage state={state} />
      </form>
    </SettingsArticle>
  );
}
