import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { IconButton } from '../../components/ui/IconButton';
import type { AuthResponse } from '../../lib/api/types';
import { AuthForm } from './AuthForm';

interface AddAccountDialogProps {
  serverUrl: string;
  onAuthenticated: (response: AuthResponse) => void | Promise<void>;
  onClose: () => void;
}

export function AddAccountDialog({
  serverUrl,
  onAuthenticated,
  onClose,
}: AddAccountDialogProps) {
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
      className="add-account-dialog"
      aria-label="Add another account"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="add-account-window">
        <header>
          <div>
            <strong>Add another account</strong>
            <span>Sessions stay separate on this Kanleaf server.</span>
          </div>
          <IconButton
            variant="ghost"
            size="sm"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            <X aria-hidden="true" size={16} />
          </IconButton>
        </header>
        <AuthForm serverUrl={serverUrl} onAuthenticated={onAuthenticated} />
      </div>
    </dialog>
  );
}
