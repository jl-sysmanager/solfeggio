import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { resolveHelpTopic } from '../help/catalog';
import { ALL_NAV_ITEMS } from '../nav';
import { Button } from './Button';
import { HelpDrawer } from './HelpDrawer';
import { Icon, type IconName } from './Icon';

/** Icono de la sección según la ruta (entrada de navegación con el prefijo más largo). */
function useSectionIcon(): IconName {
  const { pathname } = useLocation();
  const match = ALL_NAV_ITEMS
    .filter((i) => (i.to === '/' ? pathname === '/' : pathname === i.to || pathname.startsWith(`${i.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  return match?.icon ?? 'home';
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  tone = 'cool',
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  tone?: 'cool' | 'cream' | 'warm';
}) {
  const icon = useSectionIcon();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const article = resolveHelpTopic(pathname);
  const [helpOpen, setHelpOpen] = useState(false);

  // Dentro del panel global la miga raíz es el propio panel, no el inicio de una banda.
  const root = pathname.startsWith('/admin') ? { to: '/admin/metrics', label: 'Panel global' } : { to: '/', label: 'Inicio' };

  // Título de la pestaña por pantalla (WCAG 2.4.2).
  useEffect(() => {
    document.title = `${title} · Solfeamos`;
  }, [title]);

  // ?ayuda=1 abre el drawer (p. ej. desde la paleta de comandos) y limpia la query.
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get('ayuda') !== '1' || !article) return;
    setHelpOpen(true);
    params.delete('ayuda');
    const q = params.toString();
    navigate({ pathname, search: q ? `?${q}` : '' }, { replace: true });
  }, [search, article, pathname, navigate]);

  return (
    <header className={`band band--${tone}`}>
      <div className="container band__inner">
        <div>
          {eyebrow && (
            <nav aria-label="Migas de pan" className="breadcrumb">
              <ol>
                <li>
                  <Link to={root.to}>{root.label}</Link>
                </li>
                <li>{eyebrow}</li>
                <li aria-current="page">{title}</li>
              </ol>
            </nav>
          )}
          {/* Breeze PageHeader: icono en recuadro bg-muted + título + descripción */}
          <div className="band__heading">
            <span className="band__icon">
              <Icon name={icon} size={18} />
            </span>
            <div>
              <h1>{title}</h1>
              {description && <p className="band__desc">{description}</p>}
            </div>
          </div>
        </div>
        {(actions || article) && (
          <div className="band__actions">
            {actions}
            {article && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setHelpOpen(true)} aria-haspopup="dialog">
                <Icon name="lifebuoy" size={16} /> Cómo funciona
              </Button>
            )}
          </div>
        )}
      </div>
      {article && <HelpDrawer article={article} open={helpOpen} onClose={() => setHelpOpen(false)} />}
    </header>
  );
}

export function Page({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      {header}
      <div className="container page__body">{children}</div>
    </div>
  );
}
