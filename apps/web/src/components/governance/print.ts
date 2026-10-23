// Documentos imprimibles (actas, certificados, contratos, boletines) en una ventana aparte.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface PrintBrand {
  org: string;
  logoUrl?: string | null;
}

export function brandOf(session: { tenant: { name: string; slug: string; hasLogo?: boolean; logoVersion?: string | null } | null } | null | undefined): PrintBrand {
  const t = session?.tenant;
  if (!t) return { org: 'Solfeamos' };
  const logoUrl =
    t.hasLogo && typeof window !== 'undefined'
      ? `${window.location.origin}/api/v1/bands/${encodeURIComponent(t.slug)}/logo${t.logoVersion ? `?v=${encodeURIComponent(t.logoVersion)}` : ''}`
      : null;
  return { org: t.name, logoUrl };
}

const PRINT_CSS = `
  @page { margin: 16mm 16mm 18mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #1c2430; font: 11pt/1.5 'Palatino Linotype', Palatino, Georgia, serif; }
  .doc-head { display: flex; align-items: center; gap: 14px; padding-bottom: 12px; border-bottom: 3px solid #1e3a5f; }
  .doc-head img { width: 56px; height: 56px; object-fit: contain; }
  .doc-org { margin: 0; font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13pt; font-weight: 700; letter-spacing: -0.02em; color: #1e3a5f; }
  .doc-product { margin: 2px 0 0; font-family: 'Segoe UI', system-ui, sans-serif; font-size: 9pt; letter-spacing: 0.08em; text-transform: uppercase; color: #5c6b7a; }
  .doc-body { padding-top: 18px; }
  h1 { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 16pt; font-weight: 700; letter-spacing: -0.02em; color: #1e3a5f; text-align: center; margin: 0 0 0.8em; }
  h2 { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 12pt; color: #1e3a5f; margin: 1.4em 0 0.4em; }
  p { margin: 0 0 0.7em; }
  pre { white-space: pre-wrap; font: inherit; margin: 0; }
  table { width: 100%; border-collapse: collapse; margin: 0.8em 0 1em; }
  th, td { border-bottom: 1px solid #d5dde6; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 9pt; letter-spacing: 0.04em; text-transform: uppercase; color: #5c6b7a; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { color: #5c6b7a; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .signature { margin-top: 3.2em; }
  .parties { display: flex; gap: 28px; }
  .parties > div { flex: 1; }
  .sign { display: flex; gap: 28px; margin-top: 56px; }
  .sign > div { flex: 1; border-top: 1px solid #1e3a5f; padding-top: 6px; font-family: 'Segoe UI', system-ui, sans-serif; font-size: 10pt; }
  .terms { white-space: pre-wrap; }
  .doc-foot { margin-top: 28px; padding-top: 8px; border-top: 1px solid #d5dde6; font-family: 'Segoe UI', system-ui, sans-serif; font-size: 8.5pt; color: #5c6b7a; display: flex; justify-content: space-between; }
`;

export function documentHtml(title: string, bodyHtml: string, brand: PrintBrand = { org: 'Solfeamos' }) {
  const logo = brand.logoUrl ? `<img src="${esc(brand.logoUrl)}" alt="">` : '';
  const issued = new Date().toLocaleDateString('es-ES', { dateStyle: 'long' });
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>
<header class="doc-head">${logo}<div><p class="doc-org">${esc(brand.org)}</p><p class="doc-product">Solfeamos</p></div></header>
<main class="doc-body">${bodyHtml}</main>
<footer class="doc-foot"><span>${esc(brand.org)}</span><span>${esc(issued)}</span></footer>
</body></html>`;
}

export function printDocument(title: string, bodyHtml: string, brand?: PrintBrand) {
  const w = window.open('', '_blank', 'noopener=no');
  if (!w) return false;
  w.document.write(documentHtml(title, bodyHtml, brand));
  w.document.close();
  w.focus();
  w.print();
  return true;
}

export { esc as escapeHtml };
