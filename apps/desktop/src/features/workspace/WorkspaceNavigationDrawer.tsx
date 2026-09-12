import { Dialog } from '@base-ui/react/dialog';
import type { CSSProperties, ReactNode, RefObject } from 'react';

interface WorkspaceNavigationDrawerProps {
  children: ReactNode;
  navigationWidth: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus?: RefObject<HTMLElement | null>;
}

export function WorkspaceNavigationDrawer({
  children,
  navigationWidth,
  open,
  onOpenChange,
  finalFocus,
}: WorkspaceNavigationDrawerProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) finalFocus?.current?.focus();
      }}
    >
      <Dialog.Portal
        style={
          {
            '--navigation-pane-width': `${navigationWidth}px`,
          } as CSSProperties
        }
      >
        <Dialog.Backdrop className="navigation-drawer-backdrop" />
        <Dialog.Viewport className="navigation-drawer-viewport">
          <Dialog.Popup
            id="workspace-navigation-drawer"
            className="navigation-drawer-popup"
            data-ui-portal-container
            finalFocus={finalFocus}
          >
            <Dialog.Title className="sr-only">
              Workspace navigation
            </Dialog.Title>
            {children}
            <Dialog.Close className="sr-only">
              Dismiss navigation drawer
            </Dialog.Close>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
