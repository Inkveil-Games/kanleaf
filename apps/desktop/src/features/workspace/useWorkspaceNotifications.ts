import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useToast, type ToastOptions } from '../../components/ui/Toast';

export function useWorkspaceNotifications(scopeKey: string) {
  const { show, close } = useToast();
  const scope = useMemo(() => ({ key: scopeKey }), [scopeKey]);
  const activeScope = useRef<typeof scope | null>(null);

  useLayoutEffect(() => {
    activeScope.current = scope;
    close();
    return () => {
      activeScope.current = null;
      close();
    };
  }, [scope, close]);

  const notify = useCallback(
    (options: ToastOptions) => {
      // An async mutation may finish after its Workspace or account has changed.
      if (activeScope.current === scope) show(options);
    },
    [scope, show],
  );

  const setActionError = useCallback(
    (message: string | null) => {
      if (activeScope.current !== scope) return;
      if (message) {
        show({
          id: 'workspace-action-error',
          title: 'Action failed',
          description: message,
          variant: 'danger',
        });
      } else {
        close('workspace-action-error');
      }
    },
    [scope, show, close],
  );

  return { notify, setActionError };
}
