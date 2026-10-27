import { createContext, useContext } from 'react';

export type DocumentSave = () => Promise<void>;

export interface DocumentSaveCoordinatorValue {
  registerDocumentSave: (save: DocumentSave) => () => void;
  flushDocumentSaves: () => Promise<void>;
}

// Thrown by an open document whose draft could not be persisted. The
// coordinator turns it into a decision instead of a silent navigation block.
export class UnsavedDocumentError extends Error {
  constructor(
    readonly reason: 'conflict' | 'error',
    readonly detail: string,
    readonly draft: string,
    readonly retry: () => Promise<boolean>,
    readonly discard: () => Promise<void>,
  ) {
    super('Resolve unsaved Markdown before leaving this document');
    this.name = 'UnsavedDocumentError';
  }
}

// The person chose to stay on the document. The empty message keeps callers
// that report `error.message` from showing a redundant failure toast.
export class DocumentTransitionCancelledError extends Error {
  constructor() {
    super('');
    this.name = 'DocumentTransitionCancelledError';
  }
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
