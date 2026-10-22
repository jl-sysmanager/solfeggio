import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { changeLabel, couponLabel } from '../components/admin/billing/helpers';
import { AddonsSection } from '../components/admin/billing/AddonsSection';
import { renderWithProviders } from './utils';

describe('helpers de facturación del panel global', () => {
  it('describe cupones', () => {
    expect(couponLabel({ percentOff: 20, amountOffCents: null, currency: null, duration: 'repeating', durationInMonths: 3 })).toBe('20 % durante 3 meses');
    expect(couponLabel({ percentOff: 100, amountOffCents: null, currency: null, duration: 'forever', durationInMonths: null })).toBe('100 % siempre');
  });
  it('describe cambios de sincronización', () => {
    expect(changeLabel('school_seats:update:35')).toBe('Plazas de alumno: 35');
    expect(changeLabel('school_addon:remove')).toBe('Cuota de la escuela: retirada');
    expect(changeLabel('school_addon:add:1')).toBe('Cuota de la escuela: añadida (1)');
  });
});

describe('sección Add-on Escuela', () => {
  it('muestra el aviso de precios sin configurar y la banda con su sincronización', async () => {
    const overview = {
      prices: { addonConfigured: false, seatConfigured: true, addonCents: 0, seatCents: 100 },
      tenants: [{
        tenant: { id: 't1', name: 'Banda Norte', slug: 'norte', status: 'ACTIVE' },
        plan: { code: 'BASIC', name: 'Basic', maxStudents: 0, includesSchool: false },
        addons: ['school'], studentSeats: 20, lines: [{ key: 'school_seats', label: 'Plazas de alumno adicionales', quantity: 20, unitCents: 100 }],
        mrrCents: 2000, stripe: { subscriptionId: 'sub_1', status: 'active', interval: 'MONTH' }, complimentaryUntil: null,
        lastSync: { at: '2026-10-01T10:00:00Z', status: 'synced', changes: ['school_seats:add:20'] },
      }],
    };
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(overview), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    try {
      renderWithProviders(<AddonsSection />);
      expect(await screen.findByText('Banda Norte')).toBeTruthy();
      expect(screen.getByText(/precio de la cuota/)).toBeTruthy();
      expect(screen.getByText('Sincronizada')).toBeTruthy();
      expect(screen.getByText('Plazas de alumno: añadida (20)')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Sincronizar el add-on de Banda Norte/ })).toBeTruthy();
    } finally {
      globalThis.fetch = orig;
    }
  });
});
