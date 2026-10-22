import { Controller, Get, Header, Headers, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators';
import { env } from '../config/env';
import { Db } from '../db/db.service';
import { Jobs } from '../jobs/jobs.service';
import { registry } from './metrics';

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(
    private readonly db: Db,
    private readonly jobs: Jobs,
  ) {}

  @Get('health')
  live() {
    return { status: 'ok' };
  }

  @Get('health/ready')
  async ready() {
    const checks = await Promise.allSettled([this.db.app.$queryRaw`SELECT 1`, this.jobs.ping()]);
    const [database, redis] = checks.map((c) => (c.status === 'fulfilled' ? 'ok' : 'down'));
    if (database !== 'ok' || redis !== 'ok') throw new ServiceUnavailableException({ status: 'degraded', database, redis });
    return { status: 'ok', database, redis };
  }

  /** Métricas Prometheus. Protegidas por token si METRICS_TOKEN está definido. */
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async metrics(@Headers('authorization') auth?: string) {
    const token = env().METRICS_TOKEN;
    if (token && auth !== `Bearer ${token}`) throw new UnauthorizedException();
    return registry.metrics();
  }
}
