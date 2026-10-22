import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { adminMenu, visibleItems, type NavItem } from '../nav';
import { useApi } from '../api/hooks';
import type { AdminSummary, NotificationItem } from '../api/types';
import { AnnouncementBanner } from './admin/AnnouncementBanner';
import { ImpersonationBanner } from './admin/ImpersonationBanner';
import { Avatar } from './Avatar';
import { CommandPalette, useCommandPaletteShortcut } from './CommandPalette';
import { Icon } from './Icon';
import { Wordmark } from './Logo';
import { Menu, type MenuItem } from './Menu';
import { useNavSections } from './useNavSections';
import { tenantStatus } from '../lib/labels';

type Theme = 'system' | 'light' | 'dark';
const THEME_LABEL: Record<Theme, string> = { system: 'Tema del sistema', light: 'Tema claro', dark: 'Tema oscuro' };

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('sf-theme') as Theme | null) ?? 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('sf-theme', theme);
    } catch {
      /* almacenamiento no disponible */
    }
  }, [theme]);
  const next: Theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  return { theme, next, cycle: () => setTheme(next) };
}

/** Lleva el foco al título de la página tras cada navegación (lo anuncian los lectores de pantalla). */
function useRouteFocus(pathname: string) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let tries = 0;
    let raf = 0;
    const attempt = () => {
      const h1 = document.querySelector<HTMLElement>('main h1');
      if (h1) {
        h1.setAttribute('tabindex', '-1');
        h1.focus({ preventScroll: true });
        window.scrollTo({ top: 0 });
      } else if (tries++ < 30) raf = requestAnimationFrame(attempt);
    };
    raf = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(raf);
  }, [pathname]);
}

export function AppShell({ children }: { children: ReactNode }) {
  const { session, can, hasFeature, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  // Panel global: su propio menú lateral. Sin banda activa es el único, porque «Inicio» y «Avisos» de una banda
  // no existen para el administrador de plataforma (el acceso redirigía de vuelta al panel).
  const isAdmin = !!session?.user.isPlatformAdmin;
  const adminMode = isAdmin && (location.pathname.startsWith('/admin') || !session?.tenant);
  const groups = adminMode
    ? adminMenu({ hasTenant: !!session?.tenant, hasMemberships: (session?.memberships.length ?? 0) > 0 })
    : visibleItems(can, hasFeature, isAdmin);
  const sections = useNavSections(groups, location.pathname);
  const unread = useApi<NotificationItem[]>(session?.tenant && !adminMode ? '/notifications' : null, { unread: true });
  const unreadCount = unread.data?.length ?? 0;
  const summary = useApi<AdminSummary>(adminMode ? '/admin/summary' : null);
  /** Pendientes que se muestran junto a cada entrada del menú. */
  const countFor = (i: NavItem) =>
    i.to === '/notifications' ? unreadCount : i.badge === 'support' ? summary.data?.support.open ?? 0 : i.badge === 'moderation' ? summary.data?.moderation.pending ?? 0 : 0;
  const homeTo = adminMode ? '/admin/metrics' : '/';
  const openPalette = useCallback(() => setPalette(true), []);
  useCommandPaletteShortcut(openPalette);
  useRouteFocus(location.pathname);

  useEffect(() => setOpen(false), [location.pathname]);
  const signOut = () => logout().then(() => navigate('/login'));

  // Aviso sólo cuando hay algo que hacer (el nombre de la banda ya está en la barra lateral).
  const status = session?.tenant?.status;
  const alert =
    adminMode
      ? null
      : status === 'PAST_DUE'
      ? { tone: 'warning', text: 'Pago pendiente: actualiza tu método de pago para evitar el modo sólo lectura.', to: '/billing' }
      : status === 'READ_ONLY'
        ? { tone: 'danger', text: 'Cuenta en modo sólo lectura por impago. Regulariza la suscripción para editar.', to: '/billing' }
        : status === 'TRIALING'
          ? { tone: 'info', text: `Periodo de prueba del plan ${session?.plan?.name ?? ''}.`, to: '/billing' }
          : null;

  const userName = session?.user.name ?? '';
  const userItems: MenuItem[] = [
    { label: 'Seguridad de la cuenta', onSelect: () => navigate('/security') },
    ...(session && session.memberships.length > 1 ? [{ label: 'Cambiar de banda', onSelect: () => navigate('/select-band') }] : []),
    { label: `${THEME_LABEL[theme.next]} (ahora: ${THEME_LABEL[theme.theme].toLowerCase()})`, onSelect: theme.cycle },
    { label: 'Cerrar sesión', onSelect: signOut, danger: true },
  ];

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Saltar al contenido
      </a>
      <div className="layout">
        {/* Barra lateral (estilo Breeze) con secciones plegables. */}
        <nav id="sidenav" className={`sidenav${open ? ' is-open' : ''}`} aria-label="Navegación principal">
          <div className="sidenav__brand">
            <Link to={homeTo} className="brand brand--on-dark" aria-label="Solfeggio, inicio">
              <Wordmark />
            </Link>
            <button
              type="button"
              className="btn btn--icon btn--sm sidenav__toggle-all"
              onClick={sections.toggleAll}
              aria-label={sections.allCollapsed ? 'Desplegar todas las secciones' : 'Contraer las demás secciones'}
              title={sections.allCollapsed ? 'Desplegar todas las secciones' : 'Contraer las demás secciones'}
            >
              <Icon name={sections.allCollapsed ? 'chevronsUpDown' : 'chevronsDownUp'} size={16} />
            </button>
          </div>
          {adminMode && (
            <div className="sidenav__tenant">
              <p className="sidenav__tenant-name">Panel global</p>
              <span className="chip chip--info">Plataforma</span>
            </div>
          )}
          {!adminMode && session?.tenant && (
            <div className="sidenav__tenant">
              <p className="sidenav__tenant-name">{session.tenant.name}</p>
              {status && <span className={`chip chip--${tenantStatus[status]?.tone ?? 'neutral'}`}>{tenantStatus[status]?.label ?? status}</span>}
            </div>
          )}
          {groups.map((g) => {
            const expanded = sections.isOpen(g.label);
            const listId = `nav-${g.label.normalize('NFD').replace(/[^\w]/g, '').toLowerCase()}`;
            const hiddenCount = expanded ? 0 : g.items.reduce((n, i) => n + countFor(i), 0);
            return (
            <div key={g.label} className="sidenav__group">
              {/* Cabecera de sección plegable (patrón disclosure: botón + aria-expanded) */}
              <button
                type="button"
                className="sidenav__label sidenav__section"
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => sections.toggle(g.label)}
              >
                <span>{g.label}</span>
                {hiddenCount > 0 && (
                  <span className="sidenav__count" aria-label={`${hiddenCount} pendientes`}>
                    {hiddenCount}
                  </span>
                )}
                <Icon name="chevronDown" size={14} className="sidenav__chevron" />
              </button>
              <ul id={listId} hidden={!expanded} className={sections.opened === g.label ? 'is-opening' : undefined}>
                {g.items.map((i) => (
                  <li key={i.to}>
                    <NavLink to={i.to} end={i.to === '/'}>
                      <Icon name={i.icon} size={18} />
                      <span>{i.label}</span>
                      {countFor(i) > 0 && (
                        <span
                          className={`sidenav__count${i.badge === 'support' && (summary.data?.support.overdue ?? 0) > 0 ? ' sidenav__count--alert' : ''}`}
                          aria-label={`${countFor(i)} ${i.to === '/notifications' ? 'sin leer' : i.badge === 'support' && (summary.data?.support.overdue ?? 0) > 0 ? `abiertas, ${summary.data?.support.overdue} fuera de plazo` : 'pendientes'}`}
                        >
                          {countFor(i)}
                        </span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
            );
          })}
        </nav>
        <div className="layout__main">
          <header className="topbar">
            <div className="topbar__inner">
              <button
                className="btn btn--ghost btn--icon nav-toggle"
                aria-expanded={open}
                aria-controls="sidenav"
                onClick={() => setOpen((o) => !o)}
                aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
              >
                <Icon name={open ? 'close' : 'menu'} size={20} />
              </button>
              <Link to={homeTo} className="brand topbar__brand" aria-label="Solfeggio, inicio">
                <Wordmark />
              </Link>
              <button type="button" className="search-trigger" onClick={openPalette} aria-label="Buscar y navegar (Ctrl+K)" aria-keyshortcuts="Control+K Meta+K">
                <Icon name="search" size={16} />
                <span className="search-trigger__text">Buscar…</span>
                <kbd className="kbd search-trigger__kbd">⌘K</kbd>
              </button>
              <div className="topbar__actions">
                {session?.tenant && !adminMode && (
                  <Link to="/notifications" className="btn btn--ghost btn--icon icon-badge" aria-label={`Avisos: ${unreadCount} sin leer`}>
                    <Icon name="bell" size={18} />
                    {/* Breeze: punto primario; el número va en el nombre accesible */}
                    {unreadCount > 0 && <span className="icon-badge__count" aria-hidden="true" />}
                  </Link>
                )}
                {session && (
                  <Menu
                    label={`Menú de ${userName}`}
                    items={userItems}
                    triggerClassName="user-trigger"
                    trigger={
                      <>
                        <Avatar name={userName} />
                        <span className="user-trigger__text">
                          <span className="user-trigger__name">{userName}</span>
                          {session.role && <span className="user-trigger__role">{session.role.name}</span>}
                        </span>
                      </>
                    }
                  />
                )}
              </div>
            </div>
          </header>
          {alert && (
            <div className={`status-banner status-banner--${alert.tone}`} role="status">
              <Icon name="alert" size={16} />
              <span>{alert.text}</span>
              {can('billing:manage') && <Link to={alert.to}>Ver facturación</Link>}
            </div>
          )}
          <ImpersonationBanner />
          <AnnouncementBanner />
          <main id="main" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
