import { PointerSensor, useDraggable, useDroppable } from '@dnd-kit/react';
import { useCallback, useContext } from 'react';
import { DocumentTreeDndContext } from './documentTreeDndContext';
import type { WorkspaceDocument } from './types';

// The whole row is the drag source. Pointer drags start after a short move
// or hold, so a plain click still opens the note, and they never start from
// the row's own controls. Rows deliberately have no keyboard drag: Enter and
// Space on a row open the note, and Move to stays the keyboard route.
const ROW_SENSORS = [
  PointerSensor.configure({
    preventActivation: (event) =>
      event.target instanceof Element &&
      Boolean(
        event.target.closest(
          '.document-tree-toggle, .context-menu, input, textarea',
        ),
      ),
  }),
];

export function useDocumentTreeRowDnd(document: WorkspaceDocument) {
  const context = useContext(DocumentTreeDndContext);
  if (!context) {
    throw new Error(
      'Document tree rows must be rendered inside DocumentTreeDnd',
    );
  }
  const busy = context.persisting || context.busyIds.size > 0;
  const disabled = !document.can_edit || busy;
  const { ref: draggableRef } = useDraggable({
    id: document.id,
    type: 'library-document',
    data: { documentId: document.id },
    disabled,
    sensors: ROW_SENSORS,
  });
  const { ref: droppableRef } = useDroppable({
    id: document.id,
    type: 'library-document-row',
    accept: 'library-document',
    disabled: busy,
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
    busy,
    isDragging: context.activeId === document.id,
    dropIntent: preview?.intent ?? null,
  };
}
