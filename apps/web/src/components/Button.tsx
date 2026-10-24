import { useState, forwardRef, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Link, type LinkProps } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

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

/** Acción de fila: sólo el icono, con el nombre en un aviso al pasar o al enfocar. */
export function IconButton({
  label,
  icon,
  variant = 'ghost',
  onClick,
  ...rest
}: { label: string; icon: IconName; variant?: Variant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top });
  };
  return (
    <>
      <button
        type="button"
        className={cls(variant, 'md', 'btn--icon')}
        aria-label={label}
        onMouseEnter={(e) => show(e.currentTarget)}
        onMouseLeave={() => setTip(null)}
        onFocus={(e) => show(e.currentTarget)}
        onBlur={() => setTip(null)}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(e);
        }}
        {...rest}
      >
        <Icon name={icon} size={18} />
      </button>
      {tip &&
        createPortal(
          <span className="tip-bubble" role="tooltip" style={{ left: tip.x, top: tip.y }}>
            {label}
          </span>,
          document.body,
        )}
    </>
  );
}

export function ButtonLink({ variant = 'primary', size = 'md', className, ...rest }: LinkProps & { variant?: Variant; size?: 'md' | 'sm' }) {
  return <Link className={cls(variant, size, className)} {...rest} />;
}

/** Enlace tipográfico con flecha (DESIGN.md: "Text Link with Arrow"). */
export function ArrowLink(props: LinkProps) {
  return <Link className="link-arrow" {...props} />;
}
