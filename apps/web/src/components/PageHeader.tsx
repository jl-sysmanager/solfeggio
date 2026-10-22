import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { NAV } from '../nav';
import { Icon, type IconName } from './Icon';

/** Icono de la sección según la ruta (entrada de navegación con el prefijo más largo). */
function useSectionIcon(): IconName {
  const { pathname } = useLocation();
  const match = NAV.flatMap((g) => g.items)
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
  // Título de la pestaña por pantalla (WCAG 2.4.2).
  useEffect(() => {
    document.title = `${title} · Solfeggio`;
  }, [title]);
  return (
    <header className={`band band--${tone}`}>
      <div className="container band__inner">
        <div>
          {eyebrow && (
            <nav aria-label="Migas de pan" className="breadcrumb">
              <ol>
                <li>
                  <Link to="/">Inicio</Link>
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
        {actions && <div className="band__actions">{actions}</div>}
      </div>
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
