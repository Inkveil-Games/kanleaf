import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ApiContext } from '../workspace/api';
import type { Project } from '../workspace/types';
import {
  archiveDocument,
  createDocument,
  listDocuments,
  reorderDocuments,
  updateDocument,
} from './api';
import { DocumentDetail } from './DocumentDetail';
import { DocumentTree } from './DocumentTree';
import {
  buildSections,
  compareDocuments,
  descendantIds,
  isProjectEditor,
  visibleSections,
} from './tree';
import type { DocumentPatch, WorkspaceDocument } from './types';

interface DocumentWorkspaceProps {
  context: ApiContext;
  workspaceId: string;
  projects: Project[];
  projectId: string | null;
  canCreateWorkspaceDocuments: boolean;
}

export function DocumentWorkspace({
  context,
  workspaceId,
  projects,
  projectId,
  canCreateWorkspaceDocuments,
}: DocumentWorkspaceProps) {
  const queryClient = useQueryClient();
  const queryKey = ['documents', workspaceId, projectId ?? 'all'] as const;
  const documents = useQuery({
    queryKey,
    queryFn: () => listDocuments(context, workspaceId, projectId ?? undefined),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creatingParentId, setCreatingParentId] = useState<
    string | null | undefined
  >(undefined);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [archiveCandidateId, setArchiveCandidateId] = useState<string | null>(
    null,
  );
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const allSections = useMemo(
    () => buildSections(documents.data ?? [], projects, projectId),
    [documents.data, projectId, projects],
  );
  const sections = useMemo(
    () => visibleSections(allSections, collapsedIds),
    [allSections, collapsedIds],
  );
  const entries = useMemo(
    () => sections.flatMap((section) => section.entries),
    [sections],
  );
  const activeSelectedId = nearestVisibleSelection(
    selectedId,
    entries.map(({ document }) => document),
    documents.data ?? [],
  );
  const selected =
    documents.data?.find(({ id }) => id === activeSelectedId) ?? null;
  const activeProject = projectId
    ? projects.find(({ id }) => id === projectId)
    : null;
  const canCreate = projectId
    ? isProjectEditor(activeProject)
    : canCreateWorkspaceDocuments;

  async function refresh(preferredId?: string | null) {
    await queryClient.invalidateQueries({
      queryKey: ['documents', workspaceId],
    });
    if (preferredId !== undefined) setSelectedId(preferredId);
  }

  async function run(action: () => Promise<void>) {
    setActionError(null);
    try {
      await action();
    } catch (caught) {
      setActionError(errorMessage(caught));
      throw caught;
    }
  }

  async function addDocument(title: string, parentId: string | null) {
    const parent = parentId
      ? documents.data?.find(({ id }) => id === parentId)
      : null;
    const scopeProjectId = parent?.project_id ?? projectId;
    await run(async () => {
      const created = await createDocument(context, workspaceId, {
        title,
        project_id: scopeProjectId,
        parent_id: parentId,
      });
      if (parentId) {
        setCollapsedIds((current) => {
          const next = new Set(current);
          next.delete(parentId);
          return next;
        });
      }
      setCreatingParentId(undefined);
      await refresh(created.id);
    });
  }

  async function patchDocument(documentId: string, patch: DocumentPatch) {
    await run(async () => {
      await updateDocument(context, workspaceId, documentId, patch);
      setRenamingId(null);
      await refresh(documentId);
    });
  }

  async function moveSibling(document: WorkspaceDocument, offset: -1 | 1) {
    const siblings = (documents.data ?? [])
      .filter(
        (candidate) =>
          candidate.project_id === document.project_id &&
          candidate.parent_id === document.parent_id,
      )
      .sort(compareDocuments);
    const current = siblings.findIndex(({ id }) => id === document.id);
    const destination = current + offset;
    if (current < 0 || destination < 0 || destination >= siblings.length)
      return;
    [siblings[current], siblings[destination]] = [
      siblings[destination],
      siblings[current],
    ];
    await run(async () => {
      await reorderDocuments(context, workspaceId, {
        project_id: document.project_id,
        parent_id: document.parent_id,
        document_ids: siblings.map(({ id }) => id),
      });
      await refresh(document.id);
    });
  }

  async function confirmArchive(documentId: string) {
    await run(async () => {
      await archiveDocument(context, workspaceId, documentId);
      setArchiveCandidateId(null);
      await refresh(null);
    });
  }

  return (
    <>
      <DocumentTree
        sections={sections}
        documents={documents.data ?? []}
        projectId={projectId}
        selectedId={activeSelectedId}
        collapsedIds={collapsedIds}
        creatingParentId={creatingParentId}
        renamingId={renamingId}
        canCreate={canCreate}
        loading={documents.isPending}
        error={documents.error ? errorMessage(documents.error) : null}
        actionError={actionError}
        onSelect={(documentId) => {
          setSelectedId(documentId);
          setArchiveCandidateId(null);
        }}
        onToggleCollapsed={(documentId) => {
          const collapsing = !collapsedIds.has(documentId);
          if (
            collapsing &&
            selectedId &&
            descendantIds(documents.data ?? [], documentId).has(selectedId)
          ) {
            setSelectedId(documentId);
          }
          setCollapsedIds((current) => {
            const next = new Set(current);
            if (next.has(documentId)) next.delete(documentId);
            else next.add(documentId);
            return next;
          });
        }}
        onStartCreate={(parentId) => {
          if (parentId) {
            setSelectedId(parentId);
            setCollapsedIds((current) => {
              const next = new Set(current);
              next.delete(parentId);
              return next;
            });
          }
          setCreatingParentId(parentId);
        }}
        onCancelCreate={() => setCreatingParentId(undefined)}
        onCreate={addDocument}
        onStartRename={setRenamingId}
        onCancelRename={() => setRenamingId(null)}
        onRename={(documentId, title) => patchDocument(documentId, { title })}
        onMove={(document, offset) => {
          void moveSibling(document, offset).catch(() => undefined);
        }}
        onArchive={(documentId) => {
          setSelectedId(documentId);
          setArchiveCandidateId(documentId);
        }}
      />

      <section className="detail-pane document-detail-pane">
        {selected ? (
          <DocumentDetail
            key={selected.id}
            context={context}
            workspaceId={workspaceId}
            document={selected}
            documents={documents.data ?? []}
            projects={projects}
            confirmingArchive={archiveCandidateId === selected.id}
            onPatch={(patch) => patchDocument(selected.id, patch)}
            onRequestArchive={() => setArchiveCandidateId(selected.id)}
            onCancelArchive={() => setArchiveCandidateId(null)}
            onConfirmArchive={() => {
              void confirmArchive(selected.id).catch(() => undefined);
            }}
          />
        ) : (
          <div className="document-detail-empty">
            <FileText aria-hidden="true" size={22} />
            <h2>Select a Library note</h2>
            <p>Its Markdown source and preview open here.</p>
          </div>
        )}
      </section>
    </>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Library request failed';
}

function nearestVisibleSelection(
  selectedId: string | null,
  visible: WorkspaceDocument[],
  documents: WorkspaceDocument[],
) {
  const visibleIds = new Set(visible.map(({ id }) => id));
  let candidateId = selectedId;
  while (candidateId && !visibleIds.has(candidateId)) {
    candidateId =
      documents.find(({ id }) => id === candidateId)?.parent_id ?? null;
  }
  return candidateId ?? visible[0]?.id ?? null;
}
