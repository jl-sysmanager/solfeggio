import type { IconName } from './components/Icon';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Basta con uno de los permisos. */
  perm?: string[];
  feature?: string;
  platformAdmin?: boolean;
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
      { to: '/members', icon: 'users', label: 'Socios', perm: ['members:read'], feature: 'members' },
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
      { to: '/reinforcements', icon: 'handshake', label: 'Bolsa de refuerzos', feature: 'reinforcements' },
    ],
  },
  {
    label: 'Cuenta',
    items: [
      { to: '/settings', icon: 'settings', label: 'Ajustes', perm: ['tenant:manage', 'roles:manage', 'users:manage', 'audit:read'] },
      { to: '/billing', icon: 'card', label: 'Plan y facturación', perm: ['billing:manage'] },
      { to: '/incidents', icon: 'lifebuoy', label: 'Soporte', perm: ['incidents:write'] },
      { to: '/security', icon: 'shield', label: 'Seguridad de la cuenta' },
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
