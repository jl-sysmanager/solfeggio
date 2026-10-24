import { useState } from 'react';
import { post } from '../../../api/client';
import { useApi, useApiMutation } from '../../../api/hooks';
import type { ReinforcementGroup } from '../../../api/types-admin-support';
import { date } from '../../../lib/format';
import { Button, IconButton } from '../../Button';
import { Chip } from '../../Chip';
import { EmptyState, ErrorNote, Loading } from '../../EmptyState';
import { FormError, TextAreaField, formValues } from '../../Field';
import { Drawer } from '../../Modal';

type Action = 'dismiss' | 'hide_request' | 'hide_profile' | 'block_user';
const TITLES: Record<Action, string> = {
  dismiss: 'Descartar denuncia',
  hide_request: 'Ocultar necesidad',
  hide_profile: 'Ocultar perfil',
  block_user: 'Bloquear usuario',
};

/** Denuncias de la bolsa de refuerzos agrupadas por necesidad o perfil. */
export function ReinforcementReports() {
  const q = useApi<ReinforcementGroup[]>('/admin/moderation/reinforcements');
  const [pending, setPending] = useState<{ group: ReinforcementGroup; action: Action } | null>(null);
  const resolve = useApiMutation((v: { id: string; action: Action; note?: string }) => post(`/admin/moderation/reinforcements/reports/${v.id}/resolve`, { action: v.action, note: v.note }), {
    success: 'Denuncia resuelta',
    invalidate: ['/admin/moderation'],
    onSuccess: () => setPending(null),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data?.length) return <EmptyState title="Sin denuncias">No hay denuncias pendientes en la bolsa de refuerzos.</EmptyState>;
  return (
    <>
      <ul className="grid grid--2 list-plain">
        {q.data.map((g) => {
          const title = g.request?.title ?? g.profile?.displayName ?? 'Contenido eliminado';
          const owner = g.request?.createdBy ?? g.profile?.user;
          return (
            <li key={g.key} className="card stack">
              <div className="row between">
                <h3 className="card__title">{title}</h3>
                <Chip tone="warning">{g.reports.length} {g.reports.length === 1 ? 'denuncia' : 'denuncias'}</Chip>
              </div>
              <p className="small muted">
                {g.kind === 'request' ? `Necesidad · ${g.request?.band?.name ?? 'Banda'} · ${g.request?.instrument}` : `Perfil · ${g.profile?.instruments.join(', ')}`} · {owner?.name}
                {owner?.blockedAt && ' (bloqueado)'}
              </p>
              {(g.request?.description ?? g.profile?.bio) && <p className="small">{g.request?.description ?? g.profile?.bio}</p>}
              <ul className="stack list-plain small">
                {g.reports.map((r) => (
                  <li key={r.id}>
                    «{r.reason}» <span className="muted">· {r.reporterBand} · {date(r.createdAt)}</span>
                  </li>
                ))}
              </ul>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <IconButton icon="close" label="Descartar denuncia" onClick={() => setPending({ group: g, action: 'dismiss' })} />
                <IconButton icon="eye" label={g.kind === 'request' ? 'Ocultar necesidad' : 'Ocultar perfil'} onClick={() => setPending({ group: g, action: g.kind === 'request' ? 'hide_request' : 'hide_profile' })} />
                <IconButton icon="shield" variant="danger" label="Bloquear usuario" onClick={() => setPending({ group: g, action: 'block_user' })} />
              </div>
            </li>
          );
        })}
      </ul>
      <Drawer open={!!pending} onClose={() => setPending(null)} title={pending ? TITLES[pending.action] : ''}>
        <form
          className="form"
          key={pending?.group.key}
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (pending) resolve.mutate({ id: pending.group.reports[0].id, action: pending.action, note: v.note });
          }}
        >
          <TextAreaField
            label={pending?.action === 'block_user' ? 'Motivo del bloqueo' : 'Nota (opcional)'}
            name="note"
            required={pending?.action === 'block_user'}
            hint={pending?.action === 'block_user' ? 'Cierra sus sesiones, retira sus necesidades y oculta su perfil.' : undefined}
          />
          <FormError error={resolve.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setPending(null)}>Cancelar</Button>
            <Button type="submit" variant={pending?.action === 'block_user' ? 'danger' : 'primary'} loading={resolve.isPending}>Confirmar</Button>
          </div>
        </form>
      </Drawer>
    </>
  );
}
