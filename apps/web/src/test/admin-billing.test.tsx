import { describe, expect, it } from 'vitest';
import { changeLabel, couponLabel } from '../components/admin/billing/helpers';

describe('helpers de facturación del panel global', () => {
  it('describe cupones', () => {
    expect(couponLabel({ percentOff: 20, amountOffCents: null, currency: null, duration: 'repeating', durationInMonths: 3 })).toBe('20 % durante 3 meses');
    expect(couponLabel({ percentOff: 100, amountOffCents: null, currency: null, duration: 'forever', durationInMonths: null })).toBe('100 % siempre');
  });
  it('describe cambios de sincronización residuales', () => {
    expect(changeLabel('school_seats:update:35')).toBe('Plazas de alumno: 35');
    expect(changeLabel('school_addon:remove')).toBe('Cuota de la escuela: retirada');
    expect(changeLabel('school_addon:add:1')).toBe('Cuota de la escuela: añadida (1)');
  });
});
