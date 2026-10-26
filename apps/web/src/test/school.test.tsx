import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import EnrollPublicPage from '../pages/EnrollPublic';
import FamilyPortalPage from '../pages/FamilyPortal';
import { hhmm, score, toMinutes } from '../lib/labels-school';
import { parseCsv, suggestedYear } from '../components/school/common';
import { holidayRanges, nationalHolidays } from '../components/school/HolidaysField';
import { OverviewTab } from '../components/school/OverviewTab';
import { TuitionTab } from '../components/school/TuitionTab';
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

describe('ayudas de configuración de la escuela', () => {
  it('lee CSV con «;» o «,», comillas y BOM', () => {
    expect(parseCsv('﻿Nombre;Apellidos\nLucía;"Pérez; García"\n\n')).toEqual([['Nombre', 'Apellidos'], ['Lucía', 'Pérez; García']]);
    expect(parseCsv('a,b\r\n"di ""hola""",2')).toEqual([['a', 'b'], ['di "hola"', '2']]);
  });

  it('propone festivos nacionales (con Viernes Santo) y agrupa periodos', () => {
    const days = nationalHolidays('2026-09-01', '2027-06-30');
    expect(days).toEqual(expect.arrayContaining(['2026-10-12', '2026-12-08', '2027-01-06', '2027-03-26', '2027-05-01']));
    expect(days).not.toContain('2026-08-15');
    expect(holidayRanges(['2026-12-24', '2026-12-23', '2026-12-25', '2027-01-06'])).toEqual([
      { from: '2026-12-23', to: '2026-12-25' },
      { from: '2027-01-06', to: '2027-01-06' },
    ]);
  });

  it('sugiere el curso siguiente al último o el que está en marcha', () => {
    expect(suggestedYear([{ startsOn: '2026-09-01' }])).toEqual({ name: '2027-28', startsOn: '2027-09-01', endsOn: '2028-06-30' });
    expect(suggestedYear([], new Date('2026-10-26'))).toMatchObject({ name: '2026-27' });
    expect(suggestedYear([], new Date('2027-03-01'))).toMatchObject({ name: '2026-27' });
  });
});

const year = { id: 'y1', name: '2026-27', startsOn: '2026-09-01', endsOn: '2027-06-30', holidays: [], enrollmentOpen: false, isCurrent: true };
const manager = () => makeSession({ permissions: ['school:read', 'school:write', 'school:teach', 'school:tuition'] });

describe('Inicio de la escuela', () => {
  it('muestra lo que falta y enlaza a donde se hace', async () => {
    const overview = {
      year,
      hasYears: true,
      counts: { students: 12, families: 9, subjects: 3, teachers: 0, groups: 4, withoutSlots: 2, withoutTeacher: 4, waitlist: 1, pendingApplications: 3, conflicts: 0, occupied: 12, capacity: 40 },
      checklist: [
        { id: 'year', title: 'Crea el curso escolar', detail: '', to: '?tab=settings&section=cursos', done: true },
        { id: 'teachers', title: 'Añade al profesorado', detail: '', to: '?tab=settings&section=equipo', done: false },
      ],
      tuition: { period: '2026-10', issuedCount: 0, issuedCents: 0, pendingCount: 2, pendingCents: 9000, overdueCount: 1, overdueCents: 4500, autoIssueDay: null },
      today: [],
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(String(url).includes('/school/overview') ? overview : String(url).includes('/school/years') ? [year] : [])));
    renderWithProviders(<OverviewTab />, { session: manager() });
    expect(await screen.findByRole('heading', { name: 'Pon la escuela en marcha' }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/1 de 2 pasos hechos/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir' })).toHaveAttribute('href', '/school?tab=settings&section=equipo');
    expect(screen.getByRole('link', { name: '2 grupo(s) sin horario: no tendrán clases' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /1 mensualidad\(es\) vencida/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Revisarlas' })).toHaveAttribute('href', '/school?tab=applications');
    expect(screen.getByText('No hay clases hoy.')).toBeInTheDocument();
  });

  it('sin cursos invita a crear el primero con el asistente', async () => {
    const empty = { year: null, hasYears: false, counts: {}, checklist: [], tuition: null, today: [] };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(String(url).includes('/school/overview') ? empty : [])));
    const user = userEvent.setup();
    renderWithProviders(<OverviewTab />, { session: manager() });
    await user.click(await screen.findByRole('button', { name: 'Crear el primer curso' }));
    expect(screen.getByRole('dialog', { name: 'Nuevo curso escolar' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue(suggestedYear([]).name);
  });
});

describe('Mensualidades', () => {
  it('cobra varias seleccionadas con la forma de pago elegida', async () => {
    const charge = (id: string, name: string, cents: number) => ({
      id, yearId: 'y1', studentId: id, familyId: null, period: '2026-10', baseCents: cents, discountCents: 0, amountCents: cents,
      detail: { lines: [], discounts: [], pct: 0 }, dueDate: '2026-10-05', status: 'PENDING', paidAt: null, student: { id, firstName: name, lastName: 'Ruiz' },
    });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/school/years')) return json([year]);
      if (u.includes('/school/settings')) return json({ autoIssueDay: null, autoIssueDueDay: 5, notifyFamilies: true });
      if (u.includes('/school/tuition/charges/pay') && init?.method === 'POST') return json({ paid: 2, skipped: 0, amountCents: 7000 });
      if (u.includes('/school/tuition/charges')) return json({ data: [charge('c1', 'Ana', 3000), charge('c2', 'Leo', 4000)], total: 2, page: 1, pageSize: 50, totalAmountCents: 7000 });
      return json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<TuitionTab />, { session: manager() });
    await user.click(await screen.findByRole('button', { name: 'Seleccionar pendientes (2)' }));
    expect(screen.getByText(/2 seleccionada\(s\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Registrar cobro' }));
    const dialog = screen.getByRole('dialog', { name: 'Registrar cobro' });
    await user.selectOptions(screen.getByLabelText('Forma de pago'), 'BIZUM');
    await user.click(dialog.querySelector('button[type="submit"]')!);
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/charges/pay'))).toBe(true));
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/charges/pay'))!;
    expect(JSON.parse(String(call[1]!.body))).toMatchObject({ chargeIds: ['c1', 'c2'], method: 'BIZUM' });
  });
});
