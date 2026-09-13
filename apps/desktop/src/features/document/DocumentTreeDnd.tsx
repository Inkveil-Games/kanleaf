import { DragDropProvider, DragOverlay } from '@dnd-kit/react';
import { FileText, GripVertical } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  descendantIds,
  destinationForRow,
  dropRegion,
  moveTreeNode,
  projectSections,
  sameDestination,
  visibleSections,
  type DocumentSection,
  type TreeDestination,
} from './tree';
import type { WorkspaceDocument } from './types';
import {
  DocumentTreeDndContext,
  type DocumentTreeDragPreview,
} from './documentTreeDndContext';

export const INSIDE_HOVER_DELAY = 400;
export const AUTO_EXPAND_DELAY = 500;

interface MiddleHover {
  targetId: string;
  fallback: 'before' | 'after';
  insideActivated: boolean;
  rowTop: number;
  rowHeight: number;
}

export function DocumentTreeDnd({
  children,
  collapsedIds,
  documents,
  sections,
  busyIds,
  onKeepExpanded,
  onMove,
}: {
  children: (state: {
    sections: DocumentSection[];
    collapsedIds: ReadonlySet<string>;
  }) => ReactNode;
  collapsedIds: ReadonlySet<string>;
  documents: WorkspaceDocument[];
  sections: DocumentSection[];
  busyIds: ReadonlySet<string>;
  onKeepExpanded: (documentId: string) => void;
  onMove: (documentId: string, destination: TreeDestination) => Promise<void>;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [preview, setPreview] = useState<DocumentTreeDragPreview | null>(null);
  const [temporarilyExpandedIds, setTemporarilyExpandedIds] = useState<
    Set<string>
  >(new Set());
  const [persisting, setPersisting] = useState(false);
  const insideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const middleHover = useRef<MiddleHover | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const previewRef = useRef<DocumentTreeDragPreview | null>(null);
  const documentsRef = useRef(documents);
  const collapsedIdsRef = useRef(collapsedIds);

  useEffect(() => {
    documentsRef.current = documents;
    collapsedIdsRef.current = collapsedIds;
  }, [collapsedIds, documents]);

  const updatePreview = useCallback((next: DocumentTreeDragPreview | null) => {
    previewRef.current = next;
    setPreview((current) => {
      if (
        current?.targetId === next?.targetId &&
        current?.intent === next?.intent &&
        sameDestination(current?.destination ?? null, next?.destination ?? null)
      ) {
        return current;
      }
      return next;
    });
  }, []);

  const clearTimers = useCallback(() => {
    if (insideTimer.current) clearTimeout(insideTimer.current);
    if (expandTimer.current) clearTimeout(expandTimer.current);
    insideTimer.current = null;
    expandTimer.current = null;
  }, []);

  const resetDrag = useCallback(() => {
    clearTimers();
    middleHover.current = null;
    activeIdRef.current = null;
    previewRef.current = null;
    setActiveId(null);
    setPreview(null);
    setTemporarilyExpandedIds(new Set());
    setPersisting(false);
  }, [clearTimers]);

  useEffect(() => resetDrag, [resetDrag]);
  useEffect(() => {
    if (!activeId || documents.some(({ id }) => id === activeId)) return;
    const timeout = window.setTimeout(resetDrag, 0);
    return () => window.clearTimeout(timeout);
  }, [activeId, documents, resetDrag]);
  useEffect(() => {
    if (!activeId || busyIds.size === 0) return;
    const timeout = window.setTimeout(resetDrag, 0);
    return () => window.clearTimeout(timeout);
  }, [activeId, busyIds, resetDrag]);

  function retainTemporaryExpansions(targetId: string | null) {
    setTemporarilyExpandedIds((current) => {
      if (current.size === 0) return current;
      const next = new Set(
        [...current].filter(
          (expandedId) =>
            targetId === expandedId ||
            (targetId !== null &&
              descendantIds(documentsRef.current, expandedId).has(targetId)),
        ),
      );
      if (
        next.size === current.size &&
        [...next].every((documentId) => current.has(documentId))
      ) {
        return current;
      }
      return next;
    });
  }

  function activateEdge(targetId: string, intent: 'before' | 'after') {
    clearTimers();
    middleHover.current = null;
    retainTemporaryExpansions(targetId);
    const documentId = activeIdRef.current;
    if (!documentId) return updatePreview(null);
    const destination = destinationForRow(
      documentsRef.current,
      documentId,
      targetId,
      intent,
    );
    updatePreview(destination ? { targetId, intent, destination } : null);
  }

  function activateMiddle(
    targetId: string,
    fallback: 'before' | 'after',
    rowTop: number,
    rowHeight: number,
  ) {
    const current = middleHover.current;
    if (current?.targetId === targetId) return;
    clearTimers();
    retainTemporaryExpansions(targetId);
    const documentId = activeIdRef.current;
    if (!documentId) return updatePreview(null);

    const fallbackDestination = destinationForRow(
      documentsRef.current,
      documentId,
      targetId,
      fallback,
    );
    middleHover.current = {
      targetId,
      fallback,
      insideActivated: false,
      rowTop,
      rowHeight,
    };
    updatePreview(
      fallbackDestination
        ? { targetId, intent: fallback, destination: fallbackDestination }
        : null,
    );

    insideTimer.current = setTimeout(() => {
      const hover = middleHover.current;
      const activeDocumentId = activeIdRef.current;
      if (!hover || hover.targetId !== targetId || !activeDocumentId) return;
      const destination = destinationForRow(
        documentsRef.current,
        activeDocumentId,
        targetId,
        'inside',
      );
      if (!destination) return;
      hover.insideActivated = true;
      updatePreview({ targetId, intent: 'inside', destination });
    }, INSIDE_HOVER_DELAY);

    expandTimer.current = setTimeout(() => {
      const hover = middleHover.current;
      const target = documentsRef.current.find(({ id }) => id === targetId);
      if (
        !hover?.insideActivated ||
        hover.targetId !== targetId ||
        !target ||
        !collapsedIdsRef.current.has(targetId) ||
        descendantIds(documentsRef.current, targetId).size === 0
      ) {
        return;
      }
      setTemporarilyExpandedIds((currentIds) =>
        new Set(currentIds).add(targetId),
      );
    }, AUTO_EXPAND_DELAY);
  }

  const projection = useMemo(() => {
    if (!activeId || !preview) return null;
    return moveTreeNode(documents, {
      documentId: activeId,
      destination: preview.destination,
    });
  }, [activeId, documents, preview]);
  const previewDocuments = projection?.documents ?? documents;
  const effectiveCollapsedIds = useMemo(() => {
    const next = new Set(collapsedIds);
    for (const documentId of temporarilyExpandedIds) next.delete(documentId);
    return next;
  }, [collapsedIds, temporarilyExpandedIds]);
  const renderedSections = useMemo(
    () =>
      visibleSections(
        projectSections(sections, previewDocuments),
        effectiveCollapsedIds,
      ),
    [effectiveCollapsedIds, previewDocuments, sections],
  );
  const activeDocument = activeId
    ? documents.find(({ id }) => id === activeId)
    : null;
  const context = useMemo(
    () => ({
      activeId,
      busyIds,
      originalParentIds: new Set(
        documents.flatMap(({ parent_id: parentId }) =>
          parentId ? [parentId] : [],
        ),
      ),
      preview,
      persisting,
    }),
    [activeId, busyIds, documents, persisting, preview],
  );

  return (
    <DocumentTreeDndContext.Provider value={context}>
      <DragDropProvider
        onDragStart={({ operation }) => {
          const documentId = String(operation.source?.id ?? '');
          const document = documentsRef.current.find(
            ({ id }) => id === documentId,
          );
          if (!document?.can_edit || busyIds.has(documentId)) return;
          clearTimers();
          activeIdRef.current = documentId;
          setActiveId(documentId);
        }}
        onDragMove={({ operation, to }) => {
          if (persisting) return;
          const pointerY = to?.y ?? operation.position.current.y;
          const target = operation.target;
          const lockedHover = middleHover.current;
          if (
            lockedHover &&
            target &&
            String(target.id) === lockedHover.targetId &&
            dropRegion(lockedHover.rowTop, lockedHover.rowHeight, pointerY)
              .kind === 'middle'
          ) {
            return;
          }
          if (!target) {
            clearTimers();
            middleHover.current = null;
            updatePreview(null);
            retainTemporaryExpansions(null);
            return;
          }
          const targetId = String(target.id);
          const bounds = target.shape?.boundingRectangle;
          if (!bounds) return;
          const region = dropRegion(bounds.top, bounds.height, pointerY);
          if (region.kind === 'edge') {
            activateEdge(targetId, region.intent);
          } else {
            activateMiddle(
              targetId,
              region.fallback,
              bounds.top,
              bounds.height,
            );
          }
        }}
        onDragEnd={({ canceled }) => {
          const documentId = activeIdRef.current;
          const destination = previewRef.current?.destination;
          if (canceled || !documentId || !destination) {
            resetDrag();
            return;
          }
          const result = moveTreeNode(documentsRef.current, {
            documentId,
            destination,
          });
          if (!result?.changed) {
            resetDrag();
            return;
          }
          const keepExpandedIds = new Set<string>();
          if (previewRef.current?.intent === 'inside') {
            keepExpandedIds.add(previewRef.current.targetId);
          }
          for (const expandedId of temporarilyExpandedIds) {
            if (
              destination.parentId === expandedId ||
              (destination.parentId !== null &&
                descendantIds(documentsRef.current, expandedId).has(
                  destination.parentId,
                ))
            ) {
              keepExpandedIds.add(expandedId);
            }
          }
          clearTimers();
          setPersisting(true);
          void onMove(documentId, destination)
            .then(() => {
              for (const expandedId of keepExpandedIds) {
                onKeepExpanded(expandedId);
              }
            })
            .catch(() => undefined)
            .finally(resetDrag);
        }}
      >
        {children({
          sections: renderedSections,
          collapsedIds: effectiveCollapsedIds,
        })}
        <DragOverlay
          className="document-drag-overlay-container"
          dropAnimation={{ duration: 140, easing: 'ease-out' }}
        >
          {activeDocument ? (
            <div className="document-drag-overlay">
              <GripVertical aria-hidden="true" size={14} />
              <FileText aria-hidden="true" size={14} />
              <span>{activeDocument.title}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DragDropProvider>
    </DocumentTreeDndContext.Provider>
  );
}
