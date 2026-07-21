-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok(), is() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 61_auth_events
-- ============================================================================
-- Locks in migration 20260721140000 — G-6 structured auth-event audit log.
-- The table must be: server-side-only (no API-role access at the grant OR
-- policy layer), event-name-constrained, and append-only.
--
-- Assertions (8):
--   1. auth_events exists with RLS enabled
--   2. anon SELECT raises 42501 (no grants; RLS has no policies either)
--   3. authenticated SELECT raises 42501
--   4. authenticated INSERT raises 42501
--   5. CHECK: an unknown event name is refused (23514)
--   6. a valid owner-side INSERT succeeds (the write path the service role
--      uses; service_role and postgres both bypass RLS, grants differ but
--      the table shape/CHECK is what this asserts)
--   7. append-only: UPDATE refused (under the strictness GUC)
--   8. append-only: DELETE refused (under the strictness GUC)
-- ============================================================================

BEGIN;

SELECT plan(8);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated, anon;

INSERT INTO _tap (n, line) VALUES (1, (
  SELECT string_agg(l, E'\n') FROM ok(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.auth_events'::regclass),
    'auth_events exists with RLS enabled'
  ) AS l
));

-- 2. anon
SET LOCAL ROLE anon;
INSERT INTO _tap (n, line) VALUES (2, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    'SELECT count(*) FROM public.auth_events',
    '42501', NULL,
    'anon SELECT on auth_events raises 42501'
  ) AS l
));
RESET ROLE;

-- 3+4. authenticated
SET LOCAL ROLE authenticated;
INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    'SELECT count(*) FROM public.auth_events',
    '42501', NULL,
    'authenticated SELECT on auth_events raises 42501'
  ) AS l
));
INSERT INTO _tap (n, line) VALUES (4, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    $q$INSERT INTO public.auth_events (event) VALUES ('auth.login.success')$q$,
    '42501', NULL,
    'authenticated INSERT on auth_events raises 42501'
  ) AS l
));
RESET ROLE;

-- 5. CHECK constraint
INSERT INTO _tap (n, line) VALUES (5, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    $q$INSERT INTO public.auth_events (event) VALUES ('auth.not_a_real_event')$q$,
    '23514', NULL,
    'unknown event name refused by the CHECK constraint'
  ) AS l
));

-- 6. valid owner-side insert
INSERT INTO _tap (n, line) VALUES (6, (
  SELECT string_agg(l, E'\n') FROM lives_ok(
    $q$INSERT INTO public.auth_events (event, email, detail)
       VALUES ('auth.login.failure', 'probe-61@test.local', '{"reason":"pgTAP probe"}'::jsonb)$q$,
    'a valid owner-side INSERT succeeds'
  ) AS l
));

-- 7+8. append-only under the strictness GUC (the pgTAP channel's
-- session_user is postgres, which the trigger exempts for maintenance).
SELECT set_config('odyssey.test_enforce_guards', '1', true);

INSERT INTO _tap (n, line) VALUES (7, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    $q$UPDATE public.auth_events SET email = 'edited' WHERE email = 'probe-61@test.local'$q$,
    'P0001', 'auth_events is append-only',
    'append-only: UPDATE refused'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (8, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    $q$DELETE FROM public.auth_events WHERE email = 'probe-61@test.local'$q$,
    'P0001', 'auth_events is append-only',
    'append-only: DELETE refused'
  ) AS l
));

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
