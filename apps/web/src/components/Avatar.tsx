/** Avatar con iniciales. Color estable derivado del nombre; decorativo (el nombre va al lado). */
const TONES = ['blue', 'green', 'amber', 'violet', 'rose', 'teal'] as const;

export function initials(name: string) {
  const parts = name.replace(/[,]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function tone(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  return (
    <span className={`avatar avatar--${size} avatar--${tone(name)}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** Nombre con avatar delante (celdas de tabla, listas). */
export function Person({ name, detail, children }: { name: string; detail?: string; children?: React.ReactNode }) {
  return (
    <span className="person">
      <Avatar name={name} size="sm" />
      <span className="person__text">
        {children ?? <span className="person__name">{name}</span>}
        {detail && <span className="person__detail">{detail}</span>}
      </span>
    </span>
  );
}
