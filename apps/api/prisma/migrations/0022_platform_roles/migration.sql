-- Los roles se gestionan en la plataforma. Este permiso de banda deja de existir.
UPDATE "roles" SET "permissions" = array_remove("permissions", 'roles:manage');
