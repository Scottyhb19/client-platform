-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok(), throws_ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 36_program_template_soft_delete
-- ============================================================================
-- Why: LPT-8 of the Library Programs-tab pass
-- (docs/polish/library-program-templates.md). Locks soft_delete_program_template
-- (20260623130000) — the SECURITY DEFINER RPC behind the Programs tab's
-- delete. Mirrors the library soft-delete coverage (test 20). The reviewer
-- follow-up added A1 + A7 (see below).
--
--   A1 cross-org SELECT invisibility — staff in org B cannot SEE org A's
--      template (RLS SELECT policy is org-scoped). This is the data-layer
--      MECHANISM the read-only preview route (/library/programs/[id]) relies
--      on to 404 a cross-org id (FM-6): the route reads through the RLS
--      client and notFound()s on a null row. pgTAP can't drive a route, but
--      it can prove the row is invisible cross-org, which is what makes the
--      404 inevitable.
--   A2 cross-org staff delete deny (P0002 not-in-your-org)
--   A3 client-role deny (42501)
--   A4 happy path → invisible through the staff SELECT policy
--   A5 double-delete raises (already deleted)
--   A6 deleted_at stamped (row retained, not hard-deleted)
--   A7 anon cannot execute the RPC (grant posture / Supabase default-grant trap)
--
-- Test count: 7
-- ============================================================================

BEGIN;

SELECT plan(7);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- §1. Fixture — one template in org A.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a       uuid := '00000000-0000-0000-0000-0000000a3601'::uuid;
  org_b       uuid := '00000000-0000-0000-0000-0000000a3602'::uuid;
  staff_a     uuid;
  staff_b     uuid;
  client_user uuid;
  client_a    uuid := '00000000-0000-0000-0000-0000000a3603'::uuid;
  tpl_a       uuid := '00000000-0000-0000-0000-0000000a3604'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, 'Test Org A — Tpl Delete 36', 'test-org-a-tpldel-36'),
    (org_b, 'Test Org B — Tpl Delete 36', 'test-org-b-tpldel-36');

  staff_a     := public._test_make_user('staff-a-tpl36@test.local');
  staff_b     := public._test_make_user('staff-b-tpl36@test.local');
  client_user := public._test_make_user('client-tpl36@test.local');

  PERFORM public._test_grant_membership(staff_a,     org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(staff_b,     org_b, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_user, org_a, 'client'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (client_a, org_a, client_user, 'Cli', 'Ent', 'tpl36@test.local');

  -- Insert the template as staff_a so the INSERT policy passes.
  PERFORM public._test_set_jwt(staff_a, org_a, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO program_templates (id, organization_id, created_by_user_id, name)
  VALUES (tpl_a, org_a, staff_a, 'Tpl36 Template');
  EXECUTE 'RESET ROLE';

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a AS org_a, org_b AS org_b, staff_a AS staff_a, staff_b AS staff_b,
    client_user AS client_user, tpl_a AS tpl_a;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ----------------------------------------------------------------------------
-- §A1. Cross-org SELECT invisibility (FM-6 mechanism). Staff_b (org B) cannot
-- SELECT org A's LIVE template — the org-scoped SELECT policy hides it, so the
-- preview route reads null and 404s. Checked here, before any delete, so the
-- 0-count proves cross-org invisibility (not deletion).
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (1, (
  SELECT is(
    (SELECT count(*)::int FROM program_templates WHERE id = (SELECT tpl_a FROM _ids)),
    0,
    'A1: cross-org staff cannot SELECT another org''s template (RLS hides it → preview route 404s)'
  )
));

-- ----------------------------------------------------------------------------
-- §A2. Cross-org staff cannot delete another org's template.
-- ----------------------------------------------------------------------------
INSERT INTO _tap (n, line) VALUES (2, (
  SELECT throws_ok(
    format(
      'SELECT public.soft_delete_program_template(%L::uuid)',
      (SELECT tpl_a FROM _ids)
    ),
    'P0002',
    NULL,
    'A2: cross-org staff cannot soft-delete another org''s template'
  )
));

-- ----------------------------------------------------------------------------
-- §A3. Client role cannot delete (42501 before any write).
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT client_user FROM _ids), (SELECT org_a FROM _ids), 'client'
);

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT throws_ok(
    format(
      'SELECT public.soft_delete_program_template(%L::uuid)',
      (SELECT tpl_a FROM _ids)
    ),
    '42501',
    'Unauthorized',
    'A3: client role cannot soft-delete a template'
  )
));

-- ----------------------------------------------------------------------------
-- §A4. Happy path — staff A deletes; the row disappears from their view.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SELECT public.soft_delete_program_template((SELECT tpl_a FROM _ids));

INSERT INTO _tap (n, line) VALUES (4, (
  SELECT ok(
    NOT EXISTS (
      SELECT 1 FROM program_templates WHERE id = (SELECT tpl_a FROM _ids)
    ),
    'A4: after soft-delete the template is invisible through the staff SELECT policy'
  )
));

-- ----------------------------------------------------------------------------
-- §A5. Double-delete raises (already deleted → NOT FOUND).
-- ----------------------------------------------------------------------------
INSERT INTO _tap (n, line) VALUES (5, (
  SELECT throws_ok(
    format(
      'SELECT public.soft_delete_program_template(%L::uuid)',
      (SELECT tpl_a FROM _ids)
    ),
    'P0002',
    NULL,
    'A5: re-deleting an already-deleted template raises'
  )
));

-- ----------------------------------------------------------------------------
-- §A6. The row is soft-deleted (retained), not hard-deleted — owner view.
-- ----------------------------------------------------------------------------
RESET ROLE;

INSERT INTO _tap (n, line) VALUES (6, (
  SELECT ok(
    (SELECT deleted_at FROM program_templates WHERE id = (SELECT tpl_a FROM _ids))
      IS NOT NULL,
    'A6: deleted_at is stamped — the row is retained, not hard-deleted'
  )
));

-- §A7: grant posture — anon holds EXECUTE on nothing here (the Supabase
-- default-grant trap fired on this NEW function; the direct anon grant must be
-- revoked). Pure catalog check, as the test owner.
INSERT INTO _tap (n, line) VALUES (7, (
  SELECT ok(
    NOT has_function_privilege(
      'anon', 'public.soft_delete_program_template(uuid)', 'EXECUTE'
    ),
    'A7: anon cannot execute soft_delete_program_template'
  )
));

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
