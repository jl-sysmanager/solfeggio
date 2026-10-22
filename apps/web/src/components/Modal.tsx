import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Diálogo modal accesible: foco atrapado, Escape para cerrar, devuelve el foco al cerrar. */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [],
      );
    (focusables()[1] ?? focusables()[0] ?? node)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab') {
        const els = focusables();
        if (els.length === 0) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    // Clic en el fondo = atajo de ratón; el teclado cierra con Escape (gestionado arriba).
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="modal__header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        {children}
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Diálogo de confirmación para acciones irreversibles. */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  onConfirm,
  onClose,
  loading,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" onClick={onConfirm} disabled={loading}>
            {loading ? 'Procesando…' : confirmLabel}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}
