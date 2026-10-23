/** Logotipo Solfeamos: cuadrado azul con «S» (CSS) + nombre. */
export function Wordmark({ as: Tag = 'span' }: { as?: 'span' | 'p' }) {
  return <Tag className="wordmark">Solfeamos</Tag>;
}
