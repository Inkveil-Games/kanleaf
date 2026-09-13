import { createContext } from 'react';
import type { RowDropIntent, TreeDestination } from './tree';

export interface DocumentTreeDragPreview {
  targetId: string;
  intent: RowDropIntent;
  destination: TreeDestination;
}

export interface DocumentTreeDndContextValue {
  activeId: string | null;
  busyIds: ReadonlySet<string>;
  originalParentIds: ReadonlySet<string>;
  preview: DocumentTreeDragPreview | null;
  persisting: boolean;
}

export const DocumentTreeDndContext =
  createContext<DocumentTreeDndContextValue | null>(null);
