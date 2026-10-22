import type { Feature } from '../iam/permissions';

/**
 * Catálogo de funcionalidades que se pueden incluir en un plan, agrupadas por módulo. Es la única fuente
 * de verdad de lo que existe: sólo figura lo que está implementado y protegido en el API con
 * `@RequireFeature`. Las funcionalidades que aún no existen (SSO, API pública, informes avanzados,
 * soporte prioritario) no están aquí y no se pueden asignar a ningún plan; se añaden cuando se construyan.
 */
export interface FeatureDef {
  key: Feature;
  label: string;
  description: string;
  /** Funcionalidades que deben estar activas para que ésta tenga sentido (comparten datos). */
  requires: Feature[];
}

export interface ModuleDef {
  key: string;
  label: string;
  description: string;
  features: FeatureDef[];
}

export const FEATURE_MODULES: ModuleDef[] = [
  {
    key: 'secretaria',
    label: 'Secretaría',
    description: 'Socios, documentos y comunicación con ellos.',
    features: [
      { key: 'members', label: 'Socios y documentos', description: 'Altas y bajas, secciones, datos personales cifrados, consentimientos, documentos y derechos RGPD.', requires: [] },
      { key: 'communications', label: 'Comunicaciones', description: 'Envío de avisos y correos a toda la banda, por sección o a socios concretos.', requires: ['members'] },
    ],
  },
  {
    key: 'musica',
    label: 'Música',
    description: 'Repertorio, ensayos y asistencia.',
    features: [
      { key: 'archive', label: 'Archivo musical', description: 'Obras, partituras, particellas y audios, búsqueda, informe SGAE, libretos y préstamos entre bandas.', requires: [] },
      { key: 'archive_ai', label: 'Particellas automáticas', description: 'Detecta el instrumento de cada página de un PDF y lo divide en particellas.', requires: ['archive'] },
      { key: 'events', label: 'Ensayos y agenda', description: 'Ensayos y actuaciones, repertorio, convocatorias, recordatorios y agenda unificada.', requires: [] },
      { key: 'attendance', label: 'Asistencia', description: 'Pasar lista, justificaciones y estadísticas de asistencia.', requires: ['events'] },
    ],
  },
  {
    key: 'actuaciones',
    label: 'Actuaciones',
    description: 'Contratación y refuerzos para actuar.',
    features: [
      { key: 'performances', label: 'Contrataciones', description: 'Clientes, presupuestos y contratos, facturas encadenadas, plantilla mínima y logística por evento.', requires: ['events'] },
      { key: 'reinforcements', label: 'Bolsa de refuerzos', description: 'Necesidades y candidaturas entre bandas, músicos externos y pagos con retención.', requires: ['events'] },
    ],
  },
  {
    key: 'escuela',
    label: 'Escuela de música',
    description: 'Gestión completa de la escuela.',
    features: [
      { key: 'school', label: 'Escuela de música', description: 'Alumnos y familias, matrícula online, grupos y horarios, clases, notas, mensualidades y portal de familias.', requires: ['members'] },
    ],
  },
  {
    key: 'gestion',
    label: 'Tesorería y material',
    description: 'Cuentas, uniformes e instrumentos.',
    features: [
      { key: 'treasury', label: 'Tesorería', description: 'Ingresos y gastos, cuotas y recibos, informes, subvenciones, lotería y donantes.', requires: ['members'] },
      { key: 'wardrobe', label: 'Mayordomía', description: 'Uniformes, tallas, entregas y devoluciones.', requires: ['members'] },
      { key: 'instruments', label: 'Instrumentación', description: 'Inventario, asignaciones, mantenimiento y reparaciones.', requires: ['members'] },
    ],
  },
  {
    key: 'gobierno',
    label: 'Gobierno',
    description: 'Vida asociativa.',
    features: [
      { key: 'governance', label: 'Gobierno de la asociación', description: 'Asambleas con quórum y votación, libro de actas, junta directiva y encuestas.', requires: ['members'] },
    ],
  },
  {
    key: 'comunidad',
    label: 'Comunidad',
    description: 'Relación con otras bandas y calendarios externos.',
    features: [
      { key: 'market', label: 'BandMarket', description: 'Compra y venta de instrumentos y material entre bandas, con moderación.', requires: [] },
      { key: 'calendar_sync', label: 'Calendario externo', description: 'Suscripción personal (ICS) desde Google, Apple u Outlook.', requires: ['events'] },
    ],
  },
];

export const FEATURE_DEFS: FeatureDef[] = FEATURE_MODULES.flatMap((m) => m.features);
export const FEATURE_KEYS: Feature[] = FEATURE_DEFS.map((f) => f.key);

/** Añade las dependencias que falten (cierre transitivo). */
export function withDependencies(features: readonly string[]): string[] {
  const set = new Set(features);
  let changed = true;
  while (changed) {
    changed = false;
    for (const def of FEATURE_DEFS) {
      if (set.has(def.key)) for (const r of def.requires) if (!set.has(r)) (set.add(r), (changed = true));
    }
  }
  return [...set];
}

/** Dependencias que faltan: `[{ feature, requires }]`; vacío si el conjunto es coherente. */
export function missingDependencies(features: readonly string[]): { feature: string; requires: string }[] {
  const set = new Set(features);
  return FEATURE_DEFS.filter((d) => set.has(d.key)).flatMap((d) => d.requires.filter((r) => !set.has(r)).map((requires) => ({ feature: d.key, requires })));
}
