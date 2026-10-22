import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import EnrollPublicPage from '../pages/EnrollPublic';
import FamilyPortalPage from '../pages/FamilyPortal';
import { hhmm, score, toMinutes } from '../lib/labels-school';
import { makeSession, renderWithProviders } from './utils';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const offer = {
  band: { name: 'Banda de Prueba', slug: 'banda-prueba' },
  year: { id: 'y1', name: '2026-27', startsOn: '2026-09-01', endsOn: '2027-06-30' },
  subjects: [
    { id: 's1', name: 'Lenguaje musical', kind: 'THEORY', monthlyFeeCents: 3000 },
    { id: 's2', name: 'Clarinete', kind: 'INSTRUMENT', monthlyFeeCents: 4500 },
  ],
  publicIntro: 'Abrimos la matrícula del curso.',
};

afterEach(() => vi.unstubAllGlobals());

describe('utilidades de la escuela', () => {
  it('convierte horas y notas', () => {
    expect(hhmm(1050)).toBe('17:30');
    expect(toMinutes('17:30')).toBe(1050);
    expect(score(85)).toBe('8,5');
    expect(score(null)).toBe('—');
  });
});

describe('Matrícula online', () => {
  it('muestra la oferta, exige consentimiento y confirma el envío', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/offer')) return json(offer);
      if (url.endsWith('/applications') && init?.method === 'POST') return json({ id: 'a1', status: 'PENDING', year: '2026-27' }, 201);
      return json({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/enroll/:slug" element={<EnrollPublicPage />} />
      </Routes>,
      { session: null, route: '/enroll/banda-prueba' },
    );
    expect(await screen.findByText('Abrimos la matrícula del curso.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Matrícula · Banda de Prueba');

    await user.type(screen.getByLabelText(/^Nombre\s*\*?$/), 'Hugo');
    await user.type(screen.getByLabelText(/^Apellidos/), 'Sanz');
    await user.type(screen.getByLabelText(/Nombre y apellidos/), 'Elena Sanz');
    await user.type(screen.getByLabelText(/^Email/), 'elena@example.test');
    await user.click(screen.getByLabelText(/Clarinete/));
    // Sin consentimiento el navegador bloquea el envío (campo obligatorio).
    expect(screen.getByLabelText(/Acepto que Banda de Prueba/)).toBeRequired();
    await user.click(screen.getByLabelText(/Acepto que Banda de Prueba/));
    await user.click(screen.getByRole('button', { name: 'Enviar solicitud' }));

    expect(await screen.findByText('Solicitud enviada')).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/applications'))!;
    expect(JSON.parse(String(call[1]!.body))).toMatchObject({ studentFirstName: 'Hugo', subjectIds: ['s2'], consent: true, guardianEmail: 'elena@example.test' });
  });

  it('avisa si la matrícula no está abierta', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'Matrícula abierta no encontrado', code: 'NOT_FOUND' }, 404)));
    renderWithProviders(
      <Routes>
        <Route path="/enroll/:slug" element={<EnrollPublicPage />} />
      </Routes>,
      { session: null, route: '/enroll/otra' },
    );
    expect(await screen.findByText('Matrícula no disponible')).toBeInTheDocument();
  });
});

describe('Portal de familias', () => {
  it('explica qué hacer si el usuario no tiene tutor vinculado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'Tutor vinculado no encontrado', code: 'NOT_FOUND' }, 404)));
    renderWithProviders(<FamilyPortalPage />, { session: makeSession({ permissions: ['school:family'] }) });
    await waitFor(() => expect(screen.getByText('Sin familia vinculada')).toBeInTheDocument());
  });
});
