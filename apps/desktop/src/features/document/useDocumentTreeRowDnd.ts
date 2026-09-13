import { useDraggable, useDroppable } from '@dnd-kit/react';
import { useCallback, useContext } from 'react';
import { DocumentTreeDndContext } from './documentTreeDndContext';
import type { WorkspaceDocument } from './types';

export function useDocumentTreeRowDnd(document: WorkspaceDocument) {
  const context = useContext(DocumentTreeDndContext);
  if (!context) {
    throw new Error(
      'Document tree rows must be rendered inside DocumentTreeDnd',
    );
  }
  const disabled =
    !document.can_edit || context.persisting || context.busyIds.size > 0;
  const { ref: draggableRef, handleRef } = useDraggable({
    id: document.id,
    type: 'library-document',
    data: { documentId: document.id },
    disabled,
  });
  const { ref: droppableRef } = useDroppable({
    id: document.id,
    type: 'library-document-row',
    accept: 'library-document',
    disabled: context.persisting || context.busyIds.size > 0,
  });
  const ref = useCallback(
    (element: Element | null) => {
      draggableRef(element);
      droppableRef(element);
    },
    [draggableRef, droppableRef],
  );
  const preview =
    context.preview?.targetId === document.id ? context.preview : null;
  return {
    ref,
    handleRef,
    disabled,
    isDragging: context.activeId === document.id,
    dropIntent: preview?.intent ?? null,
    hadChildren: context.originalParentIds.has(document.id),
  };
}
