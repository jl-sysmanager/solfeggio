import { NextFunction, Request, Response } from 'express';
import { collectDefaultMetrics, Histogram, Registry } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duración de peticiones HTTP',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

/** Usa la ruta parametrizada (no la URL) para no registrar ids ni cardinalidad ilimitada. */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const route = (req.route?.path as string | undefined) ?? 'unmatched';
    end({ method: req.method, route: `${req.baseUrl}${route}`, status: String(res.statusCode) });
  });
  next();
}
