import { LoggerModule } from 'nestjs-pino';
import { pseudonymize } from './crypto';
import { env } from '../config/env';

/** `pino-pretty` es dependencia de desarrollo: sólo se usa si está instalada. */
function prettyAvailable() {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/** Logs JSON sin datos sensibles: se redactan credenciales, tokens y cuerpos; la IP se seudonimiza. */
export const loggerModule = () =>
  LoggerModule.forRoot({
    pinoHttp: {
      level: env().LOG_LEVEL,
      transport: env().NODE_ENV === 'development' && prettyAvailable() ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["stripe-signature"]',
          'res.headers["set-cookie"]',
          '*.password',
          '*.token',
          '*.accessToken',
          '*.refreshToken',
          '*.mfaCode',
          '*.iban',
          '*.nationalId',
          '*.email',
        ],
        censor: '[redacted]',
      },
      serializers: {
        req: (req: { id: string; method: string; url: string; remoteAddress?: string }) => ({
          id: req.id,
          method: req.method,
          // Sin query string: puede contener búsquedas con datos personales o tokens.
          // El token del feed ICS es una credencial: se redacta de la ruta.
          url: req.url?.split('?')[0].replace(/(\/calendar\/)[^/]+(\.ics)$/, '$1[redacted]$2'),
          ip: pseudonymize(req.remoteAddress),
        }),
      },
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' || req.url === '/api/v1/metrics' },
      customProps: (req) => ({ tenantId: (req as unknown as { ctx?: { tenantId?: string } }).ctx?.tenantId || undefined }),
    },
  });
