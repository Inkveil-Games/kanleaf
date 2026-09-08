import { Archive, Download, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { SettingsArticle } from '../settings/SettingsArticle';
import { errorMessage } from '../settings/utils';
import type { ApiContext } from './api';
import {
  applyVaultSync,
  downloadWorkspaceExport,
  getWorkspaceExport,
  previewVaultSync,
  startWorkspaceExport,
  type VaultSyncOperation,
  type WorkspaceExportOperation,
} from './portabilityApi';
import type { Workspace } from './types';

interface WorkspaceStorageSettingsProps {
  context: ApiContext;
  workspace: Workspace;
  onConfigurationUpdated: () => Promise<void>;
}

export function WorkspaceStorageSettings({
  context,
  workspace,
  onConfigurationUpdated,
}: WorkspaceStorageSettingsProps) {
  const [sync, setSync] = useState<VaultSyncOperation | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [archive, setArchive] = useState<WorkspaceExportOperation | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  async function scanVault() {
    setSyncBusy(true);
    setSyncError(null);
    setSyncMessage(null);
    try {
      const preview = await previewVaultSync(context, workspace.id);
      setSync(preview);
      setSelectedTasks(
        new Set(
          preview.items
            .filter(({ status }) => status === 'valid')
            .map(({ task_id }) => task_id),
        ),
      );
    } catch (error) {
      setSyncError(errorMessage(error));
    } finally {
      setSyncBusy(false);
    }
  }

  async function applySelected() {
    if (!sync || selectedTasks.size === 0) return;
    setSyncBusy(true);
    setSyncError(null);
    setSyncMessage(null);
    try {
      const applied = await applyVaultSync(context, workspace.id, sync, [
        ...selectedTasks,
      ]);
      setSync(applied);
      setSelectedTasks(new Set());
      setSyncMessage(
        `${applied.applied_task_ids.length} Task ${applied.applied_task_ids.length === 1 ? 'was' : 'were'} updated from the vault.`,
      );
      await onConfigurationUpdated();
    } catch (error) {
      setSyncError(errorMessage(error));
    } finally {
      setSyncBusy(false);
    }
  }

  async function prepareArchive() {
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      let operation = await startWorkspaceExport(context, workspace.id);
      setArchive(operation);
      for (let attempt = 0; operation.state === 'preparing'; attempt += 1) {
        if (attempt >= 120) throw new Error('Workspace export timed out');
        await delay(250);
        operation = await getWorkspaceExport(context, operation.id);
        setArchive(operation);
      }
      if (operation.state === 'failed') {
        throw new Error(
          operation.error?.message ?? 'Workspace export could not be prepared',
        );
      }
    } catch (error) {
      setArchiveError(errorMessage(error));
    } finally {
      setArchiveBusy(false);
    }
  }

  async function downloadArchive() {
    if (!archive) return;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      const download = await downloadWorkspaceExport(context, archive);
      const url = URL.createObjectURL(download.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = download.fileName ?? archive.file_name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setArchiveError(errorMessage(error));
    } finally {
      setArchiveBusy(false);
    }
  }

  const changedItems =
    sync?.items.filter(({ status }) => status === 'valid') ?? [];
  const attentionItems =
    sync?.items.filter(
      ({ status }) => status !== 'valid' && status !== 'unchanged',
    ) ?? [];

  return (
    <SettingsArticle
      eyebrow="Workspace"
      title="Storage & backup"
      description="Review external Markdown changes and create a portable Workspace archive."
      className="storage-settings"
    >
      <section className="settings-section storage-section">
        <div className="settings-section-heading">
          <div>
            <h2>Vault sync</h2>
            <p>
              Scan Kanleaf-owned Task properties changed by another Markdown
              editor. Markdown bodies never need this sync.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={syncBusy}
            onClick={() => void scanVault()}
          >
            <RefreshCw aria-hidden="true" size={14} />
            {syncBusy ? 'Scanning…' : sync ? 'Scan again' : 'Scan vault'}
          </Button>
        </div>
        {sync && changedItems.length === 0 && attentionItems.length === 0 && (
          <p className="storage-status" role="status">
            No external Task property changes were found.
          </p>
        )}
        {changedItems.length > 0 && (
          <div className="storage-change-list" aria-label="Vault changes">
            {changedItems.map((item) => (
              <label className="storage-change-row" key={item.task_id}>
                <Checkbox
                  aria-label={`Select ${item.reference}`}
                  checked={selectedTasks.has(item.task_id)}
                  onCheckedChange={(checked) => {
                    setSelectedTasks((current) => {
                      const next = new Set(current);
                      if (checked) next.add(item.task_id);
                      else next.delete(item.task_id);
                      return next;
                    });
                  }}
                />
                <span>
                  <strong>{item.reference}</strong>
                  <span>{item.title}</span>
                  <small>{item.changes.join(', ')}</small>
                </span>
              </label>
            ))}
            <Button
              variant="primary"
              size="sm"
              disabled={syncBusy || selectedTasks.size === 0}
              onClick={() => void applySelected()}
            >
              Apply {selectedTasks.size} selected
            </Button>
          </div>
        )}
        {(attentionItems.length > 0 || (sync?.issues.length ?? 0) > 0) && (
          <details className="storage-issues">
            <summary>
              {attentionItems.length + (sync?.issues.length ?? 0)} item(s) need
              attention
            </summary>
            <ul>
              {attentionItems.map((item) => (
                <li key={`${item.task_id}:${item.status}`}>
                  <strong>{item.reference}</strong> —{' '}
                  {item.message ?? item.status}
                </li>
              ))}
              {sync?.issues.map((issue) => (
                <li key={`${issue.kind}:${issue.path}`}>
                  <strong>{issue.path}</strong> — {issue.message}
                </li>
              ))}
            </ul>
          </details>
        )}
        {syncMessage && (
          <p className="settings-success" role="status">
            {syncMessage}
          </p>
        )}
        {syncError && (
          <p className="settings-error" role="alert">
            {syncError}
          </p>
        )}
      </section>

      <section className="settings-section storage-section">
        <div className="settings-section-heading">
          <div>
            <h2>Workspace archive</h2>
            <p>
              Package managed Task, Wiki, and portable configuration files into
              a verified <code>.kanleaf.zip</code> backup.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={archiveBusy}
            onClick={() => void prepareArchive()}
          >
            <Archive aria-hidden="true" size={14} />
            {archiveBusy && archive?.state === 'preparing'
              ? 'Preparing…'
              : archive
                ? 'Prepare again'
                : 'Prepare archive'}
          </Button>
        </div>
        {archive?.state === 'ready' && (
          <div className="storage-export-ready">
            <div>
              <strong>{archive.file_name}</strong>
              <small>
                {archive.file_count} files ·{' '}
                {formatBytes(archive.archive_bytes ?? 0)}
                {archive.exclusions.length > 0
                  ? ` · ${archive.exclusions.length} unmanaged item(s) excluded`
                  : ''}
              </small>
            </div>
            <Button
              variant="primary"
              size="sm"
              disabled={archiveBusy}
              onClick={() => void downloadArchive()}
            >
              <Download aria-hidden="true" size={14} /> Download archive
            </Button>
          </div>
        )}
        {archiveError && (
          <p className="settings-error" role="alert">
            {archiveError}
          </p>
        )}
      </section>
    </SettingsArticle>
  );
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
