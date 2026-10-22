import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { Loading } from '../components/EmptyState';
import { Page, PageHeader } from '../components/PageHeader';
import { FeatureGate } from '../components/Upgrade';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loading label="Comprobando sesión…" />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

export function RequireTenant({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  if (!session) return null;
  if (!session.tenant) {
    if (session.memberships.length > 0) return <Navigate to="/select-band" replace />;
    if (session.user.isPlatformAdmin) return <Navigate to="/admin" replace />;
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

export function NoAccess() {
  return (
    <Page header={<PageHeader title="Sin acceso" tone="cream" />}>
      <div className="card">
        <p>Tu rol en esta banda no permite ver esta sección. Si crees que es un error, contacta con un administrador de la banda.</p>
      </div>
    </Page>
  );
}

/** Protege una ruta por permiso (cualquiera de la lista) y, opcionalmente, por funcionalidad del plan. */
export function Guard({ perm, feature, admin, children }: { perm?: string[]; feature?: string; admin?: boolean; children: ReactNode }) {
  const { can, session } = useAuth();
  if (admin && !session?.user.isPlatformAdmin) return <NoAccess />;
  if (perm && !can(perm)) return <NoAccess />;
  if (feature)
    return (
      <FeatureGate feature={feature}>
        {children}
      </FeatureGate>
    );
  return <>{children}</>;
}

/** Variante para gating de funcionalidad dentro de una página con cabecera. */
export function FeaturePage({ feature, title, children }: { feature: string; title: string; children: ReactNode }) {
  const { hasFeature } = useAuth();
  if (!hasFeature(feature))
    return (
      <Page header={<PageHeader title={title} tone="cream" />}>
        <FeatureGate feature={feature}>{null}</FeatureGate>
      </Page>
    );
  return <>{children}</>;
}
