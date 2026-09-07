import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Dialog } from '@base-ui/react/dialog';
import { CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import './AppDialog.css';

export type AppDialogType = 'alert' | 'confirm' | 'typed-confirm' | 'custom';

export type AppDialogVariant =
  'default' | 'info' | 'success' | 'warning' | 'danger';

export type AppDialogSize = 'sm' | 'md' | 'lg';

type AppDialogConfirmHandler = () => boolean | void | Promise<boolean | void>;

interface AppDialogBaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: AppDialogVariant;
  size?: AppDialogSize;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  loading?: boolean;
  error?: ReactNode;
}

interface AppDialogActionLabels {
  confirmLabel?: string;
  cancelLabel?: string;
  loadingLabel?: string;
  confirmDisabled?: boolean;
  onCancel?: () => void;
}

type AppDialogAction =
  | {
      // Returning false keeps the dialog open without presenting an error.
      onConfirm: AppDialogConfirmHandler;
      formId?: never;
    }
  | {
      formId: string;
      onConfirm?: never;
    };

interface AppDialogAlertProps extends AppDialogBaseProps {
  type: 'alert';
  closeLabel?: string;
  onCancel?: () => void;
  confirmLabel?: never;
  cancelLabel?: never;
  loadingLabel?: never;
  confirmDisabled?: never;
  onConfirm?: never;
  formId?: never;
  confirmationText?: never;
  confirmationLabel?: never;
  confirmationPlaceholder?: never;
  confirmationCaseSensitive?: never;
}

type AppDialogConfirmProps = AppDialogBaseProps &
  AppDialogActionLabels &
  AppDialogAction & {
    type: 'confirm' | 'custom';
    closeLabel?: never;
    confirmationText?: never;
    confirmationLabel?: never;
    confirmationPlaceholder?: never;
    confirmationCaseSensitive?: never;
  };

type AppDialogTypedConfirmProps = AppDialogBaseProps &
  AppDialogActionLabels &
  AppDialogAction & {
    type: 'typed-confirm';
    closeLabel?: never;
    confirmationText: string;
    confirmationLabel?: ReactNode;
    confirmationPlaceholder?: string;
    confirmationCaseSensitive?: boolean;
  };

export type AppDialogProps =
  AppDialogAlertProps | AppDialogConfirmProps | AppDialogTypedConfirmProps;

interface AppDialogPanelProps {
  props: AppDialogProps;
  busy: boolean;
  error: ReactNode;
  confirmation: string;
  confirmationInputRef: RefObject<HTMLInputElement | null>;
  cancelAction: ReactNode;
  alertAction: ReactNode;
  onConfirmationChange: (value: string) => void;
  onConfirm: () => void;
}

export function AppDialog(props: AppDialogProps) {
  const {
    open,
    onOpenChange,
    type,
    variant = 'default',
    size = 'sm',
    loading = false,
  } = props;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const alertCloseRef = useRef<HTMLButtonElement>(null);
  const confirmationInputRef = useRef<HTMLInputElement>(null);
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [internalError, setInternalError] = useState<ReactNode>(null);
  const [previousOpen, setPreviousOpen] = useState(open);

  if (open !== previousOpen) {
    setPreviousOpen(open);
    setConfirmation('');
    setInternalError(null);
  }

  const busy = loading || pending;
  const displayedError = props.error ?? internalError;

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && busy) return;
    if (!nextOpen) props.onCancel?.();
    onOpenChange(nextOpen);
  }

  async function confirm() {
    if (type === 'alert' || props.formId || !props.onConfirm || busy) return;
    setPending(true);
    setInternalError(null);
    try {
      const shouldClose = (await props.onConfirm()) !== false;
      if (shouldClose) onOpenChange(false);
    } catch (caught) {
      setInternalError(
        caught instanceof Error ? caught.message : 'Request failed',
      );
    } finally {
      setPending(false);
    }
  }

  const panelProps: Omit<AppDialogPanelProps, 'cancelAction' | 'alertAction'> =
    {
      props,
      busy,
      error: displayedError,
      confirmation,
      confirmationInputRef,
      onConfirmationChange: setConfirmation,
      onConfirm: () => void confirm(),
    };
  const popupClassName = `app-dialog-popup app-dialog-${size}`;
  const initialFocus =
    type === 'typed-confirm'
      ? confirmationInputRef
      : type === 'alert'
        ? alertCloseRef
        : cancelRef;

  if (type === 'custom') {
    return (
      <Dialog.Root open={open} onOpenChange={handleOpenChange}>
        <Dialog.Portal>
          <Dialog.Backdrop className="app-dialog-backdrop" />
          <Dialog.Viewport className="app-dialog-viewport">
            <Dialog.Popup
              className={popupClassName}
              data-variant={variant}
              aria-busy={busy || undefined}
              initialFocus={initialFocus}
            >
              <AppDialogPanel
                {...panelProps}
                cancelAction={
                  <Dialog.Close
                    ref={cancelRef}
                    className="secondary-button"
                    disabled={busy}
                  >
                    {props.cancelLabel ?? 'Cancel'}
                  </Dialog.Close>
                }
                alertAction={null}
              />
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={handleOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="app-dialog-backdrop" />
        <AlertDialog.Viewport className="app-dialog-viewport">
          <AlertDialog.Popup
            className={popupClassName}
            data-variant={variant}
            aria-busy={busy || undefined}
            initialFocus={initialFocus}
          >
            <AppDialogPanel
              {...panelProps}
              cancelAction={
                type === 'alert' ? null : (
                  <AlertDialog.Close
                    ref={cancelRef}
                    className="secondary-button"
                    disabled={busy}
                  >
                    {props.cancelLabel ?? 'Cancel'}
                  </AlertDialog.Close>
                )
              }
              alertAction={
                type === 'alert' ? (
                  <AlertDialog.Close
                    ref={alertCloseRef}
                    className="primary-button"
                    disabled={busy}
                  >
                    {props.closeLabel ?? 'Close'}
                  </AlertDialog.Close>
                ) : null
              }
            />
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function AppDialogPanel({
  props,
  busy,
  error,
  confirmation,
  confirmationInputRef,
  cancelAction,
  alertAction,
  onConfirmationChange,
  onConfirm,
}: AppDialogPanelProps) {
  const { type, variant = 'default' } = props;
  const icon = props.icon === undefined ? defaultIcon(variant) : props.icon;
  const typedConfirmationValid =
    type !== 'typed-confirm' ||
    ((props.confirmationCaseSensitive ?? true)
      ? confirmation === props.confirmationText
      : confirmation.toLocaleLowerCase() ===
        props.confirmationText.toLocaleLowerCase());
  const hasActions = type === 'alert' || 'onConfirm' in props || props.formId;

  return (
    <>
      <header className="app-dialog-header">
        {icon ? (
          <span className="app-dialog-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <div className="app-dialog-heading">
          {type === 'custom' ? (
            <Dialog.Title className="app-dialog-title">
              {props.title}
            </Dialog.Title>
          ) : (
            <AlertDialog.Title className="app-dialog-title">
              {props.title}
            </AlertDialog.Title>
          )}
          {props.description ? (
            type === 'custom' ? (
              <Dialog.Description className="app-dialog-description">
                {props.description}
              </Dialog.Description>
            ) : (
              <AlertDialog.Description className="app-dialog-description">
                {props.description}
              </AlertDialog.Description>
            )
          ) : null}
        </div>
      </header>
      {type === 'typed-confirm' || props.children || error ? (
        <div className="app-dialog-body">
          {type === 'typed-confirm' ? (
            <label className="app-dialog-confirmation-field">
              <span>
                {props.confirmationLabel ?? (
                  <>
                    Type <strong>{props.confirmationText}</strong> to confirm
                  </>
                )}
              </span>
              <input
                ref={confirmationInputRef}
                value={confirmation}
                placeholder={props.confirmationPlaceholder}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => onConfirmationChange(event.target.value)}
              />
            </label>
          ) : null}
          {props.children}
          {error ? (
            <p className="app-dialog-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      {hasActions ? (
        <footer className="app-dialog-footer">
          {alertAction ?? (
            <>
              {cancelAction}
              {type !== 'alert' ? (
                <button
                  className={
                    variant === 'danger' ? 'danger-button' : 'primary-button'
                  }
                  type={props.formId ? 'submit' : 'button'}
                  form={props.formId}
                  disabled={
                    busy || props.confirmDisabled || !typedConfirmationValid
                  }
                  onClick={props.formId ? undefined : onConfirm}
                >
                  {busy
                    ? (props.loadingLabel ?? 'Working…')
                    : (props.confirmLabel ?? 'Confirm')}
                </button>
              ) : null}
            </>
          )}
        </footer>
      ) : null}
    </>
  );
}

function defaultIcon(variant: AppDialogVariant) {
  if (variant === 'info') return <Info size={18} />;
  if (variant === 'success') return <CircleCheck size={18} />;
  if (variant === 'warning' || variant === 'danger') {
    return <TriangleAlert size={18} />;
  }
  return null;
}
