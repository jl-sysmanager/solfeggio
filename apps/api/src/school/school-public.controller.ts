import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Public } from '../auth/decorators';
import { featuresFor } from '../billing/entitlements';
import { notFound } from '../common/errors';
import { isoDate, optionalText, toDate } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { env } from '../config/env';
import { Db, Tx } from '../db/db.service';
import { Audit } from '../audit/audit.service';

const slugParam = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
const applicationSchema = z.object({
  studentFirstName: z.string().trim().min(1).max(80),
  studentLastName: z.string().trim().min(1).max(120),
  studentBirthDate: isoDate.nullable().optional(),
  guardianName: z.string().trim().min(2).max(160),
  guardianEmail: z.string().trim().email().max(254),
  guardianPhone: z.string().trim().max(30).nullable().optional(),
  subjectIds: z.array(z.string().uuid()).min(1).max(10),
  notes: optionalText(2000),
  consent: z.literal(true, { errorMap: () => ({ message: 'Debes aceptar el tratamiento de datos' }) }),
});

/** Matrícula online: oferta y solicitudes sin autenticación, resolviendo la banda por su slug. */
@ApiTags('school-public')
@Public()
@Controller('public/schools')
export class SchoolPublicController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
  ) {}

  /** Sólo bandas activas con la Escuela contratada (plan o add-on) y plan pagado. */
  private async tenantBySlug(slug: string) {
    const t = await this.db.system.tenant.findUnique({
      where: { slug },
      include: { plan: true, subscription: { select: { stripeSubscriptionId: true, stripeStatus: true } } },
    });
    if (!t || t.deletedAt || ['SUSPENDED', 'CANCELLED'].includes(t.status) || !(await featuresFor(this.db, t)).has('school')) throw notFound('Escuela');
    return t;
  }

  private async openYear(tx: Tx) {
    const year = await tx.schoolYear.findFirst({ where: { enrollmentOpen: true }, orderBy: { startsOn: 'desc' } });
    if (!year) throw notFound('Matrícula abierta');
    return year;
  }

  @Get(':slug/offer')
  async offer(@Param('slug', zod(slugParam)) slug: string) {
    const t = await this.tenantBySlug(slug);
    return this.db.tenant(t.id, async (tx) => {
      const year = await this.openYear(tx);
      const [subjects, settings] = await Promise.all([
        tx.subject.findMany({ where: { active: true }, select: { id: true, name: true, kind: true, monthlyFeeCents: true }, orderBy: [{ kind: 'asc' }, { name: 'asc' }] }),
        tx.schoolSettings.findUnique({ where: { tenantId: t.id } }),
      ]);
      return {
        band: { name: t.name, slug: t.slug },
        year: { id: year.id, name: year.name, startsOn: year.startsOn, endsOn: year.endsOn },
        subjects,
        publicIntro: settings?.publicIntro ?? null,
      };
    });
  }

  @Throttle({ default: { limit: env().RATE_LIMIT_AUTH_MAX, ttl: env().RATE_LIMIT_TTL_MS } })
  @Post(':slug/applications')
  async apply(@Param('slug', zod(slugParam)) slug: string, @Body(zod(applicationSchema)) body: z.infer<typeof applicationSchema>) {
    const t = await this.tenantBySlug(slug);
    return this.db.tenant(t.id, async (tx) => {
      const year = await this.openYear(tx);
      const ids = [...new Set(body.subjectIds)];
      const subjects = await tx.subject.count({ where: { id: { in: ids }, active: true } });
      if (subjects !== ids.length) throw new BadRequestException({ message: 'Asignatura no válida', code: 'INVALID_SUBJECT' });
      const app = await tx.enrollmentApplication.create({
        data: {
          studentFirstName: body.studentFirstName, studentLastName: body.studentLastName, guardianName: body.guardianName,
          guardianPhone: body.guardianPhone, notes: body.notes, tenantId: t.id, yearId: year.id, subjectIds: ids, guardianEmail: body.guardianEmail.toLowerCase(),
          studentBirthDate: body.studentBirthDate ? toDate(body.studentBirthDate) : null, consentAt: new Date(),
        },
      });
      await this.audit.log(tx, { tenantId: t.id, userId: '' }, 'application.received', 'enrollment_application', app.id, { subjects: ids.length });
      return { id: app.id, status: app.status, year: year.name };
    });
  }
}
