import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, PlatformAdmin } from '../auth/decorators';
import { pageQuery } from '../common/pagination';
import { idParam, isoDate, toDate } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { InsightsService } from './insights.service';
import { addDays, addMonths, monthStart } from './insights-math';

const metricsQuery = z.object({ months: z.coerce.number().int().min(1).max(36).default(12) });
const funnelQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });
const healthQuery = pageQuery.extend({
  q: z.string().trim().max(100).optional(),
  risk: z.enum(['high', 'medium', 'low']).optional(),
  status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED']).optional(),
  plan: z.enum(['FREE', 'BASIC', 'PRO', 'ENTERPRISE']).optional(),
  sort: z.enum(['score', '-score', 'name', 'activeUsers', 'lastActivity', 'mrr']).default('score'),
});
const snapshotBody = z.object({ date: isoDate.optional() });
const detailQuery = pageQuery.extend({ pageSize: z.coerce.number().int().min(1).max(100).default(30) });
const accountPatch = z.object({
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  accountManagerId: z.string().uuid().nullable().optional(),
});
const noteBody = z.object({ body: z.string().trim().min(1).max(4000) });
const noteParams = z.object({ id: idParam, noteId: idParam });

/** Negocio y retención del panel global: sólo administradores de plataforma. */
@ApiTags('admin-insights')
@ApiBearerAuth()
@PlatformAdmin()
@Controller('admin/insights')
export class AdminInsightsController {
  constructor(private readonly insights: InsightsService) {}

  @HttpCode(200)
  @Post('snapshot')
  snapshot(@Body(zod(snapshotBody)) body: z.infer<typeof snapshotBody>) {
    return this.insights.snapshot(body.date ? toDate(body.date) : new Date());
  }

  @Get('metrics')
  metrics(@Query(zod(metricsQuery)) q: z.infer<typeof metricsQuery>) {
    return this.insights.metrics(q.months);
  }

  @Get('funnel')
  funnel(@Query(zod(funnelQuery)) q: z.infer<typeof funnelQuery>) {
    const to = q.to ? addDays(toDate(q.to), 1) : addDays(new Date(), 1);
    const from = q.from ? toDate(q.from) : addMonths(monthStart(new Date()), -11);
    return this.insights.funnel(from, to);
  }

  @Get('cohorts')
  cohorts() {
    return this.insights.cohorts();
  }

  @Get('health')
  health(@Query(zod(healthQuery)) q: z.infer<typeof healthQuery>) {
    return this.insights.health(q);
  }

  @Get('at-risk')
  atRisk() {
    return this.insights.atRisk();
  }

  @Get('upsell')
  upsell() {
    return this.insights.upsell();
  }

  @Get('managers')
  managers() {
    return this.insights.managers();
  }

  @Get('tenants/:id')
  tenant(@Param('id', zod(idParam)) id: string, @Query(zod(detailQuery)) q: z.infer<typeof detailQuery>) {
    return this.insights.tenantDetail(id, q.page, q.pageSize);
  }

  @Get('tenants/:id/timeline')
  timeline(@Param('id', zod(idParam)) id: string, @Query(zod(detailQuery)) q: z.infer<typeof detailQuery>) {
    return this.insights.timeline(id, q.page, q.pageSize);
  }

  @Patch('tenants/:id')
  update(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(accountPatch)) body: z.infer<typeof accountPatch>) {
    return this.insights.updateAccount(id, ctx, body);
  }

  @Post('tenants/:id/notes')
  addNote(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(noteBody)) body: z.infer<typeof noteBody>) {
    return this.insights.addNote(id, ctx, body.body);
  }

  @HttpCode(204)
  @Delete('tenants/:id/notes/:noteId')
  async deleteNote(@Ctx() ctx: RequestContext, @Param(zod(noteParams)) p: z.infer<typeof noteParams>) {
    await this.insights.deleteNote(p.id, p.noteId, ctx);
  }
}
