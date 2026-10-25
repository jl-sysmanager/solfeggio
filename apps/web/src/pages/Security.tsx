import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { patch, post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { Membership, Session } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { passwordIssue } from './Auth';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { Checkbox, FormError, TextField, formValues } from '../components/Field';
import { Page, PageHeader } from '../components/PageHeader';
import { PhotoEditor } from '../components/PhotoEditor';
import { UrlTabs, type TabDef } from '../components/Tabs';

interface ProfileMember {
  id: string;
  memberNumber: number;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  instrument?: string | null;
  consentImages: boolean;
  hasPhoto?: boolean;
  photoUrl?: string | null;
  section?: { id: string; name: string } | null;
}

interface ProfileResponse {
  user: { id: string; email: string; name: string; mfaEnabled: boolean; createdAt?: string };
  member: ProfileMember | null;
}

function ProfileTab({ profile, onChanged }: { profile: ProfileResponse; onChanged: () => void }) {
  const { reload } = useAuth();
  const saveName = useApiMutation((body: { name: string }) => patch<{ user: Session['user'] }>('/auth/profile', body), {
    success: 'Nombre actualizado',
    onSuccess: () => {
      void reload();
      onChanged();
    },
  });
  const saveMember = useApiMutation(
    (body: Record<string, unknown>) => patch<{ member: ProfileMember }>('/auth/profile/member', body),
    { success: 'Ficha actualizada', onSuccess: onChanged },
  );
  const m = profile.member;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card title="Datos de la cuenta">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (v.name) saveName.mutate({ name: v.name });
          }}
        >
          <TextField label="Nombre" name="name" defaultValue={profile.user.name} required maxLength={120} autoComplete="name" />
          <TextField label="Email" name="email" defaultValue={profile.user.email} readOnly hint="El email no se puede cambiar desde aquí. Contacta con soporte si lo necesitas." />
          <FormError error={saveName.error} />
          <div>
            <Button type="submit" loading={saveName.isPending}>
              Guardar nombre
            </Button>
          </div>
        </form>
      </Card>

      {m && (
        <>
          <Card title="Ficha de socio">
            <p className="small muted" style={{ marginBottom: 12 }}>
              Nº {m.memberNumber}
              {m.section ? ` · ${m.section.name}` : ''}
            </p>
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                saveMember.mutate({
                  firstName: String(fd.get('firstName') ?? '').trim(),
                  lastName: String(fd.get('lastName') ?? '').trim(),
                  phone: String(fd.get('phone') ?? '').trim() || null,
                  instrument: String(fd.get('instrument') ?? '').trim() || null,
                  address: String(fd.get('address') ?? '').trim() || null,
                  consentImages: fd.get('consentImages') === 'on',
                });
              }}
            >
              <div className="grid grid--2">
                <TextField label="Nombre" name="firstName" defaultValue={m.firstName} required maxLength={80} />
                <TextField label="Apellidos" name="lastName" defaultValue={m.lastName} required maxLength={120} />
              </div>
              <TextField label="Teléfono" name="phone" defaultValue={m.phone ?? ''} maxLength={30} autoComplete="tel" />
              <TextField label="Instrumento" name="instrument" defaultValue={m.instrument ?? ''} maxLength={60} />
              <TextField label="Dirección" name="address" defaultValue={m.address ?? ''} maxLength={300} autoComplete="street-address" />
              <Checkbox name="consentImages" label="Autorizo el uso de mi imagen en publicaciones de la banda" defaultChecked={m.consentImages} />
              <FormError error={saveMember.error} />
              <div>
                <Button type="submit" loading={saveMember.isPending}>
                  Guardar ficha
                </Button>
              </div>
            </form>
          </Card>
          <Card title="Foto de perfil">
            <p className="small muted" style={{ marginBottom: 12 }}>
              Se muestra en tu ficha de socio y en los listados de la banda.
            </p>
            <PhotoEditor
              previewUrl={m.photoUrl ?? null}
              confirmPath={`/members/${m.id}/photo`}
              deletePath={`/members/${m.id}/photo`}
              onChanged={onChanged}
            />
          </Card>
        </>
      )}
    </div>
  );
}

function SecurityTab() {
  const { session, reload } = useAuth();
  const [setup, setSetup] = useState<{ otpauthUrl: string; qrDataUrl: string } | null>(null);
  const start = useApiMutation(() => post<{ otpauthUrl: string; qrDataUrl: string }>('/auth/mfa/setup'), { onSuccess: setSetup });
  const enable = useApiMutation((code: string) => post('/auth/mfa/enable', { code }), {
    success: 'Verificación en dos pasos activada',
    onSuccess: () => {
      setSetup(null);
      void reload();
    },
  });
  const disable = useApiMutation((code: string) => post('/auth/mfa/disable', { code }), {
    success: 'Verificación en dos pasos desactivada',
    onSuccess: () => void reload(),
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
    <div className="stack" style={{ gap: 24 }}>
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
          <TextField
            label="Nueva contraseña"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            hint="Mínimo 10 caracteres, con letras y números."
          />
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
              <img
                src={setup.qrDataUrl}
                alt="Código QR para configurar la verificación en dos pasos"
                width={200}
                height={200}
                style={{ background: '#fff', padding: 8, borderRadius: 18, border: '1px solid var(--border)' }}
              />
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
            <p>
              Añade una segunda capa de seguridad: además de tu contraseña, te pediremos un código temporal al entrar. Muy recomendable para
              propietarios, tesoreros y secretarios.
            </p>
            <div>
              <Button onClick={() => start.mutate(undefined)} loading={start.isPending}>
                Configurar MFA
              </Button>
            </div>
            <FormError error={start.error} />
          </div>
        )}
      </Card>
    </div>
  );
}

function BandsTab({ memberships, currentTenantId }: { memberships: Membership[]; currentTenantId: string | null }) {
  const { applyTokenSession, switchTenant } = useAuth();
  const navigate = useNavigate();
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const leave = useApiMutation(
    (body: { password: string; tenantId: string }) =>
      post<{ accessToken: string; session: Session }>('/auth/leave-tenant', body),
    {
      success: 'Has salido de la banda',
      onSuccess: (res) => {
        setLeavingId(null);
        applyTokenSession(res);
        if (!res.session.tenant) navigate(res.session.memberships.length ? '/select-band' : '/onboarding');
      },
    },
  );

  if (!memberships.length) {
    return (
      <Card title="Bandas">
        <p>No perteneces a ninguna banda.</p>
        <Button onClick={() => navigate('/onboarding')}>Crear o unirte a una banda</Button>
      </Card>
    );
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      {memberships.map((m) => {
        const active = m.tenantId === currentTenantId;
        const isLeaving = leavingId === m.tenantId;
        return (
          <Card
            key={m.tenantId}
            title={m.tenantName}
            actions={
              <div className="row" style={{ gap: 8 }}>
                {active ? <Chip tone="success">Activa</Chip> : null}
                <Chip>{m.roleName}</Chip>
              </div>
            }
          >
            {!active && (
              <div style={{ marginBottom: 12 }}>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void switchTenant(m.tenantId).then(() => {
                      navigate('/');
                    })
                  }
                >
                  Entrar en esta banda
                </Button>
              </div>
            )}
            {isLeaving ? (
              <form
                className="form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = formValues(e.currentTarget);
                  leave.mutate({ password: v.password ?? '', tenantId: m.tenantId });
                }}
              >
                <p className="small">
                  Saldrás de <strong>{m.tenantName}</strong>. Tu ficha de socio (si existe) permanece en la banda; solo pierdes el acceso a la
                  app. Si eres el único propietario, no podrás salir hasta transferir la propiedad.
                </p>
                <TextField label="Confirma con tu contraseña" name="password" type="password" autoComplete="current-password" required />
                <FormError error={leave.error} />
                <div className="row">
                  <Button type="submit" variant="danger" loading={leave.isPending}>
                    Confirmar salida
                  </Button>
                  <Button variant="ghost" type="button" onClick={() => setLeavingId(null)}>
                    Cancelar
                  </Button>
                </div>
              </form>
            ) : (
              <Button variant="ghost" onClick={() => setLeavingId(m.tenantId)}>
                Salir de esta banda
              </Button>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function PrivacyTab({ onClosed }: { onClosed: () => void }) {
  const close = useApiMutation((body: { password: string; confirm: 'ELIMINAR' }) => post('/auth/close-account', body), {
    success: 'Cuenta cerrada',
    onSuccess: onClosed,
  });
  const [open, setOpen] = useState(false);

  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card title="Privacidad" tone="cream">
        <p className="small">
          Tus datos se tratan conforme al RGPD. Puedes solicitar el acceso, rectificación, portabilidad o supresión de tus datos a la secretaría
          de tu banda o a través de una incidencia de soporte. Al cerrar la cuenta, se anonimiza tu usuario y se revoca el acceso a todas las
          bandas; las fichas de socio y los registros contables o de asistencia que la banda deba conservar pueden permanecer anonimizados.
        </p>
      </Card>
      <Card title="Cerrar cuenta">
        {!open ? (
          <div className="stack">
            <p className="small">
              Esta acción es irreversible. Perderás el acceso a Solfeamos y a todas tus bandas. Si eres el único propietario de alguna, deberás
              transferir la propiedad antes.
            </p>
            <div>
              <Button variant="danger" onClick={() => setOpen(true)}>
                Quiero cerrar mi cuenta
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const v = formValues(e.currentTarget);
              if (v.confirm !== 'ELIMINAR') return;
              close.mutate({ password: v.password ?? '', confirm: 'ELIMINAR' });
            }}
          >
            <TextField label="Contraseña" name="password" type="password" autoComplete="current-password" required />
            <TextField
              label='Escribe ELIMINAR para confirmar'
              name="confirm"
              required
              autoComplete="off"
              hint="Mayúsculas, sin espacios."
            />
            <FormError error={close.error} />
            <div className="row">
              <Button type="submit" variant="danger" loading={close.isPending}>
                Cerrar cuenta definitivamente
              </Button>
              <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}

export default function SecurityPage() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const profile = useApi<ProfileResponse>('/auth/profile');

  const tabs: TabDef[] = [
    {
      id: 'perfil',
      label: 'Perfil',
      content: profile.data ? (
        <ProfileTab profile={profile.data} onChanged={() => void profile.refetch()} />
      ) : (
        <p className="muted">{profile.error ? 'No se pudo cargar el perfil.' : 'Cargando…'}</p>
      ),
    },
    { id: 'seguridad', label: 'Seguridad', content: <SecurityTab /> },
    {
      id: 'bandas',
      label: 'Bandas',
      content: <BandsTab memberships={session?.memberships ?? []} currentTenantId={session?.tenant?.id ?? null} />,
    },
    {
      id: 'privacidad',
      label: 'Privacidad',
      content: (
        <PrivacyTab
          onClosed={() => {
            void logout().finally(() => navigate('/login', { replace: true }));
          }}
        />
      ),
    },
  ];

  return (
    <Page
      header={
        <PageHeader
          tone="cream"
          eyebrow="Tu cuenta"
          title="Mi cuenta"
          description={session?.user.email}
        />
      }
    >
      <UrlTabs label="Secciones de la cuenta" tabs={tabs} />
    </Page>
  );
}
