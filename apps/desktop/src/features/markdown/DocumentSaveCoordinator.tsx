import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import { Button } from '../../components/ui/Button';
import { CopyButton } from '../../components/ui/CopyButton';
import {
  DocumentSaveContext,
  DocumentTransitionCancelledError,
  UnsavedDocumentError,
  type DocumentSave,
} from './documentSaveCoordinatorContext';

type Decision = 'resolved' | 'stay';

interface PendingDecision {
  error: UnsavedDocumentError;
  settle: (decision: Decision) => void;
}

export function DocumentSaveCoordinator({ children }: { children: ReactNode }) {
  const saves = useRef(new Set<DocumentSave>());
  const decisionQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const registerDocumentSave = useCallback((save: DocumentSave) => {
    saves.current.add(save);
    return () => saves.current.delete(save);
  }, []);

  const decide = useCallback((error: UnsavedDocumentError) => {
    // One dialog at a time: concurrent transitions wait for the open decision.
    const decision = decisionQueue.current.then(
      () =>
        new Promise<Decision>((resolve) => {
          let settled = false;
          setDiscardError(null);
          setPending({
            error,
            settle: (next) => {
              if (settled) return;
              settled = true;
              setPending(null);
              resolve(next);
            },
          });
        }),
    );
    decisionQueue.current = decision.catch(() => undefined);
    return decision;
  }, []);

  const flushDocumentSaves = useCallback(async () => {
    await Promise.all(
      [...saves.current].map(async (save) => {
        try {
          await save();
        } catch (caught) {
          if (!(caught instanceof UnsavedDocumentError)) throw caught;
          if ((await decide(caught)) === 'stay') {
            throw new DocumentTransitionCancelledError();
          }
        }
      }),
    );
  }, [decide]);

  const value = useMemo(
    () => ({ registerDocumentSave, flushDocumentSaves }),
    [flushDocumentSaves, registerDocumentSave],
  );

  async function discard() {
    if (!pending) return;
    setDiscarding(true);
    setDiscardError(null);
    try {
      await pending.error.discard();
      pending.settle('resolved');
    } catch (caught) {
      setDiscardError(
        caught instanceof Error ? caught.message : 'The note could not reload.',
      );
    } finally {
      setDiscarding(false);
    }
  }

  const error = pending?.error;
  const conflict = error?.reason === 'conflict';

  return (
    <DocumentSaveContext.Provider value={value}>
      {children}
      <AppDialog
        type="confirm"
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) pending?.settle('stay');
        }}
        variant={conflict ? 'danger' : 'warning'}
        title={
          conflict
            ? 'This note changed outside Kanleaf'
            : 'This note has unsaved changes'
        }
        description={
          conflict
            ? 'Leaving now would lose your draft. Copy it first, then discard it to load the newer file.'
            : `Kanleaf couldn't save your latest edits. ${error?.detail ?? ''}`.trim()
        }
        cancelLabel="Stay on note"
        confirmLabel={conflict ? 'Discard my draft' : 'Try saving again'}
        loadingLabel={conflict ? 'Reloading…' : 'Saving…'}
        loading={discarding}
        error={discardError}
        onConfirm={async () => {
          if (!pending) return;
          if (conflict) {
            await discard();
            return false;
          }
          if (!(await pending.error.retry())) {
            throw new Error('The note still could not be saved.');
          }
          pending.settle('resolved');
          return false;
        }}
      >
        {error && (
          <div className="unsaved-document-actions">
            <CopyButton
              text={error.draft}
              label="Copy draft"
              successLabel="Draft copied"
              errorLabel="Could not copy. Stay on the note and copy it from Source."
            />
            {!conflict && (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={discarding}
                onClick={() => void discard()}
              >
                Discard changes
              </Button>
            )}
          </div>
        )}
      </AppDialog>
    </DocumentSaveContext.Provider>
  );
}
