import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../auth/AuthProvider';
import { ToastProvider } from '../components/Toasts';
import type { Session } from '../api/types';

export function makeSession(over: Partial<Session> = {}): Session {
  return {
    user: { id: 'u1', email: 'ana@example.test', name: 'Ana Pérez', mfaEnabled: false, isPlatformAdmin: false },
    tenant: { id: 't1', name: 'Banda de Prueba', slug: 'banda-prueba', status: 'ACTIVE', timezone: 'Europe/Madrid' },
    role: { id: 'r1', key: 'musician', name: 'Músico' },
    permissions: ['archive:read', 'events:read', 'attendance:self', 'market:read'],
    plan: { code: 'FREE', name: 'Free', features: ['members', 'archive', 'events', 'attendance'], maxUsers: 5, maxMembers: 40, storageMb: 500 },
    memberId: 'm1',
    memberships: [{ tenantId: 't1', tenantName: 'Banda de Prueba', slug: 'banda-prueba', roleKey: 'musician', roleName: 'Músico' }],
    ...over,
  };
}

export function renderWithProviders(ui: ReactNode, { session = makeSession(), route = '/' }: { session?: Session | null; route?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider initialSession={session}>{ui}</AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
