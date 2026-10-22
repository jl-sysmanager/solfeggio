import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { featureLabels, featureMinPlan } from '../lib/labels';
import { ButtonLink } from './Button';
import { ErrorNote } from './EmptyState';

export function UpgradeCard({ feature }: { feature: string }) {
  const { can } = useAuth();
  return (
    <section className="card card--warm upgrade" aria-labelledby="upgrade-title">
      <p className="band__eyebrow">Función no incluida en tu plan</p>
      <h2 id="upgrade-title">{featureLabels[feature] ?? feature}</h2>
      <p>
        Disponible a partir del plan <strong>{featureMinPlan[feature] ?? 'superior'}</strong>. Cambia de plan para activarla; tus datos actuales se mantienen.
      </p>
      {can('billing:manage') ? (
        <ButtonLink to="/billing">Ver planes</ButtonLink>
      ) : (
        <p className="small">Pide al propietario de la banda que actualice el plan.</p>
      )}
    </section>
  );
}

/** Si la funcionalidad no está en el plan muestra la tarjeta de mejora, si no el contenido. */
export function FeatureGate({ feature, children }: { feature: string; children: React.ReactNode }) {
  const { hasFeature } = useAuth();
  if (!hasFeature(feature)) return <UpgradeCard feature={feature} />;
  return <>{children}</>;
}

/** Muestra un error de API, con tarjeta de mejora para FEATURE_NOT_IN_PLAN. */
export function ApiErrorView({ error, feature }: { error: unknown; feature?: string }) {
  if (error instanceof ApiError && error.code === 'FEATURE_NOT_IN_PLAN') return <UpgradeCard feature={feature ?? 'market'} />;
  return <ErrorNote error={error} />;
}
