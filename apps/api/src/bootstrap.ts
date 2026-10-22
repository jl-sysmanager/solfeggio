import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { env } from './config/env';
import { metricsMiddleware } from './health/metrics';

/** Configuración HTTP compartida por `main.ts` y los tests e2e. */
export function configureApp(app: INestApplication) {
  const e = env();
  const express = app.getHttpAdapter().getInstance();
  express.set('trust proxy', e.TRUST_PROXY);
  express.disable('x-powered-by');

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.use(metricsMiddleware);
  app.enableCors({ origin: e.CORS_ORIGINS.split(',').map((o) => o.trim()), credentials: true, maxAge: 600 });
  app.enableShutdownHooks();

  if (e.NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Solfeggio API').setVersion('1.0').addBearerAuth().build(),
    );
    // La UI de Swagger necesita scripts inline: CSP relajada sólo en esa ruta y fuera de producción.
    app.use('/api/docs', helmet({ contentSecurityPolicy: false }));
    SwaggerModule.setup('api/docs', app, doc, { jsonDocumentUrl: 'api/docs-json' });
  }
  return app;
}
