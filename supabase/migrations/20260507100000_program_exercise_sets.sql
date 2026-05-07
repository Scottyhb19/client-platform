-- ============================================================================
-- 20260507100000_program_exercise_sets
-- ============================================================================
-- Why: Phase C of the session-builder polish pass — per-set prescription
-- storage. /docs/polish/session-builder.md §2.2 + §3 + §4 row C.
--
-- Today: program_exercises carries flat scalars (sets, reps, optional_metric,
-- optional_value, rpe) that apply to every set uniformly. The SetTable in
-- SessionBuilder.tsx makes row 1 editable and rows 2..N display row 1's
-- value as static text — see the inline comment at SessionBuilder.tsx:786
-- ("they become independent inputs once per-set storage lands"). This blocks
-- 4 × 6 @ 80/80/85/85 wave loading and any non-uniform prescription.
--
-- Target: a new program_exercise_sets table holds one row per set. The
-- legacy scalar columns on program_exercises become unused (a follow-up
-- migration drops them once Phase C has stabilised). The "sets" count
-- becomes COUNT(*) of live rows in the new table.
--
-- Q6 sign-off (chat 2026-05-07): no dedicated rpe column on the new table.
-- Prescription RPE will go via optional_metric='rpe' / optional_value='8'
-- once Phase F lands the [value][metric] dropdown for the Load/Notes cell.
-- The set_logs.rpe column on the actuals side is unchanged — that's the
-- client's perceived RPE during the set, semantically distinct from the
-- prescribed target.
--
-- This migration:
--   §1 — CREATE program_exercise_sets table + partial unique index
--        (uniqueness on (pe_id, set_number) restricted to deleted_at IS NULL,
--        so soft-deleted set_numbers can be reused by the stepper without
--        renumbering — matches the project convention used on
--        programs_one_active_per_client_idx and client_publications_session_unique_active).
--   §2 — touch_updated_at trigger. No bump_version OCC trigger: per-set
--        rows aren't subject to the concurrent-edit pressure that program_exercises
--        carries; the prescribed value at a single (pe_id, set_number) coordinate
--        has a single editor at a time.
--   §3 — RLS: parent-walk through program_exercises → program_days → programs.
--        Same shape as set_logs' policy on the actuals side; explicit re-walk
--        rather than relying on nested RLS subselects (project convention).
--   §4 — audit_resolve_org_id branch (signature unchanged → CREATE OR REPLACE
--        without DROP). Three-hop walk via program_exercises.
--   §5 — audit trigger.
--   §6 — soft_delete_program_exercise_set RPC. Mirrors
--        soft_delete_program_exercise (post-D-PROG-001 single-hop walk on
--        program_days → programs) plus one extra hop through program_exercises.
--        Required because UPDATE setting deleted_at fails 42501 under FORCE
--        RLS — the SELECT policy filters deleted_at IS NULL, the post-update
--        row no longer satisfies it, the visibility check rejects.
--        See memory/project_postgrest_soft_delete_rls.md.
--
-- Out of scope here (deferred to a separate migration after Phase C stabilises):
--   - Drop of program_exercises.sets / reps / optional_metric / optional_value / rpe.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. Table + partial unique index.
-- ----------------------------------------------------------------------------
CREATE TABLE program_exercise_sets (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  program_exercise_id  uuid         NOT NULL REFERENCES program_exercises(id) ON DELETE CASCADE,
  set_number           smallint     NOT NULL CHECK (set_number BETWEEN 1 AND 50),
  reps                 text         CHECK (reps IS NULL OR length(trim(reps)) BETWEEN 1 AND 40),
  optional_metric      text,        -- code matching exercise_metric_units.code (kg, lb, rpe, percentage, ...)
  optional_value       text,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);

-- Partial unique index: one live row per (program_exercise_id, set_number).
-- Soft-deleted rows can share a set_number with a new live row, so the
-- stepper can re-use a set_number after a delete without renumbering.
CREATE UNIQUE INDEX program_exercise_sets_pe_set_unique
  ON program_exercise_sets (program_exercise_id, set_number)
  WHERE deleted_at IS NULL;

-- Lookup index for the page loader's nested select (filtered + ordered).
CREATE INDEX program_exercise_sets_pe_idx
  ON program_exercise_sets (program_exercise_id, set_number)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE program_exercise_sets IS
  'Per-set prescription rows (Phase C of the session-builder polish pass). One row per prescribed set; the parent program_exercises row carries per-exercise context (instructions, tempo, rest_seconds). Symmetric with set_logs on the actuals side (minus the dedicated rpe column — prescription RPE is folded into optional_metric/optional_value per Q6 2026-05-07).';
COMMENT ON COLUMN program_exercise_sets.optional_metric IS
  'Code from exercise_metric_units (kg, lb, rpe, percentage, time_minsec, ...). Phase C keeps the Load/Notes cell freetext on the front-end; Phase F lands the dropdown.';


-- ----------------------------------------------------------------------------
-- §2. updated_at trigger.
-- ----------------------------------------------------------------------------
CREATE TRIGGER program_exercise_sets_touch_updated_at
  BEFORE UPDATE ON program_exercise_sets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ----------------------------------------------------------------------------
-- §3. RLS — parent-walk through program_exercises → program_days → programs.
--
-- Pattern matches set_logs' policies on the actuals side: re-walk the chain
-- explicitly inside each EXISTS rather than relying on RLS-on-RLS via nested
-- subselects. Adds resilience if any policy in the chain changes shape.
-- ----------------------------------------------------------------------------
ALTER TABLE program_exercise_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select program_exercise_sets via parent"
  ON program_exercise_sets FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM program_exercises pe
        JOIN program_days pd ON pd.id = pe.program_day_id
        JOIN programs     p  ON p.id  = pd.program_id
       WHERE pe.id = program_exercise_sets.program_exercise_id
         AND pe.deleted_at IS NULL
         AND p.organization_id = public.user_organization_id()
         AND p.deleted_at IS NULL
         AND (
           public.user_role() IN ('owner', 'staff')
           OR (
             public.user_role() = 'client'
             AND p.status IN ('active', 'archived')
             AND p.client_id IN (SELECT id FROM clients WHERE user_id = auth.uid() AND deleted_at IS NULL)
           )
         )
    )
  );

CREATE POLICY "staff insert program_exercise_sets via parent"
  ON program_exercise_sets FOR INSERT TO authenticated
  WITH CHECK (
    public.user_role() IN ('owner', 'staff')
    AND EXISTS (
      SELECT 1 FROM program_exercises pe
        JOIN program_days pd ON pd.id = pe.program_day_id
        JOIN programs     p  ON p.id  = pd.program_id
       WHERE pe.id = program_exercise_sets.program_exercise_id
         AND p.organization_id = public.user_organization_id()
    )
  );

CREATE POLICY "staff update program_exercise_sets via parent"
  ON program_exercise_sets FOR UPDATE TO authenticated
  USING (
    public.user_role() IN ('owner', 'staff')
    AND EXISTS (
      SELECT 1 FROM program_exercises pe
        JOIN program_days pd ON pd.id = pe.program_day_id
        JOIN programs     p  ON p.id  = pd.program_id
       WHERE pe.id = program_exercise_sets.program_exercise_id
         AND p.organization_id = public.user_organization_id()
    )
  );

CREATE POLICY "deny delete program_exercise_sets"
  ON program_exercise_sets FOR DELETE TO authenticated USING (false);


-- ----------------------------------------------------------------------------
-- §4. audit_resolve_org_id — register the new table.
--
-- Function signature unchanged → CREATE OR REPLACE without a DROP. Body
-- adds one new branch; carries forward all existing branches verbatim from
-- 20260505100100_audit_register_library.sql §1 (the canonical prior state).
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
  CASE p_table
    -- Direct: row carries organization_id.
    WHEN 'organizations' THEN
      org_id := NULLIF(p_row ->> 'id', '')::uuid;

    WHEN 'user_organization_roles', 'invitations', 'clients',
         'client_categories', 'client_tags', 'client_tag_assignments',
         'exercises', 'program_templates', 'template_weeks',
         'template_days', 'template_exercises', 'programs', 'sessions',
         'exercise_logs', 'set_logs', 'appointments', 'reports',
         'report_versions', 'vald_raw_uploads', 'vald_device_types',
         'clinical_notes', 'assessment_templates', 'assessments',
         'session_types', 'note_templates', 'client_files',
         'test_sessions', 'test_results', 'practice_test_settings',
         'practice_custom_tests', 'practice_disabled_tests',
         'test_batteries', 'client_publications',
         -- Added 2026-05-05 (exercise library polish pass, gap P0-2):
         'movement_patterns', 'exercise_tags', 'exercise_metric_units' THEN
      org_id := NULLIF(p_row ->> 'organization_id', '')::uuid;

    -- Nested within programs
    WHEN 'program_weeks' THEN
      SELECT p.organization_id INTO org_id
        FROM programs p
       WHERE p.id = NULLIF(p_row ->> 'program_id', '')::uuid;

    WHEN 'program_days' THEN
      -- Post D-PROG-001: program_days carries program_id directly.
      SELECT p.organization_id INTO org_id
        FROM programs p
       WHERE p.id = NULLIF(p_row ->> 'program_id', '')::uuid;

    WHEN 'program_exercises' THEN
      -- Post D-PROG-001: walk via pd.program_id (one hop).
      SELECT p.organization_id INTO org_id
        FROM program_days pd
        JOIN programs p ON p.id = pd.program_id
       WHERE pd.id = NULLIF(p_row ->> 'program_day_id', '')::uuid;

    -- Added 2026-05-07 (session-builder polish pass, Phase C):
    -- Three-hop walk via program_exercises → program_days → programs.
    WHEN 'program_exercise_sets' THEN
      SELECT p.organization_id INTO org_id
        FROM program_exercises pe
        JOIN program_days       pd ON pd.id = pe.program_day_id
        JOIN programs           p  ON p.id  = pd.program_id
       WHERE pe.id = NULLIF(p_row ->> 'program_exercise_id', '')::uuid;

    -- Nested within exercises (added 2026-05-05).
    -- Composite PK (exercise_id, tag_id); no audit trigger attached
    -- but registered defensively per the testing-module convention.
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

COMMENT ON FUNCTION public.audit_resolve_org_id(text, jsonb) IS
  'Resolves organization_id for audit log writes. Direct lookup for tables that carry the column; parent walk for nested tables. Updated 2026-05-07 (session-builder Phase C) to register program_exercise_sets via three-hop walk through program_exercises.';

REVOKE EXECUTE ON FUNCTION public.audit_resolve_org_id(text, jsonb) FROM PUBLIC;


-- ----------------------------------------------------------------------------
-- §5. Attach the audit trigger.
-- ----------------------------------------------------------------------------
CREATE TRIGGER audit_program_exercise_sets
  AFTER INSERT OR UPDATE OR DELETE ON program_exercise_sets
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();


-- ----------------------------------------------------------------------------
-- §6. soft_delete_program_exercise_set RPC.
--
-- Required because direct UPDATE setting deleted_at fails 42501 under FORCE
-- RLS — see memory/project_postgrest_soft_delete_rls.md and the inline note
-- in 20260429120000_soft_delete_rpcs.sql §0. SECURITY DEFINER bypasses RLS
-- for the UPDATE; the auth check inside replicates the org gate via the
-- three-hop parent walk.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_program_exercise_set(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner', 'staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE program_exercise_sets pes
     SET deleted_at = now()
   WHERE pes.id = p_id
     AND pes.deleted_at IS NULL
     AND EXISTS (
       SELECT 1
         FROM program_exercises pe
         JOIN program_days       pd ON pd.id = pe.program_day_id
         JOIN programs           p  ON p.id  = pd.program_id
        WHERE pe.id = pes.program_exercise_id
          AND pe.deleted_at IS NULL
          AND p.organization_id = caller_org
          AND p.deleted_at IS NULL
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'program_exercise_set % not found in your organization, or already removed', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_program_exercise_set(uuid) IS
  'Soft-delete a single program_exercise_set. Three-hop org walk via program_exercises → program_days → programs (mirrors soft_delete_program_exercise post-D-PROG-001 plus one extra hop). Bypasses the deleted_at-IS-NULL SELECT-policy trap via SECURITY DEFINER.';

REVOKE EXECUTE ON FUNCTION public.soft_delete_program_exercise_set(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.soft_delete_program_exercise_set(uuid) TO authenticated;
