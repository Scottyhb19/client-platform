-- ============================================================================
-- 20260629140000_client_medications
-- ============================================================================
-- Why: The client profile needs a structured medications list — one row per
-- medication the client is on. It is a direct clone of the
-- client_medical_history pattern (20260420100700 + CN-2 staff-only SELECT
-- 20260611120000 + CN-6 soft-delete RPCs 20260611130100): same
-- organization_id scoping, same RLS shape (staff-only — the standing default
-- per the 2026-06-11 operator rule; a medication and its context note are
-- clinical-adjacent and never client-viewable in the beta), same
-- audit-resolver registration, same is_active + deleted_at status mechanism.
--
-- The ONLY differences from client_medical_history are the columns and the
-- status vocabulary (the brief for this change):
--   - columns: a required medication `name` and an optional one-line
--     `context_note`. Nothing else — deliberately no dose or frequency.
--   - status: the is_active boolean models active vs ceased (where
--     client_medical_history reads it as active vs resolved); deleted_at
--     models archived. So the three reachable states are active (is_active
--     true), ceased (is_active false), archived (deleted_at set) — the same
--     mechanism as client_medical_history, with "ceased" in place of
--     "resolved". No status enum is introduced; the mechanism is unchanged.
--
-- Table/column/policy/trigger/audit naming follows client_medical_history so
-- the two sit consistently side by side: table client_medications, index /
-- trigger prefix cmed_, audit trigger audit_client_medications, RPCs
-- soft_delete_client_medications / restore_client_medications.
--
-- This lands schema only. No app surface reads or writes this table yet (that
-- is commit two of the profile rework). No real medication data is entered
-- until the service-role key and the other transcript-exposed secrets are
-- rotated (CLAUDE.md Beta-entry hardening gate).
--
-- A commented ROLLBACK block at the foot of the file is the down reversal
-- (Supabase migrations are forward-only; the repo convention for a reversal
-- is a documented, paste-runnable block — see the §ROLLBACK note below).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. Table — mirror of client_medical_history, columns swapped.
-- ----------------------------------------------------------------------------
CREATE TABLE client_medications (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  client_id        uuid         NOT NULL REFERENCES clients(id)       ON DELETE RESTRICT,
  name             text         NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  context_note     text,
  is_active        boolean      NOT NULL DEFAULT true,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE INDEX cmed_client_idx
  ON client_medications (client_id)
  WHERE deleted_at IS NULL;

CREATE INDEX cmed_org_idx
  ON client_medications (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX cmed_active_idx
  ON client_medications (client_id)
  WHERE is_active = true AND deleted_at IS NULL;

CREATE TRIGGER cmed_touch_updated_at
  BEFORE UPDATE ON client_medications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER cmed_enforce_client_org
  BEFORE INSERT OR UPDATE ON client_medications
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('clients', 'client_id', 'organization_id');

COMMENT ON TABLE client_medications IS
  'Medications a client is on. One row per medication: a required name and an optional one-line context note (no dose/frequency). Clone of client_medical_history — same org scoping, staff-only RLS, audit registration, and is_active + deleted_at status mechanism (active / ceased / archived).';


-- ----------------------------------------------------------------------------
-- §2. RLS — Pattern A (staff-only), the current client_medical_history state
-- after CN-2. Created staff-only from the start: a medication and its context
-- note are clinical-adjacent, and staff-only is the standing default
-- (operator rule 2026-06-11). If a client-facing "your medications" surface
-- is ever designed, relax deliberately and exclude the practitioner
-- context_note — same caveat CN-2 records for client_medical_history.notes.
-- ----------------------------------------------------------------------------
ALTER TABLE client_medications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff select medications in own org"
  ON client_medications FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND public.user_role() IN ('owner', 'staff')
  );

CREATE POLICY "staff insert medications in own org"
  ON client_medications FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
  );

CREATE POLICY "staff update medications in own org"
  ON client_medications FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
  )
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "deny delete medications"
  ON client_medications FOR DELETE TO authenticated USING (false);


-- ----------------------------------------------------------------------------
-- §3. Audit-resolver registration.
--
-- Body reproduced verbatim from the canonical latest version
-- (20260618120200_audit_messages) — every existing branch retained — per the
-- "base rewrites on the LATEST replacement" rule. Only change:
-- 'client_medications' added to the direct-org branch (it carries
-- organization_id), beside client_medical_history.
--
-- Ordering vs the coverage guard: if guard_audit_resolver_coverage is live it
-- fires on this CREATE OR REPLACE — at which point audit_client_medications
-- (§4) does not yet exist, so coverage holds (the resolver lists the table
-- harmlessly ahead of its trigger). §5 re-checks with the trigger present.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_resolve_org_id(p_table text, p_row jsonb)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  org_id uuid;
BEGIN
  IF p_row IS NULL THEN
    RETURN NULL;
  END IF;

  CASE p_table
    -- ------------------------------------------------------------------
    -- Direct: row carries organization_id.
    -- ------------------------------------------------------------------
    WHEN 'organizations' THEN
      org_id := NULLIF(p_row ->> 'id', '')::uuid;

    WHEN 'user_organization_roles', 'invitations', 'clients',
         'client_medical_history',
         'client_medications',
         'communications',
         'client_categories', 'client_tags', 'client_tag_assignments',
         'exercises', 'program_templates', 'template_weeks',
         'template_days', 'template_exercises', 'programs', 'sessions',
         'appointments', 'reports',
         'vald_raw_uploads', 'vald_device_types',
         'clinical_notes', 'assessment_templates', 'assessments',
         'session_types', 'note_templates', 'client_files',
         'test_sessions', 'test_results', 'practice_test_settings',
         'practice_custom_tests', 'practice_disabled_tests',
         'test_batteries', 'client_publications',
         'movement_patterns', 'exercise_tags', 'exercise_metric_units',
         'availability_rules',
         -- Messaging (added 2026-06-18, §10 P0-3). Both carry organization_id.
         'messages', 'message_threads'
         THEN
      org_id := NULLIF(p_row ->> 'organization_id', '')::uuid;

    -- ------------------------------------------------------------------
    -- Nested via programs.
    -- ------------------------------------------------------------------
    WHEN 'program_weeks' THEN
      SELECT p.organization_id INTO org_id
        FROM programs p
       WHERE p.id = NULLIF(p_row ->> 'program_id', '')::uuid;

    WHEN 'program_days' THEN
      SELECT p.organization_id INTO org_id
        FROM programs p
       WHERE p.id = NULLIF(p_row ->> 'program_id', '')::uuid;

    WHEN 'program_exercises' THEN
      SELECT p.organization_id INTO org_id
        FROM program_days pd
        JOIN programs p ON p.id = pd.program_id
       WHERE pd.id = NULLIF(p_row ->> 'program_day_id', '')::uuid;

    WHEN 'program_exercise_sets' THEN
      SELECT p.organization_id INTO org_id
        FROM program_exercises pe
        JOIN program_days       pd ON pd.id = pe.program_day_id
        JOIN programs           p  ON p.id  = pd.program_id
       WHERE pe.id = NULLIF(p_row ->> 'program_exercise_id', '')::uuid;

    -- ------------------------------------------------------------------
    -- Nested via sessions.
    -- ------------------------------------------------------------------
    WHEN 'exercise_logs' THEN
      SELECT s.organization_id INTO org_id
        FROM sessions s
       WHERE s.id = NULLIF(p_row ->> 'session_id', '')::uuid;

    WHEN 'set_logs' THEN
      SELECT s.organization_id INTO org_id
        FROM exercise_logs el
        JOIN sessions s ON s.id = el.session_id
       WHERE el.id = NULLIF(p_row ->> 'exercise_log_id', '')::uuid;

    -- ------------------------------------------------------------------
    -- Nested via appointments.
    -- ------------------------------------------------------------------
    WHEN 'appointment_reminders' THEN
      SELECT a.organization_id INTO org_id
        FROM appointments a
       WHERE a.id = NULLIF(p_row ->> 'appointment_id', '')::uuid;

    -- ------------------------------------------------------------------
    -- Nested via reports.
    -- ------------------------------------------------------------------
    WHEN 'report_versions' THEN
      SELECT r.organization_id INTO org_id
        FROM reports r
       WHERE r.id = NULLIF(p_row ->> 'report_id', '')::uuid;

    -- ------------------------------------------------------------------
    -- Nested via exercises (composite PK; defensive registration only).
    -- ------------------------------------------------------------------
    WHEN 'exercise_tag_assignments' THEN
      SELECT e.organization_id INTO org_id
        FROM exercises e
       WHERE e.id = NULLIF(p_row ->> 'exercise_id', '')::uuid;

    ELSE
      RAISE EXCEPTION 'audit_resolve_org_id: unknown audited table %', p_table;
  END CASE;

  RETURN org_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_resolve_org_id(text, jsonb) FROM PUBLIC;

COMMENT ON FUNCTION public.audit_resolve_org_id(text, jsonb) IS
  'Resolves organization_id for audit log writes. Direct lookup for tables that carry the column; parent walk for nested tables. 2026-06-29: added client_medications to the direct-org branch.';


-- ----------------------------------------------------------------------------
-- §4. Attach the audit trigger (mirrors audit_client_medical_history).
-- ----------------------------------------------------------------------------
CREATE TRIGGER audit_client_medications
  AFTER INSERT OR UPDATE OR DELETE ON client_medications
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();


-- ----------------------------------------------------------------------------
-- §5. Fallback coverage assertion (mandated for any migration that touches the
-- resolver — see 20260513160000 §4). Fails the migration loud if any
-- audit_<name> trigger now lacks a matching CASE branch.
-- ----------------------------------------------------------------------------
SELECT public.assert_audit_resolver_coverage();


-- ----------------------------------------------------------------------------
-- §6. Soft-delete / restore RPC pair (mirror of CN-6 20260611130100).
--
-- "archived" (deleted_at set) is reached through these, not a bare UPDATE: the
-- staff-only SELECT policy filters deleted_at IS NULL, so a direct UPDATE
-- setting deleted_at trips the platform soft-delete trap (42501). Deactivation
-- (is_active = false → "ceased") is the ordinary RLS-scoped UPDATE and needs no
-- RPC. No unique-active index, so restore has no conflict path.
--
-- Grants: REVOKE FROM PUBLIC then GRANT authenticated does NOT remove anon's
-- direct auto-grant (project memory supabase_default_execute_grants; the
-- platform-wide fix is 20260623180000). So REVOKE FROM anon explicitly — these
-- new functions enter the family already anon-locked, not needing a later
-- sweep. pgTAP 47 §B is the tripwire.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_client_medications(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE client_medications
     SET deleted_at = now()
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'client_medications % not found in your organization, or already archived', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_client_medications(uuid) IS
  'Archive a medication entered by mistake. Deactivation (is_active = false → ceased) is the primary remove verb and goes through RLS directly; this RPC exists because a bare UPDATE setting deleted_at trips the SELECT-policy trap (42501). Clone of soft_delete_client_medical_history (CN-6).';

REVOKE EXECUTE ON FUNCTION public.soft_delete_client_medications(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.soft_delete_client_medications(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.soft_delete_client_medications(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.restore_client_medications(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE client_medications
     SET deleted_at = NULL
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'client_medications % not found in your organization, or not archived', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.restore_client_medications(uuid) IS
  'Un-archive a medication. No unique-active index on the table, so no conflict path; the org check is the only gate beyond the auth check. Clone of restore_client_medical_history (CN-6).';

REVOKE EXECUTE ON FUNCTION public.restore_client_medications(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restore_client_medications(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.restore_client_medications(uuid) TO authenticated;


-- ============================================================================
-- §ROLLBACK (down reversal) — Supabase migrations are forward-only, so this is
-- a documented, paste-runnable block rather than an executed DOWN. Run it in
-- the SQL Editor (or as a follow-up migration) to drop everything this file
-- added, cleanly and in dependency order. The audit_resolve_org_id branch is
-- left in place on purpose: re-running assert_audit_resolver_coverage() after
-- the table/trigger are gone still passes (a listed-but-unused branch is
-- harmless), and removing it would mean another full-body CREATE OR REPLACE.
-- ----------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.restore_client_medications(uuid);
-- DROP FUNCTION IF EXISTS public.soft_delete_client_medications(uuid);
-- DROP TRIGGER  IF EXISTS audit_client_medications ON client_medications;
-- DROP POLICY   IF EXISTS "deny delete medications"            ON client_medications;
-- DROP POLICY   IF EXISTS "staff update medications in own org" ON client_medications;
-- DROP POLICY   IF EXISTS "staff insert medications in own org" ON client_medications;
-- DROP POLICY   IF EXISTS "staff select medications in own org" ON client_medications;
-- DROP TABLE    IF EXISTS client_medications;  -- drops cmed_* indexes + triggers with it
-- ============================================================================
