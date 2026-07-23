-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok(), is() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 60_write_immutability
-- ============================================================================
-- Locks in migration 20260721120000 — the DB-level write-immutability guards
-- (docs/polish/db-write-immutability.md): the CN-7 archived-client trigger
-- family (raw-PostgREST / force-book / program stale-tab residuals) and the
-- completed-and-assigned session edit-lock, plus the soft_delete_client v4 /
-- restore_client v3 behaviour under the NARROWED archive_cascade GUC (only
-- clients_row_write_guard consults it; reviewer 2026-07-22).
--
-- Probe style: pg_temp._try() executes a statement as the CURRENT role and
-- returns 'rows:N' or 'error:<message>'. Blocked-write assertions match the
-- guard's exact message — a silent RLS 0-row no-op ('rows:0') would FAIL the
-- assertion, so a policy change can never fake a guard pass. Controls assert
-- 'rows:1' so they also catch silent no-ops.
--
-- Assertions (17):
--    1. archived: clinical_notes INSERT refused by the guard
--    2. archived: client_medical_history UPDATE refused
--    3. archived: appointments INSERT (the force-book residual) refused
--    4. archived: program_exercise_sets UPDATE (stale-tab residual) refused
--    5. archived: clients row UPDATE refused BY THE GUARD — staff RLS permits
--       the archived row (the incidental finding), so this deterministically
--       exercises the guard's raise, not an RLS no-op
--    6. control: clinical_notes INSERT for a LIVE client succeeds
--    7. lock: program_exercise_sets UPDATE under a completed+assigned day refused
--    8. lock: program_exercises INSERT into that day refused
--    9. control: same UPDATE under an assigned, NOT-completed day succeeds
--   10. unlock: same UPDATE under an UNASSIGNED completed day succeeds
--       (published_at IS NULL — the "unassign to edit" escape hatch)
--   11. GUC tripwire: client_record_write_guard ignores a forged archive_cascade
--   12. GUC tripwire: program_write_guard ignores a forged archive_cascade
--   13. archived: clients row DELETE refused BY THE GUARD — run as postgres
--       (BYPASSRLS) with enforce-GUC on, so RLS cannot hide the row and only
--       the guard can refuse; deterministic proof of the DELETE branch
--   14. cascade: soft_delete_client() runs end-to-end as staff. v4 cancels the
--       future appointment WHILE THE CLIENT IS STILL LIVE, so the appointments
--       guard passes on the merits — NO archive_cascade GUC is set
--   15. cascade: the future appointment flipped to cancelled
--   16. cascade: restore_client() runs end-to-end as staff (its archive_cascade
--       GUC lets the un-archive UPDATE past clients_row_write_guard)
--   17. cascade: the client is live again (deleted_at cleared)
--
-- Extended 2026-07-23 (migration 20260723140000 — RPC-only unassign hard gate):
--   18. control: raw unassign of a published, NOT-completed day still succeeds
--   19. hard gate: raw unassign of the completed+assigned day REFUSED
--   20. sanctioned path: unassign_program_day() succeeds as staff
--   21. …and the day really is unassigned (published_at IS NULL)
--   22. unauthorized: the RPC refuses a client-role session (42501)
--
-- Style: buffered into _tap (mirrors 56); BEGIN/ROLLBACK for live-run safety.
-- ORDER: 1–12 run as the authenticated staff role; 13 runs as postgres (a
-- deterministic DELETE-guard proof); 14–17 are the cascade round-trip as staff.
-- The only lingering GUC is odyssey.test_enforce_guards (strictness). The forged
-- archive_cascade set for 11–12 is RESET to '' before 13; soft_delete_client v4
-- sets NO GUC; restore_client sets archive_cascade at 16, after which only a
-- read (17) runs.
-- ============================================================================

BEGIN;

SELECT plan(22);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;

-- The probe. SECURITY INVOKER: EXECUTE runs as the calling role, so RLS and
-- the guards apply exactly as they would to a PostgREST statement.
CREATE FUNCTION pg_temp._try(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_n int;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN 'rows:' || v_n;
EXCEPTION WHEN others THEN
  RETURN 'error:' || SQLERRM;
END $$;

-- ----------------------------------------------------------------------------
-- Fixture (owner-privileged; the guards exempt session_user = 'postgres').
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_w        uuid := '00000000-0000-0000-0000-0000000060a1'::uuid;
  staff_w      uuid;
  arch_client  uuid := '00000000-0000-0000-0000-0000000060a2'::uuid;
  live_client  uuid := '00000000-0000-0000-0000-0000000060a3'::uuid;
  casc_client  uuid := '00000000-0000-0000-0000-0000000060a4'::uuid;
  arch_prog    uuid := '00000000-0000-0000-0000-0000000060b1'::uuid;
  live_prog    uuid := '00000000-0000-0000-0000-0000000060b2'::uuid;
  arch_day     uuid := '00000000-0000-0000-0000-0000000060c1'::uuid;
  day_locked   uuid := '00000000-0000-0000-0000-0000000060c2'::uuid;
  day_open     uuid := '00000000-0000-0000-0000-0000000060c3'::uuid;
  day_unassign uuid := '00000000-0000-0000-0000-0000000060c4'::uuid;
  arch_ex      uuid;
  arch_pe      uuid := '00000000-0000-0000-0000-0000000060d1'::uuid;
  pe_locked    uuid := '00000000-0000-0000-0000-0000000060d2'::uuid;
  pe_open      uuid := '00000000-0000-0000-0000-0000000060d3'::uuid;
  pe_unassign  uuid := '00000000-0000-0000-0000-0000000060d4'::uuid;
  set_arch     uuid := '00000000-0000-0000-0000-0000000060e1'::uuid;
  set_locked   uuid := '00000000-0000-0000-0000-0000000060e2'::uuid;
  set_open     uuid := '00000000-0000-0000-0000-0000000060e3'::uuid;
  set_unassign uuid := '00000000-0000-0000-0000-0000000060e4'::uuid;
  cmh_arch     uuid := '00000000-0000-0000-0000-0000000060f1'::uuid;
  casc_appt    uuid := '00000000-0000-0000-0000-0000000060f2'::uuid;
  v_start      timestamptz;
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (org_w, 'Test Org W — write immutability 60', 'test-org-w-immut-60');

  staff_w := public._test_make_user('staff-w-immut60@test.local');
  PERFORM public._test_grant_membership(staff_w, org_w, 'staff'::user_role);

  INSERT INTO clients (id, organization_id, first_name, last_name, email,
                       deleted_at, archived_at)
  VALUES (arch_client, org_w, 'Archie', 'Locked',
          'archie-immut60@test.local', now() - interval '1 day', now() - interval '1 day');
  INSERT INTO clients (id, organization_id, first_name, last_name, email)
  VALUES (live_client, org_w, 'Liv', 'Open', 'liv-immut60@test.local'),
         (casc_client, org_w, 'Cass', 'Cascade', 'cass-immut60@test.local');

  INSERT INTO client_medical_history (id, organization_id, client_id, condition)
  VALUES (cmh_arch, org_w, arch_client, 'Historical condition (fixture)');

  -- one library exercise to hang prescriptions off
  SELECT id INTO arch_ex FROM exercises WHERE organization_id = org_w LIMIT 1;
  IF arch_ex IS NULL THEN
    INSERT INTO exercises (organization_id, name) VALUES (org_w, 'Fixture Squat 60')
    RETURNING id INTO arch_ex;
  END IF;

  -- archived client's program (stale-tab surface)
  INSERT INTO programs (id, organization_id, client_id, name, status)
  VALUES (arch_prog, org_w, arch_client, 'Archived block', 'active');
  INSERT INTO program_days (id, program_id, day_label, scheduled_date, published_at)
  VALUES (arch_day, arch_prog, 'A-Day 1', current_date - 30, now() - interval '30 days');
  INSERT INTO program_exercises (id, program_day_id, exercise_id, sort_order)
  VALUES (arch_pe, arch_day, arch_ex, 0);
  INSERT INTO program_exercise_sets (id, program_exercise_id, set_number, reps)
  VALUES (set_arch, arch_pe, 1, '10');

  -- live client's program: locked / open / unassigned days
  INSERT INTO programs (id, organization_id, client_id, name, status)
  VALUES (live_prog, org_w, live_client, 'Live block', 'active');
  INSERT INTO program_days (id, program_id, day_label, scheduled_date, published_at) VALUES
    (day_locked,   live_prog, 'Day L', current_date - 2, now() - interval '10 days'),
    (day_open,     live_prog, 'Day O', current_date + 2, now() - interval '10 days'),
    (day_unassign, live_prog, 'Day U', current_date - 4, NULL);
  INSERT INTO program_exercises (id, program_day_id, exercise_id, sort_order) VALUES
    (pe_locked,   day_locked,   arch_ex, 0),
    (pe_open,     day_open,     arch_ex, 0),
    (pe_unassign, day_unassign, arch_ex, 0);
  INSERT INTO program_exercise_sets (id, program_exercise_id, set_number, reps) VALUES
    (set_locked,   pe_locked,   1, '8'),
    (set_open,     pe_open,     1, '8'),
    (set_unassign, pe_unassign, 1, '8');

  -- completed sessions: on the locked day AND the unassigned day
  INSERT INTO sessions (organization_id, client_id, program_day_id, started_at, completed_at)
  VALUES (org_w, live_client, day_locked,   now() - interval '2 days', now() - interval '2 days'),
         (org_w, live_client, day_unassign, now() - interval '4 days', now() - interval '4 days');

  -- cascade client's future confirmed appointment (15-min aligned)
  v_start := date_trunc('hour', now() + interval '7 days');
  INSERT INTO appointments (id, organization_id, client_id, staff_user_id,
                            start_at, end_at, status, confirmed_at,
                            appointment_type, kind)
  VALUES (casc_appt, org_w, casc_client, staff_w,
          v_start, v_start + interval '45 minutes', 'confirmed', now(),
          'Session', 'appointment');

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_w, staff_w, arch_client, live_client, casc_client,
    arch_prog, arch_day, arch_pe, set_arch, cmh_arch,
    day_locked, pe_locked, set_locked, day_open, set_open,
    day_unassign, set_unassign, casc_appt, arch_ex;
  GRANT SELECT ON _ids TO authenticated;
END $$;

-- Force enforcement for this transaction: the pgTAP channel connects with
-- session_user = postgres, which the guards exempt for maintenance. This GUC
-- can only make enforcement STRICTER — it disables the postgres exemption so
-- the assertions exercise exactly the API-path behaviour. The cascade GUC
-- (archive_cascade) is honoured only by clients_row_write_guard.
SELECT set_config('odyssey.test_enforce_guards', '1', true);

-- ----------------------------------------------------------------------------
-- Blocked writes + controls, as the staff session (the real writer).
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_w FROM _ids), (SELECT org_w FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (1, (
  SELECT string_agg(l, E'\n') FROM ok(
    pg_temp._try(format(
      'INSERT INTO clinical_notes (organization_id, client_id, author_user_id, title, plan) VALUES (%L, %L, %L, %L, ''fixture plan'')',
      (SELECT org_w FROM _ids), (SELECT arch_client FROM _ids),
      (SELECT staff_w FROM _ids), 'Should be refused'
    )) = 'error:This client is archived — their record is read-only. Restore the client to make changes.',
    'archived: clinical_notes INSERT refused by the DB guard'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (2, (
  SELECT string_agg(l, E'\n') FROM ok(
    pg_temp._try(format(
      'UPDATE client_medical_history SET notes = %L WHERE id = %L',
      'edited', (SELECT cmh_arch FROM _ids)
    )) = 'error:This client is archived — their record is read-only. Restore the client to make changes.',
    'archived: client_medical_history UPDATE refused by the DB guard'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM ok(
    pg_temp._try(format(
      'INSERT INTO appointments (organization_id, client_id, staff_user_id, start_at, end_at, status, appointment_type, kind) '
      || 'VALUES (%L, %L, %L, %L::timestamptz, %L::timestamptz, %L, %L, %L)',
      (SELECT org_w FROM _ids), (SELECT arch_client FROM _ids), (SELECT staff_w FROM _ids),
      date_trunc('hour', now() + interval '14 days'),
      date_trunc('hour', now() + interval '14 days') + interval '45 minutes',
      'pending', 'Session', 'appointment'
    )) = 'error:This client is archived — their record is read-only. Restore the client to make changes.',
    'archived: appointments INSERT (force-book residual) refused by the DB guard'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (4, (
  SELECT string_agg(l, E'\n') FROM ok(
    pg_temp._try(format(
      'UPDATE program_exercise_sets SET reps = %L WHERE id = %L',
      '99', (SELECT set_arch FROM _ids)
    )) = 'error:This client is archived — their record is read-only. Restore the client to make changes.',
    'archived: program_exercise_sets UPDATE (stale-tab residual) refused by the DB guard'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (5, (
  SELECT string_agg(l, E'\n') FROM ok(
    pg_temp._try(format(
      'UPDATE clients SET first_name = %L WHERE id = %L',
      'Renamed', (SELECT arch_client FROM _ids)
    )) = 'error:This client is archived — their record is read-only. Restore the client to make changes.',
    'archived: clients row UPDATE refused BY THE GUARD (staff RLS reaches the row)'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (6, (
  SELECT string_agg(l, E'\n') FROM ok(
    pg_temp._try(format(
      'INSERT INTO clinical_notes (organization_id, client_id, author_user_id, title, plan) VALUES (%L, %L, %L, %L, ''fixture plan'')',
      (SELECT org_w FROM _ids), (SELECT live_client FROM _ids),
      (SELECT staff_w FROM _ids), 'Live-client note'
    )) = 'rows:1',
    'control: clinical_notes INSERT for a LIVE client succeeds'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (7, (
  SELECT string_agg(l, E'\n') FROM ok(
    pg_temp._try(format(
      'UPDATE program_exercise_sets SET reps = %L WHERE id = %L',
      '12', (SELECT set_locked FROM _ids)
    )) = 'error:This session is completed and still assigned — unassign it to edit the prescription.',
    'lock: set UPDATE under a completed+assigned day refused'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (8, (
  SELECT string_agg(l, E'\n') FROM ok(
    pg_temp._try(format(
      'INSERT INTO program_exercises (program_day_id, exercise_id, sort_order) VALUES (%L, %L, 5)',
      (SELECT day_locked FROM _ids), (SELECT arch_ex FROM _ids)
    )) = 'error:This session is completed and still assigned — unassign it to edit the prescription.',
    'lock: program_exercises INSERT into a completed+assigned day refused'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (9, (
  SELECT string_agg(l, E'\n') FROM ok(
    pg_temp._try(format(
      'UPDATE program_exercise_sets SET reps = %L WHERE id = %L',
      '12', (SELECT set_open FROM _ids)
    )) = 'rows:1',
    'control: set UPDATE under an assigned, NOT-completed day succeeds'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (10, (
  SELECT string_agg(l, E'\n') FROM ok(
    pg_temp._try(format(
      'UPDATE program_exercise_sets SET reps = %L WHERE id = %L',
      '12', (SELECT set_unassign FROM _ids)
    )) = 'rows:1',
    'unlock: set UPDATE under an UNASSIGNED completed day succeeds (published_at IS NULL)'
  ) AS l
));

-- ----------------------------------------------------------------------------
-- GUC tripwire (reviewer 2026-07-22): a caller CAN set a custom GUC in its own
-- session — PostgREST just never exposes a way to. Forge archive_cascade='1'
-- as the authenticated staff role and prove the FAMILY guards ignore it. Only
-- clients_row_write_guard consults it (and only restore_client sets it).
-- ----------------------------------------------------------------------------
SELECT set_config('odyssey.archive_cascade', '1', true);

INSERT INTO _tap (n, line) VALUES (11, (
  SELECT string_agg(l, E'\n') FROM ok(
    pg_temp._try(format(
      'INSERT INTO clinical_notes (organization_id, client_id, author_user_id, title, plan) VALUES (%L, %L, %L, %L, ''fixture plan'')',
      (SELECT org_w FROM _ids), (SELECT arch_client FROM _ids),
      (SELECT staff_w FROM _ids), 'Forged-GUC note'
    )) = 'error:This client is archived — their record is read-only. Restore the client to make changes.',
    'GUC tripwire: client_record_write_guard ignores a forged archive_cascade'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (12, (
  SELECT string_agg(l, E'\n') FROM ok(
    pg_temp._try(format(
      'UPDATE program_exercise_sets SET reps = %L WHERE id = %L',
      '77', (SELECT set_arch FROM _ids)
    )) = 'error:This client is archived — their record is read-only. Restore the client to make changes.',
    'GUC tripwire: program_write_guard ignores a forged archive_cascade'
  ) AS l
));

-- Reset the forged GUC so it cannot exempt the clients-row guard below.
SELECT set_config('odyssey.archive_cascade', '', true);

-- #13 runs as postgres — which BYPASSRLS on Supabase (the fixture INSERTs above
-- prove it) — with test_enforce_guards still '1' so the postgres exemption is
-- DISABLED. RLS therefore cannot hide the row and ONLY clients_row_write_guard
-- can refuse the DELETE: deterministic proof of the DELETE branch, not RLS
-- invisibility (reviewer 2026-07-22 follow-up 1).
RESET ROLE;

INSERT INTO _tap (n, line) VALUES (13, (
  SELECT string_agg(l, E'\n') FROM ok(
    pg_temp._try(format(
      'DELETE FROM clients WHERE id = %L', (SELECT arch_client FROM _ids)
    )) = 'error:This client is archived — their record is read-only. Restore the client to make changes.',
    'archived: clients row DELETE refused BY THE GUARD (postgres bypasses RLS + enforce-GUC on → guard is the sole control)'
  ) AS l
));

-- ----------------------------------------------------------------------------
-- Cascade round trip — MUST stay last. soft_delete_client v4 sets no GUC;
-- restore_client sets archive_cascade at 16, which lingers for the final read.
-- Re-establish the authenticated staff session (13 dropped to postgres).
-- ----------------------------------------------------------------------------
SELECT public._test_set_jwt(
  (SELECT staff_w FROM _ids), (SELECT org_w FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (14, (
  SELECT string_agg(l, E'\n') FROM ok(
    pg_temp._try(format(
      'SELECT public.soft_delete_client(%L)', (SELECT casc_client FROM _ids)
    )) = 'rows:1',
    'cascade: soft_delete_client runs end-to-end as staff (v4 cancels the future appt while the client is live — no GUC)'
  ) AS l
));

RESET ROLE;

INSERT INTO _tap (n, line) VALUES (15, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT status || '/' || COALESCE(cancellation_reason, 'null')
       FROM appointments WHERE id = (SELECT casc_appt FROM _ids)),
    'cancelled/Client archived',
    'cascade: the future appointment flipped to cancelled'
  ) AS l
));

SELECT public._test_set_jwt(
  (SELECT staff_w FROM _ids), (SELECT org_w FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

INSERT INTO _tap (n, line) VALUES (16, (
  SELECT string_agg(l, E'\n') FROM ok(
    pg_temp._try(format(
      'SELECT public.restore_client(%L)', (SELECT casc_client FROM _ids)
    )) = 'rows:1',
    'cascade: restore_client runs end-to-end as staff (archive_cascade GUC passes the un-archive UPDATE)'
  ) AS l
));

RESET ROLE;

INSERT INTO _tap (n, line) VALUES (17, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT (deleted_at IS NULL AND archived_at IS NULL)::text
       FROM clients WHERE id = (SELECT casc_client FROM _ids)),
    'true',
    'cascade: the client is live again after restore'
  ) AS l
));

-- ----------------------------------------------------------------------------
-- RPC-only unassign hard gate (20260723140000). restore_client's lingering
-- archive_cascade GUC only exempts clients_row_write_guard — reset it anyway
-- so nothing below runs under a leftover exemption.
-- ----------------------------------------------------------------------------
SELECT set_config('odyssey.archive_cascade', '', true);

SELECT public._test_set_jwt(
  (SELECT staff_w FROM _ids), (SELECT org_w FROM _ids), 'staff'
);
SET LOCAL ROLE authenticated;

-- 18. control: a published day with NO completed session raw-unassigns freely.
INSERT INTO _tap (n, line) VALUES (18, (
  SELECT string_agg(l, E'\n') FROM ok(
    pg_temp._try(format(
      'UPDATE program_days SET published_at = NULL WHERE id = %L',
      (SELECT day_open FROM _ids)
    )) = 'rows:1',
    'control: raw unassign of a published, NOT-completed day still succeeds'
  ) AS l
));

-- 19. the hard gate: raw unassign of the completed+assigned day is refused.
INSERT INTO _tap (n, line) VALUES (19, (
  SELECT string_agg(l, E'\n') FROM ok(
    pg_temp._try(format(
      'UPDATE program_days SET published_at = NULL WHERE id = %L',
      (SELECT day_locked FROM _ids)
    )) = 'error:Completed sessions are unassigned through the app — use the Unassign action.',
    'hard gate: raw unassign of a completed+assigned day refused'
  ) AS l
));

-- 20. the sanctioned path succeeds for the same day, as the same staff session.
INSERT INTO _tap (n, line) VALUES (20, (
  SELECT string_agg(l, E'\n') FROM ok(
    pg_temp._try(format(
      'SELECT public.unassign_program_day(%L)', (SELECT day_locked FROM _ids)
    )) = 'rows:1',
    'sanctioned path: unassign_program_day() succeeds as staff'
  ) AS l
));

-- 21. …and it actually unassigned.
INSERT INTO _tap (n, line) VALUES (21, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT (published_at IS NULL)::text
       FROM program_days WHERE id = (SELECT day_locked FROM _ids)),
    'true',
    'the completed day is unassigned after the RPC (published_at IS NULL)'
  ) AS l
));

-- 22. a client-role session → the RPC fails closed (42501 Unauthorized).
-- (A cleared-JWT probe was tried first and hits the helpers' own claims
-- parsing before the RPC's guard — the client-role spoof exercises the
-- guard itself.)
SELECT public._test_set_jwt(
  (SELECT staff_w FROM _ids), (SELECT org_w FROM _ids), 'client'
);
INSERT INTO _tap (n, line) VALUES (22, (
  SELECT string_agg(l, E'\n') FROM ok(
    pg_temp._try(format(
      'SELECT public.unassign_program_day(%L)', (SELECT day_unassign FROM _ids)
    )) = 'error:Unauthorized',
    'unauthorized: unassign_program_day refuses a client-role session (42501)'
  ) AS l
));

RESET ROLE;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
