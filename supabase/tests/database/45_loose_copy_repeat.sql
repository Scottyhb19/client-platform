-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 45_loose_copy_repeat
-- ============================================================================
-- Why: item 3 follow-up / G3-7 (migration 20260625130000). Copying or
-- repeating a session onto a date NO dated block covers must now succeed by
-- attaching to the client's loose container — not fail with "needs a block".
-- Covers all four paths: copy_program_day, repeat_program_day_weekly,
-- copy_program_week, repeat_program_week. The source is itself a loose one-off
-- (so no block extension muddies the picture).
--
--   A1 copy_program_day onto a bare date → created.
--   A2 the copy attaches to the loose container.
--   A3 repeat_program_day_weekly across bare dates → created, no_program_dates EMPTY.
--   A4 the repeat created one day per occurrence (3) — none skipped.
--   A5 copy_program_week onto a bare target week → created.
--   A6 repeat_program_week across bare weeks → created.
--   A7 copy onto a date a dated block DOES cover → attaches to the block
--      (is_loose = false), locking target-date precedence (reviewer follow-up).
--
-- All dates CURRENT_DATE-relative; week starts are Mondays (date_trunc week).
--
-- Test count: 7
-- ============================================================================

BEGIN;

SELECT plan(7);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;

CREATE TEMP TABLE _calls (k text PRIMARY KEY, result jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON _calls TO authenticated;


-- ----------------------------------------------------------------------------
-- §1. Fixture: an org, an OWNER user, a client. No dated block — every date is
-- block-less, so every op must fall back to the loose container.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_a       uuid := '00000000-0000-0000-0000-0000000a4501'::uuid;
  owner_user  uuid;
  client_a    uuid := '00000000-0000-0000-0000-0000000a4502'::uuid;
  block_b     uuid := '00000000-0000-0000-0000-0000000a4503'::uuid;
  v_monday    date := date_trunc('week', CURRENT_DATE)::date;
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (org_a, 'Test Org A — Loose CR 45', 'test-org-a-loose-cr-45');

  owner_user := public._test_make_user('owner-loosecr45@test.local');
  PERFORM public._test_grant_membership(owner_user, org_a, 'owner'::user_role);

  INSERT INTO clients (id, organization_id, user_id, first_name, last_name, email)
  VALUES (client_a, org_a, NULL, 'Cara', 'Copy', 'loosecr45@test.local');

  -- A dated block far from every other test date (+300..+314). A7 copies onto
  -- a date inside it, which must attach to the block, not the loose container.
  INSERT INTO programs (
    id, organization_id, client_id, name, status, start_date, duration_weeks
  ) VALUES (
    block_b, org_a, client_a, 'CR45 Block', 'active', v_monday + 300, 2
  );

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_a AS org_a, owner_user AS owner_user, client_a AS client_a,
    block_b AS block_b, v_monday AS src_monday;
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ----------------------------------------------------------------------------
-- §2. Act as the owner. Seed a loose one-off on src_monday (creates the
-- container), then exercise every copy/repeat path against block-less dates.
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT owner_user FROM _ids), (SELECT org_a FROM _ids), 'owner'
);
SET LOCAL ROLE authenticated;

-- Seed source one-off (lands on the loose container — no block covers it).
INSERT INTO _calls VALUES ('seed',
  public.create_program_day((SELECT client_a FROM _ids), (SELECT src_monday FROM _ids)));

-- A1 source: copy that day onto a far bare date.
INSERT INTO _calls VALUES ('copy_day',
  public.copy_program_day(
    ((SELECT result->>'new_day_id' FROM _calls WHERE k = 'seed'))::uuid,
    (SELECT src_monday FROM _ids) + 98,
    false));

-- A3 source: repeat the seed day weekly across three bare dates (+7,+14,+21).
INSERT INTO _calls VALUES ('repeat_day',
  public.repeat_program_day_weekly(
    ((SELECT result->>'new_day_id' FROM _calls WHERE k = 'seed'))::uuid,
    (SELECT src_monday FROM _ids) + 21,
    false));

-- A5 source: copy the source week onto a far bare target week (force-safe).
INSERT INTO _calls VALUES ('copy_week',
  public.copy_program_week(
    (SELECT client_a FROM _ids),
    (SELECT src_monday FROM _ids),
    (SELECT src_monday FROM _ids) + 210,
    true));

-- A6 source: repeat the source week across bare weeks (force-safe).
INSERT INTO _calls VALUES ('repeat_week',
  public.repeat_program_week(
    (SELECT client_a FROM _ids),
    (SELECT src_monday FROM _ids),
    (SELECT src_monday FROM _ids) + 35,
    true));

-- A7 source: copy the seed onto a date INSIDE the dated block — must attach to
-- the block (block wins over the loose container).
INSERT INTO _calls VALUES ('copy_covered',
  public.copy_program_day(
    ((SELECT result->>'new_day_id' FROM _calls WHERE k = 'seed'))::uuid,
    (SELECT src_monday FROM _ids) + 301,
    false));

RESET ROLE;  -- assertions read as BYPASSRLS owner.


-- ----------------------------------------------------------------------------
-- §3. Assertions.
-- ----------------------------------------------------------------------------
INSERT INTO _tap (n, line) VALUES (1, (
  SELECT is(
    (SELECT result->>'status' FROM _calls WHERE k = 'copy_day'),
    'created',
    'A1: copy_program_day onto a block-less date returns created (not no_program)'
  )
));

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT is(
    (SELECT p.is_loose
       FROM program_days pd
       JOIN programs p ON p.id = pd.program_id
      WHERE pd.id = ((SELECT result->>'new_day_id' FROM _calls WHERE k = 'copy_day'))::uuid),
    true,
    'A2: the copied day attaches to the loose container'
  )
));

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT is(
    (SELECT result->>'status' FROM _calls WHERE k = 'repeat_day')
      || ':' || (SELECT jsonb_array_length(result->'no_program_dates')::text
                   FROM _calls WHERE k = 'repeat_day'),
    'created:0',
    'A3: repeat across block-less dates returns created with no_program_dates empty'
  )
));

INSERT INTO _tap (n, line) VALUES (4, (
  SELECT is(
    (SELECT jsonb_array_length(result->'new_day_ids') FROM _calls WHERE k = 'repeat_day'),
    3,
    'A4: repeat created one day per occurrence (+7,+14,+21) — none skipped'
  )
));

INSERT INTO _tap (n, line) VALUES (5, (
  SELECT is(
    (SELECT result->>'status' FROM _calls WHERE k = 'copy_week'),
    'created',
    'A5: copy_program_week onto a block-less target week returns created'
  )
));

INSERT INTO _tap (n, line) VALUES (6, (
  SELECT is(
    (SELECT result->>'status' FROM _calls WHERE k = 'repeat_week'),
    'created',
    'A6: repeat_program_week across block-less weeks returns created'
  )
));

INSERT INTO _tap (n, line) VALUES (7, (
  SELECT is(
    (SELECT p.is_loose
       FROM program_days pd
       JOIN programs p ON p.id = pd.program_id
      WHERE pd.id = ((SELECT result->>'new_day_id' FROM _calls WHERE k = 'copy_covered'))::uuid),
    false,
    'A7: copy onto a block-covered date attaches to the block (is_loose = false)'
  )
));

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
