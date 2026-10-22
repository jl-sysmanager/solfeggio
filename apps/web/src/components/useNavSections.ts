import { useCallback, useEffect, useState } from 'react';
import type { NavGroup } from '../nav';

const KEY = 'sf-nav-collapsed';

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function write(v: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* almacenamiento no disponible: el estado vive sólo en memoria */
  }
}

/** Grupo que contiene la ruta actual (mismo criterio que NavLink: prefijo más largo). */
export function activeGroupLabel(groups: NavGroup[], pathname: string): string | undefined {
  let best: { label: string; len: number } | undefined;
  for (const g of groups) {
    for (const i of g.items) {
      const hit = i.to === '/' ? pathname === '/' : pathname === i.to || pathname.startsWith(`${i.to}/`);
      if (hit && (!best || i.to.length > best.len)) best = { label: g.label, len: i.to.length };
    }
  }
  return best?.label;
}

/**
 * Secciones plegables del menú lateral, para todos los usuarios. El estado se recuerda en el
 * navegador; la sección de la página actual se despliega al navegar a ella.
 */
export function useNavSections(groups: NavGroup[], pathname: string) {
  const [collapsed, setCollapsed] = useState<string[]>(read);
  /** Última sección desplegada a mano: sólo ella se anima (no todas al cargar la página). */
  const [opened, setOpened] = useState<string | null>(null);
  const active = activeGroupLabel(groups, pathname);

  useEffect(() => {
    if (active && collapsed.includes(active)) setCollapsed((c) => c.filter((x) => x !== active));
    // Sólo al cambiar de sección activa: plegar la actual a mano debe respetarse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => write(collapsed), [collapsed]);

  const isOpen = useCallback((label: string) => !collapsed.includes(label), [collapsed]);
  const toggle = useCallback((label: string) => {
    setCollapsed((c) => {
      const wasCollapsed = c.includes(label);
      setOpened(wasCollapsed ? label : null);
      return wasCollapsed ? c.filter((x) => x !== label) : [...c, label];
    });
  }, []);
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.includes(g.label) || g.label === active);
  /** Contraer todo deja abierta la sección actual; desplegar todo las abre todas. */
  const toggleAll = useCallback(() => {
    setCollapsed(allCollapsed ? [] : groups.map((g) => g.label).filter((l) => l !== active));
  }, [allCollapsed, groups, active]);

  return { isOpen, toggle, toggleAll, allCollapsed, active, opened };
}
