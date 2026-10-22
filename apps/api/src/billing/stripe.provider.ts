import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import Stripe from 'stripe';
import { IntegrationsService } from '../integrations/integrations.service';

export interface PaymentsSettings {
  taxEnabled: boolean;
}

/**
 * Cliente de Stripe configurado desde el panel global (o variables de entorno como respaldo).
 * Inyectable para poder sustituirlo en tests. La instancia se recrea si cambia la clave.
 */
@Injectable()
export class StripeClient {
  private instance?: { key: string; stripe: Stripe };

  constructor(private readonly integrations: IntegrationsService) {}

  /** Indica si se pueden contratar planes de pago (para la UI). */
  async enabled(): Promise<boolean> {
    const cfg = await this.integrations.get('payments');
    return cfg.enabled && cfg.provider === 'stripe' && !!cfg.secrets.secretKey;
  }

  private async config() {
    const cfg = await this.integrations.get('payments');
    if (!cfg.provider) throw new ServiceUnavailableException({ message: 'La facturación no está configurada', code: 'BILLING_NOT_CONFIGURED' });
    if (!cfg.enabled) throw new ServiceUnavailableException({ message: 'La facturación está deshabilitada', code: 'BILLING_DISABLED' });
    if (cfg.provider !== 'stripe' || !cfg.secrets.secretKey) {
      throw new ServiceUnavailableException({ message: 'La facturación no está configurada', code: 'BILLING_NOT_CONFIGURED' });
    }
    return cfg;
  }

  async api(): Promise<Stripe> {
    const cfg = await this.config();
    const key = cfg.secrets.secretKey;
    if (this.instance?.key !== key) {
      this.instance = { key, stripe: new Stripe(key, { apiVersion: '2025-02-24.acacia', maxNetworkRetries: 2, appInfo: { name: 'Solfeggio' } }) };
    }
    return this.instance.stripe;
  }

  async settings(): Promise<PaymentsSettings> {
    const cfg = await this.config();
    return { taxEnabled: cfg.config.taxEnabled !== false };
  }

  async constructEvent(payload: Buffer, signature: string): Promise<Stripe.Event> {
    const cfg = await this.config();
    return (await this.api()).webhooks.constructEvent(payload, signature, cfg.secrets.webhookSecret ?? '');
  }

  /** Prueba de conexión: lee la cuenta y devuelve el modo (test/live) sin exponer datos sensibles. */
  async check(override?: { secretKey: string }) {
    const stripe = override ? new Stripe(override.secretKey, { apiVersion: '2025-02-24.acacia', maxNetworkRetries: 0 }) : await this.api();
    const balance = await stripe.balance.retrieve();
    return { livemode: balance.livemode };
  }
}
