import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../Button';
import { Icon } from '../Icon';

const minutesLeft = (expiresAt: string) => Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60_000));

/** Franja fija mientras el equipo de plataforma «ve como» una banda: sólo lectura y con cuenta atrás. */
export function ImpersonationBanner() {
  const { impersonation, session, endImpersonation } = useAuth();
  const navigate = useNavigate();
  const [left, setLeft] = useState(() => (impersonation ? minutesLeft(impersonation.expiresAt) : 0));
  const tenantId = session?.tenant?.id;

  useEffect(() => {
    if (!impersonation) return;
    const tick = () => {
      const m = minutesLeft(impersonation.expiresAt);
      setLeft(m);
      // Caducada: se termina sola y se devuelve la cuenta del administrador.
      if (new Date(impersonation.expiresAt).getTime() <= Date.now()) void exit();
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impersonation]);

  async function exit() {
    await endImpersonation();
    navigate(tenantId ? `/admin/tenants/${tenantId}` : '/admin');
  }

  if (!impersonation) return null;
  return (
    <div
      role="status"
      className="status-banner"
      style={{ position: 'sticky', top: 0, zIndex: 60, background: 'var(--foreground)', color: 'var(--background)', fontWeight: 600, justifyContent: 'space-between' }}
    >
      <span className="row" style={{ gap: 8 }}>
        <Icon name="alert" size={16} />
        <span>
          Viendo «{impersonation.tenantName}» como plataforma · solo lectura · quedan {left} min
        </span>
      </span>
      <Button size="sm" variant="ghost" onClick={() => void exit()} style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
        Salir
      </Button>
    </div>
  );
}
