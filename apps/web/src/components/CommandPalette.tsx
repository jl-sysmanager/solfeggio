import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { visibleItems } from '../nav';
import { Icon, type IconName } from './Icon';

interface Command {
  id: string;
  label: string;
  group: string;
  icon: IconName;
  to: string;
  keywords?: string;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Abre la paleta con ⌘K / Ctrl+K desde cualquier pantalla. */
export function useCommandPaletteShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}

/**
 * Paleta de comandos (patrón combobox de WAI-ARIA dentro de un diálogo modal): navegación a
 * cualquier módulo visible para el rol, búsquedas y acciones frecuentes. ↑/↓ mueven la selección,
 * Intro ejecuta y Esc cierra devolviendo el foco.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, can, hasFeature } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const id = useId();

  const base = useMemo<Command[]>(() => {
    const nav = visibleItems(can, hasFeature, !!session?.user.isPlatformAdmin).flatMap((g) =>
      g.items.map((i) => ({ id: `nav:${i.to}`, label: i.label, group: 'Ir a', icon: i.icon, to: i.to, keywords: g.label })),
    );
    const actions: Command[] = [];
    if (can(['members:write']) && hasFeature('members')) actions.push({ id: 'new-member', label: 'Dar de alta a un socio', group: 'Acciones', icon: 'plus', to: '/members?new=1', keywords: 'nuevo socio alta' });
    if (can(['events:write']) && hasFeature('events')) actions.push({ id: 'new-event', label: 'Planificar ensayo o actuación', group: 'Acciones', icon: 'plus', to: '/events?new=1', keywords: 'nuevo ensayo concierto' });
    return [...actions, ...nav];
  }, [can, hasFeature, session?.user.isPlatformAdmin]);

  const results = useMemo<Command[]>(() => {
    const q = norm(query.trim());
    const matches = q ? base.filter((c) => norm(`${c.label} ${c.keywords ?? ''}`).includes(q)) : base;
    const searches: Command[] = [];
    if (q) {
      if (can(['members:read']) && hasFeature('members')) searches.push({ id: 'search-members', label: `Buscar «${query.trim()}» en socios`, group: 'Buscar', icon: 'search', to: `/members?q=${encodeURIComponent(query.trim())}` });
      if (can(['archive:read']) && hasFeature('archive')) searches.push({ id: 'search-archive', label: `Buscar «${query.trim()}» en el archivo`, group: 'Buscar', icon: 'search', to: `/archive?q=${encodeURIComponent(query.trim())}` });
    }
    return [...matches, ...searches];
  }, [base, query, can, hasFeature]);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement;
    setQuery('');
    setActive(0);
    requestAnimationFrame(() => input.current?.focus());
    return () => restore.current?.focus();
  }, [open]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    navigate(c.to);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(results[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'Tab') e.preventDefault(); // el foco se queda en el diálogo
  };

  let lastGroup = '';
  return createPortal(
    <div className="modal-backdrop palette-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Buscar y navegar">
        <div className="palette__search">
          <Icon name="search" size={18} />
          <input
            ref={input}
            className="palette__input"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={results[active] ? `${id}-${results[active].id}` : undefined}
            aria-autocomplete="list"
            aria-label="Buscar módulos, acciones o datos"
            placeholder="Buscar módulos, acciones o datos…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <ul id={`${id}-list`} role="listbox" aria-label="Resultados" className="palette__list">
          {results.length === 0 && <li className="palette__empty">Sin resultados para «{query}»</li>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id} role="presentation">
                {header && (
                  <div className="palette__group" role="presentation">
                    {header}
                  </div>
                )}
                {/* Patrón combobox: el teclado lo gestiona el campo (aria-activedescendant); el ratón, aquí. */}
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
                <div
                  id={`${id}-${c.id}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === active}
                  className="palette__option"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(c)}
                >
                  <Icon name={c.icon} size={18} />
                  <span>{c.label}</span>
                  {i === active && <Icon name="arrowRight" size={16} className="palette__enter" />}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="palette__footer" aria-hidden="true">
          <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> moverse</span>
          <span><kbd className="kbd">↵</kbd> abrir</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
