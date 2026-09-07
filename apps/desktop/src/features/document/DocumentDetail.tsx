import { ArrowLeft } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import { Select } from '../../components/ui/Select';
import type { ApiContext } from '../workspace/api';
import type { Project } from '../workspace/types';
import { descendantIds, isProjectEditor } from './tree';
import type { DocumentPatch, WorkspaceDocument } from './types';

const MarkdownDocument = lazy(() =>
  import('../markdown/MarkdownDocument').then((module) => ({
    default: module.MarkdownDocument,
  })),
);

export function DocumentDetail({
  context,
  workspaceId,
  document,
  documents,
  projects,
  confirmingArchive,
  onPatch,
  onRequestArchive,
  onCancelArchive,
  onConfirmArchive,
  onBack,
}: {
  context: ApiContext;
  workspaceId: string;
  document: WorkspaceDocument;
  documents: WorkspaceDocument[];
  projects: Project[];
  confirmingArchive: boolean;
  onPatch: (patch: DocumentPatch) => Promise<void>;
  onRequestArchive: () => void;
  onCancelArchive: () => void;
  onConfirmArchive: () => Promise<boolean | void>;
  onBack: () => void;
}) {
  const descendants = descendantIds(documents, document.id);
  const parentOptions = documents.filter(
    (candidate) =>
      candidate.id !== document.id &&
      !descendants.has(candidate.id) &&
      candidate.project_id === document.project_id,
  );
  const editableProjects = projects.filter(isProjectEditor);

  return (
    <div className="document-detail-layout">
      <header className="document-detail-header">
        <div className="document-detail-heading">
          <button
            className="icon-button narrow-detail-back"
            type="button"
            aria-label="Back to Library"
            onClick={onBack}
          >
            <ArrowLeft aria-hidden="true" size={16} />
          </button>
          <div>
            <p className="pane-eyebrow">Library note</p>
            <h1>{document.title}</h1>
          </div>
        </div>
        {document.can_edit && (
          <button
            className="text-button"
            type="button"
            onClick={onRequestArchive}
          >
            Archive…
          </button>
        )}
      </header>

      <AppDialog
        open={confirmingArchive}
        onOpenChange={(open) => {
          if (!open) onCancelArchive();
        }}
        type="confirm"
        variant="warning"
        title="Archive Library note?"
        description="This archives the note and every nested note below it."
        confirmLabel="Archive note"
        loadingLabel="Archiving…"
        onConfirm={onConfirmArchive}
      />

      <div className="document-metadata-bar">
        <label>
          <span>Location</span>
          <Select
            ariaLabel="Library location"
            disabled={!document.can_edit}
            value={document.project_id ?? ''}
            options={[
              { value: '', label: 'Workspace' },
              ...editableProjects.map((project) => ({
                value: project.id,
                label: project.name,
              })),
            ]}
            onValueChange={(value) =>
              void onPatch({
                project_id: value || null,
                parent_id: null,
              }).catch(() => undefined)
            }
          />
        </label>
        <label>
          <span>Parent</span>
          <Select
            ariaLabel="Library parent"
            disabled={!document.can_edit}
            value={document.parent_id ?? ''}
            options={[
              { value: '', label: 'No parent' },
              ...parentOptions.map((candidate) => ({
                value: candidate.id,
                label: candidate.title,
              })),
            ]}
            onValueChange={(value) =>
              void onPatch({
                parent_id: value || null,
              }).catch(() => undefined)
            }
          />
        </label>
        <div className="library-file-path" title={document.library_path}>
          <span>File</span>
          <code>{document.library_path}</code>
        </div>
      </div>

      <div className="library-document-editor">
        <Suspense
          fallback={<div className="document-state">Loading editor…</div>}
        >
          <MarkdownDocument
            serverUrl={context.serverUrl}
            token={context.token}
            workspaceId={workspaceId}
            target={{ kind: 'page', id: document.id }}
            readOnly={!document.can_edit}
          />
        </Suspense>
      </div>
    </div>
  );
}
