/** Logotipo Solfeggio: cuadrado azul con «S» (CSS) + nombre. */
export function Wordmark({ as: Tag = 'span' }: { as?: 'span' | 'p' }) {
  return <Tag className="wordmark">Solfeggio</Tag>;
}
