-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 49_orphan_appointment_removal
-- ============================================================================
-- Why: regression guard for RO-6 — the bug that triggered the round-three
-- reopen. At the time, an appointment whose client was since soft-deleted came
-- back from the schedule query with a NULL client join (staff RLS then hid
-- archived clients), so the popover mis-classified it as an Unavailable block
-- and routed its Remove to soft_delete_unavailable_block — which is scoped to
-- kind='unavailable' and therefore raised no_data_found, leaving the row stuck
-- ("won't delete").
--
-- The fix routes on KIND, not on client-absence (removalActionForKind in
-- WeekView.tsx). CN-7 (migration 20260702190000_archived_client_access) later
-- made archived clients VISIBLE to staff, which dissolves the archival cause
-- of the null join — but kind-routing stays the guard (a null join can still
-- arise from other causes, and client-absence must never drive the routing).
-- Assertion 1 was updated 2026-07-03 from the pre-CN-7 posture (invisible) to
-- the CN-7 posture (visible) — caught by the first full-suite staging run;
-- the CN-7 pass re-ran 17/38/46/54/56 but missed this file. pgTAP 56 is the
-- primary CN-7 tripwire; assertion 1 here is the cross-check from this angle.
--
--   1. the archived client REMAINS visible under staff RLS (CN-7) → the RO-6
--      null-join cause is gone at the source
--   2. the orphan row's kind is still 'appointment' → kind is the source of
--      truth, not the client join
--   3. archive_appointment removes the orphan → the CORRECT route works
--   4. soft_delete_unavailable_block raises no_data_found on the orphan and
--      leaves it live → the OLD buggy route is the wrong tool (the exact defect)
--
-- Fixtures built as the test owner inside BEGIN/ROLLBACK (appointments/clients
-- carry RLS but not FORCE RLS, so the owner's writes bypass it; assertion 1
-- switches to the authenticated role to exercise RLS). Mirrors 27/48.
-- Test count: 4
-- ============================================================================

BEGIN;

SELECT plan(4);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _r   (k text PRIMARY KEY, v text NOT NULL)   ON COMMIT DROP;

DO $$
DECLARE
  v_org    uuid := '00000000-0000-0000-0000-0000000a8401'::uuid;
  v_client uuid := '00000000-0000-0000-0000-0000000a8402'::uuid;
  v_orph1  uuid := '00000000-0000-0000-0000-0000000a8403'::uuid;
  v_orph2  uuid := '00000000-0000-0000-0000-0000000a8404'::uuid;
  v_staff  uuid;
  v_visible integer;
  caught   boolean;
BEGIN
  INSERT INTO organizations (id, name, slug)
    VALUES (v_org, 'RO6 Org', 'ro6-org');

  v_staff := public._test_make_user('ro6-staff@test.local');
  PERFORM public._test_grant_membership(v_staff, v_org, 'owner'::user_role);

  -- A client that is then soft-deleted (deleted_at set) — the cause of the
  -- null client join.
  INSERT INTO clients (id, organization_id, first_name, last_name, email, deleted_at)
    VALUES (v_client, v_org, 'Gone', 'Client', 'ro6-client@test.local', now());

  -- Two real client appointments referencing that since-deleted client.
  INSERT INTO appointments
    (id, organization_id, client_id, staff_user_id, start_at, end_at,
     status, appointment_type, confirmed_at)
  VALUES
    (v_orph1, v_org, v_client, v_staff, '2026-05-04T00:00:00Z', '2026-05-04T01:00:00Z', 'confirmed', 'in_clinic', now()),
    (v_orph2, v_org, v_client, v_staff, '2026-05-05T00:00:00Z', '2026-05-05T01:00:00Z', 'confirmed', 'in_clinic', now());

  -- 1. Under the staff's RLS, the archived client stays selectable (CN-7) →
  --    the schedule query's client join resolves for these rows.
  PERFORM public._test_set_jwt(v_staff, v_org, 'owner');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_visible FROM clients WHERE id = v_client;
  RESET ROLE;
  INSERT INTO _r VALUES ('deleted_client_visible', v_visible::text);

  -- 3. archive_appointment removes the orphan (the correct route).
  PERFORM public.archive_appointment(v_orph1);

  -- 4. soft_delete_unavailable_block on an appointment-kind row → no_data_found
  --    (kind-scoped to 'unavailable'); the row must stay live.
  caught := false;
  BEGIN
    PERFORM public.soft_delete_unavailable_block(v_orph2);
  EXCEPTION WHEN no_data_found THEN caught := true;
  END;
  INSERT INTO _r VALUES ('unavailable_route_rejected', caught::text);

  PERFORM public._test_clear_jwt();
END $$;

-- ----------------------------------------------------------------------------
-- Assertions (top level; read as owner, which bypasses the deleted_at-IS-NULL
-- SELECT policy so archived/unarchived state is visible).
-- ----------------------------------------------------------------------------
INSERT INTO _tap (n, line)
SELECT 1, string_agg(l, E'\n') FROM ok(
  (SELECT v FROM _r WHERE k = 'deleted_client_visible') = '1',
  '1: an archived client stays visible under staff RLS (CN-7 — the RO-6 null-join cause is dissolved)'
) AS l;

INSERT INTO _tap (n, line)
SELECT 2, string_agg(l, E'\n') FROM ok(
  (SELECT kind FROM appointments WHERE id = '00000000-0000-0000-0000-0000000a8403') = 'appointment',
  '2: the orphaned row is still classified kind=appointment (kind is the source of truth)'
) AS l;

INSERT INTO _tap (n, line)
SELECT 3, string_agg(l, E'\n') FROM ok(
  (SELECT deleted_at IS NOT NULL FROM appointments WHERE id = '00000000-0000-0000-0000-0000000a8403'),
  '3: archive_appointment removes the orphan (the correct route works)'
) AS l;

INSERT INTO _tap (n, line)
SELECT 4, string_agg(l, E'\n') FROM ok(
  (SELECT v FROM _r WHERE k = 'unavailable_route_rejected') = 'true'
  AND (SELECT deleted_at IS NULL FROM appointments WHERE id = '00000000-0000-0000-0000-0000000a8404'),
  '4: soft_delete_unavailable_block rejects the appointment (no_data_found) and leaves it live (the old buggy route)'
) AS l;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
