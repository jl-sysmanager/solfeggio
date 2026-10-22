import { buildCatalog, findInstruments, normalizeInstrument, suggestParts, winAnsi } from './parts';

describe('detección de particellas', () => {
  const catalog = buildCatalog(['Dulzaina']);
  const first = (t: string) => findInstruments(t, catalog)[0]?.instrument;

  it('normaliza tildes, mayúsculas y ordinales', () => {
    expect(normalizeInstrument('  CLARINETE 1º en Si♭ ')).toBe('clarinete 1 en si');
    expect(normalizeInstrument('Trombón 2ª')).toBe('trombon 2');
  });

  it.each([
    ['Clarinete 1º en Sib', 'Clarinete 1º'],
    ['1er Clarinete', 'Clarinete 1º'],
    ['Segundo Clarinete', 'Clarinete 2º'],
    ['Trompeta en Sib II', 'Trompeta 2º'],
    ['CLARINETE BAJO', 'Clarinete bajo'],
    ['Saxofón Alto 1', 'Saxofón alto 1º'],
    ['FLAUTIN', 'Flautín'],
    ['Corno Inglés', 'Corno inglés'],
    ['Guión', 'Guion'],
    ['Dulzaina', 'Dulzaina'],
  ])('%s → %s', (text, expected) => expect(first(text)).toBe(expected));

  it('no confunde palabras que contienen un instrumento', () => {
    expect(first('Tubarón')).toBeUndefined();
  });

  it('agrupa páginas y trata como guion las cabeceras con muchos instrumentos', () => {
    const pages = ['Flauta Oboe Clarinete Trompeta Tuba', 'Flauta 1', '', 'Flauta 2'];
    expect(suggestParts(pages, catalog).map((s) => [s.instrument, s.fromPage, s.toPage])).toEqual([
      ['Guion', 1, 1],
      ['Flauta 1º', 2, 3],
      ['Flauta 2º', 4, 4],
    ]);
  });

  it('sustituye caracteres que no admite la fuente estándar', () => {
    expect(winAnsi('Si♭ — «Marcha» ✓')).toBe('Sib - "Marcha" ?');
  });
});
