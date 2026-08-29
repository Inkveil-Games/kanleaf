import { lazy, Suspense } from 'react';
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
  onConfirmArchive: () => void;
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
        <div>
          <p className="pane-eyebrow">Library note</p>
          <h1>{document.title}</h1>
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

      {confirmingArchive && (
        <div
          className="document-archive-confirm"
          role="alertdialog"
          aria-label="Archive Library note"
        >
          <span>This archives the note and every nested note below it.</span>
          <div>
            <button type="button" onClick={onCancelArchive}>
              Cancel
            </button>
            <button
              className="danger-button"
              type="button"
              onClick={onConfirmArchive}
            >
              Archive
            </button>
          </div>
        </div>
      )}

      <div className="document-metadata-bar">
        <label>
          <span>Location</span>
          <select
            disabled={!document.can_edit}
            value={document.project_id ?? ''}
            onChange={(event) =>
              void onPatch({
                project_id: event.target.value || null,
                parent_id: null,
              }).catch(() => undefined)
            }
          >
            <option value="">Workspace</option>
            {editableProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Parent</span>
          <select
            disabled={!document.can_edit}
            value={document.parent_id ?? ''}
            onChange={(event) =>
              void onPatch({
                parent_id: event.target.value || null,
              }).catch(() => undefined)
            }
          >
            <option value="">No parent</option>
            {parentOptions.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title}
              </option>
            ))}
          </select>
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
