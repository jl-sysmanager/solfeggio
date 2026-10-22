import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { found } from '../common/errors';
import { cents, idParam, isoDate, optionalText, toDate } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { Audit } from '../audit/audit.service';

const instrumentSchema = z.object({
  inventoryCode: z.string().trim().min(1).max(40),
  type: z.string().trim().min(1).max(60),
  brand: optionalText(60),
  model: optionalText(60),
  serialNumber: optionalText(60),
  purchaseDate: isoDate.nullable().optional(),
  purchasePriceCents: cents.nullable().optional(),
  condition: z.enum(['NEW', 'GOOD', 'WORN', 'DAMAGED']).optional(),
  status: z.enum(['AVAILABLE', 'MAINTENANCE', 'RETIRED']).optional(),
  notes: optionalText(1000),
});
const listQuery = z.object({
  status: z.enum(['AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'RETIRED']).optional(),
  type: z.string().max(60).optional(),
  q: z.string().trim().max(100).optional(),
});
const assignSchema = z.object({ memberId: z.string().uuid(), notes: optionalText(500) });
const maintenanceSchema = z.object({
  type: z.enum(['MAINTENANCE', 'REPAIR']),
  description: z.string().trim().min(1).max(1000),
  provider: optionalText(120),
  costCents: cents.nullable().optional(),
});
const completeSchema = z.object({ costCents: cents.nullable().optional() });

const toData = (b: Partial<z.infer<typeof instrumentSchema>>) => ({
  ...b,
  ...(b.purchaseDate !== undefined && { purchaseDate: b.purchaseDate ? toDate(b.purchaseDate) : null }),
});

@ApiTags('instruments')
@ApiBearerAuth()
@RequireFeature('instruments')
@Controller()
export class InstrumentsController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
  ) {}

  @Perm('instruments:read')
  @Get('instruments')
  list(@Ctx() ctx: RequestContext, @Query(zod(listQuery)) q: z.infer<typeof listQuery>) {
    return this.db.tenant(ctx.tenantId, (tx) => {
      const where: Prisma.InstrumentWhereInput = {
        status: q.status,
        type: q.type ? { equals: q.type, mode: 'insensitive' } : undefined,
        ...(q.q && {
          OR: ['inventoryCode', 'type', 'brand', 'model', 'serialNumber'].map((f) => ({ [f]: { contains: q.q, mode: 'insensitive' } })),
        }),
      };
      return tx.instrument.findMany({
        where,
        include: { assignments: { where: { endAt: null }, include: { member: { select: { id: true, firstName: true, lastName: true } } } } },
        orderBy: [{ type: 'asc' }, { inventoryCode: 'asc' }],
      });
    });
  }

  @Perm('instruments:write')
  @Post('instruments')
  create(@Ctx() ctx: RequestContext, @Body(zod(instrumentSchema)) body: z.infer<typeof instrumentSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const i = await tx.instrument.create({ data: { ...(toData(body) as Prisma.InstrumentUncheckedCreateInput), tenantId: ctx.tenantId } });
      await this.audit.log(tx, ctx, 'instrument.created', 'instrument', i.id, { inventoryCode: i.inventoryCode });
      return i;
    });
  }

  @Perm('instruments:read')
  @Get('instruments/:id')
  get(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) =>
      found(
        await tx.instrument.findUnique({
          where: { id },
          include: {
            assignments: { orderBy: { startAt: 'desc' }, include: { member: { select: { id: true, firstName: true, lastName: true } } } },
            maintenance: { orderBy: { startedAt: 'desc' } },
          },
        }),
        'Instrumento',
      ),
    );
  }

  @Perm('instruments:write')
  @Patch('instruments/:id')
  update(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(instrumentSchema.partial())) body: Partial<z.infer<typeof instrumentSchema>>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const i = found(await tx.instrument.findUnique({ where: { id } }), 'Instrumento');
      if (i.status === 'ASSIGNED' && body.status) throw new BadRequestException({ message: 'Finaliza antes la asignación', code: 'INSTRUMENT_ASSIGNED' });
      return tx.instrument.update({ where: { id }, data: toData(body) });
    });
  }

  @Perm('instruments:write')
  @Post('instruments/:id/assign')
  assign(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(assignSchema)) body: z.infer<typeof assignSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.member.findUnique({ where: { id: body.memberId } }), 'Socio');
      const { count } = await tx.instrument.updateMany({ where: { id, status: 'AVAILABLE' }, data: { status: 'ASSIGNED' } });
      if (count === 0) {
        found(await tx.instrument.findUnique({ where: { id } }), 'Instrumento');
        throw new BadRequestException({ message: 'El instrumento no está disponible', code: 'INSTRUMENT_NOT_AVAILABLE' });
      }
      const a = await tx.instrumentAssignment.create({ data: { tenantId: ctx.tenantId, instrumentId: id, memberId: body.memberId, notes: body.notes } });
      await this.audit.log(tx, ctx, 'instrument.assigned', 'instrument', id, { memberId: body.memberId });
      return a;
    });
  }

  @Perm('instruments:write')
  @HttpCode(200)
  @Post('instrument-assignments/:id/end')
  endAssignment(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const a = found(await tx.instrumentAssignment.findUnique({ where: { id } }), 'Asignación');
      if (a.endAt) throw new BadRequestException({ message: 'La asignación ya terminó', code: 'ALREADY_ENDED' });
      const updated = await tx.instrumentAssignment.update({ where: { id }, data: { endAt: new Date() } });
      await tx.instrument.update({ where: { id: a.instrumentId }, data: { status: 'AVAILABLE' } });
      await this.audit.log(tx, ctx, 'instrument.returned', 'instrument', a.instrumentId);
      return updated;
    });
  }

  @Perm('instruments:write')
  @Post('instruments/:id/maintenance')
  maintenance(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(maintenanceSchema)) body: z.infer<typeof maintenanceSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const i = found(await tx.instrument.findUnique({ where: { id } }), 'Instrumento');
      const rec = await tx.maintenanceRecord.create({ data: { ...body, tenantId: ctx.tenantId, instrumentId: id } });
      // Una reparación saca el instrumento de servicio salvo que esté asignado (se repara con el músico).
      if (body.type === 'REPAIR' && i.status === 'AVAILABLE') await tx.instrument.update({ where: { id }, data: { status: 'MAINTENANCE' } });
      await this.audit.log(tx, ctx, 'instrument.maintenance', 'instrument', id, { type: body.type });
      return rec;
    });
  }

  @Perm('instruments:write')
  @HttpCode(200)
  @Post('maintenance/:id/complete')
  complete(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(completeSchema)) body: z.infer<typeof completeSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const rec = found(await tx.maintenanceRecord.findUnique({ where: { id } }), 'Mantenimiento');
      if (rec.status === 'DONE') throw new BadRequestException({ message: 'Ya está completado', code: 'ALREADY_DONE' });
      const updated = await tx.maintenanceRecord.update({
        where: { id },
        data: { status: 'DONE', completedAt: new Date(), costCents: body.costCents ?? rec.costCents },
      });
      const open = await tx.maintenanceRecord.count({ where: { instrumentId: rec.instrumentId, status: 'OPEN', type: 'REPAIR' } });
      if (open === 0) await tx.instrument.updateMany({ where: { id: rec.instrumentId, status: 'MAINTENANCE' }, data: { status: 'AVAILABLE' } });
      return updated;
    });
  }
}
