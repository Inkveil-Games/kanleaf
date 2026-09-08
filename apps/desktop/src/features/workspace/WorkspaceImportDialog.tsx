import { ArchiveRestore, FileArchive, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import { errorMessage } from '../settings/utils';
import type { ApiContext } from './api';
import {
  applyWorkspaceImport,
  cancelWorkspaceImport,
  previewWorkspaceImport,
  type WorkspaceImportOperation,
} from './portabilityApi';

interface WorkspaceImportDialogProps {
  context: ApiContext;
  onApplyImport: (
    apply: () => Promise<WorkspaceImportOperation>,
  ) => Promise<WorkspaceImportOperation | null>;
  onClose: () => void;
}

export function WorkspaceImportDialog({
  context,
  onApplyImport,
  onClose,
}: WorkspaceImportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [operation, setOperation] = useState<WorkspaceImportOperation | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  function close() {
    if (busy) return;
    if (operation && operation.state !== 'completed') {
      void cancelWorkspaceImport(context, operation.id).catch(() => undefined);
    }
    onClose();
  }

  async function chooseArchive(file: File) {
    setBusy(true);
    setError(null);
    setFileName(file.name);
    if (operation && operation.state !== 'completed') {
      await cancelWorkspaceImport(context, operation.id).catch(() => undefined);
    }
    setOperation(null);
    try {
      const preview = await previewWorkspaceImport(context, file);
      setOperation(preview);
      if (preview.state === 'failed') {
        setError(preview.error?.message ?? 'This archive cannot be imported');
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function applyImport() {
    if (!operation || operation.state !== 'ready') return;
    setBusy(true);
    setError(null);
    try {
      const applied = await onApplyImport(() =>
        applyWorkspaceImport(context, operation),
      );
      if (!applied) {
        onClose();
        return;
      }
      setOperation(applied);
      if (applied.state !== 'completed' || !applied.workspace_id) {
        setError(applied.error?.message ?? 'Workspace import failed');
        return;
      }
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const summary = operation?.summary;

  return (
    <dialog
      ref={dialogRef}
      className="workspace-import-dialog"
      aria-label="Import Workspace"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="workspace-import-window">
        <header>
          <div>
            <strong>Import Workspace</strong>
            <span>Create a new isolated Workspace from a Kanleaf archive.</span>
          </div>
          <IconButton
            variant="ghost"
            size="sm"
            type="button"
            aria-label="Close import"
            disabled={busy}
            onClick={close}
          >
            <X aria-hidden="true" size={16} />
          </IconButton>
        </header>
        <div className="workspace-import-content">
          <label className="workspace-import-picker">
            <FileArchive aria-hidden="true" size={22} />
            <span>
              <strong>{fileName ?? 'Choose a .kanleaf.zip archive'}</strong>
              <small>
                Kanleaf validates every path, checksum, identity, and portable
                configuration record before restore.
              </small>
            </span>
            <span className="workspace-import-picker-action">
              {busy && !operation ? 'Checking…' : 'Choose file'}
            </span>
            <input
              type="file"
              accept=".zip,.kanleaf.zip,application/zip"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void chooseArchive(file);
                event.target.value = '';
              }}
            />
          </label>

          {summary && operation?.state === 'ready' && (
            <section className="workspace-import-preview">
              <div className="workspace-import-name">
                <span className="workspace-trigger-mark" aria-hidden="true">
                  {summary.workspace_name.trim().charAt(0).toUpperCase() || 'W'}
                </span>
                <span>
                  <small>New Workspace</small>
                  <strong>{summary.workspace_name}</strong>
                </span>
              </div>
              <dl className="workspace-import-counts">
                <ImportCount label="Projects" value={summary.projects} />
                <ImportCount label="Tasks" value={summary.tasks} />
                <ImportCount label="Wiki notes" value={summary.documents} />
                <ImportCount
                  label="Shared Views"
                  value={summary.shared_views}
                />
                <ImportCount label="Cycles" value={summary.cycles} />
                <ImportCount label="Modules" value={summary.modules} />
              </dl>
              <p className="workspace-import-warning">
                Access is reset for safety. You become the only Owner;
                {` ${summary.excluded_member_references} member/Project role reference(s) and ${summary.excluded_assignee_references} Task assignee reference(s) will not be restored.`}
                {' Comments and activity are not part of the archive.'}
              </p>
            </section>
          )}

          {error && (
            <p className="settings-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <Button
            variant="secondary"
            type="button"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="button"
            loading={busy && operation?.state === 'ready'}
            loadingLabel="Importing Workspace"
            disabled={operation?.state !== 'ready'}
            onClick={() => void applyImport()}
          >
            <ArchiveRestore aria-hidden="true" size={14} />
            Import as new Workspace
          </Button>
        </footer>
      </div>
    </dialog>
  );
}

function ImportCount({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
