import { useEffect, useRef, type ReactNode } from 'react';

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
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="settings-window">{children}</div>
    </dialog>
  );
}
