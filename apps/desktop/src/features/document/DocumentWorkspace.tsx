import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import type { ApiContext } from '../workspace/api';
import type { Project } from '../workspace/types';
import {
  archiveDocument,
  createDocument,
  deleteDocument,
  listDocuments,
  moveDocument,
  updateDocument,
} from './api';
import { DocumentDetail } from './DocumentDetail';
import { DocumentTree } from './DocumentTree';
import {
  buildSections,
  descendantIds,
  isProjectEditor,
  moveTreeNode,
  visibleSections,
  type TreeDestination,
} from './tree';
import type { DocumentPatch, MovedDocument, WorkspaceDocument } from './types';

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
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(
    null,
  );
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [suppressImplicitSelection, setSuppressImplicitSelection] =
    useState(false);
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
  const activeSelectedId =
    suppressImplicitSelection && selectedDocumentId === null
      ? null
      : nearestVisibleSelection(
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
  const deleteCandidate =
    availableDocuments.find(({ id }) => id === deleteCandidateId) ?? null;
  const deleteDescendantCount = deleteCandidate
    ? descendantIds(availableDocuments, deleteCandidate.id).size
    : 0;

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setSuppressImplicitSelection(false),
      0,
    );
    return () => window.clearTimeout(timeout);
  }, [projectId, workspaceId]);

  useEffect(() => {
    if (selectedDocumentId === null) return;
    const timeout = window.setTimeout(
      () => setSuppressImplicitSelection(false),
      0,
    );
    return () => window.clearTimeout(timeout);
  }, [selectedDocumentId]);

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
    if (!(await onPrepareDocumentMutation())) return false;
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
    return true;
  }

  async function moveTreeDocument(
    documentId: string,
    destination: TreeDestination,
  ) {
    const mutationIds = descendantIds(availableDocuments, documentId);
    mutationIds.add(documentId);
    if ([...mutationIds].some((id) => busyIds.has(id))) {
      throw new Error('This Library note is already being changed.');
    }
    const snapshots = queryClient.getQueriesData<WorkspaceDocument[]>({
      queryKey: ['documents', workspaceId],
    });
    setBusy(mutationIds, true);
    setActionError(null);
    queryClient.setQueriesData<WorkspaceDocument[]>(
      { queryKey: ['documents', workspaceId] },
      (current) => {
        if (!current?.some(({ id }) => id === documentId)) return current;
        return (
          moveTreeNode(current, { documentId, destination })?.documents ??
          current
        );
      },
    );
    try {
      if (!(await onPrepareDocumentMutation())) {
        throw new Error('Save the open note before moving it.');
      }
      const response = await moveDocument(context, workspaceId, documentId, {
        parent_id: destination.parentId,
        index: destination.index,
      });
      reconcileMovedDocuments(response.documents);
    } catch (caught) {
      for (const [key, snapshot] of snapshots) {
        queryClient.setQueryData(key, snapshot);
      }
      setActionError(errorMessage(caught));
      throw caught;
    } finally {
      setBusy(mutationIds, false);
    }
  }

  async function confirmArchive(documentId: string) {
    const mutationIds = descendantIds(availableDocuments, documentId);
    mutationIds.add(documentId);
    if ([...mutationIds].some((id) => busyIds.has(id))) return false;
    if (!(await onPrepareDocumentMutation())) return false;
    setBusy(mutationIds, true);
    try {
      await run(async () => {
        await archiveDocument(context, workspaceId, documentId);
        setArchiveCandidateId(null);
        await refresh();
        await onSelectDocument(null, { replace: true });
      });
      return true;
    } finally {
      setBusy(mutationIds, false);
    }
  }

  async function confirmDelete(documentId: string) {
    const mutationIds = descendantIds(availableDocuments, documentId);
    mutationIds.add(documentId);
    if ([...mutationIds].some((id) => busyIds.has(id))) return false;
    if (!(await onPrepareDocumentMutation())) return false;
    setBusy(mutationIds, true);
    setActionError(null);
    try {
      const { deleted_ids: deletedIds } = await deleteDocument(
        context,
        workspaceId,
        documentId,
      );
      const deleted = new Set(deletedIds);
      queryClient.setQueriesData<WorkspaceDocument[]>(
        { queryKey: ['documents', workspaceId] },
        (current) => current?.filter(({ id }) => !deleted.has(id)),
      );
      queryClient.removeQueries({
        predicate: (query) => {
          if (query.queryKey[1] !== workspaceId) return false;
          if (
            query.queryKey[0] === 'document' &&
            typeof query.queryKey[2] === 'string' &&
            deleted.has(query.queryKey[2])
          ) {
            return true;
          }
          if (
            query.queryKey[0] === 'routed-document' &&
            query.queryKey[2] === 'id' &&
            typeof query.queryKey[3] === 'string' &&
            deleted.has(query.queryKey[3])
          ) {
            return true;
          }
          if (
            query.queryKey[0] === 'markdown-document' &&
            typeof query.queryKey[3] === 'string'
          ) {
            return deleted.has(query.queryKey[3]);
          }
          const cached = query.state.data;
          return (
            typeof cached === 'object' &&
            cached !== null &&
            'id' in cached &&
            typeof cached.id === 'string' &&
            deleted.has(cached.id)
          );
        },
      });
      setDeleteCandidateId(null);
      if (activeSelectedId && deleted.has(activeSelectedId)) {
        setSuppressImplicitSelection(true);
        await onSelectDocument(null, { replace: true });
      }
      return true;
    } catch (caught) {
      setActionError(errorMessage(caught));
      throw caught;
    } finally {
      setBusy(mutationIds, false);
    }
  }

  function setBusy(documentIds: ReadonlySet<string>, busy: boolean) {
    setBusyIds((current) => {
      const next = new Set(current);
      for (const documentId of documentIds) {
        if (busy) next.add(documentId);
        else next.delete(documentId);
      }
      return next;
    });
  }

  function reconcileMovedDocuments(authoritative: MovedDocument[]) {
    const byId = new Map(
      authoritative.map((document) => [document.id, document]),
    );
    const reconcile = (current: WorkspaceDocument) => {
      const moved = byId.get(current.id);
      return moved ? { ...current, ...moved } : current;
    };
    queryClient.setQueriesData<WorkspaceDocument[]>(
      { queryKey: ['documents', workspaceId] },
      (current) => current?.map(reconcile),
    );
    queryClient.setQueriesData<WorkspaceDocument>(
      {
        predicate: (query) =>
          query.queryKey[1] === workspaceId &&
          (query.queryKey[0] === 'document' ||
            query.queryKey[0] === 'routed-document'),
      },
      (current) => (current ? reconcile(current) : current),
    );
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
        sections={allSections}
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
        busyIds={busyIds}
        onSelect={(documentId) => {
          setSuppressImplicitSelection(false);
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
        onRename={async (documentId, title) => {
          await patchDocument(documentId, { title });
        }}
        onMove={moveTreeDocument}
        onKeepExpanded={(documentId) => {
          setCollapsedIds((current) => {
            const next = new Set(current);
            next.delete(documentId);
            return next;
          });
        }}
        onArchive={(documentId) => {
          const document = documents.data?.find(({ id }) => id === documentId);
          if (document) void onSelectDocument(document);
          setArchiveCandidateId(documentId);
        }}
        onDelete={setDeleteCandidateId}
      />

      <AppDialog
        type="confirm"
        open={deleteCandidate !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteCandidateId(null);
        }}
        variant="danger"
        title={
          deleteCandidate
            ? deleteDescendantCount > 0
              ? `Delete “${deleteCandidate.title}” and ${deleteDescendantCount} nested ${deleteDescendantCount === 1 ? 'note' : 'notes'}?`
              : `Delete “${deleteCandidate.title}”?`
            : 'Delete Library note?'
        }
        description={
          deleteDescendantCount > 0
            ? 'This permanently deletes this note and all of its nested notes. This action cannot be undone.'
            : 'This permanently deletes this Library note and cannot be undone.'
        }
        icon={<Trash2 aria-hidden="true" size={18} />}
        confirmLabel="Delete permanently"
        loadingLabel="Deleting…"
        onConfirm={() =>
          deleteCandidate ? confirmDelete(deleteCandidate.id) : false
        }
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
            canMoveToWorkspace={canCreateWorkspaceDocuments}
            confirmingArchive={archiveCandidateId === selected.id}
            onPatch={(patch) => patchDocument(selected.id, patch)}
            onRequestArchive={() => setArchiveCandidateId(selected.id)}
            onCancelArchive={() => setArchiveCandidateId(null)}
            onConfirmArchive={() => confirmArchive(selected.id)}
            onRequestDelete={() => setDeleteCandidateId(selected.id)}
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
