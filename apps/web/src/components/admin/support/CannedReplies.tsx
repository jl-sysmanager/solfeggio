import { useState } from 'react';
import { del, patch, post } from '../../../api/client';
import { useApi, useApiMutation } from '../../../api/hooks';
import type { CannedReply } from '../../../api/types-admin-support';
import { Button, IconButton } from '../../Button';
import { Card } from '../../Card';
import { ErrorNote, Loading } from '../../EmptyState';
import { FormError, TextAreaField, TextField, formValues } from '../../Field';
import { Drawer } from '../../Modal';

/** Gestión de respuestas predefinidas del equipo de soporte. */
export function CannedReplies() {
  const q = useApi<CannedReply[]>('/admin/support/canned-replies');
  const [editing, setEditing] = useState<CannedReply | 'new' | null>(null);
  const opts = { invalidate: ['/admin/support/canned-replies'] };
  const save = useApiMutation((v: { id?: string; body: unknown }) => (v.id ? patch(`/admin/support/canned-replies/${v.id}`, v.body) : post('/admin/support/canned-replies', v.body)), {
    success: 'Respuesta guardada',
    ...opts,
    onSuccess: () => setEditing(null),
  });
  const remove = useApiMutation((id: string) => del(`/admin/support/canned-replies/${id}`), { success: 'Respuesta eliminada', ...opts });
  const cur = editing && editing !== 'new' ? editing : null;
  return (
    <Card title="Respuestas predefinidas" actions={<Button size="sm" onClick={() => setEditing('new')}>Nueva respuesta</Button>}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data?.length === 0 && <p className="small muted">Aún no hay respuestas. Crea las más habituales para contestar más rápido.</p>}
      <ul className="stack list-plain">
        {q.data?.map((c) => (
          <li key={c.id} className="row between row-link" tabIndex={0} onClick={() => setEditing(c)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setEditing(c); }}>
            <span>
              <strong>{c.title}</strong>
              <span className="small muted"> · {c.body.slice(0, 80)}{c.body.length > 80 ? '…' : ''}</span>
            </span>
            <span className="row">
              <IconButton icon="edit" label={`Editar respuesta ${c.title}`} onClick={() => setEditing(c)} />
              <IconButton icon="trash" variant="danger" label={`Eliminar respuesta ${c.title}`} onClick={() => remove.mutate(c.id)} />
            </span>
          </li>
        ))}
      </ul>
      <Drawer open={!!editing} onClose={() => setEditing(null)} title={cur ? 'Editar respuesta' : 'Nueva respuesta'}>
        <form
          className="form"
          key={cur?.id ?? 'new'}
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            save.mutate({ id: cur?.id, body: { title: v.title, body: v.body } });
          }}
        >
          <TextField className="field--medium" label="Título" name="title" required defaultValue={cur?.title} />
          <TextAreaField label="Texto" name="body" required defaultValue={cur?.body} rows={6} />
          <FormError error={save.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button type="submit" loading={save.isPending}>Guardar</Button>
          </div>
        </form>
      </Drawer>
    </Card>
  );
}
