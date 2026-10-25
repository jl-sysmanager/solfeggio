import { renderBrandedEmail } from './email-layout';

const INVITE = 'https://solfeamos.test/invite/abc';

describe('formato de correo', () => {
  it('usa la placa de cobalto, el filete ocre y escapa el contenido', () => {
    const html = renderBrandedEmail({
      subject: 'Aviso <script>',
      text: 'Hola <b>banda</b>\n\nDetalle',
      homeUrl: 'https://solfeamos.test',
    });
    expect(html).toContain('#23408E');
    expect(html).toContain('#D9A21B');
    expect(html).toContain('Solfeamos');
    expect(html).toContain('Gestión para bandas de música');
    expect(html).toContain('solfeamos.test');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('Aviso &lt;script&gt;');
    expect(html).toContain('Hola &lt;b&gt;banda&lt;/b&gt;');
  });

  it('convierte un enlace suelto en botón y deja el resto como texto', () => {
    const html = renderBrandedEmail({
      subject: 'Invitación a La Lira en Solfeamos',
      text: `Te han invitado a unirte a La Lira.\n\nAcepta la invitación aquí (caduca en 7 días):\n${INVITE}`,
    });
    expect(html).toContain(`href="${INVITE}"`);
    expect(html).toContain('Aceptar la invitación');
    expect(html).toContain('Acepta la invitación aquí (caduca en 7 días):');
    expect(html).not.toContain(`<p style="margin:0 0 14px;">${INVITE}</p>`);
  });

  it('enlaza una dirección que va dentro de una frase', () => {
    const html = renderBrandedEmail({
      subject: 'Refuerzo',
      text: `Preséntate desde la bolsa: ${INVITE.replace('/invite/abc', '/reinforcements')}.`,
    });
    expect(html).toContain('href="https://solfeamos.test/reinforcements"');
    expect(html).not.toContain('>Ver la bolsa de refuerzos<');
  });
});
