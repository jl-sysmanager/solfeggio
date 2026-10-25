/** Maqueta HTML de los correos: placa de cobalto, filete ocre y cuerpo sobre el vidriado. */

const FONT = "Archivo, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const COBALT = '#23408E';
const COBALT_DEEP = '#16275E';
const GLAZE = '#F3F5F8';
const OCHRE = '#D9A21B';
const INK = '#141A2E';
const MUTED = '#545D73';
const BORDER = '#DCDFE6';

const URL_LINE = /^https?:\/\/[^\s<>"']+$/i;
const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/gi;

const ACTION_LABELS: Array<[RegExp, string]> = [
  [/^\/reset-password(?:\/|$)/, 'Elegir una contraseña'],
  [/^\/invite(?:\/|$)/, 'Aceptar la invitación'],
  [/^\/reinforcements(?:\/|$)/, 'Ver la bolsa de refuerzos'],
  [/^\/admin(?:\/|$)/, 'Abrir el panel'],
];

export function renderBrandedEmail(input: { subject: string; text: string; homeUrl?: string }): string {
  const subject = escapeHtml(input.subject);
  const preheader = escapeHtml(input.text.replace(/\s+/g, ' ').trim().slice(0, 140));
  const blocks = input.text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(renderParagraph)
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${GLAZE};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${GLAZE};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
<tr><td style="background:${COBALT};padding:22px 28px 18px;border-radius:6px 6px 0 0;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;background:${COBALT};border-radius:6px;border:1.5px solid ${GLAZE};">
<div style="width:28px;height:28px;line-height:28px;margin:3px;border:1.5px solid ${GLAZE};border-radius:4px;font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#FFFFFF;">&#119070;</div>
</td>
<td style="padding-left:12px;font-family:${FONT};font-size:20px;font-weight:800;letter-spacing:-0.01em;color:#FFFFFF;">Solf<span style="border-bottom:2px solid ${OCHRE};padding-bottom:1px;">eamos</span></td>
</tr></table>
</td></tr>
<tr><td style="background:${OCHRE};height:3px;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="background:#FFFFFF;padding:28px 28px 24px;border:1px solid ${BORDER};border-top:none;">
<h1 style="margin:0 0 16px;font-family:${FONT};font-size:22px;line-height:1.2;font-weight:800;letter-spacing:-0.01em;color:${INK};">${subject}</h1>
<div style="font-family:${FONT};font-size:15px;line-height:1.55;color:${INK};">${blocks}</div>
</td></tr>
<tr><td style="padding:16px 8px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED};">
Solfeamos<br>Gestión para bandas de música${homeLink(input.homeUrl)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function renderParagraph(paragraph: string): string {
  const actions: string[] = [];
  const lines: string[] = [];
  for (const line of paragraph.split('\n')) {
    const trimmed = line.trim();
    if (URL_LINE.test(trimmed)) actions.push(trimmed);
    else lines.push(linkify(line));
  }
  const text = lines.join('<br>');
  const buttons = actions.map(button).join('');
  return `${text ? `<p style="margin:0 0 14px;">${text}</p>` : ''}${buttons}`;
}

function button(url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 16px;"><tr><td style="background:${COBALT};border-radius:6px;">
<a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:14px;font-weight:700;line-height:1.2;color:#FFFFFF;text-decoration:none;">${escapeHtml(actionLabel(url))}</a>
</td></tr></table>`;
}

function actionLabel(url: string): string {
  try {
    const path = new URL(url).pathname;
    return ACTION_LABELS.find(([pattern]) => pattern.test(path))?.[1] ?? 'Abrir en Solfeamos';
  } catch {
    return 'Abrir en Solfeamos';
  }
}

function linkify(raw: string): string {
  let out = '';
  let last = 0;
  for (const match of raw.matchAll(URL_IN_TEXT)) {
    const start = match.index ?? 0;
    let url = match[0];
    const trail = url.match(/[.,;:!?]+$/)?.[0] ?? '';
    if (trail) url = url.slice(0, -trail.length);
    out += escapeHtml(raw.slice(last, start));
    out += `<a href="${escapeHtml(url)}" style="color:${COBALT};font-weight:700;text-decoration:underline;">${escapeHtml(url)}</a>`;
    out += escapeHtml(trail);
    last = start + match[0].length;
  }
  return out + escapeHtml(raw.slice(last));
}

function homeLink(homeUrl?: string): string {
  if (!homeUrl || !/^https?:\/\//i.test(homeUrl)) return '';
  const label = homeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `<br><a href="${escapeHtml(homeUrl)}" style="color:${MUTED};text-decoration:underline;">${escapeHtml(label)}</a>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
