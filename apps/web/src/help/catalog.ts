import { ARTICLES } from './articles';
import type { HelpArticle } from './types';

/** Prefijos de ruta del tenant → id de artículo (el más largo gana). */
const ROUTES: { path: string; topic: string }[] = [
  { path: '/', topic: 'home' },
  { path: '/agenda', topic: 'agenda' },
  { path: '/notifications', topic: 'notifications' },
  { path: '/archive', topic: 'archive' },
  { path: '/events', topic: 'events' },
  { path: '/attendance', topic: 'attendance' },
  { path: '/performances', topic: 'performances' },
  { path: '/school', topic: 'school' },
  { path: '/family', topic: 'family' },
  { path: '/members', topic: 'members' },
  { path: '/communications', topic: 'communications' },
  { path: '/documents', topic: 'documents' },
  { path: '/treasury', topic: 'treasury' },
  { path: '/wardrobe', topic: 'wardrobe' },
  { path: '/instruments', topic: 'instruments' },
  { path: '/governance', topic: 'governance' },
  { path: '/market', topic: 'market' },
  { path: '/reinforcements', topic: 'reinforcements' },
  { path: '/settings', topic: 'settings' },
  { path: '/billing', topic: 'billing' },
  { path: '/incidents', topic: 'incidents' },
  { path: '/account', topic: 'account' },
];

/** Resuelve el artículo de ayuda para la ruta actual (sin panel global). */
export function resolveHelpTopic(pathname: string): HelpArticle | null {
  if (pathname.startsWith('/admin')) return null;
  const match = ROUTES.filter((r) => (r.path === '/' ? pathname === '/' : pathname === r.path || pathname.startsWith(`${r.path}/`))).sort(
    (a, b) => b.path.length - a.path.length,
  )[0];
  if (!match) return null;
  return ARTICLES[match.topic] ?? null;
}

/** Temas con artículo (útil en tests y cobertura del nav). */
export function helpTopics(): string[] {
  return Object.keys(ARTICLES);
}

export function helpRouteTopics(): { path: string; topic: string }[] {
  return ROUTES;
}
