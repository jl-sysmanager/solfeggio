import { useState } from 'react';
import { Link } from 'react-router-dom';
import { post } from '../../../api/client';
import { useApi, useApiMutation } from '../../../api/hooks';
import type { ModUser } from '../../../api/types-admin-support';
import { date } from '../../../lib/format';
import { Button, IconButton } from '../../Button';
import { Card } from '../../Card';
import { Chip } from '../../Chip';
import { DataTable } from '../../DataTable';
import { ErrorNote } from '../../EmptyState';
import { FormError, TextAreaField, TextField, formValues } from '../../Field';
import { Drawer } from '../../Modal';

/** Búsqueda de usuarios para bloquearlos o desbloquearlos (nunca administradores de plataforma). */
export function UserBlocking() {
  const [term, setTerm] = useState('');
  const [blocking, setBlocking] = useState<ModUser | null>(null);
  const q = useApi<ModUser[]>('/admin/moderation/users', term.trim().length >= 3 ? { q: term.trim() } : { blocked: 'true' });
  const opts = { invalidate: ['/admin/moderation', '/admin/users'] };
  const block = useApiMutation((v: { id: string; reason: string }) => post(`/admin/moderation/users/${v.id}/block`, { reason: v.reason }), {
    success: 'Usuario bloqueado',
    ...opts,
    onSuccess: () => setBlocking(null),
  });
  const unblock = useApiMutation((id: string) => post(`/admin/moderation/users/${id}/unblock`), { success: 'Usuario desbloqueado', ...opts });
  return (
    <Card title="Bloqueo de usuarios">
      <p className="small muted">
        Atajo de moderación. Gestión completa en <Link to="/admin/users">Usuarios</Link>.
      </p>
      <TextField label="Buscar usuario" value={term} onChange={(e) => setTerm(e.target.value)} hint="Nombre o email (3 letras como mínimo). Sin búsqueda se muestran los bloqueados." />
      {q.error && <ErrorNote error={q.error} />}
      <DataTable
        caption="Usuarios"
        rows={q.data ?? []}
        rowKey={(u) => u.id}
        onRowClick={(u) => { if (!u.isPlatformAdmin && !u.blockedAt) setBlocking(u); }}
        empty="Ningún usuario coincide."
        columns={[
          { key: 'n', header: 'Usuario', render: (u) => `${u.name} · ${u.email}` },
          { key: 's', header: 'Estado', render: (u) => (u.blockedAt ? <Chip tone="danger">Bloqueado {date(u.blockedAt)}</Chip> : u.isPlatformAdmin ? <Chip>Equipo de plataforma</Chip> : <Chip tone="success">Activo</Chip>) },
          { key: 'r', header: 'Motivo', render: (u) => u.blockedReason ?? '—' },
          {
            key: 'a',
            header: 'Acciones',
            render: (u) =>
              u.isPlatformAdmin ? null : u.blockedAt ? (
                <IconButton icon="check" label={`Desbloquear a ${u.name}`} onClick={() => unblock.mutate(u.id)} />
              ) : (
                <IconButton icon="shield" variant="danger" label={`Bloquear a ${u.name}`} onClick={() => setBlocking(u)} />
              ),
          },
        ]}
      />
      <Drawer open={!!blocking} onClose={() => setBlocking(null)} title={`Bloquear a ${blocking?.name ?? ''}`}>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (blocking && v.reason) block.mutate({ id: blocking.id, reason: v.reason });
          }}
        >
          <TextAreaField label="Motivo" name="reason" required minLength={3} hint="Cierra todas sus sesiones y le impide volver a entrar." />
          <FormError error={block.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setBlocking(null)}>Cancelar</Button>
            <Button type="submit" variant="danger" loading={block.isPending}>Bloquear</Button>
          </div>
        </form>
      </Drawer>
    </Card>
  );
}
