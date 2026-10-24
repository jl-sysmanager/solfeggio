import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SetupGuide as Guide } from '../api/types';
import { Button } from './Button';
import { Checkbox } from './Field';
import { Icon } from './Icon';
import { Modal } from './Modal';

export function pendingSteps(guide: Guide | undefined) {
  return guide?.steps.filter((s) => !s.done) ?? [];
}

export function setupPendingCopy(pending: number, total: number) {
  if (pending === 1) return `Queda 1 de ${total} pasos para dejar la banda lista.`;
  return `Quedan ${pending} de ${total} pasos para dejar la banda lista.`;
}

export function SetupGuideModal({
  guide,
  open,
  onClose,
  onDismiss,
}: {
  guide: Guide;
  open: boolean;
  onClose: () => void;
  onDismiss: (dismissed: boolean) => void;
}) {
  const done = guide.steps.filter((s) => s.done).length;
  const [hide, setHide] = useState(guide.dismissed);
  useEffect(() => setHide(guide.dismissed), [guide.dismissed]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pon la banda en marcha"
      footer={
        <>
          <Checkbox
            label="No volver a mostrar al entrar"
            checked={hide}
            onChange={(e) => {
              setHide(e.target.checked);
              onDismiss(e.target.checked);
            }}
          />
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        </>
      }
    >
      <p className="small">Completa estos pasos. El avance se actualiza cuando la banda ya los tiene hechos.</p>
      <p className="setup-progress" aria-label={`${done} de ${guide.steps.length} completados`}>
        <span style={{ width: `${guide.steps.length ? (done / guide.steps.length) * 100 : 0}%` }} />
      </p>
      <ol className="setup-steps">
        {guide.steps.map((step, i) => (
          <li key={step.id} className={step.done ? 'setup-step setup-step--done' : 'setup-step'}>
            <span className="setup-step__mark" aria-hidden="true">
              {step.done ? <Icon name="check" size={14} /> : i + 1}
            </span>
            <div>
              <p className="setup-step__title">{step.title}</p>
              <p className="small muted">{step.detail}</p>
            </div>
            {step.done ? (
              <span className="small muted">Hecho</span>
            ) : (
              <Link to={step.to} onClick={onClose}>
                Ir
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Modal>
  );
}
