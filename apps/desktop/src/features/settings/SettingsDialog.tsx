import { Dialog } from '@base-ui/react/dialog';
import type { ReactNode } from 'react';

interface SettingsDialogProps {
  label: string;
  children: ReactNode;
  onClose: () => void;
}

export function SettingsDialog({
  label,
  children,
  onClose,
}: SettingsDialogProps) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="settings-dialog-backdrop" />
        <Dialog.Viewport className="settings-dialog-viewport">
          <Dialog.Popup
            className="settings-dialog-popup"
            data-ui-portal-container
          >
            <Dialog.Title className="sr-only">{label}</Dialog.Title>
            <div className="settings-window">{children}</div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
