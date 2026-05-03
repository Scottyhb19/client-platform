-- ============================================================================
-- 20260503100000_program_days_scheduled_date
-- ============================================================================
-- Why: Phase A of the programs polish pass. Decisions D-PROG-001 and
-- D-PROG-003 in /docs/decisions.md.
--
-- Switch program_days from a week-relative addressing scheme to a
-- date-authoritative one. Required for the new month-view calendar UX
-- and the day-level copy / repeat operations landing in Phases B–D.
--
-- What changes on program_days:
--   + scheduled_date date NOT NULL — the authoritative scheduling field
--   + program_id     uuid NOT NULL — denormalised; lets RLS / audit /
--                                    cross-org checks walk one hop
--                                    instead of two and survives a NULL
--                                    program_week_id
--   ~ program_week_id becomes nullable, FK relaxed to ON DELETE SET NULL.
--                                    Periodisation grouping is now
--                                    optional (D-PROG-003).
--   - day_of_week    dropped — display name derives from scheduled_date
--                              at render time.
--
-- Downstream updates landed in this same migration so the DB never sits
-- in an inconsistent intermediate state:
--   - enforce_program_exercise_same_org() — walks via pd.program_id
--   - audit_resolve_org_id() — direct lookup for program_days,
--                              one-hop walk for program_exercises
--   - RLS policies on program_days and program_exercises — same shape,
--                              shorter joins via the direct FK
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. Add the new columns nullable so backfill can run.
-- ----------------------------------------------------------------------------
ALTER TABLE program_days
  ADD COLUMN IF NOT EXISTS scheduled_date date,
  ADD COLUMN IF NOT EXISTS program_id     uuid;


-- ----------------------------------------------------------------------------
-- §2. Backfill program_id from the existing program_weeks → programs walk.
-- Every existing program_day has a non-null program_week_id (the column
-- was originally NOT NULL), so this update covers all rows.
-- ----------------------------------------------------------------------------
UPDATE program_days pd
   SET program_id = pw.program_id
  FROM program_weeks pw
 WHERE pd.program_week_id = pw.id
   AND pd.program_id IS NULL;


-- ----------------------------------------------------------------------------
-- §3. Backfill scheduled_date from start_date + week_number + day_of_week.
--
-- Postgres extract(dow from <date>) returns Sun=0..Sat=6. The legacy
-- day_of_week column on program_days uses Mon=0..Sun=6 (per the original
-- migration's comment). The mapping that gives the correct date is:
--
--   target_date = program.start_date
--               + (week_number - 1) * 7
--               + day_of_week              -- Mon=0 → 0 days from Mon
--
-- The original UI rendered weeks Mon-first and read program.start_date
-- as the Monday of week 1, so adding day_of_week directly works. Days
-- with a NULL day_of_week (un-scheduled placeholders) get NULL here and
-- are filtered out of the NOT NULL set below — but the original schema's
-- application code always sets day_of_week, so the practical result is
-- "every existing row gets backfilled".
-- ----------------------------------------------------------------------------
UPDATE program_days pd
   SET scheduled_date = (p.start_date + ((pw.week_number - 1) * 7 + pd.day_of_week)::int)::date
  FROM program_weeks pw
  JOIN programs p ON p.id = pw.program_id
 WHERE pd.program_week_id = pw.id
   AND pd.scheduled_date IS NULL
   AND pd.day_of_week IS NOT NULL
   AND p.start_date IS NOT NULL;


-- ----------------------------------------------------------------------------
-- §4. Any rows that couldn't be backfilled (NULL day_of_week or NULL
-- program.start_date) are dropped pre-launch. There is no production
-- data; these would only be seed-data placeholders that no longer fit
-- the new model. Soft-delete them so the audit log records the removal.
-- ----------------------------------------------------------------------------
UPDATE program_days
   SET deleted_at = now()
 WHERE scheduled_date IS NULL
   AND deleted_at IS NULL;


-- ----------------------------------------------------------------------------
-- §5. Lock the new columns down. SET NOT NULL applies only to live rows;
-- soft-deleted rows above already had NULL scheduled_date but they're
-- soft-deleted so the constraint check on existing data passes provided
-- we set NOT NULL after the soft-delete.
-- ----------------------------------------------------------------------------
-- One small wrinkle: SET NOT NULL is a hard constraint that ignores
-- deleted_at. Verify all live (non-soft-deleted) rows have values, then
-- set the constraint. The soft-deleted rows kept their NULLs, which
-- would block SET NOT NULL — so we backfill those defensively too,
-- using a sentinel program_id (NULL is impossible by §2's coverage,
-- but for scheduled_date on soft-deleted rows we use program.start_date
-- as a placeholder; the row is soft-deleted so the value is never read).
-- ----------------------------------------------------------------------------
UPDATE program_days pd
   SET scheduled_date = COALESCE(p.start_date, '1970-01-01'::date)
  FROM program_weeks pw
  JOIN programs p ON p.id = pw.program_id
 WHERE pd.program_week_id = pw.id
   AND pd.scheduled_date IS NULL;

-- Final fallback for any remaining NULLs (program_week_id was NULL — not
-- possible in current schema but defensive): use epoch sentinel.
UPDATE program_days
   SET scheduled_date = '1970-01-01'::date
 WHERE scheduled_date IS NULL;

ALTER TABLE program_days
  ALTER COLUMN scheduled_date SET NOT NULL,
  ALTER COLUMN program_id     SET NOT NULL;


-- ----------------------------------------------------------------------------
-- §6. FK on the new program_id column. CASCADE because program_days
-- belong to their program — deleting the program removes them too.
-- ----------------------------------------------------------------------------
ALTER TABLE program_days
  ADD CONSTRAINT program_days_program_id_fkey
  FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE;


-- ----------------------------------------------------------------------------
-- §7. Calendar's bread-and-butter index: lookup by program + date range.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS program_days_program_date_idx
  ON program_days (program_id, scheduled_date)
  WHERE deleted_at IS NULL;


-- ----------------------------------------------------------------------------
-- §8. Update the cross-org enforcement trigger function.
-- Walk one hop (program_days → programs) instead of two
-- (program_days → program_weeks → programs). The trigger itself stays
-- attached; only the function body changes.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_program_exercise_same_org()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  program_org_id   uuid;
  exercise_org_id  uuid;
BEGIN
  SELECT p.organization_id
    INTO program_org_id
    FROM program_days pd
    JOIN programs p ON p.id = pd.program_id
   WHERE pd.id = NEW.program_day_id;

  SELECT organization_id
    INTO exercise_org_id
    FROM exercises
   WHERE id = NEW.exercise_id;

  IF program_org_id IS NULL OR exercise_org_id IS NULL THEN
    RAISE EXCEPTION 'program_exercises parent lookup failed (day %, exercise %)',
      NEW.program_day_id, NEW.exercise_id;
  END IF;

  IF program_org_id IS DISTINCT FROM exercise_org_id THEN
    RAISE EXCEPTION 'Cross-org: program in org % cannot reference exercise in org %',
      program_org_id, exercise_org_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_program_exercise_same_org() IS
  'BEFORE INSERT/UPDATE trigger: walks program_exercises → program_days → programs (via direct program_id) to resolve org, and compares with exercises.organization_id. Updated 2026-05-03 to use the denormalised program_days.program_id (D-PROG-001).';


-- ----------------------------------------------------------------------------
-- §9. Update audit_resolve_org_id() — direct lookup for program_days,
-- one-hop walk for program_exercises. Function signature is unchanged
-- so no DROP needed (per project memory: only DROP+CREATE when signature
-- itself changes; CREATE OR REPLACE for body-only edits).
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
         'test_batteries', 'client_publications' THEN
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

    ELSE
      RAISE EXCEPTION 'audit_resolve_org_id: unknown audited table %', p_table;
  END CASE;

  RETURN org_id;
END;
$$;

COMMENT ON FUNCTION public.audit_resolve_org_id(text, jsonb) IS
  'Resolves organization_id for audit log writes. Direct lookup for tables that carry the column; parent walk for nested tables. Updated 2026-05-03 (D-PROG-001) to use program_days.program_id directly for both program_days and program_exercises branches.';


-- ----------------------------------------------------------------------------
-- §10. Replace RLS policies on program_days. Same security shape (staff
-- of the program's org get full access, clients see active/archived
-- programs they own); the join now goes one hop via the direct FK
-- instead of through program_weeks.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "select program_days via parent"        ON program_days;
DROP POLICY IF EXISTS "staff insert program_days via parent"  ON program_days;
DROP POLICY IF EXISTS "staff update program_days via parent"  ON program_days;

CREATE POLICY "select program_days via parent"
  ON program_days FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM programs p
       WHERE p.id = program_days.program_id
         AND p.organization_id = public.user_organization_id()
         AND p.deleted_at IS NULL
         AND (
           public.user_role() IN ('owner','staff')
           OR (
             public.user_role() = 'client'
             AND p.status IN ('active','archived')
             AND p.client_id IN (SELECT id FROM clients WHERE user_id = auth.uid() AND deleted_at IS NULL)
           )
         )
    )
  );

CREATE POLICY "staff insert program_days via parent"
  ON program_days FOR INSERT TO authenticated
  WITH CHECK (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM programs p
       WHERE p.id = program_days.program_id
         AND p.organization_id = public.user_organization_id()
    )
  );

CREATE POLICY "staff update program_days via parent"
  ON program_days FOR UPDATE TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM programs p
       WHERE p.id = program_days.program_id
         AND p.organization_id = public.user_organization_id()
    )
  );


-- ----------------------------------------------------------------------------
-- §11. Replace RLS policies on program_exercises. The walk shortens
-- from program_exercises → program_days → program_weeks → programs to
-- program_exercises → program_days → programs.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "select program_exercises via parent"        ON program_exercises;
DROP POLICY IF EXISTS "staff insert program_exercises via parent"  ON program_exercises;
DROP POLICY IF EXISTS "staff update program_exercises via parent"  ON program_exercises;

CREATE POLICY "select program_exercises via parent"
  ON program_exercises FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM program_days pd
        JOIN programs p ON p.id = pd.program_id
       WHERE pd.id = program_exercises.program_day_id
         AND p.organization_id = public.user_organization_id()
         AND p.deleted_at IS NULL
         AND (
           public.user_role() IN ('owner','staff')
           OR (
             public.user_role() = 'client'
             AND p.status IN ('active','archived')
             AND p.client_id IN (SELECT id FROM clients WHERE user_id = auth.uid() AND deleted_at IS NULL)
           )
         )
    )
  );

CREATE POLICY "staff insert program_exercises via parent"
  ON program_exercises FOR INSERT TO authenticated
  WITH CHECK (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM program_days pd
        JOIN programs p ON p.id = pd.program_id
       WHERE pd.id = program_exercises.program_day_id
         AND p.organization_id = public.user_organization_id()
    )
  );

CREATE POLICY "staff update program_exercises via parent"
  ON program_exercises FOR UPDATE TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM program_days pd
        JOIN programs p ON p.id = pd.program_id
       WHERE pd.id = program_exercises.program_day_id
         AND p.organization_id = public.user_organization_id()
    )
  );


-- ----------------------------------------------------------------------------
-- §12. Relax program_week_id: nullable + ON DELETE SET NULL.
-- Periodisation grouping is now optional (D-PROG-003); deleting a week
-- leaves its days intact.
-- ----------------------------------------------------------------------------
ALTER TABLE program_days
  DROP CONSTRAINT IF EXISTS program_days_program_week_id_fkey;

ALTER TABLE program_days
  ALTER COLUMN program_week_id DROP NOT NULL;

ALTER TABLE program_days
  ADD CONSTRAINT program_days_program_week_id_fkey
  FOREIGN KEY (program_week_id) REFERENCES program_weeks(id) ON DELETE SET NULL;


-- ----------------------------------------------------------------------------
-- §13. Drop the day_of_week index (depends on the column) and the
-- column itself. Postgres drops the column's CHECK constraint with the
-- column.
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS program_days_dow_idx;

ALTER TABLE program_days
  DROP COLUMN IF EXISTS day_of_week;


-- ----------------------------------------------------------------------------
-- §14. Documentation refresh on the table and the new columns.
-- ----------------------------------------------------------------------------
COMMENT ON COLUMN program_days.scheduled_date IS
  'Authoritative date this day is scheduled for. Display weekday derives at render time. Added 2026-05-03 (D-PROG-001).';
COMMENT ON COLUMN program_days.program_id IS
  'Denormalised parent FK. Lets RLS / audit / cross-org checks resolve org via a one-hop walk and survives a NULL program_week_id. Added 2026-05-03 (D-PROG-001).';
COMMENT ON COLUMN program_days.program_week_id IS
  'Optional periodisation grouping. Days created via copy / repeat default to NULL. Relaxed 2026-05-03 (D-PROG-003).';
