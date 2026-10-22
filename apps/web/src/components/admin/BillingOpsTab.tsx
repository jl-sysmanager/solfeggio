import { UrlTabs } from '../Tabs';
import { CouponsSection } from './billing/CouponsSection';
import { DunningSection } from './billing/DunningSection';
import { WebhooksSection } from './billing/WebhooksSection';

/** Pestaña «Facturación» del panel global: impagos, bonificaciones y webhooks. */
export function BillingOpsTab() {
  return (
    <UrlTabs
      label="Facturación"
      tabs={[
        { id: 'dunning', label: 'Pagos fallidos', content: <DunningSection /> },
        { id: 'coupons', label: 'Bonificaciones', content: <CouponsSection /> },
        { id: 'webhooks', label: 'Webhooks', content: <WebhooksSection /> },
      ]}
    />
  );
}
