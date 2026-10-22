import { useRef } from 'react';
import { useApi } from '../../api/hooks';
import type { Quote } from '../../api/types-performances';
import { useAuth } from '../../auth/AuthProvider';
import { date, dateTime, money } from '../../lib/format';
import { clientKind } from '../../lib/labels-performances';
import { Button } from '../Button';
import { ErrorNote, Loading } from '../EmptyState';
import { Modal } from '../Modal';
import { lineCents } from './totals';

const PRINT_CSS = `
  body { font: 12pt/1.5 Georgia, 'Times New Roman', serif; color: #111; margin: 2cm; }
  h1 { font-size: 18pt; margin: 0 0 4pt; } h2 { font-size: 13pt; margin: 18pt 0 6pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 8pt; }
  th, td { border-bottom: 1px solid #999; padding: 4pt 6pt; text-align: left; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; } .muted { color: #555; } .terms { white-space: pre-wrap; }
  .parties { display: flex; gap: 24pt; } .parties > div { flex: 1; }
  .sign { display: flex; gap: 24pt; margin-top: 48pt; } .sign > div { flex: 1; border-top: 1px solid #111; padding-top: 4pt; }
`;

/** Documento de contrato (presupuesto aceptado) apto para imprimir o guardar como PDF. */
export function ContractDocument({ quote, bandName }: { quote: Quote; bandName: string }) {
  const c = quote.client;
  return (
    <article>
      <h1>{quote.status === 'ACCEPTED' ? 'Contrato de actuación' : 'Presupuesto de actuación'} nº {quote.number}</h1>
      <p className="muted">
        {quote.title}
        {quote.performanceAt ? ` · ${dateTime(quote.performanceAt)}` : ''}
        {quote.location ? ` · ${quote.location}` : ''}
      </p>
      <h2>Partes</h2>
      <div className="parties">
        <div>
          <strong>La banda</strong>
          <br />
          {bandName}
        </div>
        <div>
          <strong>El contratante</strong>
          <br />
          {c?.name}
          {c?.kind ? ` (${clientKind[c.kind] ?? c.kind})` : ''}
          {c?.taxId && (
            <>
              <br />
              NIF: {c.taxId}
            </>
          )}
          {c?.address && (
            <>
              <br />
              {c.address}
            </>
          )}
          {c?.contactName && (
            <>
              <br />
              Contacto: {c.contactName}
            </>
          )}
        </div>
      </div>
      <h2>Servicios e importe</h2>
      <table>
        <thead>
          <tr>
            <th>Concepto</th>
            <th className="num">Cantidad</th>
            <th className="num">Precio</th>
            <th className="num">Importe</th>
          </tr>
        </thead>
        <tbody>
          {quote.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.description}</td>
              <td className="num">{String(l.quantity).replace('.', ',')}</td>
              <td className="num">{money(l.unitCents)}</td>
              <td className="num">{money(lineCents(l))}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={3} className="num">Base imponible</td>
            <td className="num">{money(quote.baseCents)}</td>
          </tr>
          <tr>
            <td colSpan={3} className="num">Impuesto ({quote.taxRatePct} %)</td>
            <td className="num">{money(quote.taxCents)}</td>
          </tr>
          <tr>
            <td colSpan={3} className="num">
              <strong>Total</strong>
            </td>
            <td className="num">
              <strong>{money(quote.totalCents)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
      {quote.validUntil && quote.status !== 'ACCEPTED' && <p className="muted">Presupuesto válido hasta el {date(quote.validUntil)}.</p>}
      {quote.contractTerms && (
        <>
          <h2>Condiciones</h2>
          <p className="terms">{quote.contractTerms}</p>
        </>
      )}
      {quote.signedAt ? (
        <p>
          Aceptado y firmado por <strong>{quote.signedBy}</strong> el {dateTime(quote.signedAt)}.
        </p>
      ) : (
        <div className="sign">
          <div>Por la banda</div>
          <div>Por el contratante</div>
        </div>
      )}
    </article>
  );
}

export function ContractModal({ quoteId, onClose }: { quoteId: string | null; onClose: () => void }) {
  const { session } = useAuth();
  const q = useApi<Quote>(quoteId ? `/performances/quotes/${quoteId}` : null);
  const quote = quoteId ? (q.data ?? null) : null;
  const ref = useRef<HTMLDivElement>(null);
  const bandName = session?.tenant?.name ?? 'La banda';

  function print() {
    // Ventana aparte con estilos de impresión propios: la interfaz de la aplicación no se imprime.
    const w = window.open('', '_blank', 'noopener=no,width=900,height=1000');
    if (!w || !ref.current) return;
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Contrato ${quote?.number ?? ''}</title><style>${PRINT_CSS}</style></head><body>${ref.current.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <Modal
      open={!!quoteId}
      onClose={onClose}
      title={quote?.status === 'ACCEPTED' ? 'Contrato' : 'Presupuesto'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          <Button onClick={print} disabled={!quote}>Imprimir o guardar PDF</Button>
        </>
      }
    >
      {q.isLoading && <Loading rows={6} />}
      {q.error && <ErrorNote error={q.error} />}
      <div ref={ref}>{quote && <ContractDocument quote={quote} bandName={bandName} />}</div>
    </Modal>
  );
}
