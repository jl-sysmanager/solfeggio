import type { IconName } from './components/Icon';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Basta con uno de los permisos. */
  perm?: string[];
  feature?: string;
  platformAdmin?: boolean;
  /** Contador de pendientes que se muestra junto a la entrada (panel global). */
  badge?: 'support' | 'moderation';
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: 'General',
    items: [
      { to: '/', icon: 'home', label: 'Inicio' },
      { to: '/agenda', icon: 'calendar', label: 'Agenda', perm: ['events:read'], feature: 'events' },
      { to: '/notifications', icon: 'bell', label: 'Notificaciones' },
    ],
  },
  {
    label: 'Música',
    items: [
      { to: '/archive', icon: 'music', label: 'Archivo musical', perm: ['archive:read'], feature: 'archive' },
      { to: '/events', icon: 'mic', label: 'Ensayos y actuaciones', perm: ['events:read'], feature: 'events' },
      { to: '/attendance', icon: 'checkCircle', label: 'Asistencia', perm: ['attendance:read'], feature: 'attendance' },
      { to: '/performances', icon: 'contract', label: 'Contrataciones', perm: ['performances:read'], feature: 'performances' },
    ],
  },
  {
    label: 'Escuela',
    items: [
      { to: '/school', icon: 'school', label: 'Escuela de música', perm: ['school:read'], feature: 'school' },
      { to: '/family', icon: 'users', label: 'Portal de familias', perm: ['school:family'], feature: 'school' },
    ],
  },
  {
    label: 'Gestión',
    items: [
      { to: '/members', icon: 'users', label: 'Miembros', perm: ['members:read'], feature: 'members' },
      { to: '/communications', icon: 'megaphone', label: 'Comunicaciones', perm: ['communications:send'], feature: 'communications' },
      { to: '/documents', icon: 'file', label: 'Documentos', perm: ['documents:read'], feature: 'members' },
      { to: '/treasury', icon: 'wallet', label: 'Tesorería', perm: ['finance:read'], feature: 'treasury' },
      { to: '/wardrobe', icon: 'shirt', label: 'Mayordomía', perm: ['wardrobe:read'], feature: 'wardrobe' },
      { to: '/instruments', icon: 'trumpet', label: 'Instrumentación', perm: ['instruments:read'], feature: 'instruments' },
      { to: '/governance', icon: 'landmark', label: 'Gobierno', perm: ['governance:read'], feature: 'governance' },
    ],
  },
  {
    label: 'Comunidad',
    items: [
      { to: '/market', icon: 'store', label: 'BandMarket', perm: ['market:read'], feature: 'market' },
      { to: '/reinforcements', icon: 'handshake', label: 'Bolsa de refuerzos', perm: ['events:read', 'reinforcements:manage'], feature: 'reinforcements' },
    ],
  },
  {
    label: 'Cuenta',
    items: [
      { to: '/settings', icon: 'settings', label: 'Ajustes', perm: ['tenant:manage', 'audit:read'] },
      { to: '/billing', icon: 'card', label: 'Plan y facturación', perm: ['billing:manage'] },
      { to: '/incidents', icon: 'lifebuoy', label: 'Soporte', perm: ['incidents:write'] },
      { to: '/account', icon: 'shield', label: 'Mi cuenta' },
      { to: '/admin', icon: 'globe', label: 'Panel global', platformAdmin: true },
    ],
  },
];

/**
 * Entradas visibles: se ocultan las que el rol no puede usar y las que el plan no incluye
 * (el acceso directo por URL muestra la tarjeta de mejora).
 */
export function visibleItems(
  can: (p: string[]) => boolean,
  hasFeature: (f: string) => boolean,
  isPlatformAdmin: boolean,
): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => {
      if (i.platformAdmin) return isPlatformAdmin;
      if (i.perm && !can(i.perm)) return false;
      if (i.feature && !hasFeature(i.feature)) return false;
      return true;
    }),
  })).filter((g) => g.items.length > 0);
}

/**
 * Menú del panel global de plataforma. Cada sección es una ruta propia (`/admin/<sección>`), de modo que
 * se puede enlazar, recargar y volver atrás con el navegador.
 */
export const ADMIN_NAV: NavGroup[] = [
  {
    label: 'Resumen',
    items: [
      { to: '/admin/metrics', icon: 'chart', label: 'Métricas' },
      { to: '/admin/health', icon: 'checkCircle', label: 'Salud de clientes' },
    ],
  },
  {
    label: 'Clientes',
    items: [
      { to: '/admin/tenants', icon: 'users', label: 'Bandas' },
      { to: '/admin/billing', icon: 'card', label: 'Facturación' },
    ],
  },
  {
    label: 'Atención',
    items: [
      { to: '/admin/support', icon: 'lifebuoy', label: 'Soporte', badge: 'support' },
      { to: '/admin/moderation', icon: 'alert', label: 'Moderación', badge: 'moderation' },
      { to: '/admin/announcements', icon: 'megaphone', label: 'Avisos' },
    ],
  },
  {
    label: 'Plataforma',
    items: [
      { to: '/admin/users', icon: 'user', label: 'Equipo' },
      { to: '/admin/roles', icon: 'shield', label: 'Roles' },
      { to: '/admin/ops', icon: 'storage', label: 'Sistema' },
      { to: '/admin/plans', icon: 'euro', label: 'Planes' },
      { to: '/admin/integrations', icon: 'settings', label: 'Integraciones' },
      { to: '/admin/brand', icon: 'landmark', label: 'Marca' },
    ],
  },
];

/**
 * Menú de la barra lateral dentro del panel global: las secciones del panel, más el acceso a la propia
 * banda (si el administrador pertenece a alguna) y Mi cuenta.
 */
export function adminMenu(opts: { hasTenant: boolean; hasMemberships: boolean }): NavGroup[] {
  const back: NavItem[] = [];
  if (opts.hasTenant) back.push({ to: '/', icon: 'home', label: 'Volver a mi banda' });
  else if (opts.hasMemberships) back.push({ to: '/select-band', icon: 'swap', label: 'Elegir una banda' });
  return [
    ...ADMIN_NAV,
    {
      label: 'Cuenta',
      items: [...back, { to: '/account', icon: 'shield', label: 'Mi cuenta' }],
    },
  ];
}

/** Todas las entradas conocidas (banda y panel) para resolver el icono de la sección actual. */
export const ALL_NAV_ITEMS: NavItem[] = [...NAV, ...ADMIN_NAV].flatMap((g) => g.items);
