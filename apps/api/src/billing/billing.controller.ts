import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post, RawBodyRequest, Req, ServiceUnavailableException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { AllowReadOnly, Ctx, Perm, Public } from '../auth/decorators';
import { zod } from '../common/zod.pipe';
import { BillingService } from './billing.service';
import { StripeClient } from './stripe.provider';

const checkoutSchema = z.object({ planCode: z.enum(['BASIC', 'PRO', 'ENTERPRISE']), interval: z.enum(['MONTH', 'YEAR']) });

@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly stripe: StripeClient,
  ) {}

  @ApiBearerAuth()
  @Perm('billing:manage')
  @Get('billing')
  overview(@Ctx() ctx: RequestContext) {
    return this.billing.overview(ctx.tenantId);
  }

  @ApiBearerAuth()
  @Perm('billing:manage')
  @AllowReadOnly()
  @HttpCode(200)
  @Post('billing/checkout')
  checkout(@Ctx() ctx: RequestContext, @Body(zod(checkoutSchema)) body: z.infer<typeof checkoutSchema>) {
    return this.billing.checkout(ctx.tenantId, ctx.email, body.planCode, body.interval);
  }

  @ApiBearerAuth()
  @Perm('billing:manage')
  @AllowReadOnly()
  @HttpCode(200)
  @Post('billing/portal')
  portal(@Ctx() ctx: RequestContext) {
    return this.billing.portal(ctx.tenantId, ctx.email);
  }

  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Post('webhooks/stripe')
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    if (!signature || !req.rawBody) throw new BadRequestException({ message: 'Firma ausente', code: 'SIGNATURE_MISSING' });
    let event;
    try {
      event = await this.stripe.constructEvent(req.rawBody, signature);
    } catch (e) {
      // Pagos deshabilitados o sin configurar: 503 para que Stripe reintente más tarde.
      if (e instanceof ServiceUnavailableException) throw e;
      throw new BadRequestException({ message: 'Firma no válida', code: 'SIGNATURE_INVALID' });
    }
    return { received: true, result: await this.billing.handleEvent(event) };
  }
}
