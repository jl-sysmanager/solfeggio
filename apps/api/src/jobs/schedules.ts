/** Catálogo cerrado de procesos periódicos que un administrador puede programar. */
export const SCHEDULE_CATALOG = [
  { key: 'events.reminders', label: 'Recordatorios de convocatorias', description: 'Avisa a los músicos antes de ensayos y actuaciones.', pattern: '*/15 * * * *' },
  { key: 'billing.grace-sweep', label: 'Revisión de periodos de gracia', description: 'Actualiza el acceso tras incidencias de facturación.', pattern: '5 * * * *' },
  { key: 'finance.overdue', label: 'Actualización de cuotas vencidas', description: 'Marca como vencidos los recibos de socios y las mensualidades de la escuela que han superado su fecha límite.', pattern: '30 3 * * *' },
  { key: 'school.tuition-issue', label: 'Emisión de mensualidades', description: 'Emite las mensualidades de las escuelas que tienen programado el día de emisión.', pattern: '0 6 * * *' },
  { key: 'storage.recount', label: 'Recuento de almacenamiento', description: 'Recalcula el espacio usado por cada banda.', pattern: '0 4 * * *' },
  { key: 'platform.snapshot', label: 'Instantánea de métricas', description: 'Guarda las métricas diarias de la plataforma.', pattern: '30 2 * * *' },
  { key: 'support.sla-sweep', label: 'Control de SLA de soporte', description: 'Revisa los plazos de las incidencias de soporte.', pattern: '*/15 * * * *' },
  { key: 'billing.reconcile-addons', label: 'Conciliación de complementos', description: 'Sincroniza los complementos contratados con facturación.', pattern: '15 3 * * *' },
  { key: 'ops.orphan-scan', label: 'Análisis de huérfanos', description: 'Busca objetos almacenados sin referencia y cuentas que no son del equipo ni de ninguna banda.', pattern: '0 5 * * 0' },
  { key: 'backups.export-tenants', label: 'Copia de las bandas', description: 'Guarda una copia de los datos de cada banda. Restaurarla sustituye la banda original.', pattern: '0 1 * * *' },
] as const;

export type ScheduledTaskKey = (typeof SCHEDULE_CATALOG)[number]['key'];
export const scheduledTask = (key: string) => SCHEDULE_CATALOG.find((task) => task.key === key);
