import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * Botón de menú (patrón WAI-ARIA «menu button»): Intro/Espacio/↓ abren y enfocan el primer
 * elemento; ↑/↓/Inicio/Fin navegan; Esc o Tab cierran y devuelven el foco al botón.
 */
export function Menu({
  label,
  items,
  trigger,
  align = 'end',
  triggerClassName = 'btn btn--ghost btn--icon btn--sm',
}: {
  /** Nombre accesible del botón (p. ej. «Acciones de Lucía García»). */
  label: string;
  items: MenuItem[];
  trigger?: ReactNode;
  align?: 'start' | 'end';
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const enabled = items.filter((i) => !i.disabled);

  const focusItem = (index: number) => {
    const els = list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])');
    if (!els?.length) return;
    els[(index + els.length) % els.length].focus();
  };

  // Posición fija junto al botón: el menú vive en un portal para que ningún contenedor con
  // desplazamiento o celda fija lo recorte o lo tape. Se recoloca al desplazar o redimensionar.
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const place = () => {
      if (!button.current) return;
      const r = button.current.getBoundingClientRect();
      const below = window.innerHeight - r.bottom > 220;
      setPos({
        position: 'fixed',
        ...(below ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }),
        ...(align === 'end' ? { right: Math.max(8, window.innerWidth - r.right) } : { left: Math.max(8, r.left) }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => focusItem(0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => focusItem(-1));
    }
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const els = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
    else if (e.key === 'End') { e.preventDefault(); focusItem(-1); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    // El menú vive en un portal: Tab lo cierra y devuelve el foco al botón para no perder la posición.
    else if (e.key === 'Tab') { e.preventDefault(); close(); }
  };

  if (enabled.length === 0) return null;

  return (
    <div className="menu">
      <button
        ref={button}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onButtonKey}
      >
        {trigger ?? <Icon name="more" size={18} />}
      </button>
      {open &&
        createPortal(
        <div ref={list} id={`${id}-menu`} role="menu" tabIndex={-1} aria-label={label} className="menu__list" style={pos} onKeyDown={onMenuKey}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              className={`menu__item${item.danger ? ' menu__item--danger' : ''}`}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>,
          document.body,
        )}
    </div>
  );
}
