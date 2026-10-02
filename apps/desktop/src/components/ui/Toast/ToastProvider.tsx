import { Toast as BaseToast } from '@base-ui/react/toast';
import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../Button';
import { IconButton } from '../IconButton';
import type { ToastData } from './useToast';
import './Toast.css';

const icons = {
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  danger: CircleX,
};

export function ToastProvider({ children }: { children?: ReactNode }) {
  return (
    <BaseToast.Provider limit={3}>
      {children}
      <BaseToast.Portal>
        <ToastViewport />
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

function ToastViewport() {
  const { toasts } = BaseToast.useToastManager<ToastData>();
  return (
    <BaseToast.Viewport
      className="ui-toast-viewport ui-native-scrollbar"
      aria-label="Status messages"
    >
      {toasts.map((toast) => {
        const variant = toast.data?.variant ?? 'info';
        const Icon = icons[variant];
        return (
          <BaseToast.Root
            key={toast.id}
            toast={toast}
            className="ui-toast"
            data-variant={variant}
          >
            <BaseToast.Content className="ui-toast-content">
              <Icon className="ui-toast-icon" size={18} aria-hidden="true" />
              <div className="ui-toast-copy">
                <BaseToast.Title className="ui-toast-title" />
                <BaseToast.Description className="ui-toast-description" />
                {toast.actionProps && (
                  <BaseToast.Action
                    render={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ui-toast-action"
                      />
                    }
                  />
                )}
              </div>
              <BaseToast.Close
                render={
                  <IconButton
                    variant="ghost"
                    size="sm"
                    aria-label="Dismiss notification"
                  />
                }
              >
                <X size={14} aria-hidden="true" />
              </BaseToast.Close>
            </BaseToast.Content>
          </BaseToast.Root>
        );
      })}
    </BaseToast.Viewport>
  );
}
