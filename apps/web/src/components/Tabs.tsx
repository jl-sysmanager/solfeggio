import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface TabDef {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * Pestañas accesibles (patrón WAI-ARIA: flechas, Inicio/Fin). Sin `value` guardan su propio estado;
 * con `value` y `onValueChange` las controla quien las usa (p. ej. `UrlTabs`).
 */
export function Tabs({
  tabs,
  label,
  initial,
  value,
  onValueChange,
}: {
  tabs: TabDef[];
  label: string;
  initial?: string;
  value?: string;
  onValueChange?: (id: string) => void;
}) {
  const [own, setOwn] = useState(initial ?? tabs[0]?.id);
  const active = value ?? own;
  const setActive = (id: string) => {
    setOwn(id);
    onValueChange?.(id);
  };
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKey(e: KeyboardEvent, i: number) {
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    setActive(tabs[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="segmented" role="tablist" aria-label={label} style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            onClick={() => setActive(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) =>
        t.id === active ? (
          <div key={t.id} role="tabpanel" id={`${base}-panel-${t.id}`} aria-labelledby={`${base}-tab-${t.id}`}>
            {t.content}
          </div>
        ) : null,
      )}
    </div>
  );
}

/** Pestañas cuyo estado vive en la URL (`?tab=…`): se pueden enlazar, recargar y recorrer con «atrás». */
export function UrlTabs({ tabs, label, param = 'tab' }: { tabs: TabDef[]; label: string; param?: string }) {
  const [params, setParams] = useSearchParams();
  const current = params.get(param);
  const value = tabs.some((t) => t.id === current) ? (current as string) : tabs[0]?.id;
  return (
    <Tabs
      tabs={tabs}
      label={label}
      value={value}
      onValueChange={(id) =>
        setParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            if (id === tabs[0]?.id) next.delete(param);
            else next.set(param, id);
            return next;
          },
          { replace: false },
        )
      }
    />
  );
}
