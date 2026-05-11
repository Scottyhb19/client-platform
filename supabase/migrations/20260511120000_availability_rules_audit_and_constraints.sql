-- ============================================================================
-- 20260511120000_availability_rules_audit_and_constraints
-- ============================================================================
-- Why: Make availability_rules safe to author from a UI for the first time.
-- Four problems land together because they share a common purpose
-- ("editor-grade hygiene") and roll back as one unit:
--
--   1. Audit gap (A0). availability_rules has no audit trigger and is
--      missing from audit_resolve_org_id's CASE list. Today writes
--      succeed (no trigger to fail), but every change to who-can-be-
--      booked-when goes unrecorded — Privacy Act 1988 healthcare
--      audit-trail hole. Fix: attach the trigger AND register the table
--      in audit_resolve_org_id (both must happen — registering without
--      a trigger is a no-op; attaching without registering aborts every
--      write with 'unknown audited table availability_rules', exactly
--      the bug 20260428110000 fixed for client_files).
--
--   2. UNIQUE-rule guard (A1). Without a constraint, a double-click on
--      Save in the upcoming editor produces two identical rows. Adds a
--      partial UNIQUE index on the natural key
--      (organization_id, staff_user_id, recurrence, day_of_week,
--      specific_date, start_time, end_time) WHERE deleted_at IS NULL.
--      NULLs in day_of_week and specific_date compose because the
--      availability_recurrence_fields CHECK already guarantees exactly
--      one is non-NULL per row.
--
--   3. Slot dedup (A2). client_available_slots UNION ALLs a per-rule
--      slot stream then SELECTs without DISTINCT. Two non-identical
--      overlapping rules (e.g., recurring 8am-5pm Mon + a one-off
--      "extra clinic" 10am-11am Mon) currently produce duplicate slot
--      rows in the picker. Adds DISTINCT — body-only change, signature
--      stays identical, no client-side update.
--
--   4. Per-staff RLS tightening (A4). Multi-practitioner readiness.
--      Existing policies let any staff member modify any rule in the
--      org — so when a second practitioner joins, they could overwrite
--      the owner's hours. Tighten INSERT/UPDATE/DELETE to:
--          owner: any rule in own org
--          staff: only rows where staff_user_id = auth.uid()
--      SELECT stays open within the org — colleagues seeing each
--      other's working hours is benign.
--
-- Sign-off: docs/polish/availability-editor.md §0.1 (locked 2026-05-11).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Audit trigger
-- ----------------------------------------------------------------------------
CREATE TRIGGER audit_availability_rules
  AFTER INSERT OR UPDATE OR DELETE ON availability_rules
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();


-- ----------------------------------------------------------------------------
-- 2. Register availability_rules in audit_resolve_org_id.
-- Body extends 20260510120200 (the canonical version after the
-- "restore_nested" repair). Adds 'availability_rules' to the direct-org
-- WHEN list. Everything else verbatim — plpgsql has no "patch a single
-- branch" mechanism so the function has to be replaced as a whole.
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
         -- Added 2026-05-11 alongside attaching audit_availability_rules.
         'availability_rules'
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
    -- Nested via exercises.
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
  'Resolves organization_id for audit log writes. Direct lookup for tables that carry the column; parent walk for nested tables. 2026-05-11: added availability_rules to direct branch alongside attaching audit_availability_rules trigger.';


-- ----------------------------------------------------------------------------
-- 3. UNIQUE constraint on the rule's natural key (partial — soft-delete safe).
--
-- Index, not ADD CONSTRAINT, because partial UNIQUE constraints aren't
-- expressible via ALTER TABLE in Postgres — only as a partial UNIQUE INDEX.
-- The semantic effect is the same: a duplicate INSERT raises 23505.
--
-- The CHECK constraint availability_recurrence_fields guarantees:
--   weekly  → day_of_week NOT NULL, specific_date IS NULL
--   one_off → day_of_week IS NULL,  specific_date NOT NULL
-- so the index distinguishes them naturally without needing two indexes.
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX availability_rules_uniq
  ON availability_rules (
    organization_id, staff_user_id, recurrence,
    day_of_week, specific_date, start_time, end_time
  )
  WHERE deleted_at IS NULL;

COMMENT ON INDEX availability_rules_uniq IS
  'Prevents identical-rule duplication (e.g., double-click on Save). Partial — soft-deleted rows are excluded so an old rule can be restored without conflicting with a current one. NULLs compose with the recurrence CHECK constraint.';


-- ----------------------------------------------------------------------------
-- 4. client_available_slots — DISTINCT in the final SELECT.
--
-- Body unchanged from 20260420102500 §7 except the final SELECT clause,
-- which now reads SELECT DISTINCT. Reason: when two non-identical rules
-- generate coincident slot rows (e.g., recurring 8am-5pm Mon AND a
-- one-off "extra clinic" 10am-11am Mon both produce a 10:00am slot),
-- the picker would otherwise render two identical tiles. The UNIQUE
-- index above prevents IDENTICAL rule duplication; DISTINCT covers the
-- legitimate-overlap case.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_available_slots(
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS TABLE (
  staff_user_id   uuid,
  slot_start      timestamptz,
  slot_end        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id   uuid := auth.uid();
  caller_org  uuid;
  caller_tz   text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION 'from must precede to';
  END IF;

  IF p_to - p_from > interval '90 days' THEN
    RAISE EXCEPTION 'Range too large (max 90 days)';
  END IF;

  -- Caller's org: derive from their client row (not JWT, so this works
  -- even if the claim is briefly stale after an invite accept).
  SELECT c.organization_id, o.timezone
    INTO caller_org, caller_tz
    FROM clients c
    JOIN organizations o ON o.id = c.organization_id
   WHERE c.user_id    = caller_id
     AND c.deleted_at IS NULL
   LIMIT 1;

  IF caller_org IS NULL THEN
    RAISE EXCEPTION 'Caller has no client record';
  END IF;

  RETURN QUERY
  WITH rules AS (
    SELECT ar.*
      FROM availability_rules ar
     WHERE ar.organization_id = caller_org
       AND ar.deleted_at      IS NULL
       AND ar.effective_from <= (p_to AT TIME ZONE caller_tz)::date
       AND (ar.effective_to IS NULL OR ar.effective_to >= (p_from AT TIME ZONE caller_tz)::date)
  ),
  day_grid AS (
    SELECT generate_series(
             (p_from AT TIME ZONE caller_tz)::date,
             (p_to   AT TIME ZONE caller_tz)::date,
             interval '1 day'
           )::date AS d
  ),
  candidates AS (
    -- Weekly rules materialized over the grid.
    SELECT
      r.staff_user_id,
      ((d.d || ' ' || r.start_time)::timestamp AT TIME ZONE caller_tz) AS window_start,
      ((d.d || ' ' || r.end_time)::timestamp   AT TIME ZONE caller_tz) AS window_end,
      r.slot_duration_minutes
    FROM rules r
    JOIN day_grid d ON r.recurrence = 'weekly'
                    AND EXTRACT(ISODOW FROM d.d)::int - 1 = r.day_of_week
    WHERE d.d BETWEEN r.effective_from
                  AND COALESCE(r.effective_to, d.d)

    UNION ALL

    -- One-off rules.
    SELECT
      r.staff_user_id,
      ((r.specific_date || ' ' || r.start_time)::timestamp AT TIME ZONE caller_tz),
      ((r.specific_date || ' ' || r.end_time)::timestamp   AT TIME ZONE caller_tz),
      r.slot_duration_minutes
    FROM rules r
    WHERE r.recurrence = 'one_off'
      AND r.specific_date BETWEEN (p_from AT TIME ZONE caller_tz)::date
                              AND (p_to   AT TIME ZONE caller_tz)::date
  ),
  slots AS (
    SELECT
      c.staff_user_id,
      generate_series(
        c.window_start,
        c.window_end - (c.slot_duration_minutes * interval '1 minute'),
        (c.slot_duration_minutes * interval '1 minute')
      ) AS slot_start,
      (c.slot_duration_minutes * interval '1 minute') AS slot_len
    FROM candidates c
  )
  -- DISTINCT (2026-05-11): dedupe coincident slots produced by non-
  -- identical overlapping rules. The UNIQUE index above already
  -- prevents identical-rule duplication.
  SELECT DISTINCT
    s.staff_user_id,
    s.slot_start,
    s.slot_start + s.slot_len AS slot_end
  FROM slots s
  WHERE s.slot_start >= p_from
    AND s.slot_start +  s.slot_len <= p_to
    AND NOT EXISTS (
      SELECT 1 FROM appointments a
       WHERE a.organization_id = caller_org
         AND a.staff_user_id   = s.staff_user_id
         AND a.status          IN ('pending', 'confirmed')
         AND a.deleted_at      IS NULL
         AND tstzrange(a.start_at, a.end_at, '[)') &&
             tstzrange(s.slot_start, s.slot_start + s.slot_len, '[)')
    )
  ORDER BY s.slot_start, s.staff_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_available_slots(timestamptz, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_available_slots(timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.client_available_slots(timestamptz, timestamptz) IS
  'Computes bookable slots within the caller''s organization. Materializes weekly rules + one-off rules, subtracts existing pending/confirmed appointments. Max range 90 days. 2026-05-11: SELECT DISTINCT added so non-identical overlapping rules don''t produce duplicate slot tiles in the picker.';


-- ----------------------------------------------------------------------------
-- 5. Tighten INSERT/UPDATE/DELETE policies for multi-practitioner safety.
-- SELECT policy is unchanged — cross-staff visibility within the org is
-- benign (a colleague seeing your working hours doesn't expose PHI).
--
-- The new clause: owners can modify any rule in own org; non-owners can
-- only modify rows where staff_user_id = auth.uid(). Mirrors the
-- soft_delete_availability_rule RPC's per-staff check (20260511120100).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "staff insert availability_rules in own org" ON availability_rules;
DROP POLICY IF EXISTS "staff update availability_rules in own org" ON availability_rules;
DROP POLICY IF EXISTS "staff delete availability_rules in own org" ON availability_rules;

CREATE POLICY "insert availability_rules in own org"
  ON availability_rules FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
    AND (public.user_role() = 'owner' OR staff_user_id = auth.uid())
  );

CREATE POLICY "update availability_rules in own org"
  ON availability_rules FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
    AND (public.user_role() = 'owner' OR staff_user_id = auth.uid())
  )
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
    AND (public.user_role() = 'owner' OR staff_user_id = auth.uid())
  );

CREATE POLICY "delete availability_rules in own org"
  ON availability_rules FOR DELETE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
    AND (public.user_role() = 'owner' OR staff_user_id = auth.uid())
  );
