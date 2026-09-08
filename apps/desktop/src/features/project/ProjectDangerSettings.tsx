import { Archive, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import { Button } from '../../components/ui/Button';
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
  const [dialog, setDialog] = useState<'archive' | 'delete' | null>(null);
  const [state, setState] = useState<ActionState>({ status: 'idle' });

  async function archive() {
    setState({ status: 'saving' });
    try {
      await archiveProject(context, workspace.id, project.id);
      await onRemoved();
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
      throw error;
    }
  }

  async function remove() {
    setState({ status: 'saving' });
    try {
      await deleteProject(
        context,
        workspace.id,
        project.id,
        project.identifier,
      );
      await onRemoved();
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
      throw error;
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
        <Button
          variant="secondary"
          size="sm"
          disabled={state.status === 'saving'}
          onClick={() => setDialog('archive')}
        >
          <Archive aria-hidden="true" size={14} /> Archive Project
        </Button>
      </section>
      <section className="danger-section project-delete-form">
        <div>
          <h2>Delete Project permanently</h2>
          <p>
            Removes every Project Task, document, view, planning record,
            membership, setting, and Markdown file. This cannot be recovered.
          </p>
        </div>
        <Button
          variant="danger"
          size="sm"
          disabled={state.status === 'saving'}
          onClick={() => setDialog('delete')}
        >
          <Trash2 aria-hidden="true" size={14} /> Delete Project
        </Button>
      </section>
      <ActionMessage state={state} />
      <AppDialog
        open={dialog === 'archive'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        type="confirm"
        variant="warning"
        title={`Archive ${project.name}?`}
        description="Its tasks, documents, and settings will stay intact and can be restored later."
        confirmLabel="Archive Project"
        loadingLabel="Archiving…"
        onConfirm={archive}
      />
      <AppDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        type="typed-confirm"
        variant="danger"
        title={`Delete ${project.name} permanently?`}
        description="Removes every Project Task, document, view, planning record, membership, setting, and Markdown file. This cannot be recovered."
        confirmationText={project.identifier}
        confirmLabel="Delete Project"
        loadingLabel="Deleting…"
        onConfirm={remove}
      />
    </SettingsArticle>
  );
}
