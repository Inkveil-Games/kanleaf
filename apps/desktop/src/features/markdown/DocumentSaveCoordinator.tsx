import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import {
  DocumentSaveContext,
  type DocumentSave,
} from './documentSaveCoordinatorContext';

export function DocumentSaveCoordinator({ children }: { children: ReactNode }) {
  const saves = useRef(new Set<DocumentSave>());
  const registerDocumentSave = useCallback((save: DocumentSave) => {
    saves.current.add(save);
    return () => saves.current.delete(save);
  }, []);
  const flushDocumentSaves = useCallback(async () => {
    await Promise.all([...saves.current].map((save) => save()));
  }, []);
  const value = useMemo(
    () => ({ registerDocumentSave, flushDocumentSaves }),
    [flushDocumentSaves, registerDocumentSave],
  );

  return (
    <DocumentSaveContext.Provider value={value}>
      {children}
    </DocumentSaveContext.Provider>
  );
}
