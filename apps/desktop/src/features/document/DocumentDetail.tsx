import { Archive, ArrowLeft, FolderInput, Trash2 } from 'lucide-react';
import { lazy, Suspense, useState, type FormEvent } from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import { Button } from '../../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../../components/ui/DropdownMenu';
import { IconButton } from '../../components/ui/IconButton';
import { Popover } from '../../components/ui/Popover';
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
  canMoveToWorkspace,
  confirmingArchive,
  onPatch,
  onRequestArchive,
  onCancelArchive,
  onConfirmArchive,
  onRequestDelete,
  onBack,
}: {
  context: ApiContext;
  workspaceId: string;
  document: WorkspaceDocument;
  documents: WorkspaceDocument[];
  projects: Project[];
  canMoveToWorkspace: boolean;
  confirmingArchive: boolean;
  onPatch: (patch: DocumentPatch) => Promise<boolean>;
  onRequestArchive: () => void;
  onCancelArchive: () => void;
  onConfirmArchive: () => Promise<boolean | void>;
  onRequestDelete: () => void;
  onBack: () => void;
}) {
  return (
    <section
      className="document-detail-layout"
      aria-label={`${document.title} Library note`}
    >
      <div className="document-shell-actions" aria-label="Document actions">
        <IconButton
          className="narrow-detail-back"
          variant="ghost"
          size="sm"
          type="button"
          aria-label="Back to Library"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" size={16} />
        </IconButton>
        <span className="document-shell-spacer" />
        {document.can_edit ? (
          <>
            <DocumentMovePopover
              document={document}
              documents={documents}
              projects={projects}
              canMoveToWorkspace={canMoveToWorkspace}
              onPatch={onPatch}
            />
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={onRequestArchive}
            >
              <Archive aria-hidden="true" size={14} /> Archive
            </Button>
          </>
        ) : null}
        <DropdownMenu label="More document actions">
          <div
            className="document-file-menu-info"
            title={document.library_path}
          >
            <span>File</span>
            <code>{document.library_path}</code>
          </div>
          {document.can_edit ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="danger-menu-item"
                onClick={onRequestDelete}
              >
                <Trash2 aria-hidden="true" size={14} /> Delete permanently
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenu>
      </div>

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
    </section>
  );
}

function DocumentMovePopover({
  document,
  documents,
  projects,
  canMoveToWorkspace,
  onPatch,
}: {
  document: WorkspaceDocument;
  documents: WorkspaceDocument[];
  projects: Project[];
  canMoveToWorkspace: boolean;
  onPatch: (patch: DocumentPatch) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(document.project_id ?? '');
  const [parentId, setParentId] = useState(document.parent_id ?? '');
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descendants = descendantIds(documents, document.id);
  const parentOptions = documents.filter(
    (candidate) =>
      candidate.id !== document.id &&
      !descendants.has(candidate.id) &&
      candidate.project_id === (projectId || null),
  );
  const editableProjects = projects.filter(isProjectEditor);
  const unchanged =
    projectId === (document.project_id ?? '') &&
    parentId === (document.parent_id ?? '');

  async function move(event: FormEvent) {
    event.preventDefault();
    if (unchanged) {
      setOpen(false);
      return;
    }
    setMoving(true);
    setError(null);
    try {
      const moved = await onPatch({
        project_id: projectId || null,
        parent_id: parentId || null,
      });
      if (moved) setOpen(false);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Library move failed',
      );
    } finally {
      setMoving(false);
    }
  }

  return (
    <Popover
      label="Move Library note"
      contentLabel={`Move ${document.title}`}
      className="document-move-menu"
      align="end"
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setProjectId(document.project_id ?? '');
          setParentId(document.parent_id ?? '');
          setError(null);
        }
      }}
      trigger={
        <>
          <FolderInput aria-hidden="true" size={14} /> Move to…
        </>
      }
    >
      <form
        className="document-move-form"
        onSubmit={(event) => void move(event)}
      >
        <label>
          <span>Location</span>
          <Select
            ariaLabel="Move location"
            value={projectId}
            options={[
              ...(canMoveToWorkspace
                ? [{ value: '', label: 'Workspace' }]
                : []),
              ...editableProjects.map((project) => ({
                value: project.id,
                label: project.name,
              })),
            ]}
            onValueChange={(value) => {
              setProjectId(value);
              setParentId('');
            }}
          />
        </label>
        <label>
          <span>Parent</span>
          <Select
            ariaLabel="Move parent"
            value={parentId}
            options={[
              { value: '', label: 'No parent' },
              ...parentOptions.map((candidate) => ({
                value: candidate.id,
                label: candidate.title,
              })),
            ]}
            onValueChange={setParentId}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <div>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={unchanged}
            loading={moving}
            loadingLabel="Moving note"
          >
            Move
          </Button>
        </div>
      </form>
    </Popover>
  );
}
