import { X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** `drawer` slides in from the right and is meant for detail views. */
  variant?: 'modal' | 'drawer';
  size?: 'sm' | 'md' | 'lg';
  /** Render the body inside a <form> so Enter submits and the footer can hold a submit button. */
  onSubmit?: () => void;
}

/** Accessible modal built on the native <dialog> element (focus trap, Esc, inert background). */
export function Dialog({ title, onClose, children, footer, variant = 'modal', size = 'md', onSubmit }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  const body = (
    <>
      <header className="dialog-header">
        <h2>{title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </header>
      <div className="dialog-body">{children}</div>
      {footer && <footer className="dialog-footer">{footer}</footer>}
    </>
  );

  return (
    <dialog
      ref={ref}
      className={`dialog dialog-${variant} dialog-${size}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        // Clicking the backdrop (the dialog element itself) dismisses it.
        if (event.target === ref.current) onClose();
      }}
    >
      {onSubmit ? (
        <form
          method="dialog"
          className="dialog-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {body}
        </form>
      ) : (
        <div className="dialog-form">{body}</div>
      )}
    </dialog>
  );
}

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  /** Require the user to type this text before the confirm button enables. */
  requireText?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy,
  danger,
  requireText,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const allowed = !requireText || typed === requireText;

  return (
    <Dialog
      title={title}
      size="sm"
      onClose={onClose}
      onSubmit={() => allowed && !busy && onConfirm()}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={!allowed || busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="stack">
        {children}
        {requireText && (
          <label className="field">
            <span>
              Type <strong>{requireText}</strong> to confirm
            </span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" />
          </label>
        )}
      </div>
    </Dialog>
  );
}
