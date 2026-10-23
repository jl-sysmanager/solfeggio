import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { sha256 } from '../common/crypto';
import { IntegrationsService } from './integrations.service';
import { ResolvedIntegration } from './registry';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type SendResult = { sent: true; provider: string } | { sent: false; reason: 'disabled' | 'not_configured' };

/** Error de proveedor sin cuerpo de respuesta (podría reflejar datos de la petición). */
export class MailProviderError extends Error {
  constructor(provider: string, status: number) {
    super(`El proveedor de correo ${provider} respondió ${status}`);
  }
}

/** Evita inyección de cabeceras en nombres y asuntos. */
const clean = (v: unknown) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();

/**
 * Envía correo con el proveedor configurado en el panel. Si el envío está deshabilitado, no se
 * envía nada y se devuelve `sent: false` (el trabajo se da por completado, sin reintentos).
 */
@Injectable()
export class Mailer {
  private readonly logger = new Logger(Mailer.name);
  private transport?: { key: string; t: Transporter };

  constructor(private readonly integrations: IntegrationsService) {}

  async send(msg: MailMessage, override?: ResolvedIntegration): Promise<SendResult> {
    const cfg = override ?? (await this.integrations.get('email'));
    if (!cfg.provider) return { sent: false, reason: 'not_configured' };
    if (!cfg.enabled) {
      this.logger.warn(`Correo deshabilitado: se descarta «${clean(msg.subject)}»`);
      return { sent: false, reason: 'disabled' };
    }
    const c = cfg.config as Record<string, string | number | undefined>;
    const s = cfg.secrets;
    const from = { email: clean(c.fromAddress), name: clean(c.fromName || 'Solfeamos') };
    const fromHeader = `"${from.name.replace(/"/g, "'")}" <${from.email}>`;
    const message = { to: clean(msg.to), subject: clean(msg.subject), text: msg.text, html: msg.html, replyTo: c.replyTo ? clean(c.replyTo) : undefined };

    switch (cfg.provider) {
      case 'smtp': {
        const options = {
          host: String(c.host),
          port: Number(c.port),
          secure: c.security === 'tls',
          requireTLS: c.security === 'starttls',
          ignoreTLS: c.security === 'none',
          auth: c.username ? { user: String(c.username), pass: s.password ?? '' } : undefined,
        };
        // Se reutiliza el transporte mientras la configuración no cambie.
        const key = sha256(JSON.stringify(options));
        if (this.transport?.key !== key) this.transport = { key, t: nodemailer.createTransport(options) };
        await this.transport.t.sendMail({ from: fromHeader, ...message });
        break;
      }
      case 'sendgrid':
        await this.post('sendgrid', 'https://api.sendgrid.com/v3/mail/send', { Authorization: `Bearer ${s.apiKey}` }, {
          personalizations: [{ to: [{ email: message.to }] }],
          from,
          ...(message.replyTo && { reply_to: { email: message.replyTo } }),
          subject: message.subject,
          content: [{ type: 'text/plain', value: message.text }, ...(message.html ? [{ type: 'text/html', value: message.html }] : [])],
        });
        break;
      case 'mailgun': {
        const host = c.region === 'us' ? 'api.mailgun.net' : 'api.eu.mailgun.net';
        const form = new URLSearchParams({ from: fromHeader, to: message.to, subject: message.subject, text: message.text });
        if (message.html) form.set('html', message.html);
        if (message.replyTo) form.set('h:Reply-To', message.replyTo);
        await this.post('mailgun', `https://${host}/v3/${encodeURIComponent(String(c.domain))}/messages`, {
          Authorization: `Basic ${Buffer.from(`api:${s.apiKey}`).toString('base64')}`,
        }, form);
        break;
      }
      case 'resend':
        await this.post('resend', 'https://api.resend.com/emails', { Authorization: `Bearer ${s.apiKey}` }, {
          from: fromHeader, to: [message.to], subject: message.subject, text: message.text,
          ...(message.html && { html: message.html }), ...(message.replyTo && { reply_to: message.replyTo }),
        });
        break;
      case 'postmark':
        await this.post('postmark', 'https://api.postmarkapp.com/email', { 'X-Postmark-Server-Token': s.serverToken }, {
          From: fromHeader, To: message.to, Subject: message.subject, TextBody: message.text,
          ...(message.html && { HtmlBody: message.html }), ...(message.replyTo && { ReplyTo: message.replyTo }),
          MessageStream: c.messageStream || 'outbound',
        });
        break;
      default:
        throw new Error(`Proveedor de correo no soportado: ${cfg.provider}`);
    }
    return { sent: true, provider: cfg.provider };
  }

  private async post(provider: string, url: string, headers: Record<string, string>, body: unknown) {
    const isForm = body instanceof URLSearchParams;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': isForm ? 'application/x-www-form-urlencoded' : 'application/json', ...headers },
      body: isForm ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new MailProviderError(provider, res.status);
  }
}
