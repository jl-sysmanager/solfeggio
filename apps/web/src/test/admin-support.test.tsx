import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import { AnnouncementBanner } from '../components/admin/AnnouncementBanner';
import { SlaChip, minutesLabel } from '../components/admin/support/shared';
import { renderWithProviders } from './utils';

afterEach(() => vi.restoreAllMocks());

describe('soporte: utilidades visuales', () => {
  it('muestra el estado del SLA con texto, no sólo color', () => {
    renderWithProviders(<SlaChip state="overdue" />);
    expect(screen.getByText('SLA vencido')).toBeInTheDocument();
  });

  it('formatea tiempos de respuesta', () => {
    expect(minutesLabel(45)).toBe('45 min');
    expect(minutesLabel(180)).toBe('3 h');
    expect(minutesLabel(null)).toBe('—');
  });
});

describe('avisos de plataforma', () => {
  const notice = { id: 'a1', title: 'Mantenimiento esta noche', body: 'Habrá un corte breve.', level: 'MAINTENANCE', link: null };

  it('muestra los avisos como estado accesible y permite descartarlos', async () => {
    vi.spyOn(client, 'get').mockResolvedValue([{ ...notice, dismissible: true }, { ...notice, id: 'a2', title: 'Fijo', dismissible: false }] as never);
    const post = vi.spyOn(client, 'post').mockResolvedValue({} as never);
    renderWithProviders(<AnnouncementBanner />);
    const banners = await screen.findAllByRole('status');
    expect(banners).toHaveLength(2);
    // Sólo el descartable ofrece botón.
    const dismiss = screen.getAllByRole('button', { name: /descartar aviso/i });
    expect(dismiss).toHaveLength(1);
    await userEvent.click(dismiss[0]);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/announcements/a1/dismiss'));
  });

  it('no pinta nada sin avisos', async () => {
    vi.spyOn(client, 'get').mockResolvedValue([] as never);
    const { container } = renderWithProviders(<AnnouncementBanner />);
    await waitFor(() => expect(client.get).toHaveBeenCalled());
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
