import { useCallback, useRef, useState } from 'react';
import type { TaskPatch } from '../workspace/types';
import type { PropertyKey } from './taskPropertyModel';

export interface TaskPropertyEditing {
  savingProperties: ReadonlySet<PropertyKey>;
  failedProperties: ReadonlySet<PropertyKey>;
  error: { key: PropertyKey; message: string } | null;
  disabled: (key: PropertyKey) => boolean;
  patchProperty: (
    key: PropertyKey,
    patch: TaskPatch,
    rethrow?: boolean,
  ) => Promise<boolean>;
}

export function useTaskPropertyEditing(
  canEdit: boolean,
  onPatch: (patch: TaskPatch) => Promise<void>,
): TaskPropertyEditing {
  const [savingProperties, setSavingProperties] = useState<Set<PropertyKey>>(
    () => new Set(),
  );
  const [failedProperties, setFailedProperties] = useState<Set<PropertyKey>>(
    () => new Set(),
  );
  const [error, setError] = useState<{
    key: PropertyKey;
    message: string;
  } | null>(null);
  const savingRef = useRef<Set<PropertyKey>>(new Set());

  const patchProperty = useCallback(
    async (key: PropertyKey, patch: TaskPatch, rethrow = false) => {
      setError(null);
      setFailedProperties((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      savingRef.current.add(key);
      setSavingProperties(new Set(savingRef.current));
      try {
        await onPatch(patch);
        return true;
      } catch (caught) {
        setFailedProperties((current) => new Set(current).add(key));
        setError({ key, message: errorMessage(caught) });
        if (rethrow) throw caught;
        return false;
      } finally {
        savingRef.current.delete(key);
        setSavingProperties(new Set(savingRef.current));
      }
    },
    [onPatch],
  );

  const disabled = useCallback(
    (key: PropertyKey) => !canEdit || savingProperties.has(key),
    [canEdit, savingProperties],
  );

  return {
    savingProperties,
    failedProperties,
    error,
    disabled,
    patchProperty,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Task update failed';
}
