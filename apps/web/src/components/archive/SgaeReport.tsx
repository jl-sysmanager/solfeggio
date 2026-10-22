import { useState } from 'react';
import { downloadFile, withQuery } from '../../api/client';
import { useApi } from '../../api/hooks';
import type { SgaeReport } from '../../api/types-archive';
import { date } from '../../lib/format';
import { Button } from '../Button';
import { Card } from '../Card';
import { DataTable } from '../DataTable';
import { ErrorNote, Loading } from '../EmptyState';
import { TextField, formValues } from '../Field';
import { useToast } from '../Toasts';

type Row = SgaeReport['events'][number]['works'][number] & { key: string; date: string; event: string; location: string | null };

const yearStart = () => `${new Date().getFullYear()}-01-01`;
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Datos de repertorio interpretado para cumplimentar la declaración a la SGAE. */
export function SgaeReportTab() {
  const toast = useToast();
  const [range, setRange] = useState({ from: yearStart(), to: todayIso() });
  const report = useApi<SgaeReport>('/archive/reports/sgae', range);
  const [downloading, setDownloading] = useState(false);

  const rows: Row[] = (report.data?.events ?? []).flatMap((e) =>
    e.works.map((w, i) => ({ ...w, key: `${e.id}-${i}`, date: e.date, event: e.title, location: e.location })),
  );

  async function csv() {
    setDownloading(true);
    try {
      await downloadFile(withQuery('/archive/reports/sgae', { ...range, format: 'csv' }), `repertorio-sgae-${range.from}-${range.to}.csv`);
    } catch (e) {
      toast.error(e);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="stack">
      <Card>
        <p className="small muted">
          Listado de las obras interpretadas en actuaciones (no se incluyen ensayos ni actos cancelados) con los datos que pide la declaración de repertorio de la SGAE.
          Es una ayuda para rellenarla: no se envía nada a la SGAE.
        </p>
        <form
          className="toolbar"
          aria-label="Periodo del informe"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (v.from && v.to) setRange({ from: v.from, to: v.to });
          }}
        >
          <TextField label="Desde" name="from" type="date" required defaultValue={range.from} />
          <TextField label="Hasta" name="to" type="date" required defaultValue={range.to} />
          <Button type="submit" variant="ghost">
            Ver informe
          </Button>
          <Button onClick={csv} loading={downloading} disabled={!rows.length}>
            Descargar CSV
          </Button>
        </form>
      </Card>
      {report.isLoading && <Loading />}
      {report.error && <ErrorNote error={report.error} />}
      {report.data && (
        <>
          <p className="small muted" aria-live="polite">
            {report.data.totals.performances} actuaciones · {report.data.totals.works} interpretaciones ({report.data.totals.distinctWorks} obras distintas) · duración total{' '}
            {report.data.totals.duration}
            {report.data.totals.missingDuration > 0 && ` · ${report.data.totals.missingDuration} sin duración en la ficha`}
          </p>
          <DataTable
            caption="Repertorio interpretado"
            rows={rows}
            rowKey={(r) => r.key}
            empty="No hay actuaciones con repertorio en este periodo."
            columns={[
              { key: 'd', header: 'Fecha', render: (r) => date(r.date), nowrap: true },
              { key: 'e', header: 'Acto', render: (r) => r.event },
              { key: 'l', header: 'Lugar', render: (r) => r.location ?? '—' },
              { key: 't', header: 'Obra', render: (r) => r.title },
              { key: 'c', header: 'Compositor', render: (r) => r.composer ?? '—' },
              { key: 'a', header: 'Arreglista', render: (r) => r.arranger ?? '—' },
              { key: 'u', header: 'Duración', render: (r) => r.duration || '—', numeric: true, nowrap: true },
              { key: 'p', header: 'Editorial', render: (r) => r.publisher ?? '—' },
              { key: 's', header: 'Signatura', render: (r) => r.catalogCode ?? '—', nowrap: true },
            ]}
          />
        </>
      )}
    </div>
  );
}
