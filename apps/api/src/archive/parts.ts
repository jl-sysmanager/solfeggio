import { BadRequestException } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';

/** Instrumentos habituales de banda. Los alias van normalizados (minúsculas, sin tildes). */
const CATALOG: { name: string; aliases: string[] }[] = [
  { name: 'Guion', aliases: ['guion', 'guión', 'director', 'partitura general', 'full score', 'score'] },
  { name: 'Flautín', aliases: ['flautin', 'piccolo', 'octavin'] },
  { name: 'Flauta', aliases: ['flauta', 'flute'] },
  { name: 'Corno inglés', aliases: ['corno ingles', 'english horn'] },
  { name: 'Oboe', aliases: ['oboe'] },
  { name: 'Fagot', aliases: ['fagot', 'bassoon'] },
  { name: 'Requinto', aliases: ['requinto', 'clarinete en mib', 'clarinete mib'] },
  { name: 'Clarinete bajo', aliases: ['clarinete bajo', 'bass clarinet'] },
  { name: 'Clarinete', aliases: ['clarinete', 'clarinet'] },
  { name: 'Saxofón soprano', aliases: ['saxofon soprano', 'saxo soprano', 'soprano sax'] },
  { name: 'Saxofón alto', aliases: ['saxofon alto', 'saxo alto', 'alto sax'] },
  { name: 'Saxofón tenor', aliases: ['saxofon tenor', 'saxo tenor', 'tenor sax'] },
  { name: 'Saxofón barítono', aliases: ['saxofon baritono', 'saxo baritono', 'baritone sax'] },
  { name: 'Trompa', aliases: ['trompa', 'horn'] },
  { name: 'Fliscorno', aliases: ['fliscorno', 'fiscorno', 'flugelhorn'] },
  { name: 'Trompeta', aliases: ['trompeta', 'trumpet'] },
  { name: 'Trombón', aliases: ['trombon', 'trombone'] },
  { name: 'Bombardino', aliases: ['bombardino', 'euphonium'] },
  { name: 'Tuba', aliases: ['tuba'] },
  { name: 'Contrabajo', aliases: ['contrabajo', 'double bass', 'string bass'] },
  { name: 'Timbales', aliases: ['timbales', 'timpani'] },
  { name: 'Caja', aliases: ['caja', 'snare drum'] },
  { name: 'Bombo', aliases: ['bombo', 'bass drum'] },
  { name: 'Platos', aliases: ['platos', 'cymbals'] },
  { name: 'Lira', aliases: ['lira', 'glockenspiel'] },
  { name: 'Percusión', aliases: ['percusion', 'percussion'] },
];

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4 };
const ORDINAL: Record<string, number> = { primer: 1, primero: 1, primera: 1, segundo: 2, segunda: 2, tercer: 3, tercero: 3, tercera: 3, cuarto: 4, cuarta: 4 };

/** Minúsculas, sin tildes ni indicadores ordinales, espacios simples. */
export function normalizeInstrument(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(\d)\s*(º|ª|°|o\b|a\b|er\b|do\b|ro\b)/g, '$1')
    .replace(/[º°ª.]/g, ' ')
    .replace(/[^a-z0-9#ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Entry = { name: string; alias: string; re: RegExp };

export function buildCatalog(extra: string[] = []): Entry[] {
  const entries: Entry[] = [];
  const add = (name: string, alias: string) => {
    const a = normalizeInstrument(alias);
    if (!a || entries.some((e) => e.alias === a)) return;
    entries.push({ name, alias: a, re: new RegExp(`(?:^|[^a-z0-9])${escapeRe(a)}(?![a-z])`) });
  };
  for (const c of CATALOG) for (const a of c.aliases) add(c.name, a);
  // Instrumentos propios de la banda (Member.instrument) que no estén ya en el catálogo.
  for (const x of extra) if (x.trim()) add(x.trim().slice(0, 60), x);
  // Primero los alias más largos: «clarinete bajo» antes que «clarinete».
  return entries.sort((a, b) => b.alias.length - a.alias.length);
}

function numberAround(text: string, start: number, end: number): number | null {
  const after = text.slice(end, end + 12).match(/^\s*(?:(?:en|in) \w+\s*)?(\d{1,2}|iv|iii|ii|i)\b/);
  if (after) return ROMAN[after[1]] ?? Number(after[1]);
  const before = text.slice(Math.max(0, start - 12), start).match(/(\d{1,2}|iv|iii|ii|i|primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa])\s*$/);
  if (before) return ROMAN[before[1]] ?? ORDINAL[before[1]] ?? Number(before[1]);
  return null;
}

export interface Match {
  instrument: string;
  index: number;
}

/** Todos los instrumentos que aparecen en el texto, en orden de aparición y sin solapes. */
export function findInstruments(raw: string, catalog: Entry[]): Match[] {
  const text = normalizeInstrument(raw);
  const taken: [number, number][] = [];
  const out: Match[] = [];
  for (const e of catalog) {
    const re = new RegExp(e.re.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index + m[0].indexOf(e.alias);
      const end = start + e.alias.length;
      if (taken.some(([s, f]) => start < f && end > s)) continue;
      taken.push([start, end]);
      const n = e.name === 'Guion' ? null : numberAround(text, start, end);
      out.push({ instrument: n && n <= 9 ? `${e.name} ${n}º` : e.name, index: start });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

export interface Suggestion {
  instrument: string;
  fromPage: number;
  toPage: number;
  confidence: number;
}

/**
 * Agrupa páginas consecutivas por el instrumento de su cabecera. Las páginas sin cabecera
 * reconocible se consideran continuación de la particella anterior (con menos confianza).
 */
export function suggestParts(pages: string[], catalog: Entry[]): Suggestion[] {
  const perPage = pages.map((t) => {
    const header = t.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4).join('\n');
    const inHeader = findInstruments(header, catalog);
    const distinct = new Set(inHeader.map((m) => m.instrument));
    // Una cabecera con muchos instrumentos suele ser una página del guion.
    if (distinct.size >= 4) return { instrument: 'Guion', confidence: 0.5 };
    if (inHeader.length) return { instrument: inHeader[0].instrument, confidence: distinct.size === 1 ? 0.9 : 0.6 };
    const anywhere = findInstruments(t, catalog);
    if (anywhere.length && new Set(anywhere.map((m) => m.instrument)).size === 1) return { instrument: anywhere[0].instrument, confidence: 0.5 };
    return null;
  });
  const out: (Suggestion & { scores: number[] })[] = [];
  perPage.forEach((p, i) => {
    const last = out[out.length - 1];
    if (!p) {
      if (last && last.toPage === i) {
        last.toPage = i + 1;
        last.scores.push(0.4);
      }
      return;
    }
    if (last && last.instrument === p.instrument && last.toPage === i) {
      last.toPage = i + 1;
      last.scores.push(p.confidence);
    } else {
      out.push({ instrument: p.instrument, fromPage: i + 1, toPage: i + 1, confidence: 0, scores: [p.confidence] });
    }
  });
  return out.map(({ scores, ...s }) => ({ ...s, confidence: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 }));
}

// pdf.js (vía unpdf) es ESM y costoso en CPU: se ejecuta en un worker aparte, con límite de tiempo
// y memoria, para no bloquear el bucle de eventos (y porque jest no admite import() dinámico).
const TEXT_WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
import(pathToFileURL(workerData.lib).href)
  .then(async ({ getDocumentProxy, extractText }) => {
    const pdf = await getDocumentProxy(workerData.bytes);
    const { text } = await extractText(pdf, { mergePages: false });
    parentPort.postMessage({ text });
  })
  .catch((e) => parentPort.postMessage({ error: String(e && e.message || e) }));
`;

/** Texto de cada página. Un PDF escaneado devuelve páginas vacías. */
export function extractPages(bytes: Uint8Array, timeoutMs = 30_000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new BadRequestException({ message: 'No se ha podido leer el PDF', code: 'PDF_UNREADABLE' }));
    const worker = new Worker(TEXT_WORKER, {
      eval: true,
      workerData: { lib: require.resolve('unpdf'), bytes: new Uint8Array(bytes) },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    const timer = setTimeout(() => void worker.terminate(), timeoutMs);
    worker.once('message', (m: { text?: string[]; error?: string }) => {
      clearTimeout(timer);
      void worker.terminate();
      if (m.text) resolve(m.text);
      else fail();
    });
    worker.once('error', () => (clearTimeout(timer), fail()));
    worker.once('exit', () => (clearTimeout(timer), fail()));
  });
}

export async function loadPdf(bytes: Uint8Array) {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    throw new BadRequestException({ message: 'No se ha podido leer el PDF', code: 'PDF_UNREADABLE' });
  }
}

export async function extractRange(src: PDFDocument, fromPage: number, toPage: number) {
  const doc = await PDFDocument.create();
  const pages = await doc.copyPages(src, Array.from({ length: toPage - fromPage + 1 }, (_, i) => fromPage - 1 + i));
  pages.forEach((p) => doc.addPage(p));
  return doc.save();
}

/** Las fuentes estándar sólo codifican WinAnsi: sustituimos el resto de caracteres. */
export function winAnsi(s: string) {
  return s
    .normalize('NFC')
    .replace(/♭/g, 'b')
    .replace(/♯/g, '#')
    .replace(/[‘’]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

export interface BookletEntry {
  label: string | null;
  title: string;
  composer: string | null;
  pdf: PDFDocument | null;
}

const PAGE: [number, number] = [595.28, 841.89];
const LINES_PER_PAGE = 28;

/** Índice (etiqueta, título, página o «falta») seguido de las particellas en el orden del libreto. */
export async function mergeBooklet(title: string, instrument: string, entries: BookletEntry[], org?: string | null) {
  const out = await PDFDocument.create();
  out.setTitle(winAnsi(`${title} - ${instrument}`));
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const indexPages = Math.max(1, Math.ceil(entries.length / LINES_PER_PAGE));
  let next = indexPages + 1;
  const starts = entries.map((e) => {
    if (!e.pdf) return null;
    const s = next;
    next += e.pdf.getPageCount();
    return s;
  });

  const fit = (s: string, f: PDFFont, size: number, max: number) => {
    const t = winAnsi(s);
    if (f.widthOfTextAtSize(t, size) <= max) return t;
    let cut = t;
    while (cut.length > 1 && f.widthOfTextAtSize(cut + '...', size) > max) cut = cut.slice(0, -1);
    return cut + '...';
  };
  const ink = rgb(0.12, 0.23, 0.37);
  const mute = rgb(0.36, 0.42, 0.48);
  for (let p = 0; p < indexPages; p++) {
    const page = out.addPage(PAGE);
    page.drawRectangle({ x: 0, y: PAGE[1] - 10, width: PAGE[0], height: 10, color: ink });
    let y = PAGE[1] - 48;
    if (p === 0) {
      if (org) {
        page.drawText(fit(org, bold, 11, 480), { x: 50, y, size: 11, font: bold, color: ink });
        y -= 18;
      }
      page.drawText(fit(title, bold, 18, 480), { x: 50, y, size: 18, font: bold });
      y -= 22;
      page.drawText(fit(instrument, font, 12, 480), { x: 50, y, size: 12, font, color: mute });
      y -= 16;
      page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.6, color: ink });
      y -= 26;
    }
    page.drawText('Solfeamos', { x: 50, y: 28, size: 8, font, color: mute });
    const pageNo = `${p + 1} / ${indexPages}`;
    page.drawText(pageNo, { x: 545 - font.widthOfTextAtSize(pageNo, 8), y: 28, size: 8, font, color: mute });
    entries.slice(p * LINES_PER_PAGE, (p + 1) * LINES_PER_PAGE).forEach((e, i) => {
      const idx = p * LINES_PER_PAGE + i;
      const color = e.pdf ? rgb(0, 0, 0) : rgb(0.55, 0.1, 0.1);
      page.drawText(fit(e.label ?? String(idx + 1), bold, 11, 40), { x: 50, y, size: 11, font: bold, color });
      const name = e.composer ? `${e.title} (${e.composer})` : e.title;
      page.drawText(fit(name, font, 11, 370), { x: 95, y, size: 11, font, color });
      const right = starts[idx] ? `pág. ${starts[idx]}` : 'falta';
      page.drawText(winAnsi(right), { x: 545 - font.widthOfTextAtSize(winAnsi(right), 11), y, size: 11, font, color });
      y -= 20;
    });
  }
  for (const e of entries) {
    if (!e.pdf) continue;
    const pages = await out.copyPages(e.pdf, e.pdf.getPageIndices());
    pages.forEach((pg) => out.addPage(pg));
  }
  return out.save();
}
