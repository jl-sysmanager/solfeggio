import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Enrollment, Family, Guardian, Prisma } from '@prisma/client';
import type { RequestContext } from '../auth/context';
import { decrypt, mask } from '../common/crypto';
import { found } from '../common/errors';
import type { Tx } from '../db/db.service';

/** Los formularios envían '' en campos vacíos: se tratan como null. */
export const blankToNull = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, typeof x === 'string' && x.trim() === '' ? null : x]))
    : v;

export const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Evita inyección de fórmulas en hojas de cálculo.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const escapeLike = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** 1 = lunes … 7 = domingo. */
export const isoWeekday = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1;
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export function serializeFamily<T extends Family>(f: T, ctx: RequestContext) {
  const { ibanEnc, ...rest } = f;
  const sensitive = ctx.permissions.has('members:sensitive');
  return { ...rest, iban: sensitive ? decrypt(ibanEnc) : undefined, ibanMasked: mask(decrypt(ibanEnc)) };
}

export function serializeGuardian<T extends Guardian>(g: T, ctx: RequestContext) {
  const { nationalIdEnc, ...rest } = g;
  // El profesorado ve el nombre y el teléfono de los tutores; el email y el DNI quedan para la secretaría.
  if (!ctx.permissions.has('school:write')) rest.email = null;
  return { ...rest, nationalId: ctx.permissions.has('members:sensitive') ? decrypt(nationalIdEnc) : undefined, hasNationalId: !!nationalIdEnc };
}

/**
 * Un profesor vinculado a un usuario sólo puede pasar lista y evaluar en sus grupos, salvo que
 * además gestione la escuela (`school:write`). Otros perfiles con `school:teach` (dirección) no se limitan.
 */
export async function assertCanTeachGroup(tx: Tx, ctx: RequestContext, groupId: string) {
  const group = found(await tx.classGroup.findUnique({ where: { id: groupId }, include: { teacher: true } }), 'Grupo');
  if (ctx.permissions.has('school:write')) return group;
  const mine = await tx.teacher.findMany({ where: { userId: ctx.userId }, select: { id: true } });
  if (mine.length && !mine.some((t) => t.id === group.teacherId)) {
    throw new ForbiddenException({ message: 'Sólo puedes gestionar tus propios grupos', code: 'NOT_YOUR_GROUP' });
  }
  return group;
}

/** Matricula respetando el cupo: si el grupo está completo, queda en lista de espera. */
export async function enroll(tx: Tx, tenantId: string, studentId: string, groupId: string): Promise<Enrollment> {
  const group = found(await tx.classGroup.findUnique({ where: { id: groupId } }), 'Grupo');
  const student = found(await tx.student.findUnique({ where: { id: studentId } }), 'Alumno');
  if (student.status === 'LEFT') throw new ConflictException({ message: 'El alumno está dado de baja', code: 'STUDENT_LEFT' });
  const existing = await tx.enrollment.findUnique({ where: { groupId_studentId: { groupId, studentId } } });
  if (existing && existing.status !== 'WITHDRAWN') throw new ConflictException({ message: 'El alumno ya está matriculado en este grupo', code: 'ALREADY_ENROLLED' });
  const active = await tx.enrollment.count({ where: { groupId, status: 'ACTIVE' } });
  const status = group.capacity !== null && active >= group.capacity ? 'WAITLIST' : 'ACTIVE';
  if (existing) return tx.enrollment.update({ where: { id: existing.id }, data: { status, enrolledAt: new Date(), withdrawnAt: null } });
  return tx.enrollment.create({ data: { tenantId, studentId, groupId, status } });
}

/** Baja de una matrícula: si deja plaza libre, entra el primero de la lista de espera. */
export async function withdraw(tx: Tx, enrollmentId: string) {
  const e = found(await tx.enrollment.findUnique({ where: { id: enrollmentId }, include: { group: true } }), 'Matrícula');
  if (e.status === 'WITHDRAWN') return { enrollment: e, promoted: null };
  const enrollment = await tx.enrollment.update({ where: { id: e.id }, data: { status: 'WITHDRAWN', withdrawnAt: new Date() } });
  let promoted: Enrollment | null = null;
  if (e.status === 'ACTIVE') {
    const active = await tx.enrollment.count({ where: { groupId: e.groupId, status: 'ACTIVE' } });
    if (e.group.capacity === null || active < e.group.capacity) {
      const next = await tx.enrollment.findFirst({ where: { groupId: e.groupId, status: 'WAITLIST' }, orderBy: { enrolledAt: 'asc' } });
      if (next) promoted = await tx.enrollment.update({ where: { id: next.id }, data: { status: 'ACTIVE' } });
    }
  }
  return { enrollment, promoted };
}

export interface SlotInfo {
  id: string;
  groupId: string;
  groupName: string;
  weekday: number;
  startMin: number;
  endMin: number;
  roomId: string | null;
  teacherId: string | null;
  studentIds: string[];
}

export interface ScheduleConflict {
  a: Omit<SlotInfo, 'studentIds'>;
  b: Omit<SlotInfo, 'studentIds'>;
  reasons: ('ROOM' | 'TEACHER' | 'STUDENT')[];
  studentIds: string[];
}

async function yearSlots(tx: Tx, yearId: string): Promise<SlotInfo[]> {
  const groups = await tx.classGroup.findMany({
    where: { yearId },
    include: { slots: true, enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } } },
  });
  return groups.flatMap((g) =>
    g.slots.map((s) => ({
      id: s.id, groupId: g.id, groupName: g.name, weekday: s.weekday, startMin: s.startMin, endMin: s.endMin,
      roomId: s.roomId, teacherId: g.teacherId, studentIds: g.enrollments.map((e) => e.studentId),
    })),
  );
}

function compare(a: SlotInfo, b: SlotInfo): ScheduleConflict | null {
  if (a.id === b.id || a.weekday !== b.weekday || !(a.startMin < b.endMin && b.startMin < a.endMin)) return null;
  const reasons: ScheduleConflict['reasons'] = [];
  if (a.roomId && a.roomId === b.roomId) reasons.push('ROOM');
  if (a.teacherId && a.teacherId === b.teacherId) reasons.push('TEACHER');
  const shared = a.groupId === b.groupId ? [] : a.studentIds.filter((s) => b.studentIds.includes(s));
  if (shared.length) reasons.push('STUDENT');
  if (!reasons.length) return null;
  const strip = ({ studentIds: _s, ...rest }: SlotInfo) => rest;
  return { a: strip(a), b: strip(b), reasons, studentIds: shared };
}

/** Solapes de aula, profesor o alumnos en el horario semanal de un curso. */
export async function yearConflicts(tx: Tx, yearId: string): Promise<ScheduleConflict[]> {
  const slots = await yearSlots(tx, yearId);
  const out: ScheduleConflict[] = [];
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const c = compare(slots[i], slots[j]);
      if (c) out.push(c);
    }
  }
  return out;
}

/** Comprueba una franja nueva o modificada contra el resto del curso; 409 salvo `force`. */
export async function assertNoSlotConflict(
  tx: Tx,
  group: { id: string; name: string; yearId: string; teacherId: string | null },
  slot: { id?: string; weekday: number; startMin: number; endMin: number; roomId: string | null },
  force?: boolean,
) {
  const slots = await yearSlots(tx, group.yearId);
  const own = slots.find((s) => s.groupId === group.id);
  const studentIds = own?.studentIds ?? (await tx.enrollment.findMany({ where: { groupId: group.id, status: 'ACTIVE' }, select: { studentId: true } })).map((e) => e.studentId);
  const candidate: SlotInfo = { id: slot.id ?? 'new', groupId: group.id, groupName: group.name, teacherId: group.teacherId, studentIds, ...slot };
  const conflicts = slots.map((s) => compare(candidate, s)).filter((c): c is ScheduleConflict => !!c);
  if (conflicts.length && !force) {
    throw new ConflictException({ message: 'La franja se solapa con otras clases', code: 'SCHEDULE_CONFLICT', details: conflicts });
  }
  return conflicts;
}

export interface TuitionLine {
  groupId: string;
  label: string;
  cents: number;
}
export interface TuitionDetail {
  lines: TuitionLine[];
  discounts: { kind: 'SIBLING' | 'MEMBER' | 'MULTI_SUBJECT'; pct: number }[];
  pct: number;
}

type StudentForTuition = Prisma.StudentGetPayload<{
  include: {
    family: { include: { guardians: { select: { memberId: true } } } };
    enrollments: { include: { group: { include: { subject: true } } } };
  };
}>;

/**
 * Calcula las mensualidades de un periodo. Descuentos (en % y sumados, máximo 100):
 * hermanos (del 2º en adelante por fecha de nacimiento), socio (el alumno o algún tutor es socio)
 * y varias asignaturas (2 o más matrículas activas).
 */
export function computeTuition(
  students: StudentForTuition[],
  settings: { siblingDiscountPct: number; memberDiscountPct: number; multiSubjectDiscountPct: number },
) {
  const byFamily = new Map<string, StudentForTuition[]>();
  for (const s of students) {
    if (!s.familyId || !s.enrollments.length) continue;
    byFamily.set(s.familyId, [...(byFamily.get(s.familyId) ?? []), s]);
  }
  const siblings = new Set<string>();
  for (const list of byFamily.values()) {
    const sorted = [...list].sort((a, b) => (a.birthDate?.getTime() ?? Infinity) - (b.birthDate?.getTime() ?? Infinity) || a.createdAt.getTime() - b.createdAt.getTime());
    sorted.slice(1).forEach((s) => siblings.add(s.id));
  }
  return students
    .filter((s) => s.enrollments.length)
    .map((s) => {
      const lines = s.enrollments.map((e) => ({
        groupId: e.groupId,
        label: `${e.group.subject.name} · ${e.group.name}`,
        cents: e.group.monthlyFeeCents ?? e.group.subject.monthlyFeeCents,
      }));
      const baseCents = lines.reduce((sum, l) => sum + l.cents, 0);
      const discounts: TuitionDetail['discounts'] = [];
      if (siblings.has(s.id) && settings.siblingDiscountPct) discounts.push({ kind: 'SIBLING', pct: settings.siblingDiscountPct });
      const isMember = !!s.memberId || !!s.family?.guardians.some((g) => g.memberId);
      if (isMember && settings.memberDiscountPct) discounts.push({ kind: 'MEMBER', pct: settings.memberDiscountPct });
      if (s.enrollments.length >= 2 && settings.multiSubjectDiscountPct) discounts.push({ kind: 'MULTI_SUBJECT', pct: settings.multiSubjectDiscountPct });
      const pct = Math.min(100, discounts.reduce((sum, d) => sum + d.pct, 0));
      const discountCents = Math.round((baseCents * pct) / 100);
      const detail: TuitionDetail = { lines, discounts, pct };
      return { studentId: s.id, familyId: s.familyId, baseCents, discountCents, amountCents: baseCents - discountCents, detail };
    });
}

/** Usuarios del portal de familias con alumnos activos (en un grupo concreto o en toda la escuela). */
export async function familyUserIds(tx: Tx, groupId?: string | null) {
  const students = await tx.student.findMany({
    where: { status: 'ACTIVE', familyId: { not: null }, enrollments: { some: { status: 'ACTIVE', ...(groupId && { groupId }) } } },
    select: { familyId: true },
  });
  const familyIds = [...new Set(students.map((s) => s.familyId!))];
  if (!familyIds.length) return [];
  const guardians = await tx.guardian.findMany({ where: { familyId: { in: familyIds } }, select: { id: true } });
  const memberships = await tx.membership.findMany({
    where: { status: 'ACTIVE', guardianId: { in: guardians.map((g) => g.id) } },
    select: { userId: true },
  });
  return [...new Set(memberships.map((m) => m.userId))];
}
