import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

interface Base {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}

function useFieldIds(id?: string) {
  const auto = useId();
  const fieldId = id ?? auto;
  return { fieldId, hintId: `${fieldId}-hint`, errorId: `${fieldId}-error` };
}

function describedBy(hint: unknown, error: unknown, hintId: string, errorId: string) {
  return [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
}

export function TextField({ label, hint, error, id, className, ...rest }: Base & InputHTMLAttributes<HTMLInputElement>) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label htmlFor={fieldId}>
        {label}
        {rest.required && <span aria-hidden="true"> *</span>}
      </label>
      <input id={fieldId} className="input" aria-invalid={error ? true : undefined} aria-describedby={describedBy(hint, error, hintId, errorId)} {...rest} />
      {hint && <span id={hintId} className="field__hint">{hint}</span>}
      {error && <span id={errorId} className="field__error">{error}</span>}
    </div>
  );
}

export function TextAreaField({ label, hint, error, id, ...rest }: Base & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <div className="field">
      <label htmlFor={fieldId}>
        {label}
        {rest.required && <span aria-hidden="true"> *</span>}
      </label>
      <textarea id={fieldId} className="textarea" aria-invalid={error ? true : undefined} aria-describedby={describedBy(hint, error, hintId, errorId)} {...rest} />
      {hint && <span id={hintId} className="field__hint">{hint}</span>}
      {error && <span id={errorId} className="field__error">{error}</span>}
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function SelectField({
  label,
  hint,
  error,
  id,
  options,
  placeholder,
  ...rest
}: Base & SelectHTMLAttributes<HTMLSelectElement> & { options: Option[]; placeholder?: string }) {
  const { fieldId, hintId, errorId } = useFieldIds(id);
  return (
    <div className="field">
      <label htmlFor={fieldId}>
        {label}
        {rest.required && <span aria-hidden="true"> *</span>}
      </label>
      <select id={fieldId} className="select" aria-invalid={error ? true : undefined} aria-describedby={describedBy(hint, error, hintId, errorId)} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span id={hintId} className="field__hint">{hint}</span>}
      {error && <span id={errorId} className="field__error">{error}</span>}
    </div>
  );
}

export function Checkbox({ label, ...rest }: { label: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="checkbox">
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <p className="field__error" role="alert">
      {message}
    </p>
  );
}

/** Convierte FormData en objeto plano con strings (vacíos → undefined). */
export function formValues(form: HTMLFormElement): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  new FormData(form).forEach((v, k) => {
    const s = typeof v === 'string' ? v.trim() : undefined;
    out[k] = s === '' ? undefined : s;
  });
  return out;
}
