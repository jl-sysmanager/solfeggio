import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { found } from '../common/errors';
import { idParam, isoDate, optionalText, toDate } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { Audit } from '../audit/audit.service';

const condition = z.enum(['NEW', 'GOOD', 'WORN', 'DAMAGED']);
const itemSchema = z.object({
  code: z.string().trim().min(1).max(40),
  garment: z.string().trim().min(1).max(60),
  size: z.string().trim().min(1).max(20),
  condition: condition.optional(),
  status: z.enum(['AVAILABLE', 'MAINTENANCE', 'RETIRED']).optional(),
  notes: optionalText(500),
});
const itemsQuery = z.object({ status: z.enum(['AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'RETIRED']).optional(), garment: z.string().max(60).optional() });
const deliverSchema = z.object({ memberId: z.string().uuid(), dueAt: isoDate.nullable().optional(), conditionOut: condition, notes: optionalText(500) });
const returnSchema = z.object({ conditionIn: condition, notes: optionalText(500) });

@ApiTags('wardrobe')
@ApiBearerAuth()
@RequireFeature('wardrobe')
@Controller('wardrobe')
export class WardrobeController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
  ) {}

  @Perm('wardrobe:read')
  @Get('items')
  items(@Ctx() ctx: RequestContext, @Query(zod(itemsQuery)) q: z.infer<typeof itemsQuery>) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.uniformItem.findMany({
        where: { status: q.status, garment: q.garment ? { equals: q.garment, mode: 'insensitive' } : undefined },
        include: { loans: { where: { returnedAt: null }, include: { member: { select: { id: true, firstName: true, lastName: true } } } } },
        orderBy: [{ garment: 'asc' }, { code: 'asc' }],
      }),
    );
  }

  @Perm('wardrobe:write')
  @Post('items')
  create(@Ctx() ctx: RequestContext, @Body(zod(itemSchema)) body: z.infer<typeof itemSchema>) {
    return this.db.tenant(ctx.tenantId, (tx) => tx.uniformItem.create({ data: { ...body, tenantId: ctx.tenantId } }));
  }

  @Perm('wardrobe:write')
  @Patch('items/:id')
  update(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(itemSchema.partial())) body: Partial<z.infer<typeof itemSchema>>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const item = found(await tx.uniformItem.findUnique({ where: { id } }), 'Prenda');
      if (item.status === 'ASSIGNED' && body.status) throw new BadRequestException({ message: 'La prenda está entregada', code: 'ITEM_ASSIGNED' });
      return tx.uniformItem.update({ where: { id }, data: body });
    });
  }

  @Perm('wardrobe:write')
  @Post('items/:id/deliver')
  deliver(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(deliverSchema)) body: z.infer<typeof deliverSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.member.findUnique({ where: { id: body.memberId } }), 'Socio');
      // Transición condicional: evita entregar dos veces la misma prenda en peticiones concurrentes.
      const { count } = await tx.uniformItem.updateMany({ where: { id, status: 'AVAILABLE' }, data: { status: 'ASSIGNED', condition: body.conditionOut } });
      if (count === 0) {
        found(await tx.uniformItem.findUnique({ where: { id } }), 'Prenda');
        throw new BadRequestException({ message: 'La prenda no está disponible', code: 'ITEM_NOT_AVAILABLE' });
      }
      const loan = await tx.uniformLoan.create({
        data: { tenantId: ctx.tenantId, itemId: id, memberId: body.memberId, conditionOut: body.conditionOut, dueAt: body.dueAt ? toDate(body.dueAt) : null, notes: body.notes },
      });
      await this.audit.log(tx, ctx, 'uniform.delivered', 'uniform_item', id, { memberId: body.memberId });
      return loan;
    });
  }

  @Perm('wardrobe:read')
  @Get('loans')
  loans(@Ctx() ctx: RequestContext, @Query('open') open?: string) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.uniformLoan.findMany({
        where: open === 'true' ? { returnedAt: null } : undefined,
        include: { item: true, member: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { deliveredAt: 'desc' },
        take: 500,
      }),
    );
  }

  @Perm('wardrobe:write')
  @HttpCode(200)
  @Post('loans/:id/return')
  returnLoan(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(returnSchema)) body: z.infer<typeof returnSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const loan = found(await tx.uniformLoan.findUnique({ where: { id } }), 'Entrega');
      if (loan.returnedAt) throw new BadRequestException({ message: 'Ya devuelta', code: 'ALREADY_RETURNED' });
      const updated = await tx.uniformLoan.update({ where: { id }, data: { returnedAt: new Date(), conditionIn: body.conditionIn, notes: body.notes ?? loan.notes } });
      await tx.uniformItem.update({
        where: { id: loan.itemId },
        data: { status: body.conditionIn === 'DAMAGED' ? 'MAINTENANCE' : 'AVAILABLE', condition: body.conditionIn },
      });
      await this.audit.log(tx, ctx, 'uniform.returned', 'uniform_item', loan.itemId, { conditionIn: body.conditionIn });
      return updated;
    });
  }

  /** Tallas de socios activos: base para planificar pedidos. */
  @Perm('wardrobe:read')
  @Get('sizes')
  sizes(@Ctx() ctx: RequestContext, @Query('garment') garment?: string) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.memberSize.findMany({
        where: { garment: garment ? { equals: garment.slice(0, 60), mode: 'insensitive' } : undefined, member: { status: 'ACTIVE' } },
        include: { member: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: [{ garment: 'asc' }, { size: 'asc' }],
      }),
    );
  }
}
