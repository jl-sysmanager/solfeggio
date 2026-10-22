-- Revisión de accesos: nuevo rol de sistema «Archivero» en las bandas existentes.
-- Las bandas nuevas lo reciben al crearse (SYSTEM_ROLES).
INSERT INTO roles (id, tenant_id, key, name, permissions, "isSystem", "updatedAt")
SELECT gen_random_uuid(), t.id, 'archivist', 'Archivero',
  ARRAY['archive:read','archive:write','events:read','attendance:self','market:read','governance:read','governance:vote','incidents:write'],
  true, now()
FROM tenants t
ON CONFLICT (tenant_id, key) DO NOTHING;
