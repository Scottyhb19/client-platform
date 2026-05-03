-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), throws_ok(), lives_ok() resolve
-- unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 09_programs_dates
-- ============================================================================
-- Why: Coverage for migrations
--   20260503100000_program_days_scheduled_date.sql  (D-PROG-001, D-PROG-003)
--   20260503110000_drop_unique_active_program.sql   (D-PROG-002)
--
-- Asserts the four load-bearing properties of Phase A:
--
--   1. program_days.scheduled_date is the authoritative scheduling field
--      and round-trips through INSERT.
--   2. program_days.program_week_id may be NULL — periodisation is now
--      an optional grouping, not a structural requirement.
--   3. Two active programs for the same client coexist when their date
--      ranges do not overlap; overlap is rejected by the EXCLUDE.
--   4. RLS isolation holds: staff in org B cannot read program_days that
--      belong to a program in org A, even though program_days now
--      carries the direct program_id FK.
--
-- Output pattern: each assertion's TAP line is captured into a temp
-- _tap table, then a final SELECT returns all 7 rows. This is what
-- `supabase db query` shows the agent — the CLI only returns the last
-- statement's results, so a per-statement assertion would only surface
-- the last one.
--
-- Test count: 7
-- ============================================================================

BEGIN;

SELECT plan(7);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- §1. Fixture
--
-- Two organizations:
--   org_a — staff_a, client_a, programA (Apr 1 – Apr 28, active)
--   org_b — staff_b (cross-org isolation target)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a       uuid := '00000000-0000-0000-0000-000000000a01'::uuid;
  org_b       uuid := '00000000-0000-0000-0000-000000000a02'::uuid;
  staff_a     uuid;
  staff_b     uuid;
  client_user uuid;
  client_a    uuid := '00000000-0000-0000-0000-000000000a03'::uuid;
  program_a   uuid := '00000000-0000-0000-0000-000000000a05'::uuid;
  week_a      uuid := '00000000-0000-0000-0000-000000000a07'::uuid;
  day_a       uuid := '00000000-0000-0000-0000-000000000a08'::uuid;
BEGIN
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, 'Test Org A — Programs Dates 09', 'test-org-a-prog-dates-09'),
    (org_b, 'Test Org B — Programs Dates 09', 'test-org-b-prog-dates-09');

  staff_a     := public._test_make_user('staff-a-progdates09@test.local');
  staff_b     := public._test_make_user('staff-b-progdates09@test.local');
  client_user := public._test_make_user('client-progdates09@test.local');

  PERFORM public._test_grant_membership(staff_a,     org_a, 'staff'::user_role);
  PERFORM public._test_grant_membership(staff_b,     org_b, 'staff'::user_role);
  PERFORM public._test_grant_membership(client_user, org_a, 'client'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (client_a, org_a, client_user, 'Sam', 'Apex', 'progdates09-a@test.local');

  -- Spoof staff_a + role-switch so the programs / program_days INSERT
  -- policies (which target authenticated) actually apply.
  PERFORM public._test_set_jwt(staff_a, org_a, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- Block A: 4-week active mesocycle starting Apr 1.
  INSERT INTO programs (
    id, organization_id, client_id, name, status, start_date, duration_weeks
  ) VALUES (
    program_a, org_a, client_a, 'PD09 Block A', 'active', '2026-04-01'::date, 4
  );

  INSERT INTO program_weeks (id, program_id, week_number)
  VALUES (week_a, program_a, 1);

  -- Day inserted with explicit scheduled_date and NO program_week_id.
  -- Probed by §A and §D.
  INSERT INTO program_days (
    id, program_id, scheduled_date, day_label, sort_order
  ) VALUES (
    day_a, program_a, '2026-04-07'::date, 'Day A', 0
  );

  -- Drop back to the test owner before stashing ids — temp tables
  -- created by authenticated would belong to the wrong role.
  EXECUTE 'RESET ROLE';

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a       AS org_a,
    org_b       AS org_b,
    staff_a     AS staff_a,
    staff_b     AS staff_b,
    client_user AS client_user,
    client_a    AS client_a,
    program_a   AS program_a,
    week_a      AS week_a,
    day_a       AS day_a;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ----------------------------------------------------------------------------
-- §A. scheduled_date is authoritative; program_week_id can be NULL.
-- ----------------------------------------------------------------------------
INSERT INTO _tap (n, line) VALUES (1, (
  SELECT is(
    (SELECT scheduled_date FROM program_days WHERE id = (SELECT day_a FROM _ids)),
    '2026-04-07'::date,
    'A1: scheduled_date round-trips on INSERT'
  )
));

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT is(
    (SELECT program_week_id FROM program_days WHERE id = (SELECT day_a FROM _ids)),
    NULL::uuid,
    'A2: program_week_id can be NULL (optional periodisation grouping)'
  )
));


-- ----------------------------------------------------------------------------
-- §B. Two non-overlapping active programs for the same client are
-- allowed. Block A runs Apr 1 – Apr 28 (4 weeks). Block C starts
-- Apr 29 (the day after A ends). Half-open daterange semantics on the
-- EXCLUDE constraint mean start = previous-end is NOT an overlap.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_a FROM _ids), (SELECT org_a FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT lives_ok(
    format(
      $q$INSERT INTO programs (
           id, organization_id, client_id, name, status, start_date, duration_weeks
         ) VALUES (
           '00000000-0000-0000-0000-000000000a09'::uuid, %L::uuid, %L::uuid,
           'PD09 Block C', 'active', '2026-04-29'::date, 4
         )$q$,
      (SELECT org_a    FROM _ids),
      (SELECT client_a FROM _ids)
    ),
    'B1: same client may have two non-overlapping active programs'
  )
));

INSERT INTO _tap (n, line) VALUES (4, (
  SELECT is(
    (SELECT count(*)::int FROM programs
      WHERE client_id = (SELECT client_a FROM _ids)
        AND status = 'active'
        AND deleted_at IS NULL),
    2,
    'B2: both blocks present for the client'
  )
));


-- ----------------------------------------------------------------------------
-- §C. Overlapping active programs are rejected by the EXCLUDE constraint.
-- Block O would run Apr 15 – May 12, overlapping Block A (Apr 1 – Apr 28).
-- ----------------------------------------------------------------------------
INSERT INTO _tap (n, line) VALUES (5, (
  SELECT throws_ok(
    format(
      $q$INSERT INTO programs (
           id, organization_id, client_id, name, status, start_date, duration_weeks
         ) VALUES (
           '00000000-0000-0000-0000-000000000a0a'::uuid, %L::uuid, %L::uuid,
           'PD09 Block O (overlap)', 'active', '2026-04-15'::date, 4
         )$q$,
      (SELECT org_a    FROM _ids),
      (SELECT client_a FROM _ids)
    ),
    '23P01',
    NULL,
    'C1: overlapping active programs rejected by programs_no_active_overlap EXCLUDE'
  )
));


-- ----------------------------------------------------------------------------
-- §D. RLS isolation: staff in org B cannot SELECT program_days that
-- belong to a program in org A. The new direct program_id FK does not
-- open a cross-org leak — the SELECT policy still gates via
-- programs.organization_id.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_b FROM _ids), (SELECT org_b FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (6, (
  SELECT is(
    (SELECT count(*)::int FROM program_days
      WHERE id = (SELECT day_a FROM _ids)),
    0,
    'D1: staff in org B cannot SELECT program_days from org A (RLS isolation holds)'
  )
));

-- The parallel program_exercises policy was rewritten in the same
-- migration. Smoke-check it exists post-migration so a future audit
-- doesn't silently lose the policy.
INSERT INTO _tap (n, line) VALUES (7, (
  SELECT ok(
    EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'program_exercises'
         AND policyname = 'select program_exercises via parent'
    ),
    'D2: program_exercises SELECT policy exists post-migration'
  )
));


-- ----------------------------------------------------------------------------
-- Hand back to the test owner so the final SELECT and ROLLBACK run as
-- the privileged role.
-- ----------------------------------------------------------------------------
RESET ROLE;

-- Final SELECT — all 7 TAP lines in order. This is what the agent sees
-- via `supabase db query --linked --file ...`. finish() is intentionally
-- not called here; we don't need its summary because the temp table
-- carries the structured per-assertion result.
SELECT line FROM _tap ORDER BY n;

ROLLBACK;
