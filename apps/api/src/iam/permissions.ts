export const PERMISSIONS = [
  { key: 'tenant:manage', group: 'Banda', label: 'Configurar la banda' },
  { key: 'billing:manage', group: 'Banda', label: 'Gestionar suscripción y facturas' },
  { key: 'users:manage', group: 'Banda', label: 'Gestionar usuarios e invitaciones' },
  { key: 'roles:manage', group: 'Banda', label: 'Gestionar roles y permisos' },
  { key: 'audit:read', group: 'Banda', label: 'Consultar auditoría' },
  { key: 'members:read', group: 'Secretaría', label: 'Ver socios' },
  { key: 'members:write', group: 'Secretaría', label: 'Altas, bajas y edición de socios' },
  { key: 'members:sensitive', group: 'Secretaría', label: 'Ver DNI' },
  { key: 'communications:send', group: 'Secretaría', label: 'Enviar comunicaciones' },
  { key: 'documents:read', group: 'Secretaría', label: 'Ver documentos' },
  { key: 'documents:write', group: 'Secretaría', label: 'Subir y borrar documentos' },
  { key: 'archive:read', group: 'Archivo', label: 'Consultar archivo musical' },
  { key: 'archive:write', group: 'Archivo', label: 'Editar archivo musical' },
  { key: 'events:read', group: 'Ensayos', label: 'Ver ensayos y actuaciones' },
  { key: 'events:write', group: 'Ensayos', label: 'Planificar ensayos y actuaciones' },
  { key: 'calls:manage', group: 'Ensayos', label: 'Gestionar convocatorias' },
  { key: 'attendance:read', group: 'Asistencia', label: 'Ver asistencia y estadísticas' },
  { key: 'attendance:write', group: 'Asistencia', label: 'Pasar lista y revisar justificaciones' },
  { key: 'attendance:self', group: 'Asistencia', label: 'Justificar ausencias propias' },
  { key: 'finance:read', group: 'Tesorería', label: 'Ver tesorería' },
  { key: 'finance:write', group: 'Tesorería', label: 'Registrar movimientos y cuotas' },
  { key: 'wardrobe:read', group: 'Mayordomía', label: 'Ver uniformes' },
  { key: 'wardrobe:write', group: 'Mayordomía', label: 'Entregas y devoluciones' },
  { key: 'instruments:read', group: 'Instrumentación', label: 'Ver inventario' },
  { key: 'instruments:write', group: 'Instrumentación', label: 'Asignar y mantener instrumentos' },
  { key: 'market:read', group: 'BandMarket', label: 'Ver anuncios' },
  { key: 'market:write', group: 'BandMarket', label: 'Publicar anuncios y contactar' },
  { key: 'school:read', group: 'Escuela', label: 'Ver alumnos, grupos y horarios' },
  { key: 'school:write', group: 'Escuela', label: 'Gestionar alumnos, matrículas y grupos' },
  { key: 'school:teach', group: 'Escuela', label: 'Pasar lista, poner notas y avisos en clase' },
  { key: 'school:family', group: 'Escuela', label: 'Portal de familias' },
  { key: 'performances:read', group: 'Actuaciones', label: 'Ver clientes, presupuestos y facturas' },
  { key: 'performances:write', group: 'Actuaciones', label: 'Presupuestar, contratar y facturar actuaciones' },
  { key: 'reinforcements:manage', group: 'Actuaciones', label: 'Bolsa de refuerzos y pagos a músicos' },
  { key: 'governance:read', group: 'Gobierno', label: 'Ver asambleas, junta y encuestas' },
  { key: 'governance:write', group: 'Gobierno', label: 'Convocar asambleas, actas y encuestas' },
  { key: 'governance:vote', group: 'Gobierno', label: 'Votar en asambleas y encuestas' },
  { key: 'incidents:write', group: 'Soporte', label: 'Abrir incidencias' },
] as const;

export type Permission = (typeof PERMISSIONS)[number]['key'];
export const ALL_PERMISSIONS: Permission[] = PERMISSIONS.map((p) => p.key);

const except = (...excluded: Permission[]) => ALL_PERMISSIONS.filter((p) => !excluded.includes(p));

export const SYSTEM_ROLES: { key: string; name: string; permissions: Permission[] }[] = [
  { key: 'owner', name: 'Propietario', permissions: ALL_PERMISSIONS },
  { key: 'admin', name: 'Administrador', permissions: except('billing:manage') },
  {
    key: 'director',
    name: 'Director',
    permissions: [
      'members:read', 'archive:read', 'archive:write', 'events:read', 'events:write', 'calls:manage',
      'attendance:read', 'attendance:write', 'attendance:self', 'communications:send', 'documents:read',
      'wardrobe:read', 'instruments:read', 'market:read', 'incidents:write', 'school:read', 'school:teach',
      'performances:read', 'reinforcements:manage', 'governance:read', 'governance:vote',
    ],
  },
  {
    key: 'secretary',
    name: 'Secretario',
    permissions: [
      'members:read', 'members:write', 'members:sensitive', 'communications:send', 'documents:read',
      'documents:write', 'events:read', 'attendance:read', 'attendance:self', 'audit:read', 'archive:read',
      'incidents:write', 'school:read', 'school:write', 'performances:read', 'governance:read', 'governance:write',
      'governance:vote',
    ],
  },
  {
    key: 'treasurer',
    name: 'Tesorero',
    permissions: [
      'finance:read', 'finance:write', 'members:read', 'members:sensitive', 'events:read', 'attendance:self',
      'documents:read', 'archive:read', 'incidents:write', 'school:read', 'performances:read', 'performances:write',
      'governance:read', 'governance:vote',
    ],
  },
  {
    key: 'material_manager',
    name: 'Responsable de material',
    permissions: [
      'wardrobe:read', 'wardrobe:write', 'instruments:read', 'instruments:write', 'members:read',
      'market:read', 'market:write', 'events:read', 'attendance:self', 'archive:read', 'incidents:write',
      'governance:read', 'governance:vote',
    ],
  },
  { key: 'musician', name: 'Músico', permissions: ['archive:read', 'events:read', 'attendance:self', 'market:read', 'governance:read', 'governance:vote'] },
  { key: 'collaborator', name: 'Colaborador', permissions: ['events:read', 'archive:read'] },
  {
    key: 'archivist',
    name: 'Archivero',
    permissions: [
      'archive:read', 'archive:write', 'events:read', 'attendance:self', 'market:read', 'governance:read', 'governance:vote',
      'incidents:write',
    ],
  },
  { key: 'teacher', name: 'Profesor', permissions: ['archive:read', 'events:read', 'school:read', 'school:teach'] },
  { key: 'family', name: 'Familia', permissions: ['school:family'] },
];

export const FEATURES = [
  'members', 'archive', 'events', 'attendance', 'treasury', 'wardrobe', 'instruments', 'communications',
  'market', 'calendar_sync', 'school', 'performances', 'reinforcements', 'governance', 'archive_ai',
] as const;
export type Feature = (typeof FEATURES)[number];
