import { appUrl } from '../config/env';

/** Correo de invitación. Una cuenta nueva recibe el enlace de alta; una cuenta ya existente entra y acepta en el panel. */
export function invitationEmail(tenantName: string, token: string, existingAccount: boolean) {
  const subject = `Invitación a ${tenantName} en Solfeamos`;
  if (existingAccount) {
    return {
      subject,
      text:
        `Te han invitado a unirte a ${tenantName}.\n\n` +
        `Entra en Solfeamos con tu cuenta y acepta la invitación en Notificaciones. ` +
        `Desde el menú podrás cambiar entre tus bandas.\n\n${appUrl('/login')}\n\n` +
        `La invitación caduca en 7 días.`,
    };
  }
  return {
    subject,
    text: `Te han invitado a unirte a ${tenantName}.\n\nAcepta la invitación aquí (caduca en 7 días):\n${appUrl(`/invite/${token}`)}`,
  };
}
