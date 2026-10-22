import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

type Variant = 'primary' | 'ghost' | 'danger';
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'sm';
  loading?: boolean;
}

function cls(variant: Variant, size: 'md' | 'sm', extra?: string) {
  return ['btn', variant !== 'primary' && `btn--${variant}`, size === 'sm' && 'btn--sm', extra].filter(Boolean).join(' ');
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cls(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? 'Procesando…' : children}
    </button>
  );
});

export function ButtonLink({ variant = 'primary', size = 'md', className, ...rest }: LinkProps & { variant?: Variant; size?: 'md' | 'sm' }) {
  return <Link className={cls(variant, size, className)} {...rest} />;
}

/** Enlace tipográfico con flecha (DESIGN.md: "Text Link with Arrow"). */
export function ArrowLink(props: LinkProps) {
  return <Link className="link-arrow" {...props} />;
}
