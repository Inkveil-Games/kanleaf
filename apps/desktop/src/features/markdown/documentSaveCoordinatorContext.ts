import { createContext, useContext } from 'react';

export type DocumentSave = () => Promise<void>;

export interface DocumentSaveCoordinatorValue {
  registerDocumentSave: (save: DocumentSave) => () => void;
  flushDocumentSaves: () => Promise<void>;
}

export const DocumentSaveContext =
  createContext<DocumentSaveCoordinatorValue | null>(null);

export function useDocumentSaveCoordinator() {
  const coordinator = useContext(DocumentSaveContext);
  if (!coordinator) {
    throw new Error('DocumentSaveCoordinator is required');
  }
  return coordinator;
}
