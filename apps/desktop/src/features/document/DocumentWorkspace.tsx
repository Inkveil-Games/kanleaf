import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
  accessSettled: boolean;
  canCreateWorkspaceDocuments: boolean;
  selectedDocumentId: string | null;
  onSelectDocument: (
    document: WorkspaceDocument | null,
    navigation?: { replace?: boolean },
  ) => boolean | Promise<boolean>;
  onPrepareDocumentMutation: () => boolean | Promise<boolean>;
  onInvalidSelection: () => void;
}

export function DocumentWorkspace({
  context,
  workspaceId,
  projects,
  projectId,
  accessSettled,
  canCreateWorkspaceDocuments,
  selectedDocumentId,
  onSelectDocument,
  onPrepareDocumentMutation,
  onInvalidSelection,
}: DocumentWorkspaceProps) {
  const queryClient = useQueryClient();
  const queryKey = ['documents', workspaceId, projectId ?? 'all'] as const;
  const documents = useQuery({
    queryKey,
    queryFn: () => listDocuments(context, workspaceId, projectId ?? undefined),
    enabled: accessSettled,
  });
  const [creatingParentId, setCreatingParentId] = useState<
    string | null | undefined
  >(undefined);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [archiveCandidateId, setArchiveCandidateId] = useState<string | null>(
    null,
  );
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const availableDocuments = useMemo(
    () => (accessSettled ? (documents.data ?? []) : []),
    [accessSettled, documents.data],
  );

  const allSections = useMemo(
    () => buildSections(availableDocuments, projects, projectId),
    [availableDocuments, projectId, projects],
  );
  const sections = useMemo(
    () => visibleSections(allSections, collapsedIds),
    [allSections, collapsedIds],
  );
  const scopedDocumentIds = useMemo(
    () =>
      new Set(
        allSections.flatMap((section) =>
          section.entries.map(({ document }) => document.id),
        ),
      ),
    [allSections],
  );
  const entries = useMemo(
    () => sections.flatMap((section) => section.entries),
    [sections],
  );
  const activeSelectedId = nearestVisibleSelection(
    selectedDocumentId,
    entries.map(({ document }) => document),
    availableDocuments,
  );
  const selected =
    availableDocuments.find(({ id }) => id === activeSelectedId) ?? null;
  const activeProject = projectId
    ? projects.find(({ id }) => id === projectId)
    : null;
  const canCreate =
    accessSettled &&
    (projectId ? isProjectEditor(activeProject) : canCreateWorkspaceDocuments);

  useEffect(() => {
    if (
      !accessSettled ||
      !documents.isSuccess ||
      documents.isFetching ||
      selectedDocumentId === null
    ) {
      return;
    }

    const routedDocument = documents.data.find(
      ({ id }) => id === selectedDocumentId,
    );
    if (!routedDocument || !scopedDocumentIds.has(selectedDocumentId)) {
      onInvalidSelection();
    } else if (routedDocument.project_id !== projectId) {
      void onSelectDocument(routedDocument, { replace: true });
    }
  }, [
    accessSettled,
    documents.data,
    documents.isFetching,
    documents.isSuccess,
    onInvalidSelection,
    onSelectDocument,
    projectId,
    scopedDocumentIds,
    selectedDocumentId,
  ]);

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: ['documents', workspaceId],
    });
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
      if (!(await onPrepareDocumentMutation())) {
        setCreatingParentId(undefined);
        return;
      }
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
      await refresh();
      await onSelectDocument(created);
    });
  }

  async function patchDocument(documentId: string, patch: DocumentPatch) {
    await run(async () => {
      const updated = await updateDocument(
        context,
        workspaceId,
        documentId,
        patch,
      );
      setRenamingId(null);
      if (
        updated.id === selectedDocumentId &&
        updated.project_id !== projectId
      ) {
        await onSelectDocument(updated, { replace: true });
      }
      await refresh();
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
      await refresh();
    });
  }

  async function confirmArchive(documentId: string) {
    await run(async () => {
      if (!(await onPrepareDocumentMutation())) return;
      await archiveDocument(context, workspaceId, documentId);
      setArchiveCandidateId(null);
      await refresh();
      await onSelectDocument(null, { replace: true });
    });
  }

  async function toggleCollapsed(documentId: string) {
    const collapsing = !collapsedIds.has(documentId);
    if (
      collapsing &&
      selectedDocumentId &&
      descendantIds(documents.data ?? [], documentId).has(selectedDocumentId) &&
      !(await onSelectDocument(
        documents.data?.find(({ id }) => id === documentId) ?? null,
        { replace: true },
      ))
    ) {
      return;
    }
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  }

  return (
    <>
      <DocumentTree
        sections={sections}
        documents={availableDocuments}
        projectId={projectId}
        selectedId={activeSelectedId}
        collapsedIds={collapsedIds}
        creatingParentId={accessSettled ? creatingParentId : undefined}
        renamingId={accessSettled ? renamingId : null}
        canCreate={canCreate}
        loading={!accessSettled || documents.isPending}
        error={documents.error ? errorMessage(documents.error) : null}
        actionError={actionError}
        onSelect={(documentId) => {
          const document = documents.data?.find(({ id }) => id === documentId);
          if (document) void onSelectDocument(document);
          setArchiveCandidateId(null);
        }}
        onToggleCollapsed={(documentId) => {
          void toggleCollapsed(documentId);
        }}
        onStartCreate={(parentId) => {
          if (parentId) {
            const parent = documents.data?.find(({ id }) => id === parentId);
            if (parent) void onSelectDocument(parent);
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
          const document = documents.data?.find(({ id }) => id === documentId);
          if (document) void onSelectDocument(document);
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
            documents={availableDocuments}
            projects={projects}
            confirmingArchive={archiveCandidateId === selected.id}
            onPatch={(patch) => patchDocument(selected.id, patch)}
            onRequestArchive={() => setArchiveCandidateId(selected.id)}
            onCancelArchive={() => setArchiveCandidateId(null)}
            onConfirmArchive={() => {
              void confirmArchive(selected.id).catch(() => undefined);
            }}
            onBack={() => {
              void onSelectDocument(null, { replace: true });
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
  if (selectedId === null) return visible[0]?.id ?? null;

  const visibleIds = new Set(visible.map(({ id }) => id));
  let candidateId: string | null = selectedId;
  while (candidateId && !visibleIds.has(candidateId)) {
    candidateId =
      documents.find(({ id }) => id === candidateId)?.parent_id ?? null;
  }
  return candidateId;
}
