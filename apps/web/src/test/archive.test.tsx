import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { rangeError } from '../components/archive/PartSplitter';
import ArchivePage from '../pages/Archive';
import WorkDetailPage from '../pages/WorkDetail';
import { makeSession, renderWithProviders } from './utils';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const work = {
  id: 'w1',
  title: 'Amparito Roca',
  tags: [],
  versions: [],
  assets: [
    { id: 'a1', kind: 'SCORE', fileName: 'guion.pdf', mimeType: 'application/pdf', sizeBytes: 1000, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'a2', kind: 'AUDIO', fileName: 'ensayo.mp3', mimeType: 'audio/mpeg', sizeBytes: 1000, createdAt: '2026-01-01T00:00:00Z' },
  ],
};

function mockApi(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input).replace('/api/v1', '').split('?')[0];
    return json(routes[url] ?? []);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

const archivist = (features: string[]) =>
  makeSession({
    permissions: ['archive:read', 'archive:write', 'events:read'],
    plan: { code: 'PRO', name: 'Pro', features: ['archive', 'events', ...features], maxUsers: 50, maxMembers: 300, storageMb: 1024 },
  });

describe('validación de rangos de particellas', () => {
  it('detecta rangos vacíos, invertidos o fuera del PDF', () => {
    expect(rangeError([])).toMatch(/al menos/);
    expect(rangeError([{ instrument: 'Flauta', fromPage: 3, toPage: 2 }])).toMatch(/no válido/);
    expect(rangeError([{ instrument: 'Flauta', fromPage: 1, toPage: 5 }], 4)).toMatch(/4 páginas/);
    expect(rangeError([{ instrument: ' ', fromPage: 1, toPage: 1 }])).toMatch(/instrumento/);
    expect(rangeError([{ instrument: 'Flauta', fromPage: 1, toPage: 4 }], 4)).toBeNull();
  });
});

describe('Archivo: pestañas', () => {
  it('muestra Obras, Informe SGAE, Libretos y Préstamos y avisa de que el informe no es oficial', async () => {
    const user = userEvent.setup();
    mockApi({
      '/works': { data: [], total: 0, page: 1, pageSize: 24 },
      '/archive/reports/sgae': { from: '2026-01-01', to: '2026-10-22', events: [], totals: { performances: 0, works: 0, distinctWorks: 0, durationSec: 0, duration: '0:00', missingDuration: 0 } },
    });
    renderWithProviders(<ArchivePage />, { session: archivist([]) });
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Obras', 'Informe SGAE', 'Libretos', 'Préstamos']);
    await user.click(screen.getByRole('tab', { name: 'Informe SGAE' }));
    expect(screen.getByText(/no se envía nada a la SGAE/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Desde/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Préstamos' }));
    expect(await screen.findByLabelText('Estado')).toBeInTheDocument();
  });

  it('sin permiso de eventos no aparece el informe SGAE', () => {
    mockApi({ '/works': { data: [], total: 0, page: 1, pageSize: 24 } });
    renderWithProviders(<ArchivePage />, { session: makeSession({ permissions: ['archive:read'] }) });
    expect(screen.queryByRole('tab', { name: 'Informe SGAE' })).not.toBeInTheDocument();
  });
});

describe('Ficha de obra: particellas automáticas', () => {
  const renderWork = (features: string[]) =>
    renderWithProviders(
      <Routes>
        <Route path="/archive/:id" element={<WorkDetailPage />} />
      </Routes>,
      { session: archivist(features), route: '/archive/w1' },
    );

  it('ofrece dividir PDFs sólo con archive_ai y muestra el aviso de OCR para escaneos', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({ '/works/w1': work, '/works/w1/loans': [], '/works/w1/assets/a1/detect-parts': { pages: 3, ocrRequired: true, suggestions: [] } });
    renderWork(['archive_ai']);
    await user.click(await screen.findByRole('button', { name: 'Acciones de guion.pdf' }));
    await user.click(screen.getByRole('menuitem', { name: 'Dividir en particellas' }));
    await user.click(screen.getByRole('button', { name: 'Detectar instrumentos' }));
    expect(await screen.findByText(/no tiene capa de texto/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/detect-parts'))).toBe(true);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Acciones de ensayo.mp3' }));
    expect(screen.queryByRole('menuitem', { name: 'Dividir en particellas' })).not.toBeInTheDocument();
  });

  it('sin archive_ai no aparece la opción y se listan los préstamos de la obra', async () => {
    const user = userEvent.setup();
    mockApi({
      '/works/w1': work,
      '/works/w1/loans': [{ id: 'l1', workId: 'w1', direction: 'LENT', counterparty: 'Banda de Llíria', loanedAt: '2026-01-10', dueAt: '2026-02-10', returnedAt: null, overdue: true }],
    });
    renderWork([]);
    expect(await screen.findByText('Banda de Llíria')).toBeInTheDocument();
    expect(screen.getByText('Con retraso')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Acciones de guion.pdf' }));
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Dividir en particellas' })).not.toBeInTheDocument());
  });
});
