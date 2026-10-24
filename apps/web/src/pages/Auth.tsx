import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { Session } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/Button';
import { FormError, TextField, formValues } from '../components/Field';
import { BrandMark } from '../components/Logo';

export function AuthLayout({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth__aside" aria-label="Solfeamos">
        <Link to="/login" className="brand brand--on-dark" aria-label="Solfeamos, entrar">
          <BrandMark />
        </Link>
        <div className="auth__copy">
          <p className="auth__headline">Toda tu banda, en un solo panel.</p>
          <p className="auth__lead">Archivo, ensayos, socios, tesorería y escuela. Cada banda trabaja con sus datos, separados del resto.</p>
          <ul className="auth__points">
            <li>Convocatorias y asistencia en el mismo sitio</li>
            <li>Partituras, cuotas y actas listas para imprimir</li>
            <li>La marca de tu banda en la aplicación y en los documentos</li>
          </ul>
        </div>
        <ol className="auth__preview week-tiles" aria-hidden="true">
          {[
            ['Lun', ''],
            ['Mar', 'Ensayo'],
            ['Mié', 'Escuela'],
            ['Jue', 'Ensayo'],
            ['Vie', ''],
            ['Sáb', 'Pasacalle'],
            ['Dom', 'Procesión'],
          ].map(([day, what]) => (
            <li key={day} className={`week-tile${what === 'Ensayo' ? ' week-tile--REHEARSAL' : what === 'Escuela' ? ' week-tile--SCHOOL' : what ? ' week-tile--PERFORMANCE' : ''}`}>
              <span>{day}</span>
              <strong>{what}</strong>
            </li>
          ))}
        </ol>
      </aside>
      <main id="main" className="auth__panel">
        <div className="auth__card card">
          <h1>{title}</h1>
          {lead && <p className="auth__card-lead">{lead}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}

/** Tras autenticarse, decide adónde ir según las bandas del usuario. */
export function useAfterLogin() {
  const { switchTenant } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  return async (memberships: Session['memberships'], isPlatformAdmin: boolean) => {
    if (memberships.length === 1) {
      await switchTenant(memberships[0].tenantId);
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } else if (memberships.length > 1) {
      navigate('/select-band', { replace: true, state: { from } });
    } else {
      navigate(isPlatformAdmin ? '/admin' : '/onboarding', { replace: true });
    }
  };
}

export function LoginPage() {
  const { login } = useAuth();
  const afterLogin = useAfterLogin();
  const [step, setStep] = useState<'credentials' | 'mfa'>('credentials');
  const [creds, setCreds] = useState({ email: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const v = formValues(e.currentTarget);
    const email = step === 'credentials' ? v.email ?? '' : creds.email;
    const password = step === 'credentials' ? v.password ?? '' : creds.password;
    setLoading(true);
    try {
      const res = await login(email, password, step === 'mfa' ? v.mfaCode : undefined);
      await afterLogin(res.memberships, res.user.isPlatformAdmin);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MFA_REQUIRED') {
        setCreds({ email, password });
        setStep('mfa');
      } else if (err instanceof ApiError && err.code === 'ACCOUNT_LOCKED') {
        setError(new Error('Cuenta bloqueada temporalmente por intentos fallidos. Inténtalo más tarde.'));
      } else if (err instanceof ApiError && err.status === 401) {
        setError(new Error(step === 'mfa' ? 'Código incorrecto.' : 'Email o contraseña incorrectos.'));
      } else {
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title={step === 'mfa' ? 'Verificación en dos pasos' : 'Entrar'} lead={step === 'mfa' ? 'Introduce el código de tu aplicación de autenticación.' : 'Accede con el email de tu cuenta.'}>
      <form className="form" onSubmit={submit} noValidate={false}>
        {step === 'credentials' ? (
          <>
            <TextField label="Email" name="email" type="email" autoComplete="email" required autoFocus />
            <TextField label="Contraseña" name="password" type="password" autoComplete="current-password" required />
          </>
        ) : (
          <>
            <TextField
              label="Código"
              name="mfaCode"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
            />
          </>
        )}
        <FormError error={error} />
        <Button type="submit" loading={loading}>
          {step === 'mfa' ? 'Verificar' : 'Entrar'}
        </Button>
        {step === 'mfa' ? (
          <button type="button" className="link-arrow" onClick={() => setStep('credentials')}>
            Volver
          </button>
        ) : (
          <p className="small">
            ¿Tu banda aún no usa Solfeamos? <Link to="/register">Crea una cuenta</Link>
          </p>
        )}
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    setError(null);
    if ((v.password ?? '').length < 12) {
      setError(new Error('La contraseña debe tener al menos 12 caracteres.'));
      return;
    }
    if (v.password !== v.password2) {
      setError(new Error('Las contraseñas no coinciden.'));
      return;
    }
    setLoading(true);
    try {
      await api('/auth/register', { method: 'POST', body: { email: v.email, password: v.password, name: v.name }, noRefresh: true });
      await login(v.email!, v.password!);
      navigate('/onboarding', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Crear cuenta" lead="En unos minutos tendrás el panel de tu banda.">
      <form className="form" onSubmit={submit}>
        <TextField label="Nombre y apellidos" name="name" autoComplete="name" required autoFocus />
        <TextField label="Email" name="email" type="email" autoComplete="email" required />
        <TextField label="Contraseña" name="password" type="password" autoComplete="new-password" minLength={12} required hint="Mínimo 12 caracteres." />
        <TextField label="Repite la contraseña" name="password2" type="password" autoComplete="new-password" required />
        <p className="small muted">
          Al crear la cuenta aceptas las condiciones del servicio y la política de privacidad. Tratamos tus datos conforme al RGPD.
        </p>
        <FormError error={error} />
        <Button type="submit" loading={loading}>
          Crear cuenta
        </Button>
        <p className="small">
          ¿Ya tienes cuenta? <Link to="/login">Entra</Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function AcceptInvitePage() {
  const { token } = useParams();
  const { applyTokenSession } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ accessToken: string; session: Session }>('/auth/invitations/accept', {
        method: 'POST',
        body: { token, name: v.name, password: v.password },
        noRefresh: true,
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
    <AuthLayout title="Únete a tu banda" lead="Te han invitado a Solfeamos. Si es tu primera vez, indica tu nombre y una contraseña. Si ya tienes cuenta, introduce tu contraseña actual.">
      <form className="form" onSubmit={submit}>
        <TextField label="Nombre y apellidos" name="name" autoComplete="name" />
        <TextField label="Contraseña" name="password" type="password" autoComplete="new-password" required minLength={12} />
        <FormError error={error} />
        <Button type="submit" loading={loading}>
          Aceptar invitación
        </Button>
      </form>
    </AuthLayout>
  );
}
