import { useState, type FormEvent } from 'react';
import { ApiError, del, post, put } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { IntegrationCategory, IntegrationField, IntegrationProvider, Paginated, PlatformAuditEntry } from '../api/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { ErrorNote, Loading } from '../components/EmptyState';
import { Checkbox, FormError, SelectField, TextField } from '../components/Field';
import { ConfirmModal } from '../components/Modal';
import { dateTime } from '../lib/format';

const SOURCE: Record<IntegrationCategory['current']['source'], string> = {
  database: 'Configurada en el panel',
  env: 'Heredada de variables de entorno',
  none: 'Sin configurar',
};

/** Errores de validación del API ({ path: 'config.host' | 'secrets.apiKey', message }) por campo. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  return Object.fromEntries(
    (error.details as { path: string; message: string }[]).map((d) => [d.path.replace(/^(config|secrets)\./, ''), d.message]),
  );
}

function initialValue(field: IntegrationField, cat: IntegrationCategory, providerId: string) {
  const same = cat.current.provider === providerId;
  const v = same ? cat.current.config[field.key] : undefined;
  return v ?? field.default ?? '';
}

function Field({ field, cat, provider, error }: { field: IntegrationField; cat: IntegrationCategory; provider: IntegrationProvider; error?: string }) {
  const name = `f_${field.key}`;
  const hint = field.help;
  const value = initialValue(field, cat, provider.id);
  if (field.type === 'boolean') {
    return (
      <div className="field">
        <Checkbox name={name} label={field.label} defaultChecked={value === true || value === 'true'} />
        {error && <span className="field__error">{error}</span>}
      </div>
    );
  }
  if (field.type === 'select') {
    return <SelectField label={field.label} name={name} required={field.required} defaultValue={String(value)} options={field.options ?? []} hint={hint} error={error} />;
  }
  if (field.type === 'secret') {
    const stored = cat.current.provider === provider.id ? cat.current.secrets[field.key] : undefined;
    return (
      <div className="stack" style={{ gap: 6 }}>
        <TextField
          label={field.label}
          name={name}
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          required={field.required && !stored?.set}
          placeholder={stored?.set ? `Guardado${stored.hint ? ` (…${stored.hint})` : ''}. Escribe para sustituirlo` : field.placeholder}
          hint={stored?.set ? 'Déjalo vacío para conservar el valor guardado.' : hint}
          error={error}
        />
        {stored?.set && !field.required && <Checkbox name={`clear_${field.key}`} label="Borrar el valor guardado" />}
      </div>
    );
  }
  return (
    <TextField
      label={field.label}
      name={name}
      type={field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text'}
      min={field.min}
      max={field.max}
      required={field.required}
      placeholder={field.placeholder}
      defaultValue={String(value)}
      hint={hint}
      error={error}
      autoComplete="off"
    />
  );
}

/** Construye el cuerpo del PUT: config completa; secretos sólo si se escriben o se piden borrar. */
export function payload(form: HTMLFormElement, provider: IntegrationProvider) {
  const fd = new FormData(form);
  const config: Record<string, string | number | boolean | null> = {};
  const secrets: Record<string, string | null> = {};
  for (const f of provider.fields) {
    const raw = fd.get(`f_${f.key}`);
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (f.type === 'boolean') config[f.key] = raw === 'on';
    else if (f.type === 'secret') {
      if (text) secrets[f.key] = text;
      else if (fd.get(`clear_${f.key}`) === 'on') secrets[f.key] = null;
    } else if (f.type === 'number') config[f.key] = text === '' ? null : Number(text);
    else config[f.key] = text === '' ? null : text;
  }
  return { provider: provider.id, enabled: fd.get('enabled') === 'on', config, secrets };
}

function IntegrationCard({ cat }: { cat: IntegrationCategory }) {
  const [providerId, setProviderId] = useState(cat.current.provider ?? cat.providers[0].id);
  const [testTo, setTestTo] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const provider = cat.providers.find((p) => p.id === providerId) ?? cat.providers[0];

  const save = useApiMutation((body: ReturnType<typeof payload>) => put<IntegrationCategory>(`/admin/integrations/${cat.id}`, body), {
    success: `${cat.label}: configuración guardada`,
    invalidate: ['/admin/integrations', '/admin/audit-logs'],
  });
  const test = useApiMutation(() => post<{ ok: boolean; message: string }>(`/admin/integrations/${cat.id}/test`, cat.id === 'email' && testTo ? { to: testTo } : {}), {
    invalidate: ['/admin/audit-logs'],
    onSuccess: (r) => setTestResult(r),
  });
  const reset = useApiMutation(() => del<IntegrationCategory>(`/admin/integrations/${cat.id}`), {
    success: `${cat.label}: se usarán las variables de entorno`,
    invalidate: ['/admin/integrations', '/admin/audit-logs'],
    onSuccess: () => setConfirmReset(false),
  });
  const errors = fieldErrors(save.error);
  const savedProvider = cat.current.provider === providerId;

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTestResult(null);
    save.mutate(payload(e.currentTarget, provider));
  };

  const status = !cat.current.provider ? (
    <Chip>Sin configurar</Chip>
  ) : cat.current.enabled ? (
    <Chip tone="success">Habilitada · {cat.providers.find((p) => p.id === cat.current.provider)?.label}</Chip>
  ) : (
    <Chip tone="warning">Deshabilitada</Chip>
  );

  return (
    <Card title={cat.label} actions={status}>
      <div className="stack" style={{ gap: 20 }}>
        <div className="stack" style={{ gap: 4 }}>
          <p className="muted">{cat.description}</p>
          <p className="small muted">
            {SOURCE[cat.current.source]}
            {cat.current.updatedAt && ` · actualizado el ${dateTime(cat.current.updatedAt)}${cat.current.updatedBy ? ` por ${cat.current.updatedBy.name}` : ''}`}
          </p>
        </div>

        {/* `key` reinicia los valores por defecto al cambiar de proveedor o tras guardar. */}
        <form className="form" onSubmit={onSubmit} key={`${providerId}-${cat.current.updatedAt ?? 'none'}`} noValidate>
          <div className="form-row">
            <SelectField
              label="Proveedor"
              name="provider"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              options={cat.providers.map((p) => ({ value: p.id, label: p.label }))}
              hint={
                <>
                  {provider.description}
                  {provider.docsUrl && (
                    <>
                      {' '}
                      <a href={provider.docsUrl} target="_blank" rel="noreferrer noopener">
                        Documentación
                      </a>
                    </>
                  )}
                </>
              }
            />
          </div>
          <div className="card card--cream stack" style={{ gap: 4 }}>
            <Checkbox name="enabled" label={<strong>Habilitar {cat.label.toLowerCase()}</strong>} defaultChecked={savedProvider ? cat.current.enabled : false} />
            <p className="small muted">Si se deshabilita: {cat.disabledBehavior}</p>
          </div>
          {!savedProvider && cat.current.provider && (
            <p className="small muted" role="note">
              Al guardar con otro proveedor se descartan los secretos de {cat.providers.find((p) => p.id === cat.current.provider)?.label}.
            </p>
          )}
          <div className="form-row">
            {provider.fields.map((f) => (
              <Field key={f.key} field={f} cat={cat} provider={provider} error={errors[f.key]} />
            ))}
          </div>
          {save.error && !Object.keys(errors).length ? <FormError error={save.error} /> : null}
          {Object.keys(errors).length > 0 && (
            <p className="field__error" role="alert">
              Revisa los campos marcados.
            </p>
          )}
          <div className="row">
            <Button type="submit" loading={save.isPending}>
              Guardar
            </Button>
            {cat.current.source === 'database' && (
              <Button variant="ghost" onClick={() => setConfirmReset(true)}>
                Restablecer a variables de entorno
              </Button>
            )}
          </div>
        </form>

        <div className="card card--cream stack">
          <h3 className="card__title">Probar conexión</h3>
          <p className="small muted">
            Usa la configuración guardada, aunque esté deshabilitada.{' '}
            {cat.id === 'email' ? 'Envía un correo de prueba.' : 'Consulta el saldo de la cuenta para validar la clave.'}
          </p>
          <div className="toolbar">
            {cat.id === 'email' && (
              <TextField label="Enviar a" type="email" placeholder="Tu email (por defecto)" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            )}
            <Button variant="ghost" onClick={() => test.mutate(undefined)} loading={test.isPending} disabled={!cat.current.provider}>
              Probar conexión
            </Button>
          </div>
          <div aria-live="polite">{testResult && <Chip tone={testResult.ok ? 'success' : 'danger'}>{testResult.message}</Chip>}</div>
        </div>
      </div>

      <ConfirmModal
        open={confirmReset}
        title={`Restablecer ${cat.label.toLowerCase()}`}
        confirmLabel="Restablecer"
        message="Se borrará la configuración guardada (incluidos los secretos) y se volverán a usar las variables de entorno del servidor, si existen."
        loading={reset.isPending}
        onConfirm={() => reset.mutate(undefined)}
        onClose={() => setConfirmReset(false)}
      />
    </Card>
  );
}

const ACTIONS: Record<string, string> = {
  'integration.updated': 'Configuración guardada',
  'integration.reset': 'Restablecida a variables de entorno',
  'integration.tested': 'Prueba de conexión',
};

function History() {
  const q = useApi<Paginated<PlatformAuditEntry>>('/admin/audit-logs', { entity: 'integration', pageSize: 20 });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const rows = q.data?.data ?? [];
  return (
    <Card title="Historial de cambios">
      {rows.length === 0 ? (
        <p className="muted">Todavía no hay cambios.</p>
      ) : (
        <ul className="list-plain list-divided">
          {rows.map((r) => {
            const m = (r.metadata ?? {}) as { provider?: string; enabled?: boolean; ok?: boolean; secretsChanged?: string[] };
            return (
              <li key={r.id} className="row between">
                <span>
                  <strong>{ACTIONS[r.action] ?? r.action}</strong> · {r.entityId === 'payments' ? 'Pagos' : 'Correo'}
                  {m.provider && ` · ${m.provider}`}
                  {m.enabled !== undefined && ` · ${m.enabled ? 'habilitada' : 'deshabilitada'}`}
                  {m.ok !== undefined && ` · ${m.ok ? 'correcta' : 'fallida'}`}
                  {m.secretsChanged?.length ? ` · secretos cambiados: ${m.secretsChanged.join(', ')}` : ''}
                </span>
                <span className="small muted">
                  {r.actor?.name ?? 'Sistema'} · {dateTime(r.createdAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function IntegrationsTab() {
  const q = useApi<IntegrationCategory[]>('/admin/integrations');
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  return (
    <div className="stack" style={{ gap: 24 }}>
      <p className="muted">
        Los secretos se guardan cifrados (AES-256-GCM) y nunca se muestran; sólo los últimos caracteres para identificarlos. Los cambios se aplican en
        menos de 30 segundos en la API y el worker, sin reiniciar.
      </p>
      {(q.data ?? []).map((c) => (
        <IntegrationCard key={c.id} cat={c} />
      ))}
      <History />
    </div>
  );
}
