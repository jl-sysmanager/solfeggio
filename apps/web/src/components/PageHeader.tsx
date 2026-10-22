import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

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
          <h1>{title}</h1>
          {description && <p className="band__desc">{description}</p>}
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
