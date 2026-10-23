import { useEffect, useState } from 'react';
import { get } from '../api/client';

let brandPromise: Promise<{ hasLogo: boolean; version: string | null }> | null = null;

export function loadBrand(fresh = false) {
  if (fresh) brandPromise = null;
  brandPromise ??= get<{ hasLogo: boolean; version: string | null }>('/brand').catch(() => ({ hasLogo: false, version: null }));
  return brandPromise;
}

/** Logotipo de plataforma si está configurado; si no, el cuadrado con «S». */
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
      {src && <img className="wordmark__logo" src={src} alt="" />}
      Solfeamos
    </Tag>
  );
}
