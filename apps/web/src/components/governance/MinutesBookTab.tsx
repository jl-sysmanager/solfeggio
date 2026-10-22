import { useApi } from '../../api/hooks';
import type { MinutesEntry } from '../../api/types-governance';
import { ArrowLink, Button } from '../Button';
import { Card } from '../Card';
import { EmptyState, ErrorNote, Loading } from '../EmptyState';
import { date, dateTime } from '../../lib/format';
import { assemblyType } from '../../lib/labels-governance';
import { escapeHtml, printDocument } from './print';

export function minutesHtml(m: Pick<MinutesEntry, 'type' | 'title' | 'firstCallAt' | 'minutes' | 'minutesApprovedAt'>) {
  return `<section class="page"><h1>${escapeHtml(m.title)}</h1>
<p><em>Asamblea ${escapeHtml(assemblyType[m.type].toLowerCase())} · ${escapeHtml(dateTime(m.firstCallAt))}${m.minutesApprovedAt ? ` · Acta aprobada el ${escapeHtml(date(m.minutesApprovedAt))}` : ' · BORRADOR'}</em></p>
<pre>${escapeHtml(m.minutes)}</pre></section>`;
}

/** Libro de actas: actas aprobadas en orden cronológico. */
export function MinutesBookTab() {
  const q = useApi<MinutesEntry[]>('/governance/minutes');
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const book = q.data ?? [];
  if (book.length === 0) return <EmptyState title="Libro de actas vacío">Las actas aparecen aquí una vez aprobadas.</EmptyState>;
  return (
    <Card title="Libro de actas" actions={<Button size="sm" variant="ghost" onClick={() => printDocument('Libro de actas', book.map(minutesHtml).join(''))}>Imprimir libro</Button>}>
      <ol className="list-divided" style={{ paddingLeft: 20 }}>
        {book.map((m) => (
          <li key={m.id}>
            <div className="row between">
              <span>
                <ArrowLink to={`/governance/assemblies/${m.id}`}>{m.title}</ArrowLink>{' '}
                <span className="small muted">
                  · {assemblyType[m.type]} · {date(m.firstCallAt)} · aprobada {date(m.minutesApprovedAt)}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => printDocument(m.title, minutesHtml(m))} aria-label={`Imprimir acta de ${m.title}`}>
                Imprimir
              </Button>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
