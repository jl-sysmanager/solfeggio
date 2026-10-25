import { useState } from 'react';
import { post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { Member } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { passwordIssue } from './Auth';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { FormError, TextField, formValues } from '../components/Field';
import { Page, PageHeader } from '../components/PageHeader';
import { PhotoEditor } from '../components/PhotoEditor';

export default function SecurityPage() {
  const { session, reload } = useAuth();
  const meMember = useApi<Member>(session?.memberId ? `/members/${session.memberId}` : null);
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
  const [formKey, setFormKey] = useState(0);
  const [passwordError, setPasswordError] = useState<unknown>(null);
  const changePassword = useApiMutation(
    (body: { currentPassword: string; newPassword: string }) => post('/auth/password/change', body),
    { success: 'Contraseña actualizada', onSuccess: () => setFormKey((k) => k + 1) },
  );
  const enabled = session?.user.mfaEnabled;
  const secret = setup ? new URL(setup.otpauthUrl).searchParams.get('secret') : null;

  return (
    <Page header={<PageHeader tone="cream" eyebrow="Tu cuenta" title="Seguridad" description={session?.user.email} />}>
      <Card title="Contraseña">
        <form
          key={formKey}
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            const issue = passwordIssue(v.newPassword ?? '', v.newPassword2 ?? '');
            if (issue) {
              setPasswordError(new Error(issue));
              return;
            }
            if (v.currentPassword === v.newPassword) {
              setPasswordError(new Error('La nueva contraseña debe ser distinta.'));
              return;
            }
            setPasswordError(null);
            changePassword.mutate({ currentPassword: v.currentPassword ?? '', newPassword: v.newPassword ?? '' });
          }}
        >
          <TextField label="Contraseña actual" name="currentPassword" type="password" autoComplete="current-password" required />
          <TextField label="Nueva contraseña" name="newPassword" type="password" autoComplete="new-password" minLength={10} required hint="Mínimo 10 caracteres, con letras y números." />
          <TextField label="Repite la nueva contraseña" name="newPassword2" type="password" autoComplete="new-password" required />
          <FormError error={passwordError ?? changePassword.error} />
          <div>
            <Button type="submit" loading={changePassword.isPending}>
              Cambiar contraseña
            </Button>
          </div>
        </form>
      </Card>
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
      {session?.memberId && (
        <Card title="Foto de perfil">
          <p className="small muted" style={{ marginBottom: 12 }}>
            Se muestra en tu ficha de socio y en los listados de la banda.
          </p>
          <PhotoEditor
            previewUrl={meMember.data?.photoUrl ?? null}
            confirmPath={`/members/${session.memberId}/photo`}
            deletePath={`/members/${session.memberId}/photo`}
            onChanged={() => meMember.refetch()}
          />
        </Card>
      )}
      <Card title="Privacidad" tone="cream">
        <p className="small">
          Tus datos se tratan conforme al RGPD. Puedes solicitar el acceso, rectificación, portabilidad o supresión de tus datos a la secretaría de tu banda o a través de una incidencia de soporte.
        </p>
      </Card>
    </Page>
  );
}
