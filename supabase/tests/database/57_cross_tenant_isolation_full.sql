-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), throws_ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 57_cross_tenant_isolation_full
-- ============================================================================
-- Closes the pgTAP half of premortem R-4 across the ENTIRE tenant surface.
--
-- Test 17 (17_cross_tenant_isolation.sql) proves the boundary on the
-- regression-prone core: read isolation on clients / clinical_notes /
-- programs, write isolation on clients as representative. Its own coverage
-- note records that the other tenant tables were only ever covered by the
-- MANUAL 2026-06-07 runbook pass. This file makes that manual sweep
-- automated and exhaustive: it asserts cross-tenant read AND write isolation,
-- in BOTH directions, on EVERY table in `public` that carries
-- `organization_id` — the full list confirmed by live introspection
-- (pg_catalog) against the staging schema at migration head 20260702190000,
-- which equals the production head (a staging pass therefore certifies prod).
--
-- The 41 organization_id-bearing tables (introspected, not remembered):
--   appointments, assessment_templates, assessments, audit_log,
--   availability_rules, circuits, client_categories, client_files,
--   client_medical_history, client_medications, client_publications, clients,
--   clinical_notes, communication_templates, communications, contacts,
--   exercise_metric_units, exercise_tags, exercises, invite_tokens,
--   message_notifications, message_threads, messages, movement_patterns,
--   note_templates, practice_custom_tests, practice_disabled_tests,
--   practice_test_settings, program_templates, programs, reports,
--   section_titles, session_templates, session_types, sessions,
--   test_batteries, test_results, test_sessions, user_organization_roles,
--   vald_device_types, vald_raw_uploads.
--
-- The 26 public tables WITHOUT organization_id are OUT OF SCOPE here by
-- construction — they inherit tenancy through a parent (Pattern C: e.g.
-- program_days/weeks/exercises, set_logs, exercise_logs, template_*,
-- circuit_*, session_template_*, appointment_reminders, report_versions,
-- note_template_fields, vald device children) or are global/non-tenant
-- (organizations, user_profiles, physical_markers_schema_*, rate_limit_log,
-- password_recovery_tickets, calendar_feed_tokens, audit_wide_column_config).
-- Their isolation is a property of the parent's organization_id, which this
-- test exercises on the parent. See the closing report for the full list.
--
-- Method (identical spoof mechanism to tests 06 / 16 / 17):
--   * Fixture seeds two synthetic orgs, org_a and org_b, each with one OWNER
--     user, one client, and one row in every one of the 41 tables. Seeding
--     runs as the test owner (postgres, rolbypassrls=true — verified live),
--     which bypasses RLS including FORCE ROW LEVEL SECURITY, so all 41 tables
--     (9 of which FORCE RLS) seed with plain INSERTs.
--   * Assertions run under SET LOCAL ROLE authenticated with a spoofed JWT
--     (_test_set_jwt), so auth.user_organization_id()/user_role() resolve to
--     the acting org and RLS is enforced exactly as it is for a PostgREST
--     request. Owner role is used (not staff) so the audit_log owner-only
--     SELECT policy still yields the own-org control row.
--
-- Assertions (339), grouped:
--   Per table (40; invite_tokens handled separately, see below) × two acting
--   orgs (owner_a over org_a, owner_b over org_b):
--     - control    : acting owner sees >= 1 of its OWN org's rows
--                    (anti-trivial: proves a row exists to be isolated)
--     - read  iso  : acting owner sees 0 of the OTHER org's rows
--     - write iso  : acting owner UPDATE of the OTHER org's rows affects 0
--     - write iso  : acting owner DELETE of the OTHER org's rows affects 0
--     => 4 lines × 40 × 2 = 320. A table whose UPDATE/DELETE is not granted
--        to `authenticated` at all (audit_log) denies at the GRANT layer
--        (42501) = 0 rows written; that is caught and the TAP label notes it.
--   Same-org write controls (2): owner_a UPDATE of its own clients /
--     clinical_notes affects >= 1 — proves the UPDATE path is not
--     universally zero, so the write-iso zeros above are isolation.
--   invite_tokens (9): this table denies ALL access to `authenticated` (RLS
--     USING/WITH CHECK false; only the service role reads the secret
--     action_link). The uniform "owner sees own >= 1" control cannot apply, so
--     it gets a dedicated block: an owner-bypass count proves the seed rows
--     exist, then no authenticated session — own-org OR cross-org — can read,
--     update, or delete them. Stronger than tenant isolation.
--   INSERT isolation (8): owner_b INSERT carrying org_a's organization_id into
--     a PHI/clinical table is rejected by a tenant guard — the RLS WITH CHECK
--     (42501; e.g. clients) OR the enforce_same_org_fk cross-org trigger
--     (P0001; client-scoped tables, whose org_a client is invisible to
--     owner_b). Either proves owner_b cannot fabricate a row in org_a; the
--     caught SQLSTATE is shown in the label.
--
-- Run discipline: BEGIN/ROLLBACK so nothing persists (this suite has no
-- non-prod-durable target; the rollback is what makes running it safe, and
-- this file must NEVER be run against production — staging only). The _tap
-- temp table surfaces every TAP line in one grid (the runner returns only the
-- last statement's rows). finish() is intentionally dropped (as in 15/16/17);
-- the 338-row plan count is the check.
-- ============================================================================

BEGIN;

SELECT plan(339);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;
GRANT INSERT, SELECT ON _tap TO authenticated;


-- ----------------------------------------------------------------------------
-- Per-org seeding helper. One row in each of the 39 tables not seeded by the
-- fixture directly (clients + user_organization_roles are seeded there). Temp
-- function: dropped at ROLLBACK. Runs as postgres (bypasses RLS incl. FORCE).
-- Every value satisfies the table's live CHECK/FK constraints (introspected).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp._xt_seed(
  p_org uuid, p_client uuid, p_owner uuid,
  p_tsession uuid, p_thread uuid, p_msg uuid, p_atmpl uuid, p_vdt uuid,
  p_sfx text
) RETURNS void
LANGUAGE plpgsql
AS $seed$
BEGIN
  -- reference / lookup / library (org-scoped, no client)
  INSERT INTO assessment_templates (id, organization_id, name)
    VALUES (p_atmpl, p_org, 'AT ' || p_sfx);
  INSERT INTO circuits (organization_id, name, circuit_type)
    VALUES (p_org, 'Circuit ' || p_sfx, 'superset');
  INSERT INTO client_categories (organization_id, name)
    VALUES (p_org, 'Cat ' || p_sfx);
  INSERT INTO communication_templates (organization_id, name, communication_type, body_template, subject_template)
    VALUES (p_org, 'CommTmpl ' || p_sfx, 'email', 'body', 'subj');
  INSERT INTO contacts (organization_id, name, contact_group)
    VALUES (p_org, 'Contact ' || p_sfx, 'other');
  INSERT INTO exercise_metric_units (organization_id, code, display_label, category)
    VALUES (p_org, 'kg', 'Kilograms', 'weight');
  INSERT INTO exercise_tags (organization_id, name)
    VALUES (p_org, 'Tag ' || p_sfx);
  INSERT INTO exercises (organization_id, name)
    VALUES (p_org, 'Exercise ' || p_sfx);
  INSERT INTO movement_patterns (organization_id, name)
    VALUES (p_org, 'Pattern ' || p_sfx);
  INSERT INTO note_templates (organization_id, name)
    VALUES (p_org, 'NoteTmpl ' || p_sfx);
  INSERT INTO program_templates (organization_id, name)
    VALUES (p_org, 'ProgTmpl ' || p_sfx);
  INSERT INTO section_titles (organization_id, name)
    VALUES (p_org, 'Section ' || p_sfx);
  INSERT INTO session_templates (organization_id, name)
    VALUES (p_org, 'SessTmpl ' || p_sfx);
  INSERT INTO session_types (organization_id, name, color, kind)
    VALUES (p_org, 'SessType ' || p_sfx, '#3366cc', 'appointment');
  INSERT INTO vald_device_types (id, organization_id, code, display_label)
    VALUES (p_vdt, p_org, 'forcedecks', 'ForceDecks');
  INSERT INTO test_batteries (organization_id, name, metric_keys)
    VALUES (p_org, 'Battery ' || p_sfx, '["m1"]'::jsonb);
  INSERT INTO practice_custom_tests (organization_id, category_id, subcategory_id, test_id, name, metrics)
    VALUES (p_org, 'cat', 'sub', 'custom_probe_' || p_sfx, 'CustomTest ' || p_sfx, '["m1"]'::jsonb);
  INSERT INTO practice_disabled_tests (organization_id, test_id)
    VALUES (p_org, 'some_test_' || p_sfx);
  INSERT INTO practice_test_settings (organization_id, test_id, metric_id)
    VALUES (p_org, 'some_test_' || p_sfx, 'some_metric');

  -- client-scoped clinical / PHI
  INSERT INTO clinical_notes (organization_id, client_id, author_user_id, body_rich)
    VALUES (p_org, p_client, p_owner, 'xtenant-full clinical note ' || p_sfx);
  INSERT INTO client_medical_history (organization_id, client_id, condition)
    VALUES (p_org, p_client, 'condition ' || p_sfx);
  INSERT INTO client_medications (organization_id, client_id, name)
    VALUES (p_org, p_client, 'medication ' || p_sfx);
  INSERT INTO programs (organization_id, client_id, name, start_date, duration_weeks)
    VALUES (p_org, p_client, 'Program ' || p_sfx, CURRENT_DATE, 4);
  INSERT INTO sessions (organization_id, client_id)
    VALUES (p_org, p_client);
  INSERT INTO reports (organization_id, client_id, report_type, title, test_date, storage_path)
    VALUES (p_org, p_client, 'vald', 'Report ' || p_sfx, CURRENT_DATE, 'reports/' || p_sfx);
  INSERT INTO communications (organization_id, client_id, sender_user_id, communication_type, body, recipient_email, subject)
    VALUES (p_org, p_client, p_owner, 'email', 'body', 'recipient-' || p_sfx || '@test.local', 'subject');
  INSERT INTO appointments (organization_id, client_id, staff_user_id, start_at, end_at, kind, created_by_role)
    VALUES (p_org, p_client, p_owner, now() + interval '1 day', now() + interval '1 day 1 hour', 'appointment', 'staff');
  INSERT INTO availability_rules (organization_id, staff_user_id, recurrence, day_of_week, start_time, end_time)
    VALUES (p_org, p_owner, 'weekly', 1, '09:00', '17:00');
  INSERT INTO client_files (organization_id, client_id, uploaded_by_user_id, name, original_filename, size_bytes, storage_path)
    VALUES (p_org, p_client, p_owner, 'File ' || p_sfx, 'file.pdf', 100, 'files/' || p_sfx);
  INSERT INTO assessments (organization_id, client_id, template_id, author_user_id)
    VALUES (p_org, p_client, p_atmpl, p_owner);
  INSERT INTO invite_tokens (organization_id, client_id, action_link)
    VALUES (p_org, p_client, 'https://example.test/invite/' || p_sfx);

  -- testing module
  INSERT INTO test_sessions (id, organization_id, client_id, conducted_by, conducted_at)
    VALUES (p_tsession, p_org, p_client, p_owner, now());
  INSERT INTO test_results (organization_id, test_session_id, test_id, metric_id, value, unit)
    VALUES (p_org, p_tsession, 'some_test', 'some_metric', 1.0, 'kg');
  INSERT INTO client_publications (organization_id, test_session_id, published_by, test_id)
    VALUES (p_org, p_tsession, p_owner, 'some_test');

  -- messaging
  INSERT INTO message_threads (id, organization_id, client_id)
    VALUES (p_thread, p_org, p_client);
  INSERT INTO messages (id, thread_id, organization_id, sender_user_id, sender_role, body)
    VALUES (p_msg, p_thread, p_org, p_owner, 'staff', 'hello ' || p_sfx);
  INSERT INTO message_notifications (organization_id, thread_id, message_id, recipient_user_id)
    VALUES (p_org, p_thread, p_msg, p_owner);

  -- vald raw + audit
  INSERT INTO vald_raw_uploads (organization_id, uploaded_by_user_id, device_type_id, source_filename, storage_path)
    VALUES (p_org, p_owner, p_vdt, 'raw-' || p_sfx || '.csv', 'vald/' || p_sfx);
  INSERT INTO audit_log (organization_id, table_name, row_id, action)
    VALUES (p_org, 'clients', p_client, 'INSERT');
END;
$seed$;


-- ----------------------------------------------------------------------------
-- Fixture: two orgs, two owners, one client each, then one row per table.
-- ----------------------------------------------------------------------------
DO $fix$
DECLARE
  org_a     uuid := '00000000-0000-0000-0000-000000570a01';
  org_b     uuid := '00000000-0000-0000-0000-000000570b01';
  client_a  uuid := '00000000-0000-0000-0000-000000570a02';
  client_b  uuid := '00000000-0000-0000-0000-000000570b02';
  owner_a   uuid;
  owner_b   uuid;
BEGIN
  INSERT INTO organizations (id, name, slug) VALUES
    (org_a, 'XTenant-Full Org A', 'xtenant-full-a'),
    (org_b, 'XTenant-Full Org B', 'xtenant-full-b');

  owner_a := public._test_make_user('xtfull-owner-a@test.local');
  owner_b := public._test_make_user('xtfull-owner-b@test.local');

  PERFORM public._test_grant_membership(owner_a, org_a, 'owner'::user_role);
  PERFORM public._test_grant_membership(owner_b, org_b, 'owner'::user_role);

  INSERT INTO clients (id, organization_id, first_name, last_name, email) VALUES
    (client_a, org_a, 'Alpha', 'OrgA', 'xtfull-client-a@test.local'),
    (client_b, org_b, 'Bravo', 'OrgB', 'xtfull-client-b@test.local');

  PERFORM pg_temp._xt_seed(
    org_a, client_a, owner_a,
    '00000000-0000-0000-0000-000000570a03',
    '00000000-0000-0000-0000-000000570a04',
    '00000000-0000-0000-0000-000000570a05',
    '00000000-0000-0000-0000-000000570a06',
    '00000000-0000-0000-0000-000000570a07',
    'a');

  PERFORM pg_temp._xt_seed(
    org_b, client_b, owner_b,
    '00000000-0000-0000-0000-000000570b03',
    '00000000-0000-0000-0000-000000570b04',
    '00000000-0000-0000-0000-000000570b05',
    '00000000-0000-0000-0000-000000570b06',
    '00000000-0000-0000-0000-000000570b07',
    'b');

  CREATE TEMP TABLE _ids ON COMMIT DROP AS
    SELECT org_a AS org_a, org_b AS org_b,
           owner_a AS owner_a, owner_b AS owner_b,
           client_a AS client_a, client_b AS client_b;
  GRANT SELECT ON _ids TO authenticated;
END
$fix$;


-- ----------------------------------------------------------------------------
-- Assertion driver. Loops the 40-table array under each owner's spoofed
-- session and records four isolation TAP lines per table per direction, then
-- the same-org write controls, the invite_tokens deny-all block, and the
-- INSERT-isolation denials. (invite_tokens is NOT in the loop — it denies all
-- authenticated access, so the uniform own-org control does not fit it.)
-- ----------------------------------------------------------------------------
DO $asrt$
DECLARE
  n int := 0;
  s text;
  v int;
  t text;
  v_note text := '';
  got text;
  i int;
  ins_names text[];
  ins_sqls text[];
  org_a uuid; org_b uuid; owner_a uuid; owner_b uuid; client_a uuid; client_b uuid;
  tbls text[] := ARRAY[
    'appointments','assessment_templates','assessments','audit_log',
    'availability_rules','circuits','client_categories','client_files',
    'client_medical_history','client_medications','client_publications','clients',
    'clinical_notes','communication_templates','communications','contacts',
    'exercise_metric_units','exercise_tags','exercises',
    'message_notifications','message_threads','messages','movement_patterns',
    'note_templates','practice_custom_tests','practice_disabled_tests',
    'practice_test_settings','program_templates','programs','reports',
    'section_titles','session_templates','session_types','sessions',
    'test_batteries','test_results','test_sessions','user_organization_roles',
    'vald_device_types','vald_raw_uploads'
  ];
BEGIN
  SELECT _ids.org_a, _ids.org_b, _ids.owner_a, _ids.owner_b, _ids.client_a, _ids.client_b
    INTO org_a, org_b, owner_a, owner_b, client_a, client_b
  FROM _ids;

  -- ===== PHASE A: owner_a acting in org_a; "other" = org_b =====
  PERFORM public._test_set_jwt(owner_a, org_a, 'owner');
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOREACH t IN ARRAY tbls LOOP
    -- control: sees >= 1 of own (org_a)
    EXECUTE format('SELECT count(*)::int FROM %I WHERE organization_id = $1', t) INTO v USING org_a;
    SELECT string_agg(l, E'\n') INTO s FROM is(v >= 1, true,
      format('control: owner_a sees its own org_a rows in %s', t)) l;
    n := n + 1; INSERT INTO _tap VALUES (n, s);

    -- read isolation: sees 0 of other (org_b)
    EXECUTE format('SELECT count(*)::int FROM %I WHERE organization_id = $1', t) INTO v USING org_b;
    SELECT string_agg(l, E'\n') INTO s FROM is(v, 0,
      format('read isolation: owner_a (org_a) sees 0 of org_b rows in %s', t)) l;
    n := n + 1; INSERT INTO _tap VALUES (n, s);

    -- write isolation (UPDATE): affects 0 of other (org_b). A missing UPDATE
    -- GRANT to authenticated (e.g. audit_log) denies with 42501 = 0 written;
    -- caught and labelled so the report distinguishes the two mechanisms.
    v_note := '';
    BEGIN
      EXECUTE format(
        'WITH u AS (UPDATE %I SET organization_id = organization_id WHERE organization_id = $1 RETURNING 1) SELECT count(*)::int FROM u', t)
        INTO v USING org_b;
    EXCEPTION WHEN insufficient_privilege THEN
      v := 0; v_note := ' [no UPDATE grant to authenticated; blanket-denied]';
    END;
    SELECT string_agg(l, E'\n') INTO s FROM is(v, 0,
      format('write isolation UPDATE: owner_a UPDATE of org_b rows affects 0 in %s%s', t, v_note)) l;
    n := n + 1; INSERT INTO _tap VALUES (n, s);

    -- write isolation (DELETE): affects 0 of other (org_b)
    v_note := '';
    BEGIN
      EXECUTE format(
        'WITH d AS (DELETE FROM %I WHERE organization_id = $1 RETURNING 1) SELECT count(*)::int FROM d', t)
        INTO v USING org_b;
    EXCEPTION WHEN insufficient_privilege THEN
      v := 0; v_note := ' [no DELETE grant to authenticated; blanket-denied]';
    END;
    SELECT string_agg(l, E'\n') INTO s FROM is(v, 0,
      format('write isolation DELETE: owner_a DELETE of org_b rows affects 0 in %s%s', t, v_note)) l;
    n := n + 1; INSERT INTO _tap VALUES (n, s);
  END LOOP;
  EXECUTE 'RESET ROLE';

  -- ===== PHASE B: owner_b acting in org_b; "other" = org_a =====
  PERFORM public._test_set_jwt(owner_b, org_b, 'owner');
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('SELECT count(*)::int FROM %I WHERE organization_id = $1', t) INTO v USING org_b;
    SELECT string_agg(l, E'\n') INTO s FROM is(v >= 1, true,
      format('control: owner_b sees its own org_b rows in %s', t)) l;
    n := n + 1; INSERT INTO _tap VALUES (n, s);

    EXECUTE format('SELECT count(*)::int FROM %I WHERE organization_id = $1', t) INTO v USING org_a;
    SELECT string_agg(l, E'\n') INTO s FROM is(v, 0,
      format('read isolation: owner_b (org_b) sees 0 of org_a rows in %s', t)) l;
    n := n + 1; INSERT INTO _tap VALUES (n, s);

    v_note := '';
    BEGIN
      EXECUTE format(
        'WITH u AS (UPDATE %I SET organization_id = organization_id WHERE organization_id = $1 RETURNING 1) SELECT count(*)::int FROM u', t)
        INTO v USING org_a;
    EXCEPTION WHEN insufficient_privilege THEN
      v := 0; v_note := ' [no UPDATE grant to authenticated; blanket-denied]';
    END;
    SELECT string_agg(l, E'\n') INTO s FROM is(v, 0,
      format('write isolation UPDATE: owner_b UPDATE of org_a rows affects 0 in %s%s', t, v_note)) l;
    n := n + 1; INSERT INTO _tap VALUES (n, s);

    v_note := '';
    BEGIN
      EXECUTE format(
        'WITH d AS (DELETE FROM %I WHERE organization_id = $1 RETURNING 1) SELECT count(*)::int FROM d', t)
        INTO v USING org_a;
    EXCEPTION WHEN insufficient_privilege THEN
      v := 0; v_note := ' [no DELETE grant to authenticated; blanket-denied]';
    END;
    SELECT string_agg(l, E'\n') INTO s FROM is(v, 0,
      format('write isolation DELETE: owner_b DELETE of org_a rows affects 0 in %s%s', t, v_note)) l;
    n := n + 1; INSERT INTO _tap VALUES (n, s);
  END LOOP;
  EXECUTE 'RESET ROLE';

  -- ===== Same-org write controls: proves the UPDATE path is not always 0 ===
  -- (run last; these DO mutate own-org rows, after all isolation checks)
  PERFORM public._test_set_jwt(owner_a, org_a, 'owner');
  EXECUTE 'SET LOCAL ROLE authenticated';

  WITH u AS (UPDATE clients SET first_name = first_name WHERE organization_id = org_a RETURNING 1)
  SELECT count(*)::int INTO v FROM u;
  SELECT string_agg(l, E'\n') INTO s FROM is(v >= 1, true,
    'control: owner_a UPDATE of its own org_a clients affects >= 1 (UPDATE path lives)') l;
  n := n + 1; INSERT INTO _tap VALUES (n, s);

  WITH u AS (UPDATE clinical_notes SET body_rich = body_rich WHERE organization_id = org_a RETURNING 1)
  SELECT count(*)::int INTO v FROM u;
  SELECT string_agg(l, E'\n') INTO s FROM is(v >= 1, true,
    'control: owner_a UPDATE of its own org_a clinical_notes affects >= 1 (author-locked path lives)') l;
  n := n + 1; INSERT INTO _tap VALUES (n, s);
  EXECUTE 'RESET ROLE';

  -- ===== invite_tokens — deny-all to authenticated (secret action_link) =====
  -- RLS denies SELECT/INSERT/UPDATE/DELETE to authenticated entirely; only the
  -- service role reads the token. The uniform "owner sees own >= 1" control
  -- cannot apply, so prove (a) the seed rows exist (owner-bypass count = 2),
  -- and (b) NO authenticated session — own-org OR cross-org — can read or
  -- write them. This is stronger than tenant isolation.
  SELECT count(*)::int INTO v FROM invite_tokens WHERE organization_id IN (org_a, org_b);
  SELECT string_agg(l, E'\n') INTO s FROM is(v, 2,
    'anti-trivial: invite_tokens seed rows exist for both orgs (owner-bypass count = 2)') l;
  n := n + 1; INSERT INTO _tap VALUES (n, s);

  PERFORM public._test_set_jwt(owner_a, org_a, 'owner');
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*)::int INTO v FROM invite_tokens WHERE organization_id = org_a;
  SELECT string_agg(l, E'\n') INTO s FROM is(v, 0,
    'invite_tokens: owner_a sees 0 of its OWN org_a rows (RLS denies all authenticated SELECT)') l;
  n := n + 1; INSERT INTO _tap VALUES (n, s);
  SELECT count(*)::int INTO v FROM invite_tokens WHERE organization_id = org_b;
  SELECT string_agg(l, E'\n') INTO s FROM is(v, 0,
    'read isolation: owner_a sees 0 of org_b invite_tokens') l;
  n := n + 1; INSERT INTO _tap VALUES (n, s);
  v_note := '';
  BEGIN
    WITH u AS (UPDATE invite_tokens SET organization_id = organization_id WHERE organization_id = org_b RETURNING 1)
    SELECT count(*)::int INTO v FROM u;
  EXCEPTION WHEN insufficient_privilege THEN v := 0; v_note := ' [no UPDATE grant to authenticated; blanket-denied]'; END;
  SELECT string_agg(l, E'\n') INTO s FROM is(v, 0,
    format('write isolation UPDATE: owner_a UPDATE of org_b invite_tokens affects 0%s', v_note)) l;
  n := n + 1; INSERT INTO _tap VALUES (n, s);
  v_note := '';
  BEGIN
    WITH d AS (DELETE FROM invite_tokens WHERE organization_id = org_b RETURNING 1)
    SELECT count(*)::int INTO v FROM d;
  EXCEPTION WHEN insufficient_privilege THEN v := 0; v_note := ' [no DELETE grant to authenticated; blanket-denied]'; END;
  SELECT string_agg(l, E'\n') INTO s FROM is(v, 0,
    format('write isolation DELETE: owner_a DELETE of org_b invite_tokens affects 0%s', v_note)) l;
  n := n + 1; INSERT INTO _tap VALUES (n, s);
  EXECUTE 'RESET ROLE';

  PERFORM public._test_set_jwt(owner_b, org_b, 'owner');
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*)::int INTO v FROM invite_tokens WHERE organization_id = org_b;
  SELECT string_agg(l, E'\n') INTO s FROM is(v, 0,
    'invite_tokens: owner_b sees 0 of its OWN org_b rows (RLS denies all authenticated SELECT)') l;
  n := n + 1; INSERT INTO _tap VALUES (n, s);
  SELECT count(*)::int INTO v FROM invite_tokens WHERE organization_id = org_a;
  SELECT string_agg(l, E'\n') INTO s FROM is(v, 0,
    'read isolation: owner_b sees 0 of org_a invite_tokens') l;
  n := n + 1; INSERT INTO _tap VALUES (n, s);
  v_note := '';
  BEGIN
    WITH u AS (UPDATE invite_tokens SET organization_id = organization_id WHERE organization_id = org_a RETURNING 1)
    SELECT count(*)::int INTO v FROM u;
  EXCEPTION WHEN insufficient_privilege THEN v := 0; v_note := ' [no UPDATE grant to authenticated; blanket-denied]'; END;
  SELECT string_agg(l, E'\n') INTO s FROM is(v, 0,
    format('write isolation UPDATE: owner_b UPDATE of org_a invite_tokens affects 0%s', v_note)) l;
  n := n + 1; INSERT INTO _tap VALUES (n, s);
  v_note := '';
  BEGIN
    WITH d AS (DELETE FROM invite_tokens WHERE organization_id = org_a RETURNING 1)
    SELECT count(*)::int INTO v FROM d;
  EXCEPTION WHEN insufficient_privilege THEN v := 0; v_note := ' [no DELETE grant to authenticated; blanket-denied]'; END;
  SELECT string_agg(l, E'\n') INTO s FROM is(v, 0,
    format('write isolation DELETE: owner_b DELETE of org_a invite_tokens affects 0%s', v_note)) l;
  n := n + 1; INSERT INTO _tap VALUES (n, s);
  EXECUTE 'RESET ROLE';

  -- ===== INSERT isolation: owner_b cannot fabricate a row in org_a =====
  -- Each INSERT carries org_a's organization_id and is otherwise valid. It is
  -- rejected by a tenant guard: the RLS WITH CHECK (42501; clients, no
  -- cross-org FK trigger) OR the enforce_same_org_fk cross-org trigger (P0001;
  -- client-scoped tables — org_a's client is invisible to owner_b, so the FK
  -- target reads as non-existent). Both prove owner_b cannot create a row in
  -- org_a. The caught SQLSTATE is shown; a successful INSERT (got '00000')
  -- fails the assertion (that would be an isolation breach).
  ins_names := ARRAY['clients','clinical_notes','client_medical_history',
    'client_medications','programs','reports','sessions','communications'];
  ins_sqls := ARRAY[
    format($q$INSERT INTO clients (organization_id, first_name, last_name, email) VALUES (%L,'Mallory','Tamper','xtfull-insert@test.local')$q$, org_a),
    format($q$INSERT INTO clinical_notes (organization_id, client_id, author_user_id, body_rich) VALUES (%L,%L,%L,'x')$q$, org_a, client_a, owner_b),
    format($q$INSERT INTO client_medical_history (organization_id, client_id, condition) VALUES (%L,%L,'x')$q$, org_a, client_a),
    format($q$INSERT INTO client_medications (organization_id, client_id, name) VALUES (%L,%L,'x')$q$, org_a, client_a),
    format($q$INSERT INTO programs (organization_id, client_id, name, start_date, duration_weeks) VALUES (%L,%L,'x',CURRENT_DATE,4)$q$, org_a, client_a),
    format($q$INSERT INTO reports (organization_id, client_id, report_type, title, test_date, storage_path) VALUES (%L,%L,'vald','x',CURRENT_DATE,'reports/x')$q$, org_a, client_a),
    format($q$INSERT INTO sessions (organization_id, client_id) VALUES (%L,%L)$q$, org_a, client_a),
    format($q$INSERT INTO communications (organization_id, client_id, sender_user_id, communication_type, body, recipient_email, subject) VALUES (%L,%L,%L,'email','b','x@test.local','s')$q$, org_a, client_a, owner_b)
  ];
  PERFORM public._test_set_jwt(owner_b, org_b, 'owner');
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOR i IN 1 .. array_length(ins_sqls, 1) LOOP
    BEGIN
      EXECUTE ins_sqls[i];
      got := '00000';  -- no error = INSERT SUCCEEDED = isolation breach
    EXCEPTION WHEN others THEN
      got := SQLSTATE;
    END;
    SELECT string_agg(l, E'\n') INTO s FROM is(got IN ('42501','P0001'), true,
      format('INSERT isolation: owner_b INSERT into org_a %s rejected by tenant guard (got %s)', ins_names[i], got)) l;
    n := n + 1; INSERT INTO _tap VALUES (n, s);
  END LOOP;
  EXECUTE 'RESET ROLE';
END
$asrt$;


-- Surface every captured TAP line in one grid.
SELECT line FROM _tap ORDER BY n;

ROLLBACK;
