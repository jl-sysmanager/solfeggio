import { useState } from 'react';
import type { PaymentMethod } from '../../api/types-school';
import { money, today } from '../../lib/format';
import { paymentMethod } from '../../lib/labels-school';
import { Button } from '../Button';
import { FormError, SelectField, TextField } from '../Field';
import { Modal } from '../Modal';

const LAST_METHOD = 'solfeamos.school.payMethod';

function lastMethod(): PaymentMethod {
  try {
    return (localStorage.getItem(LAST_METHOD) as PaymentMethod | null) ?? 'CASH';
  } catch {
    return 'CASH';
  }
}

/** Registrar uno o varios cobros: fecha y forma de pago (recuerda la última usada en este navegador). */
export function PayModal({
  open,
  title,
  summary,
  amountCents,
  loading,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  summary: string;
  amountCents: number;
  loading?: boolean;
  error?: unknown;
  onConfirm: (v: { date: string; method: PaymentMethod }) => void;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>(lastMethod);
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const d = (e.currentTarget.elements.namedItem('date') as HTMLInputElement).value;
          try {
            localStorage.setItem(LAST_METHOD, method);
          } catch {
            // Sin almacenamiento local: se vuelve a proponer efectivo.
          }
          onConfirm({ date: d, method });
        }}
      >
        <p>
          {summary} <strong>{money(amountCents)}</strong>
        </p>
        <div className="form-row">
          <TextField label="Fecha de cobro" name="date" type="date" required defaultValue={today()} max={today()} />
          <SelectField label="Forma de pago" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} options={Object.entries(paymentMethod).map(([value, label]) => ({ value, label }))} />
        </div>
        <p className="small muted">Se registra el ingreso en tesorería, en la categoría «Escuela de música».</p>
        <FormError error={error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading}>
            Registrar cobro
          </Button>
        </div>
      </form>
    </Modal>
  );
}
