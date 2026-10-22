import { env } from '../config/env';

/**
 * Catálogo de integraciones configurables desde el panel global. La UI genera los formularios a
 * partir de estas definiciones y el servidor valida contra ellas: añadir un proveedor sólo requiere
 * declararlo aquí e implementar su adaptador.
 */
export type FieldType = 'text' | 'email' | 'url' | 'number' | 'boolean' | 'select' | 'secret';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  default?: string | number | boolean;
  /** Expresión regular (sin delimitadores) que debe cumplir el valor. */
  pattern?: string;
  patternMessage?: string;
  min?: number;
  max?: number;
}

export interface ProviderDef {
  id: string;
  label: string;
  description: string;
  docsUrl?: string;
  fields: FieldDef[];
}

export interface ResolvedIntegration {
  source: 'database' | 'env' | 'none';
  provider: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}

export interface CategoryDef {
  id: CategoryId;
  label: string;
  description: string;
  /** Qué ocurre cuando la integración está deshabilitada (se muestra en la UI). */
  disabledBehavior: string;
  providers: ProviderDef[];
  /** Configuración heredada de variables de entorno cuando no hay fila en base de datos. */
  envFallback: () => Omit<ResolvedIntegration, 'source'> | null;
}

export type CategoryId = 'payments' | 'email';

const senderFields: FieldDef[] = [
  { key: 'fromAddress', label: 'Remitente (email)', type: 'email', required: true, placeholder: 'no-reply@tudominio.es' },
  { key: 'fromName', label: 'Nombre del remitente', type: 'text', placeholder: 'Solfeggio', default: 'Solfeggio' },
  { key: 'replyTo', label: 'Responder a', type: 'email', placeholder: 'soporte@tudominio.es' },
];

/** «Nombre <correo>» → partes. */
function parseFrom(value: string) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  return m ? { fromName: m[1].replace(/^"|"$/g, ''), fromAddress: m[2] } : { fromName: 'Solfeggio', fromAddress: value.trim() };
}

export const CATEGORIES: CategoryDef[] = [
  {
    id: 'payments',
    label: 'Pagos y suscripciones',
    description: 'Cobro de los planes de pago: Checkout, Customer Portal, facturas y webhooks.',
    disabledBehavior: 'Las bandas no pueden contratar ni gestionar planes de pago; la facturación responde 503 y la web oculta los botones de pago. Las suscripciones existentes en el proveedor no se cancelan.',
    providers: [
      {
        id: 'stripe',
        label: 'Stripe',
        description: 'Checkout con prueba gratuita, cupones, Stripe Tax y Customer Portal. Webhook: /api/v1/webhooks/stripe.',
        docsUrl: 'https://docs.stripe.com/keys',
        fields: [
          { key: 'secretKey', label: 'Clave secreta', type: 'secret', required: true, placeholder: 'sk_live_… o rk_live_…', pattern: '^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$', patternMessage: 'Debe empezar por sk_test_, sk_live_, rk_test_ o rk_live_', help: 'Se recomienda una clave restringida (rk_) con permisos de Checkout, Billing Portal, Customers, Subscriptions e Invoices.' },
          { key: 'webhookSecret', label: 'Secreto de firma del webhook', type: 'secret', required: true, placeholder: 'whsec_…', pattern: '^whsec_[A-Za-z0-9]{10,}$', patternMessage: 'Debe empezar por whsec_' },
          { key: 'publishableKey', label: 'Clave publicable', type: 'text', placeholder: 'pk_live_…', pattern: '^pk_(test|live)_[A-Za-z0-9]{10,}$', patternMessage: 'Debe empezar por pk_test_ o pk_live_' },
          { key: 'taxEnabled', label: 'Calcular impuestos con Stripe Tax', type: 'boolean', default: true },
          { key: 'schoolAddonPrice', label: 'Price ID del add-on Escuela (mensual)', type: 'text', placeholder: 'price_…', pattern: '^price_[A-Za-z0-9]{6,}$', patternMessage: 'Debe empezar por price_', help: 'Cuota fija mensual para bandas cuyo plan no incluye la escuela. Sin valor se usa STRIPE_PRICE_SCHOOL_ADDON.' },
          { key: 'schoolAddonAmountCents', label: 'Importe del add-on Escuela (céntimos/mes)', type: 'number', min: 0, max: 1_000_000, help: 'Sólo para las métricas de ingresos; debe coincidir con el Price de Stripe.' },
          { key: 'schoolSeatPrice', label: 'Price ID por plaza de alumno adicional (mensual)', type: 'text', placeholder: 'price_…', pattern: '^price_[A-Za-z0-9]{6,}$', patternMessage: 'Debe empezar por price_', help: 'Se cobra por cada plaza adicional. Sin valor se usa STRIPE_PRICE_SCHOOL_SEAT.' },
          { key: 'schoolSeatAmountCents', label: 'Importe por plaza adicional (céntimos/mes)', type: 'number', min: 0, max: 1_000_000, help: 'Sólo para las métricas de ingresos.' },
        ],
      },
    ],
    envFallback: () => {
      const e = env();
      if (!e.STRIPE_SECRET_KEY) return null;
      return {
        provider: 'stripe',
        enabled: true,
        config: { taxEnabled: e.STRIPE_TAX_ENABLED },
        secrets: { secretKey: e.STRIPE_SECRET_KEY, webhookSecret: e.STRIPE_WEBHOOK_SECRET },
      };
    },
  },
  {
    id: 'email',
    label: 'Envío de correo',
    description: 'Invitaciones, convocatorias, recordatorios, comunicaciones y avisos de facturación.',
    disabledBehavior: 'No se envía ningún correo: las notificaciones dentro de la app siguen funcionando y los envíos se descartan con un aviso en los logs del worker.',
    providers: [
      {
        id: 'smtp',
        label: 'SMTP',
        description: 'Cualquier servidor SMTP (Amazon SES, Microsoft 365, Google Workspace, Mailpit en local…).',
        fields: [
          { key: 'host', label: 'Servidor', type: 'text', required: true, placeholder: 'smtp.tudominio.es', pattern: '^[A-Za-z0-9.-]{1,253}$', patternMessage: 'Nombre de host no válido' },
          { key: 'port', label: 'Puerto', type: 'number', required: true, default: 587, min: 1, max: 65535 },
          {
            key: 'security', label: 'Seguridad', type: 'select', required: true, default: 'starttls',
            options: [{ value: 'starttls', label: 'STARTTLS (587)' }, { value: 'tls', label: 'TLS implícito (465)' }, { value: 'none', label: 'Sin cifrar (sólo desarrollo)' }],
          },
          { key: 'username', label: 'Usuario', type: 'text' },
          { key: 'password', label: 'Contraseña', type: 'secret' },
          ...senderFields,
        ],
      },
      {
        id: 'sendgrid',
        label: 'SendGrid',
        description: 'API v3 de Twilio SendGrid.',
        docsUrl: 'https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send',
        fields: [
          { key: 'apiKey', label: 'API key', type: 'secret', required: true, placeholder: 'SG.…', pattern: '^SG\\.[A-Za-z0-9_.-]{10,}$', patternMessage: 'Debe empezar por SG.' },
          ...senderFields,
        ],
      },
      {
        id: 'mailgun',
        label: 'Mailgun',
        description: 'API de mensajes de Mailgun (regiones EE. UU. y UE).',
        docsUrl: 'https://documentation.mailgun.com/docs/mailgun/api-reference/',
        fields: [
          { key: 'apiKey', label: 'API key', type: 'secret', required: true },
          { key: 'domain', label: 'Dominio de envío', type: 'text', required: true, placeholder: 'mg.tudominio.es', pattern: '^[A-Za-z0-9.-]{1,253}$', patternMessage: 'Dominio no válido' },
          { key: 'region', label: 'Región', type: 'select', required: true, default: 'eu', options: [{ value: 'eu', label: 'Unión Europea' }, { value: 'us', label: 'Estados Unidos' }] },
          ...senderFields,
        ],
      },
      {
        id: 'resend',
        label: 'Resend',
        description: 'API de Resend.',
        docsUrl: 'https://resend.com/docs/api-reference/emails/send-email',
        fields: [
          { key: 'apiKey', label: 'API key', type: 'secret', required: true, placeholder: 're_…', pattern: '^re_[A-Za-z0-9_]{10,}$', patternMessage: 'Debe empezar por re_' },
          ...senderFields,
        ],
      },
      {
        id: 'postmark',
        label: 'Postmark',
        description: 'API de Postmark.',
        docsUrl: 'https://postmarkapp.com/developer/api/email-api',
        fields: [
          { key: 'serverToken', label: 'Server API token', type: 'secret', required: true },
          { key: 'messageStream', label: 'Message stream', type: 'text', default: 'outbound', placeholder: 'outbound' },
          ...senderFields,
        ],
      },
    ],
    envFallback: () => {
      const e = env();
      if (!e.SMTP_URL) return null;
      const url = new URL(e.SMTP_URL);
      return {
        provider: 'smtp',
        enabled: true,
        config: {
          host: url.hostname,
          port: Number(url.port || (url.protocol === 'smtps:' ? 465 : 587)),
          security: url.protocol === 'smtps:' ? 'tls' : url.hostname === 'localhost' || url.hostname === 'mailpit' ? 'none' : 'starttls',
          username: decodeURIComponent(url.username) || undefined,
          ...parseFrom(e.MAIL_FROM),
        },
        secrets: (url.password ? { password: decodeURIComponent(url.password) } : {}) as Record<string, string>,
      };
    },
  },
];

export function category(id: string): CategoryDef | undefined {
  return CATEGORIES.find((c) => c.id === id);
}
