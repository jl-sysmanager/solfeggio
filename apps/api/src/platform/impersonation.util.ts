import { SetMetadata } from '@nestjs/common';
import { ALL_PERMISSIONS } from '../iam/permissions';

/** Marca las rutas de escritura que sí admite un token «ver como» (cerrar la propia sesión). */
export const ALLOW_IMPERSONATION = 'sf:allow-impersonation';
export const AllowImpersonation = () => SetMetadata(ALLOW_IMPERSONATION, true);

export const IMPERSONATION_ROLE = { id: 'impersonation', key: 'impersonation', name: 'Ver como (solo lectura)' };

/** Todos los permisos de lectura; nunca `members:sensitive` ni los de escritura o gestión. */
export const IMPERSONATION_PERMISSIONS: string[] = ALL_PERMISSIONS.filter((p) => p.endsWith(':read') || p === 'archive:all');
