import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { PublicOffer } from '../api/types-school';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { EmptyState, ErrorNote, Loading } from '../components/EmptyState';
import { Checkbox, FormError, TextAreaField, TextField, formValues } from '../components/Field';
import { Wordmark } from '../components/Logo';
import { PageHeader } from '../components/PageHeader';
import { money } from '../lib/format';
import { subjectKind } from '../lib/labels-school';

/** Formulario público de matrícula (sin sesión). */
export default function EnrollPublicPage() {
  const { slug } = useParams();
  const base = `/public/schools/${encodeURIComponent(slug ?? '')}`;
  const offer = useQuery<PublicOffer>({ queryKey: [base], queryFn: () => api<PublicOffer>(`${base}/offer`, { noRefresh: true }), retry: false });
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = formValues(form);
    const subjectIds = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="subjectIds"]:checked')).map((i) => i.value);
    const consent = (form.elements.namedItem('consent') as HTMLInputElement).checked;
    if (!subjectIds.length) return setError(new Error('Elige al menos una asignatura'));
    if (!consent) return setError(new Error('Debes aceptar el tratamiento de datos'));
    setLoading(true);
    setError(null);
    try {
      await api(`${base}/applications`, {
        method: 'POST',
        noRefresh: true,
        body: {
          studentFirstName: v.studentFirstName, studentLastName: v.studentLastName, studentBirthDate: v.studentBirthDate ?? null,
          guardianName: v.guardianName, guardianEmail: v.guardianEmail, guardianPhone: v.guardianPhone ?? null, notes: v.notes ?? null, subjectIds, consent: true,
        },
      });
      setSent(`${v.studentFirstName}`);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  const o = offer.data;
  return (
    <div className="page">
      <a className="skip-link" href="#main">
        Saltar al contenido
      </a>
      <div className="container" style={{ paddingTop: 16 }}>
        <Wordmark />
      </div>
      <PageHeader title={o ? `Matrícula · ${o.band.name}` : 'Matrícula en la escuela de música'} description={o ? `Escuela de música · Curso ${o.year.name}` : undefined} />
      <main id="main" className="container page__body" style={{ maxWidth: 760 }}>
        {offer.isLoading && <Loading />}
        {offer.error && (offer.error instanceof ApiError && offer.error.status === 404 ? (
          <EmptyState title="Matrícula no disponible" icon="school">Esta escuela no tiene la matrícula online abierta en este momento.</EmptyState>
        ) : (
          <ErrorNote error={offer.error} onRetry={() => offer.refetch()} />
        ))}
        {o && sent && (
          <Card tone="cool">
            <div role="status">
              <h2 className="card__title">Solicitud enviada</h2>
              <p>Hemos recibido la solicitud de matrícula de {sent}. La escuela revisará la solicitud y se pondrá en contacto contigo por email (por ejemplo, para la prueba de acceso).</p>
              <Button variant="ghost" onClick={() => setSent(null)}>
                Enviar otra solicitud
              </Button>
            </div>
          </Card>
        )}
        {o && !sent && (
          <div className="stack" style={{ gap: 24 }}>
            {o.publicIntro && (
              <Card tone="cream">
                <p style={{ whiteSpace: 'pre-line' }}>{o.publicIntro}</p>
              </Card>
            )}
            <Card>
              <form className="form" onSubmit={submit}>
                <h2 className="card__title">Alumno</h2>
                <div className="form-row">
                  <TextField label="Nombre" name="studentFirstName" required autoComplete="off" />
                  <TextField label="Apellidos" name="studentLastName" required autoComplete="off" />
                  <TextField label="Fecha de nacimiento" name="studentBirthDate" type="date" />
                </div>
                <h2 className="card__title">Madre, padre o tutor</h2>
                <div className="form-row">
                  <TextField label="Nombre y apellidos" name="guardianName" required autoComplete="name" />
                  <TextField label="Email" name="guardianEmail" type="email" required autoComplete="email" />
                  <TextField label="Teléfono" name="guardianPhone" type="tel" autoComplete="tel" />
                </div>
                <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0 }}>
                  <legend className="card__title">Asignaturas</legend>
                  {o.subjects.map((s) => (
                    <Checkbox key={s.id} name="subjectIds" value={s.id} label={`${s.name} (${subjectKind[s.kind]})${s.monthlyFeeCents ? ` · ${money(s.monthlyFeeCents)}/mes` : ''}`} />
                  ))}
                </fieldset>
                <TextAreaField label="Observaciones" name="notes" hint="Experiencia musical previa, instrumento que le gustaría tocar, horarios…" />
                <Checkbox
                  name="consent"
                  required
                  label={`Acepto que ${o.band.name} trate estos datos para gestionar la matrícula en su escuela de música.`}
                />
                <FormError error={error} />
                <div className="row">
                  <Button type="submit" loading={loading}>
                    Enviar solicitud
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
