import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { post } from '../api/client';
import { useApi } from '../api/hooks';
import type { NotificationItem, Session } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/Button';
import { FormError, SelectField, TextField, formValues } from '../components/Field';
import { AuthLayout } from './Auth';

export function slugify(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function OnboardingPage() {
  const { applyTokenSession, session, reload } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (session && !session.user.emailVerified) {
    return (
      <AuthLayout title="Confirma tu email" lead={`Te hemos enviado un enlace a ${session.user.email}.`}>
        <div className="stack">
          <p>Ábrelo para comprobar que el email es tuyo. Hasta entonces no se puede crear la banda. El enlace caduca en 24 horas y sólo puede usarse una vez.</p>
          <Button
            loading={loading}
            onClick={async () => {
              setLoading(true);
              setError(null);
              try {
                await post('/auth/email/send');
                setNotice('Enlace reenviado.');
              } catch (err) {
                setError(err);
              } finally {
                setLoading(false);
              }
            }}
          >
            Reenviar enlace
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              setError(null);
              await reload();
            }}
          >
            Ya lo he confirmado
          </Button>
          {notice && <p className="small">{notice}</p>}
          <FormError error={error} />
        </div>
      </AuthLayout>
    );
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    setLoading(true);
    setError(null);
    try {
      const res = await post<{ accessToken: string; session: Session }>('/onboarding', {
        bandName: v.bandName,
        slug: v.slug,
        country: v.country,
        timezone: v.timezone,
      });
      applyTokenSession(res);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Registra tu banda">
      <form className="form" onSubmit={submit}>
        <p className="small">Empiezas en el plan Free. Podrás cambiar de plan cuando quieras desde «Plan y facturación».</p>
        <TextField
          label="Nombre de la banda"
          name="bandName"
          required
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
        />
        <TextField
          label="Identificador"
          name="slug"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(slugify(e.target.value));
          }}
          hint="Sólo minúsculas, números y guiones. Ej.: banda-municipal-lliria"
        />
        <div className="form-row">
          <SelectField
            label="País"
            name="country"
            defaultValue="ES"
            options={[
              { value: 'ES', label: 'España' },
              { value: 'PT', label: 'Portugal' },
              { value: 'MX', label: 'México' },
              { value: 'AR', label: 'Argentina' },
              { value: 'CO', label: 'Colombia' },
            ]}
          />
          <SelectField
            label="Zona horaria"
            name="timezone"
            defaultValue="Europe/Madrid"
            options={[
              { value: 'Europe/Madrid', label: 'Europe/Madrid' },
              { value: 'Atlantic/Canary', label: 'Atlantic/Canary' },
              { value: 'Europe/Lisbon', label: 'Europe/Lisbon' },
              { value: 'America/Mexico_City', label: 'America/Mexico_City' },
              { value: 'America/Argentina/Buenos_Aires', label: 'America/Buenos_Aires' },
              { value: 'America/Bogota', label: 'America/Bogota' },
            ]}
          />
        </div>
        <FormError error={error} />
        <Button type="submit" loading={loading}>
          Crear banda
        </Button>
      </form>
    </AuthLayout>
  );
}

export function TenantPickerPage() {
  const { session, switchTenant, applyTokenSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const invites = useApi<NotificationItem[]>('/notifications', { unread: true });
  const pending = invites.data?.filter((n) => n.type === 'invitation') ?? [];

  async function pick(tenantId: string) {
    setBusy(tenantId);
    setError(null);
    try {
      await switchTenant(tenantId);
      navigate(from ?? '/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function accept(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await post<{ accessToken: string; session: Session }>('/auth/invitations/pending/accept', { id });
      applyTokenSession(res);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <AuthLayout title="Elige una banda">
      {pending.length > 0 && (
        <ul className="list-plain stack" style={{ marginBottom: 16 }}>
          {pending.map((n) => (
            <li key={n.id} className="card stack" style={{ gap: 8 }}>
              <strong>{n.title}</strong>
              <span className="small">{n.body}</span>
              <Button onClick={() => accept(n.id)} disabled={busy !== null}>
                Aceptar y entrar
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ul className="list-plain stack">
        {session?.memberships.map((m) => (
          <li key={m.tenantId}>
            <button
              className="card"
              style={{ width: '100%', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
              onClick={() => pick(m.tenantId)}
              disabled={busy !== null}
              aria-busy={busy === m.tenantId || undefined}
            >
              <strong style={{ display: 'block', fontSize: 16, fontWeight: 700, color: 'var(--text-strong)' }}>{m.tenantName}</strong>
              <span className="small muted">
                {m.roleName} · {m.slug}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <FormError error={error} />
      <div className="row" style={{ marginTop: 20 }}>
        <Button variant="ghost" onClick={() => navigate('/onboarding')}>
          Registrar otra banda
        </Button>
        {session?.user.isPlatformAdmin && (
          <Button variant="ghost" onClick={() => navigate('/admin')}>
            Panel global
          </Button>
        )}
      </div>
    </AuthLayout>
  );
}
