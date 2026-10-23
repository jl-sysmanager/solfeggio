import { useState } from 'react';
import { useApi } from '../../api/hooks';
import { Card } from '../Card';
import { ErrorNote, Loading } from '../EmptyState';
import { loadBrand } from '../Logo';
import { LogoEditor } from '../LogoEditor';

export function BrandTab() {
  const q = useApi<{ hasLogo: boolean; version: string | null }>('/brand');
  const [bust, setBust] = useState(0);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  const preview = q.data.hasLogo ? `/api/v1/brand/logo?v=${encodeURIComponent(q.data.version ?? String(bust))}` : null;
  return (
    <Card title="Logotipo de Solfeamos">
      <p className="small muted">Aparece en el acceso y en la cabecera de la aplicación. Cada banda configura el suyo en Ajustes.</p>
      <LogoEditor
        previewUrl={preview}
        confirmPath="/admin/brand/logo"
        deletePath="/admin/brand/logo"
        onChanged={() => {
          loadBrand(true);
          setBust(Date.now());
          q.refetch();
        }}
      />
    </Card>
  );
}
