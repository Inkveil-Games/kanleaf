import { Toast as BaseToast } from '@base-ui/react/toast';
import { ArrowRight } from 'lucide-react';
import { useCallback, type ReactNode } from 'react';

export type ToastVariant = 'success' | 'info' | 'warning' | 'danger';

export interface ToastOptions {
  id?: string;
  title: string;
  description?: ReactNode;
  variant?: ToastVariant;
  action?: { label: string; onClick: () => void };
}

export interface ToastData {
  variant: ToastVariant;
}

export function useToast() {
  const { add, close } = BaseToast.useToastManager<ToastData>();
  const show = useCallback(
    ({ variant = 'info', action, ...options }: ToastOptions) =>
      add({
        ...options,
        type: variant,
        data: { variant },
        timeout: variant === 'warning' || variant === 'danger' ? 0 : 5000,
        priority: variant === 'danger' ? 'high' : 'low',
        actionProps: action
          ? {
              children: (
                <>
                  {action.label}
                  <ArrowRight size={12} aria-hidden="true" />
                </>
              ),
              onClick: action.onClick,
            }
          : undefined,
      }),
    [add],
  );
  return { show, close };
}
