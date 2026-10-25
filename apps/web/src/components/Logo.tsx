import { useEffect, useState } from 'react';
import { get } from '../api/client';

let brandPromise: Promise<{ hasLogo: boolean; version: string | null }> | null = null;

export function loadBrand(fresh = false) {
  if (fresh) brandPromise = null;
  brandPromise ??= get<{ hasLogo: boolean; version: string | null }>('/brand').catch(() => ({ hasLogo: false, version: null }));
  return brandPromise;
}

/** Placa esmaltada con clave de sol (marca Solfeamos). */
export function BrandMarkIcon({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="#23408E" />
      <rect x="3.2" y="3.2" width="25.6" height="25.6" rx="3.5" stroke="#F3F5F8" strokeWidth="1.6" />
      <path
        fill="#FFFFFF"
        d="M16.4 3.6c-1.15 0-2 .5-2.45 1.35-.4.7-.4 1.55-.15 2.55.4 1.7 1.35 3.45 2.55 5.15-2.9 1.55-4.85 4.2-4.85 7.15 0 3.55 2.65 5.85 5.85 5.85 1.05 0 2.05-.3 2.85-.85v2.1c0 1.95-.8 3.45-2.7 3.45-.95 0-1.55-.4-1.55-1.15 0-.6.5-1.05 1.1-1.05.4 0 .7.2.7.6 0 .1 0 .2-.05.3.4.2.85.3 1.3.3 1.65 0 2.55-1.3 2.55-3.35v-2.85c.95-.75 1.55-1.9 1.55-3.3 0-2.7-1.8-5.1-4.4-6.65.55-1.1 1-2.3 1.2-3.5.25-1.2.1-2.25-.45-3.05C18.85 4.15 17.75 3.6 16.4 3.6Zm0 1.55c.75 0 1.3.3 1.6.9.25.5.3 1.15.15 1.9-.2 1-.65 2-1.2 2.95-.95-1.5-1.55-3-1.75-4.45-.1-.7 0-1.2.3-1.5.3-.3.55-.4.9-.8Zm.15 8.2c2.3 1.2 3.7 3.15 3.7 5.25 0 1.35-.55 2.45-1.45 3.2v-1.35c0-.35-.1-.65-.25-.9-.55.9-1.45 1.45-2.55 1.45-2 0-3.45-1.45-3.45-3.55 0-2 1.35-3.75 4-4.1z"
      />
    </svg>
  );
}

/**
 * Wordmark completo: placa + «Solfeamos» con subrayado ocre en «eamos».
 * Si el panel global tiene logotipo subido, sustituye la placa por esa imagen.
 */
export function BrandMark({ as: Tag = 'span' }: { as?: 'span' | 'p' }) {
  const [brand, setBrand] = useState<{ hasLogo: boolean; version: string | null }>({ hasLogo: false, version: null });
  useEffect(() => {
    let on = true;
    loadBrand().then((b) => {
      if (on && b?.hasLogo) setBrand(b);
    });
    return () => {
      on = false;
    };
  }, []);
  const src = brand.hasLogo ? `/api/v1/brand/logo${brand.version ? `?v=${encodeURIComponent(brand.version)}` : ''}` : null;
  return (
    <Tag className={src ? 'wordmark wordmark--logo' : 'wordmark'}>
      {src ? <img className="wordmark__logo" src={src} alt="" /> : <BrandMarkIcon className="wordmark__mark" size={32} />}
      <span className="wordmark__name">
        Solf<span className="wordmark__accent">eamos</span>
      </span>
    </Tag>
  );
}
