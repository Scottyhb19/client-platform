-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok(), is() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 23_program_rpc_grants
-- ============================================================================
-- Why: P0-1 of the program-calendar polish pass (docs/polish/program-calendar.md,
-- FM-2). Locks in the EXECUTE-grant posture for the whole program-engine /
-- calendar RPC family after the two revoke migrations (20260612130000 +
-- 20260612150000). The Supabase auto-grant trap means any future
-- CREATE OR REPLACE on these functions can silently re-grant anon — this
-- test is the tripwire.
--
--   §A anon holds EXECUTE on NOTHING in the family (17 functions).
--   §B internal helpers (_clone_program, _program_for_date) are
--      definer-only: authenticated must NOT hold EXECUTE either.
--   §C caller-facing functions keep their authenticated grant (the app
--      calls them as a logged-in staff member — a revoke that went too
--      far would break the calendar, not secure it).
--
-- No fixtures, no JWT spoof — pure catalog checks as the test owner.
-- Test count: 21
-- ============================================================================

BEGIN;

SELECT plan(21);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;

-- ----------------------------------------------------------------------------
-- §A — anon must hold EXECUTE on nothing in the family.
-- ----------------------------------------------------------------------------
WITH family(ord, sig) AS (
  VALUES
    (1,  'public.copy_program_day(uuid, date, boolean)'),
    (2,  'public.repeat_program_day_weekly(uuid, date, boolean)'),
    (3,  'public.insert_program_exercise_at(uuid, uuid, uuid, text)'),
    (4,  'public.save_program_as_template(uuid, text)'),
    (5,  'public.create_program_from_template(uuid, uuid, date, text)'),
    (6,  'public.copy_program(uuid, date, text)'),
    (7,  'public.repeat_program(uuid)'),
    (8,  'public.create_program_day(uuid, date)'),
    (9,  'public.duplicate_program_day(uuid, date)'),
    (10, 'public.soft_delete_program_day(uuid)'),
    (11, 'public.soft_delete_program_exercise(uuid)'),
    (12, 'public.restore_program_exercise(uuid)'),
    (13, 'public.soft_delete_program_exercise_set(uuid)'),
    (14, 'public.reorder_program_exercises(uuid, uuid[], uuid)'),
    (15, 'public.swap_program_exercise(uuid, uuid)'),
    (16, 'public._clone_program(uuid, date, text)'),
    (17, 'public._program_for_date(uuid, date)')
)
INSERT INTO _tap (n, line)
SELECT ord, ok(
  NOT has_function_privilege('anon', sig, 'EXECUTE'),
  format('A%s: anon cannot execute %s', ord, sig)
)
FROM family;

-- ----------------------------------------------------------------------------
-- §B — internal helpers are definer-only (authenticated revoked too).
-- ----------------------------------------------------------------------------
INSERT INTO _tap (n, line) VALUES (18, (
  SELECT ok(
    NOT has_function_privilege('authenticated', 'public._clone_program(uuid, date, text)', 'EXECUTE'),
    'B1: authenticated cannot execute _clone_program (definer-only)'
  )
));

INSERT INTO _tap (n, line) VALUES (19, (
  SELECT ok(
    NOT has_function_privilege('authenticated', 'public._program_for_date(uuid, date)', 'EXECUTE'),
    'B2: authenticated cannot execute _program_for_date (definer-only)'
  )
));

-- ----------------------------------------------------------------------------
-- §C — caller-facing grants survive: the app still works. Spot-check the
-- two calendar workhorses; a blanket revoke that stripped authenticated
-- would pass §A while silently breaking every batch operation.
-- ----------------------------------------------------------------------------
INSERT INTO _tap (n, line) VALUES (20, (
  SELECT ok(
    has_function_privilege('authenticated', 'public.copy_program_day(uuid, date, boolean)', 'EXECUTE'),
    'C1: authenticated keeps EXECUTE on copy_program_day'
  )
));

INSERT INTO _tap (n, line) VALUES (21, (
  SELECT ok(
    has_function_privilege('authenticated', 'public.copy_program(uuid, date, text)', 'EXECUTE'),
    'C2: authenticated keeps EXECUTE on copy_program'
  )
));

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
