import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import type { HelpArticle } from '../help/types';
import { Drawer } from './Modal';

/** Panel lateral con el artículo de ayuda de la pantalla actual. */
export function HelpDrawer({ article, open, onClose }: { article: HelpArticle | null; open: boolean; onClose: () => void }) {
  const { can } = useAuth();
  const showSupport = can(['incidents:write']);
  return (
    <Drawer open={open && !!article} title={article ? `Cómo funciona · ${article.title}` : 'Cómo funciona'} onClose={onClose}>
      {article && (
        <div className="stack help-article" style={{ gap: 20 }}>
          <p className="muted">{article.summary}</p>
          {article.sections.map((s) => (
            <section key={s.heading} className="stack" style={{ gap: 8 }}>
              <h3 className="label-caps" style={{ margin: 0 }}>
                {s.heading}
              </h3>
              {s.paragraphs?.map((p) => (
                <p key={p} className="small" style={{ margin: 0 }}>
                  {p}
                </p>
              ))}
              {s.bullets && s.bullets.length > 0 && (
                <ul className="stack" style={{ gap: 6, margin: 0, paddingLeft: '1.25rem' }}>
                  {s.bullets.map((b) => (
                    <li key={b} className="small">
                      {b}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          {showSupport && (
            <p className="small muted" style={{ marginTop: 8 }}>
              ¿Sigues con dudas?{' '}
              <Link to="/incidents" onClick={onClose}>
                Abre una incidencia de soporte
              </Link>
              .
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}
