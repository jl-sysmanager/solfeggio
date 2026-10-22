import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  numeric?: boolean;
  /** No partir el contenido en varias líneas (fechas, importes, códigos). */
  nowrap?: boolean;
}

/** La columna «Acciones» queda fija a la derecha para que nunca se oculte al desplazar la tabla. */
function cellClass<T>(c: Column<T>) {
  return [c.numeric && 'num', c.nowrap && 'nowrap', c.header === 'Acciones' && 'actions'].filter(Boolean).join(' ') || undefined;
}

/** Tabla accesible que en móvil se convierte en lista de tarjetas (CSS .table--responsive). */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  empty = 'No hay registros todavía.',
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  empty?: ReactNode;
}) {
  if (rows.length === 0) return <EmptyState title="Sin resultados" icon="search">{empty}</EmptyState>;
  return (
    <div className="table-wrap">
      <table className="table table--responsive">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cellClass(c)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} data-label={c.header} className={cellClass(c)}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Paginación">
      <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Anterior
      </button>
      <span aria-live="polite">
        Página {page} de {pages}
      </span>
      <button className="btn btn--ghost btn--sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Siguiente →
      </button>
    </nav>
  );
}
