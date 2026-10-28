import { createContext } from 'react';
import type { RowDropVisualIntent, TreeDestination } from './tree';

export interface DocumentTreeDragPreview {
  targetId: string;
  intent: RowDropVisualIntent;
  destination: TreeDestination | null;
}

export interface DocumentTreeDndContextValue {
  activeId: string | null;
  busyIds: ReadonlySet<string>;
  preview: DocumentTreeDragPreview | null;
  persisting: boolean;
}

export const DocumentTreeDndContext =
  createContext<DocumentTreeDndContextValue | null>(null);
