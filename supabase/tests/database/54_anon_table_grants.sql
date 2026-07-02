-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok(), is() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 54_anon_table_grants
-- ============================================================================
-- Locks in migration 20260702170000 — the go-live-checklist §4b anon
-- table-grant tightening: anon is now denied at BOTH the grant layer and the
-- RLS layer on every table in public, and the postgres-role default
-- privileges no longer mint anon grants on future tables, sequences, or
-- functions (the root cause of the §4 anon-EXECUTE trap).
--
-- The checks are DYNAMIC (catalog scans, not a hard-coded table list), so a
-- future migration that creates a table with an anon grant — or a platform
-- change that re-adds the default ACL — fails this suite without anyone
-- remembering to extend it.
--
-- Assertions (8):
--   1. LOAD-BEARING — anon holds ZERO table/view grants in public.
--   2. anon holds no privilege on any sequence in public.
--   3. postgres's default ACL for TABLES in public no longer lists anon.
--   4. postgres's default ACL for FUNCTIONS in public no longer lists anon
--      (future functions are born without the auto-grant).
--   5. functional — an anon-role SELECT on clients raises 42501 (permission
--      denied at the grant layer, before RLS is even consulted).
--   6. control — authenticated keeps SELECT on clients (the working model:
--      authenticated holds table grants, RLS scopes the rows).
--   7. control — authenticated keeps UPDATE on clients.
--   8. control — calendar_feed_events KEEPS its deliberate anon EXECUTE (the
--      one pre-auth anon surface; proves the sweep didn't nuke existing
--      intentional grants — only defaults changed).
--
-- No fixtures. BEGIN/ROLLBACK for live-run safety; finish() intentionally
-- dropped (same as 15/16/17).
-- ============================================================================

BEGIN;

SELECT plan(8);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO anon;

-- Test 1 (LOAD-BEARING): zero anon table/view grants in public.
INSERT INTO _tap (n, line) VALUES (1, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM information_schema.role_table_grants
      WHERE grantee = 'anon' AND table_schema = 'public'),
    0,
    'LOAD-BEARING (4b): anon holds zero table/view grants in public'
  ) AS l
));

-- Test 2: zero anon privileges on any sequence in public.
INSERT INTO _tap (n, line) VALUES (2, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'S'
        AND (has_sequence_privilege('anon', c.oid, 'USAGE')
          OR has_sequence_privilege('anon', c.oid, 'SELECT')
          OR has_sequence_privilege('anon', c.oid, 'UPDATE'))),
    0,
    '4b: anon holds no privilege on any sequence in public'
  ) AS l
));

-- Test 3: postgres default ACL for TABLES in public no longer lists anon.
INSERT INTO _tap (n, line) VALUES (3, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM pg_default_acl d
      JOIN pg_namespace ns ON ns.oid = d.defaclnamespace
      WHERE ns.nspname = 'public'
        AND d.defaclrole = 'postgres'::regrole
        AND d.defaclobjtype = 'r'
        AND d.defaclacl::text LIKE '%anon=%'),
    0,
    '4b: postgres default ACL for future TABLES no longer grants anon'
  ) AS l
));

-- Test 4: postgres default ACL for FUNCTIONS in public no longer lists anon.
INSERT INTO _tap (n, line) VALUES (4, (
  SELECT string_agg(l, E'\n') FROM is(
    (SELECT count(*)::int FROM pg_default_acl d
      JOIN pg_namespace ns ON ns.oid = d.defaclnamespace
      WHERE ns.nspname = 'public'
        AND d.defaclrole = 'postgres'::regrole
        AND d.defaclobjtype = 'f'
        AND d.defaclacl::text LIKE '%anon=%'),
    0,
    '4b: postgres default ACL for future FUNCTIONS no longer grants anon (root cause of the section-4 trap)'
  ) AS l
));

-- Test 5 (functional): an anon-role SELECT on clients is denied at the grant
-- layer — 42501, before RLS is consulted. throws_ok runs the SQL under the
-- current role, so drop to anon first (the test-46 idiom).
SET LOCAL ROLE anon;

INSERT INTO _tap (n, line) VALUES (5, (
  SELECT string_agg(l, E'\n') FROM throws_ok(
    'SELECT count(*) FROM public.clients',
    '42501',
    NULL,
    '4b functional: anon SELECT on clients raises 42501 (grant-layer denial)'
  ) AS l
));

RESET ROLE;

-- Tests 6-7 (controls): authenticated keeps its table grants — the revoke
-- was anon-only, not a lockout of the working model.
INSERT INTO _tap (n, line) VALUES (6, (
  SELECT string_agg(l, E'\n') FROM ok(
    has_table_privilege('authenticated', 'public.clients', 'SELECT'),
    'control: authenticated keeps SELECT on clients'
  ) AS l
));

INSERT INTO _tap (n, line) VALUES (7, (
  SELECT string_agg(l, E'\n') FROM ok(
    has_table_privilege('authenticated', 'public.clients', 'UPDATE'),
    'control: authenticated keeps UPDATE on clients'
  ) AS l
));

-- Test 8 (control): the one deliberate pre-auth anon surface survives.
INSERT INTO _tap (n, line) VALUES (8, (
  SELECT string_agg(l, E'\n') FROM ok(
    has_function_privilege('anon', 'public.calendar_feed_events(text)', 'EXECUTE'),
    'control: calendar_feed_events keeps its deliberate anon EXECUTE (existing grants untouched)'
  ) AS l
));

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
