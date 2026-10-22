// Vista imprimible en una ventana aparte (actas, certificados), sin el marco de la aplicación.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function printDocument(title: string, bodyHtml: string) {
  const w = window.open('', '_blank', 'noopener=no');
  if (!w) return false;
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { font: 12pt/1.5 Georgia, 'Times New Roman', serif; color: #111; margin: 2cm; }
  h1 { font-size: 16pt; text-align: center; margin: 0 0 1em; }
  h2 { font-size: 13pt; margin: 1.5em 0 .5em; }
  pre { white-space: pre-wrap; font: inherit; }
  table { width: 100%; border-collapse: collapse; margin: 1em 0; }
  th, td { border-bottom: 1px solid #999; padding: 4px 6px; text-align: left; }
  td.num, th.num { text-align: right; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .signature { margin-top: 3em; }
</style></head><body>${bodyHtml}</body></html>`);
  w.document.close();
  w.focus();
  w.print();
  return true;
}

export { esc as escapeHtml };
