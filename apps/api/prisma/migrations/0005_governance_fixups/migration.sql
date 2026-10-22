-- Un socio presente puede representar hasta dos delegaciones de voto: una fila por (asistente, delegante).
-- Sustituye la unicidad (asamblea, socio) de 0004, que sólo permitía una delegación por asistente.
-- NULLS NOT DISTINCT: la fila de asistencia sin delegación (proxyForId nulo) tampoco se duplica.
-- schema.prisma: AssemblyAttendance @@unique([assemblyId, memberId, proxyForId]).
DROP INDEX IF EXISTS "assembly_attendance_assemblyId_memberId_key";
CREATE UNIQUE INDEX "assembly_attendance_assemblyId_memberId_proxyForId_key" ON "assembly_attendance"("assemblyId", "memberId", "proxyForId") NULLS NOT DISTINCT;
