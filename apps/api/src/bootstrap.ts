import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { env } from './config/env';
import { metricsMiddleware } from './health/metrics';

/** Configuración HTTP compartida por `main.ts` y los tests e2e. */
export function configureApp(app: INestApplication) {
  const e = env();
  const http = app.getHttpAdapter().getInstance();
  http.set('trust proxy', e.TRUST_PROXY);
  http.disable('x-powered-by');

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  // El navegador no habla con el almacén: el logotipo llega al API (mismo origen) y el servidor lo guarda.
  const logoBody = express.raw({ type: ['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'], limit: '1mb' });
  app.use('/api/v1/admin/brand/logo', logoBody);
  app.use('/api/v1/tenant/logo', logoBody);
  app.use('/api/v1/members/:id/photo', logoBody);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.use(metricsMiddleware);
  app.enableCors({ origin: e.CORS_ORIGINS.split(',').map((o) => o.trim()), credentials: true, maxAge: 600 });
  app.enableShutdownHooks();

  if (e.NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Solfeamos API').setVersion('1.0').addBearerAuth().build(),
    );
    // La UI de Swagger necesita scripts inline: CSP relajada sólo en esa ruta y fuera de producción.
    app.use('/api/docs', helmet({ contentSecurityPolicy: false }));
    SwaggerModule.setup('api/docs', app, doc, { jsonDocumentUrl: 'api/docs-json' });
  }
  return app;
}
