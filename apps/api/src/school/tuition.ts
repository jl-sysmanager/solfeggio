import { BadRequestException } from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
import { found } from '../common/errors';
import type { Tx } from '../db/db.service';
import { computeTuition } from './school.helpers';

export const PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER', 'DIRECT_DEBIT', 'BIZUM', 'OTHER'] as const satisfies readonly PaymentMethod[];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  DIRECT_DEBIT: 'Domiciliación',
  BIZUM: 'Bizum',
  OTHER: 'Otro',
};
const CATEGORY = 'Escuela de música';

export type TuitionSettings = {
  feeMode?: 'PERCENT' | 'FIXED';
  siblingDiscountPct: number;
  memberDiscountPct: number;
  multiSubjectDiscountPct: number;
  familyDiscountCents?: number;
};
const NO_DISCOUNTS: TuitionSettings = { siblingDiscountPct: 0, memberDiscountPct: 0, multiSubjectDiscountPct: 0, familyDiscountCents: 0 };

/** Alumnos activos con lo necesario para calcular su mensualidad en un curso. */
function studentsForYear(tx: Tx, yearId: string) {
  return tx.student.findMany({
    where: { status: 'ACTIVE' },
    include: {
      tuitionTariff: { select: { id: true, name: true, monthlyCents: true } },
      family: { include: { guardians: { select: { memberId: true } } } },
      enrollments: { where: { status: 'ACTIVE', group: { yearId } }, include: { group: { include: { subject: true } } } },
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
}

/**
 * Lo que pagaría cada alumno con la configuración guardada o con otra que aún no se ha guardado
 * (el simulador de Configuración). Los hermanos se calculan sobre toda la escuela.
 */
export async function previewTuition(tx: Tx, tenantId: string, yearId: string, override?: Partial<TuitionSettings>) {
  const [saved, students] = await Promise.all([tx.schoolSettings.findUnique({ where: { tenantId } }), studentsForYear(tx, yearId)]);
  const settings = { ...NO_DISCOUNTS, ...saved, ...override };
  const names = new Map(students.map((s) => [s.id, { firstName: s.firstName, lastName: s.lastName, family: s.family ? { id: s.family.id, name: s.family.name } : null }]));
  return computeTuition(students, settings)
    .filter((r) => r.baseCents > 0)
    .map((r) => ({ ...r, student: names.get(r.studentId)! }));
}

/** Emite las mensualidades del periodo. Idempotente por (alumno, periodo): devuelve sólo las creadas ahora. */
export async function issueTuition(tx: Tx, tenantId: string, body: { yearId: string; period: string; dueDate: Date }) {
  found(await tx.schoolYear.findUnique({ where: { id: body.yearId } }), 'Curso');
  const rows = await previewTuition(tx, tenantId, body.yearId);
  const existing = new Set(
    (await tx.tuitionCharge.findMany({ where: { period: body.period, studentId: { in: rows.map((r) => r.studentId) } }, select: { studentId: true } })).map((c) => c.studentId),
  );
  const fresh = rows.filter((r) => !existing.has(r.studentId));
  if (fresh.length) {
    await tx.tuitionCharge.createMany({
      data: fresh.map((r) => ({
        tenantId, yearId: body.yearId, studentId: r.studentId, familyId: r.familyId, period: body.period, baseCents: r.baseCents,
        discountCents: r.discountCents, amountCents: r.amountCents, detail: r.detail as unknown as Prisma.InputJsonValue, dueDate: body.dueDate,
      })),
      skipDuplicates: true,
    });
  }
  return { created: fresh.length, skipped: rows.length - fresh.length, studentIds: fresh.map((r) => r.studentId) };
}

/** Marca pagada una mensualidad y registra el ingreso en la categoría «Escuela de música». */
export async function payCharge(tx: Tx, tenantId: string, userId: string, id: string, date: Date, method: PaymentMethod) {
  const charge = found(await tx.tuitionCharge.findUnique({ where: { id }, include: { student: true } }), 'Mensualidad');
  if (charge.status === 'PAID' || charge.status === 'WAIVED') throw new BadRequestException({ message: 'La mensualidad ya está cerrada', code: 'CHARGE_CLOSED' });
  const category = await tx.financeCategory.upsert({
    where: { tenantId_name_kind: { tenantId, name: CATEGORY, kind: 'INCOME' } },
    create: { tenantId, name: CATEGORY, kind: 'INCOME' },
    update: {},
  });
  const t = await tx.transaction.create({
    data: {
      tenantId, kind: 'INCOME', amountCents: charge.amountCents, date, categoryId: category.id,
      description: `Mensualidad ${charge.period} · ${charge.student.firstName} ${charge.student.lastName} (${PAYMENT_METHOD_LABEL[method].toLowerCase()})`,
      memberId: charge.student.memberId, createdById: userId,
    },
  });
  return tx.tuitionCharge.update({ where: { id }, data: { status: 'PAID', paidAt: date, paymentMethod: method, transactionId: t.id } });
}

const euros = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

/**
 * Emails a las familias por los recibos recién emitidos: uno por familia con el total y el detalle.
 * Devuelve los destinatarios (los tutores con email) para encolarlos fuera de la transacción.
 */
export async function tuitionEmails(tx: Tx, tenantName: string, period: string, studentIds: string[]) {
  if (!studentIds.length) return [];
  const charges = await tx.tuitionCharge.findMany({
    where: { period, studentId: { in: studentIds }, familyId: { not: null } },
    include: { student: { select: { firstName: true } }, family: { include: { guardians: { where: { email: { not: null } }, select: { email: true } } } } },
  });
  const byFamily = new Map<string, typeof charges>();
  for (const c of charges) byFamily.set(c.familyId!, [...(byFamily.get(c.familyId!) ?? []), c]);
  return [...byFamily.values()].flatMap((list) => {
    const total = list.reduce((s, c) => s + c.amountCents, 0);
    const lines = list.map((c) => `- ${c.student.firstName}: ${euros(c.amountCents)}`).join('\n');
    const due = list[0].dueDate.toISOString().slice(0, 10).split('-').reverse().join('/');
    const subject = `${tenantName}: mensualidad de la escuela (${period})`;
    const text = `Hola:\n\nYa está emitida la mensualidad de ${period} de la escuela de música.\n\n${lines}\n\nTotal: ${euros(total)}. Vence el ${due}.\n\nPuedes consultar los recibos en el portal de familias.`;
    return list[0].family!.guardians.map((g) => ({ to: g.email!, subject, text }));
  });
}

/** `YYYY-MM` del día dado en la zona de Madrid y el día del mes. */
export function madridToday(now = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-');
  return { period: `${y}-${m}`, day: Number(d), iso: `${y}-${m}-${d}` };
}
