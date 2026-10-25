-- Propietarios sin ficha: crear socio vinculado (socio + usuario).
DO $$
DECLARE
  r RECORD;
  fname TEXT;
  lname TEXT;
  next_num INT;
  mid UUID;
  trimmed TEXT;
BEGIN
  FOR r IN
    SELECT m.id AS membership_id, m.tenant_id, u.name, u.email
    FROM memberships m
    JOIN users u ON u.id = m."userId"
    JOIN roles ro ON ro.id = m."roleId"
    WHERE m."memberId" IS NULL AND ro.key = 'owner'
  LOOP
    SELECT COALESCE(MAX("memberNumber"), 0) + 1 INTO next_num FROM members WHERE tenant_id = r.tenant_id;
    trimmed := trim(r.name);
    fname := split_part(trimmed, ' ', 1);
    IF fname = '' THEN fname := 'Propietario'; END IF;
    lname := NULLIF(trim(substr(trimmed, char_length(fname) + 1)), '');
    IF lname IS NULL OR lname = '' THEN lname := '-'; END IF;
    mid := gen_random_uuid();
    INSERT INTO members (
      id, tenant_id, "memberNumber", "firstName", "lastName", email, status,
      "joinedAt", "consentDataAt", "consentImages", "createdAt", "updatedAt"
    ) VALUES (
      mid, r.tenant_id, next_num, fname, lname, r.email, 'ACTIVE',
      CURRENT_DATE, NOW(), false, NOW(), NOW()
    );
    UPDATE memberships SET "memberId" = mid WHERE id = r.membership_id;
  END LOOP;
END $$;
