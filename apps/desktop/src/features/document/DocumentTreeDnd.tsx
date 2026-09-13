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
  sameDestination,
  visibleSections,
  type DocumentSection,
  type DropRegion,
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
  insideActivated: boolean;
}

interface DragTarget {
  id: string | number;
  shape?: {
    boundingRectangle: {
      top: number;
      height: number;
    };
  };
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
  const hoverRegion = useRef<{
    targetId: string;
    region: DropRegion;
  } | null>(null);
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
    hoverRegion.current = null;
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

  function activateMiddle(targetId: string) {
    const current = middleHover.current;
    if (current?.targetId === targetId) return;
    clearTimers();
    retainTemporaryExpansions(targetId);
    const documentId = activeIdRef.current;
    if (!documentId) return updatePreview(null);

    const insideDestination = destinationForRow(
      documentsRef.current,
      documentId,
      targetId,
      'inside',
    );
    if (!insideDestination) {
      middleHover.current = null;
      return updatePreview(null);
    }
    middleHover.current = {
      targetId,
      insideActivated: false,
    };
    updatePreview({ targetId, intent: 'inside-pending', destination: null });

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

  function clearHover(restoreTemporaryExpansions: boolean) {
    clearTimers();
    middleHover.current = null;
    hoverRegion.current = null;
    updatePreview(null);
    if (restoreTemporaryExpansions) retainTemporaryExpansions(null);
  }

  function resolveHover(
    target: DragTarget | null | undefined,
    pointerY: number,
    useHysteresis: boolean,
    restoreTemporaryExpansionsOnClear: boolean,
  ) {
    const bounds = target?.shape?.boundingRectangle;
    if (
      !target ||
      !bounds ||
      pointerY < bounds.top ||
      pointerY > bounds.top + bounds.height
    ) {
      clearHover(restoreTemporaryExpansionsOnClear);
      return;
    }
    const targetId = String(target.id);
    const previousRegion =
      useHysteresis && hoverRegion.current?.targetId === targetId
        ? hoverRegion.current.region
        : undefined;
    const region = dropRegion(
      bounds.top,
      bounds.height,
      pointerY,
      previousRegion,
    );
    hoverRegion.current = { targetId, region };
    if (region.kind === 'edge') {
      activateEdge(targetId, region.intent);
    } else {
      activateMiddle(targetId);
    }
  }

  const effectiveCollapsedIds = useMemo(() => {
    const next = new Set(collapsedIds);
    for (const documentId of temporarilyExpandedIds) next.delete(documentId);
    return next;
  }, [collapsedIds, temporarilyExpandedIds]);
  const renderedSections = useMemo(
    () => visibleSections(sections, effectiveCollapsedIds),
    [effectiveCollapsedIds, sections],
  );
  const activeDocument = activeId
    ? (documents.find(({ id }) => id === activeId) ?? null)
    : null;
  const announcement = dragAnnouncement(activeDocument, preview, documents);
  const context = useMemo(
    () => ({
      activeId,
      busyIds,
      preview,
      persisting,
    }),
    [activeId, busyIds, persisting, preview],
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
          middleHover.current = null;
          hoverRegion.current = null;
          updatePreview(null);
          setTemporarilyExpandedIds(new Set());
          activeIdRef.current = documentId;
          setActiveId(documentId);
        }}
        onDragMove={({ operation, to, by, nativeEvent }) => {
          if (persisting) return;
          const pointerY = to?.y ?? operation.position.current.y + (by?.y ?? 0);
          resolveHover(
            operation.target,
            pointerY,
            !(
              typeof KeyboardEvent !== 'undefined' &&
              nativeEvent instanceof KeyboardEvent
            ),
            false,
          );
        }}
        onDragOver={({ operation }) => {
          if (persisting) return;
          resolveHover(
            operation.target,
            operation.position.current.y,
            false,
            true,
          );
        }}
        onDragEnd={({ canceled, operation }) => {
          const documentId = activeIdRef.current;
          const currentPreview = previewRef.current;
          const finalTargetId = operation.target
            ? String(operation.target.id)
            : null;
          if (
            canceled ||
            !documentId ||
            !currentPreview?.destination ||
            currentPreview.targetId !== finalTargetId ||
            currentPreview.intent === 'inside-pending'
          ) {
            resetDrag();
            return;
          }
          const destination = destinationForRow(
            documentsRef.current,
            documentId,
            currentPreview.targetId,
            currentPreview.intent,
          );
          if (!destination) {
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
        <span
          className="sr-only document-tree-dnd-announcement"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {announcement}
        </span>
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

function dragAnnouncement(
  activeDocument: WorkspaceDocument | null,
  preview: DocumentTreeDragPreview | null,
  documents: WorkspaceDocument[],
) {
  if (!activeDocument) return '';
  if (!preview) return `Moving ${activeDocument.title}.`;
  const target = documents.find(({ id }) => id === preview.targetId);
  if (!target) return `Moving ${activeDocument.title}.`;
  if (preview.intent === 'inside-pending') {
    return `Hold to move ${activeDocument.title} inside ${target.title}.`;
  }
  return `Move ${activeDocument.title} ${preview.intent} ${target.title}.`;
}
