import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, PlatformAdmin } from '../auth/decorators';
import { pageQuery } from '../common/pagination';
import { idParam, isoDate, text, toDate } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { BillingOpsService } from './billing-ops.service';

const stripeId = z.string().regex(/^[A-Za-z0-9_-]{3,100}$/, 'Identificador no válido');
const daysSchema = z.object({ days: z.number().int().min(1).max(90) });
const couponSchema = z.object({
  name: text(40),
  percentOff: z.number().min(1).max(100).optional(),
  amountOffCents: z.number().int().min(1).max(10_000_00).optional(),
  duration: z.enum(['once', 'repeating', 'forever']),
  durationInMonths: z.number().int().min(1).max(36).optional(),
  maxRedemptions: z.number().int().min(1).max(100_000).optional(),
  promotionCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/, 'Sólo letras, números, guiones (3-40)').optional(),
});
const applyCouponSchema = z.object({ couponId: stripeId });
const creditSchema = z.object({ amountCents: z.number().int().min(1).max(10_000_00), description: text(200) });
const freeMonthsSchema = z.object({ months: z.number().int().min(1).max(24) });
const complimentarySchema = z.object({ until: isoDate, reason: text(300), planCode: z.enum(['BASIC', 'PRO', 'ENTERPRISE']) });
const webhooksQuery = pageQuery.extend({
  type: z.string().regex(/^[a-z_.]{3,100}$/).optional(),
  status: z.enum(['processed', 'failed', 'pending']).optional(),
});

/** Operación de facturación del panel global (impagos, bonificaciones, add-on Escuela y webhooks). */
@ApiTags('admin')
@ApiBearerAuth()
@PlatformAdmin()
@Controller('admin/billing')
export class AdminBillingController {
  constructor(private readonly ops: BillingOpsService) {}

  private actor(ctx: RequestContext) {
    return { userId: ctx.userId, ip: ctx.ip };
  }

  @Get('dunning')
  dunning() {
    return this.ops.dunning();
  }

  @Get('tenants/:id')
  tenant(@Param('id', zod(idParam)) id: string) {
    return this.ops.tenantSummary(id);
  }

  @HttpCode(200)
  @Post('tenants/:id/retry')
  retry(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.ops.retry(id, this.actor(ctx));
  }

  @HttpCode(200)
  @Post('tenants/:id/remind')
  remind(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.ops.remind(id, this.actor(ctx));
  }

  @HttpCode(200)
  @Post('tenants/:id/read-only')
  readOnly(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.ops.readOnly(id, this.actor(ctx));
  }

  @HttpCode(200)
  @Post('tenants/:id/grace')
  grace(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(daysSchema)) body: z.infer<typeof daysSchema>) {
    return this.ops.extendGrace(id, body.days, this.actor(ctx));
  }

  @Get('coupons')
  coupons() {
    return this.ops.coupons();
  }

  @Post('coupons')
  createCoupon(@Ctx() ctx: RequestContext, @Body(zod(couponSchema)) body: z.infer<typeof couponSchema>) {
    return this.ops.createCoupon(body, this.actor(ctx));
  }

  @Delete('coupons/:id')
  deleteCoupon(@Ctx() ctx: RequestContext, @Param('id', zod(stripeId)) id: string) {
    return this.ops.deleteCoupon(id, this.actor(ctx));
  }

  @HttpCode(200)
  @Post('tenants/:id/coupon')
  applyCoupon(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(applyCouponSchema)) body: z.infer<typeof applyCouponSchema>) {
    return this.ops.applyCoupon(id, body.couponId, this.actor(ctx));
  }

  @HttpCode(200)
  @Post('tenants/:id/credit')
  credit(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(creditSchema)) body: z.infer<typeof creditSchema>) {
    return this.ops.credit(id, body.amountCents, body.description, this.actor(ctx));
  }

  @HttpCode(200)
  @Post('tenants/:id/free-months')
  freeMonths(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(freeMonthsSchema)) body: z.infer<typeof freeMonthsSchema>) {
    return this.ops.freeMonths(id, body.months, this.actor(ctx));
  }

  @HttpCode(200)
  @Post('tenants/:id/extend-trial')
  extendTrial(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(daysSchema)) body: z.infer<typeof daysSchema>) {
    return this.ops.extendTrial(id, body.days, this.actor(ctx));
  }

  @HttpCode(200)
  @Post('tenants/:id/complimentary')
  complimentary(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(complimentarySchema)) body: z.infer<typeof complimentarySchema>) {
    // Hasta el final del día indicado (hora UTC).
    const until = new Date(toDate(body.until).getTime() + 86_400_000 - 1);
    return this.ops.setComplimentary(id, { until, reason: body.reason, planCode: body.planCode }, this.actor(ctx));
  }

  @Delete('tenants/:id/complimentary')
  clearComplimentary(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.ops.clearComplimentary(id, this.actor(ctx));
  }

  @Get('addons')
  addons() {
    return this.ops.addonsOverview();
  }

  @HttpCode(200)
  @Post('tenants/:id/sync-addons')
  syncAddons(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.ops.syncAddons(id, this.actor(ctx));
  }

  @Get('webhooks')
  webhooks(@Query(zod(webhooksQuery)) q: z.infer<typeof webhooksQuery>) {
    return this.ops.webhooks(q);
  }

  @Get('webhooks/:id')
  webhook(@Param('id', zod(stripeId)) id: string) {
    return this.ops.webhook(id);
  }

  @HttpCode(200)
  @Post('webhooks/:id/replay')
  replay(@Ctx() ctx: RequestContext, @Param('id', zod(stripeId)) id: string) {
    return this.ops.replay(id, this.actor(ctx));
  }
}
