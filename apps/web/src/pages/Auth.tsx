import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { Session } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { Button, ButtonLink } from '../components/Button';
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
          <p className="auth__lead">Archivo, ensayos, socios, tesorería y escuela.</p>
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

const BAND_PATHS = [
  { id: 'enter', title: 'Entrar en mi banda', hint: 'Ya tengo cuenta' },
  { id: 'create', title: 'Crear una banda', hint: 'Todavía no está en Solfeamos' },
] as const;

type BandPath = (typeof BAND_PATHS)[number]['id'];

/** Dos caminos visibles: una banda que ya existe, o una que hay que dar de alta. */
function BandPathChoice({ path, onChange }: { path: BandPath; onChange: (next: BandPath) => void }) {
  const enterRef = useRef<HTMLButtonElement>(null);
  const createRef = useRef<HTMLButtonElement>(null);

  function move(from: BandPath, event: KeyboardEvent<HTMLButtonElement>) {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !back) return;
    event.preventDefault();
    const next: BandPath = from === 'enter' ? 'create' : 'enter';
    onChange(next);
    (next === 'enter' ? enterRef : createRef).current?.focus();
  }

  return (
    <div className="auth-paths" role="radiogroup" aria-label="Elige cómo continuar">
      {BAND_PATHS.map((option) => {
        const selected = path === option.id;
        return (
          <button
            key={option.id}
            ref={option.id === 'enter' ? enterRef : createRef}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={selected ? 'auth-path auth-path--on' : 'auth-path'}
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => move(option.id, event)}
          >
            <span className="auth-path__title">{option.title}</span>
            <span className="auth-path__hint">{option.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

export function LoginPage() {
  const location = useLocation();
  const resetDone = (location.state as { reset?: boolean } | null)?.reset;
  const { login } = useAuth();
  const afterLogin = useAfterLogin();
  const [step, setStep] = useState<'credentials' | 'mfa'>('credentials');
  const [path, setPath] = useState<BandPath>('enter');
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

  const choosing = step === 'credentials';

  return (
    <AuthLayout
      title={step === 'mfa' ? 'Verificación en dos pasos' : 'Entra o crea tu banda'}
      lead={step === 'mfa' ? 'Introduce el código de tu aplicación de autenticación.' : undefined}
    >
      {choosing && <BandPathChoice path={path} onChange={setPath} />}
      {resetDone && choosing && path === 'enter' && <p className="small">Contraseña actualizada. Entra con la nueva.</p>}
      {choosing && path === 'create' ? (
        <div className="auth-next" id="band-path-create">
          <p>Crearás tu cuenta y, en el paso siguiente, darás de alta la banda.</p>
          <ButtonLink to="/register">Crear la banda</ButtonLink>
          <p className="small muted">Si te han invitado a una banda que ya existe, elige «Entrar en mi banda».</p>
        </div>
      ) : (
        <form className="form" onSubmit={submit} noValidate={false} id="band-path-enter">
          {step === 'credentials' ? (
            <>
              <TextField label="Email" name="email" type="email" autoComplete="email" required autoFocus />
              <TextField label="Contraseña" name="password" type="password" autoComplete="current-password" required />
              <p className="small">
                <Link to="/forgot-password">He olvidado mi contraseña</Link>
              </p>
            </>
          ) : (
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
          )}
          <FormError error={error} />
          <Button type="submit" loading={loading}>
            {step === 'mfa' ? 'Verificar' : 'Entrar'}
          </Button>
          {step === 'mfa' && (
            <button type="button" className="link-arrow" onClick={() => setStep('credentials')}>
              Volver
            </button>
          )}
        </form>
      )}
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
          Te enviaremos un enlace para confirmar el email antes de crear la banda. Al crear la cuenta aceptas las condiciones del servicio y la
          política de privacidad.
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

/** Reglas alineadas con `passwordSchema` del API. */
export function passwordIssue(password: string, confirm?: string): string | null {
  if (password.length < 10 || password.length > 128) return 'La contraseña debe tener entre 10 y 128 caracteres.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'La contraseña debe incluir letras y números.';
  if (confirm !== undefined && password !== confirm) return 'Las contraseñas no coinciden.';
  return null;
}

export function ForgotPasswordPage() {
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    setError(null);
    setLoading(true);
    try {
      await api('/auth/password/forgot', { method: 'POST', body: { email: v.email }, noRefresh: true });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Recuperar contraseña" lead="Te enviaremos un enlace para elegir una contraseña nueva.">
      {sent ? (
        <div className="stack">
          <p>Si hay una cuenta con ese email, recibirás un enlace en los próximos minutos. Caduca en una hora y sólo puede usarse una vez.</p>
          <p className="small">
            <Link to="/login">Volver a entrar</Link>
          </p>
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <TextField label="Email" name="email" type="email" autoComplete="email" required autoFocus />
          <FormError error={error} />
          <Button type="submit" loading={loading}>
            Enviar enlace
          </Button>
          <p className="small">
            <Link to="/login">Volver a entrar</Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}

export function VerifyEmailPage() {
  const { token } = useParams();
  const { session, reload } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function confirm() {
    setError(null);
    setLoading(true);
    try {
      await api('/auth/email/verify', { method: 'POST', body: { token }, noRefresh: true });
      if (session) await reload();
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'EMAIL_VERIFY_INVALID' ? new Error('El enlace no es válido o ha caducado. Pide otro desde el alta de la banda.') : err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Confirmar email" lead="Este enlace comprueba que el email del propietario es suyo.">
      {done ? (
        <div className="stack">
          <p>Email confirmado. Ya puedes crear la banda.</p>
          {session ? (
            <Button onClick={() => navigate('/onboarding', { replace: true })}>Crear la banda</Button>
          ) : (
            <p className="small">
              <Link to="/login">Entra para continuar</Link>
            </p>
          )}
        </div>
      ) : (
        <div className="stack">
          <FormError error={error} />
          <Button onClick={confirm} loading={loading} disabled={!token}>
            Confirmar email
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const issue = passwordIssue(v.password ?? '', v.password2 ?? '');
    if (issue) {
      setError(new Error(issue));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await api('/auth/password/reset', { method: 'POST', body: { token, password: v.password }, noRefresh: true });
      navigate('/login', { replace: true, state: { reset: true } });
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'RESET_INVALID' ? new Error('El enlace no es válido o ha caducado. Pide otro.') : err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Nueva contraseña" lead="Elige una contraseña que no hayas usado en esta cuenta.">
      <form className="form" onSubmit={submit}>
        <TextField label="Nueva contraseña" name="password" type="password" autoComplete="new-password" minLength={10} required autoFocus hint="Mínimo 10 caracteres, con letras y números." />
        <TextField label="Repite la contraseña" name="password2" type="password" autoComplete="new-password" required />
        <FormError error={error} />
        <Button type="submit" loading={loading}>
          Guardar contraseña
        </Button>
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
