import { Tabs } from '../Tabs';
import { AddonsSection } from './billing/AddonsSection';
import { CouponsSection } from './billing/CouponsSection';
import { DunningSection } from './billing/DunningSection';
import { WebhooksSection } from './billing/WebhooksSection';

/** Pestaña «Facturación» del panel global: impagos, bonificaciones, add-on Escuela y webhooks. */
export function BillingOpsTab() {
  return (
    <Tabs
      label="Facturación"
      tabs={[
        { id: 'dunning', label: 'Pagos fallidos', content: <DunningSection /> },
        { id: 'coupons', label: 'Bonificaciones', content: <CouponsSection /> },
        { id: 'addons', label: 'Add-on Escuela', content: <AddonsSection /> },
        { id: 'webhooks', label: 'Webhooks', content: <WebhooksSection /> },
      ]}
    />
  );
}
