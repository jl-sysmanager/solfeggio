import { useState } from 'react';
import { post } from '../api/client';
import { useApiMutation } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { FormError, TextField, formValues } from '../components/Field';
import { Page, PageHeader } from '../components/PageHeader';

export default function SecurityPage() {
  const { session, reload } = useAuth();
  const [setup, setSetup] = useState<{ otpauthUrl: string; qrDataUrl: string } | null>(null);
  const start = useApiMutation(() => post<{ otpauthUrl: string; qrDataUrl: string }>('/auth/mfa/setup'), { onSuccess: setSetup });
  const enable = useApiMutation((code: string) => post('/auth/mfa/enable', { code }), {
    success: 'Verificación en dos pasos activada',
    onSuccess: () => {
      setSetup(null);
      reload();
    },
  });
  const disable = useApiMutation((code: string) => post('/auth/mfa/disable', { code }), {
    success: 'Verificación en dos pasos desactivada',
    onSuccess: () => reload(),
  });
  const enabled = session?.user.mfaEnabled;
  const secret = setup ? new URL(setup.otpauthUrl).searchParams.get('secret') : null;

  return (
    <Page header={<PageHeader tone="cream" eyebrow="Tu cuenta" title="Seguridad" description={session?.user.email} />}>
      <Card title="Verificación en dos pasos (MFA)" actions={<Chip tone={enabled ? 'success' : 'warning'}>{enabled ? 'Activada' : 'Desactivada'}</Chip>}>
        {enabled ? (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const v = formValues(e.currentTarget);
              if (v.code) disable.mutate(v.code);
            }}
          >
            <p>Para desactivarla, introduce un código actual de tu aplicación de autenticación.</p>
            <TextField label="Código" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />
            <FormError error={disable.error} />
            <div>
              <Button type="submit" variant="ghost" loading={disable.isPending}>
                Desactivar MFA
              </Button>
            </div>
          </form>
        ) : setup ? (
          <div className="grid grid--2">
            <div className="stack">
              <p>1. Escanea el código QR con Google Authenticator, 1Password, Authy u otra aplicación TOTP.</p>
              <img src={setup.qrDataUrl} alt="Código QR para configurar la verificación en dos pasos" width={200} height={200} style={{ background: '#fff', padding: 8, borderRadius: 18, border: '1px solid var(--border)' }} />
              {secret && (
                <p className="small">
                  ¿No puedes escanear? Clave: <code style={{ overflowWrap: 'anywhere' }}>{secret}</code>
                </p>
              )}
            </div>
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                const v = formValues(e.currentTarget);
                if (v.code) enable.mutate(v.code);
              }}
            >
              <p>2. Introduce el código de 6 dígitos que muestra la aplicación.</p>
              <TextField label="Código" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus />
              <FormError error={enable.error} />
              <div className="row">
                <Button type="submit" loading={enable.isPending}>
                  Activar
                </Button>
                <Button variant="ghost" onClick={() => setSetup(null)}>
                  Cancelar
                </Button>
              </div>
            </form>
          </div>
        ) : (
          <div className="stack">
            <p>Añade una segunda capa de seguridad: además de tu contraseña, te pediremos un código temporal al entrar. Muy recomendable para propietarios, tesoreros y secretarios.</p>
            <div>
              <Button onClick={() => start.mutate(undefined)} loading={start.isPending}>
                Configurar MFA
              </Button>
            </div>
            <FormError error={start.error} />
          </div>
        )}
      </Card>
      <Card title="Privacidad" tone="cream">
        <p className="small">
          Tus datos se tratan conforme al RGPD. Puedes solicitar el acceso, rectificación, portabilidad o supresión de tus datos a la secretaría de tu banda o a través de una incidencia de soporte.
        </p>
      </Card>
    </Page>
  );
}
