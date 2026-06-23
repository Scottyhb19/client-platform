-- ============================================================================
-- 20260624130000_session_templates
-- ============================================================================
-- Why: S-1 of the Library Sessions/Programs editors pass
-- (docs/polish/library-sessions-programs.md). A SESSION template is one full
-- training day, not tied to a client: solo exercises and/or supersets, with
-- section titles, in order — i.e. a program_day minus the client. Authored in
-- the Library (the in-Library editor, S-5) or saved from a real day (S-6), then
-- dropped onto an existing client's program day, cross-client, by the
-- apply_session_to_program_day copy-on-apply RPC (S-2).
--
-- Owner-directed extension beyond brief v2.1 (the brief specs Exercise Library +
-- Program Templates, is silent on a standalone session library) — gap doc §1,
-- approved 2026-06-24. Dedicated tables (Q-4), NOT a flag on program_templates,
-- so a session never pollutes Programs queries.
--
-- Mirrors the circuits / program_exercises SHAPE (scalar per-exercise prescription
-- + a mandatory per-set child) so a session copies into a program day 1:1. Unlike
-- circuits, a session_template_exercise carries section_title + superset_group_id
-- (a session supports multiple groups + section headers, like a real day); unlike
-- circuits there is NO type enum (Q-5 — a session is just a named day).
-- rep_metric (the volume axis) lives at the SET level, matching every sibling.
--
-- "Template library, not a patient record" (schema.md §11.2), same as
-- program_templates / circuits: intentionally NOT audited.
--
-- Tables: session_templates (direct org-scoped) → session_template_exercises
-- (via-parent RLS) → session_template_exercise_sets (via-grandparent RLS).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- session_templates  (mirrors circuits / program_templates: direct org-scoped)
-- ----------------------------------------------------------------------------
CREATE TABLE session_templates (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid          NOT NULL REFERENCES organizations(id)  ON DELETE RESTRICT,
  created_by_user_id  uuid          REFERENCES user_profiles(user_id)      ON DELETE SET NULL,
  name                text          NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  notes               text          CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

CREATE INDEX session_templates_org_idx
  ON session_templates (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX session_templates_org_name_idx
  ON session_templates (organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE TRIGGER session_templates_touch_updated_at
  BEFORE UPDATE ON session_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE session_templates IS
  'Reusable single-day session template (a program_day minus the client): ordered exercises, supersets, and section titles carrying their own prescriptions. Copied into a program day on apply; edits here do NOT propagate to already-placed instances. Template library, not a patient record — intentionally not audited (schema.md §11.2).';

-- ----------------------------------------------------------------------------
-- session_template_exercises  (mirrors program_exercises: scalar prescription
-- + section_title + superset_group_id)
-- ----------------------------------------------------------------------------
CREATE TABLE session_template_exercises (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  session_template_id  uuid          NOT NULL REFERENCES session_templates(id) ON DELETE CASCADE,
  exercise_id          uuid          NOT NULL REFERENCES exercises(id)         ON DELETE RESTRICT,
  sort_order           int           NOT NULL DEFAULT 0,
  section_title        text          CHECK (section_title IS NULL OR length(trim(section_title)) BETWEEN 1 AND 60),
  superset_group_id    uuid,
  -- Scalar prescription; NULL falls back to exercise defaults at time-of-use.
  -- Per-set detail (incl. rep_metric) lives in session_template_exercise_sets.
  sets                 smallint      CHECK (sets IS NULL OR sets BETWEEN 1 AND 50),
  reps                 text          CHECK (reps IS NULL OR length(trim(reps)) BETWEEN 1 AND 40),
  rest_seconds         int           CHECK (rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 3600),
  rpe                  smallint      CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  optional_metric      text,
  optional_value       text,
  tempo                text          CHECK (tempo IS NULL OR tempo ~ '^[0-9x]{4}$'),
  instructions         text,
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);

CREATE INDEX session_template_exercises_parent_idx
  ON session_template_exercises (session_template_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE TRIGGER session_template_exercises_touch_updated_at
  BEFORE UPDATE ON session_template_exercises
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- session_template_exercise_sets  (mirrors program_exercise_sets: per-set detail)
-- ----------------------------------------------------------------------------
CREATE TABLE session_template_exercise_sets (
  id                           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  session_template_exercise_id uuid          NOT NULL REFERENCES session_template_exercises(id) ON DELETE CASCADE,
  set_number                   smallint      NOT NULL CHECK (set_number BETWEEN 1 AND 50),
  reps                         text          CHECK (reps IS NULL OR length(trim(reps)) BETWEEN 1 AND 40),
  rep_metric                   text          CHECK (rep_metric IS NULL OR rep_metric IN
                                  ('time_minsec','distance_m','distance_km','distance_miles')),
  optional_metric              text,         -- load axis: kg / lb / percentage / ...
  optional_value               text,
  created_at                   timestamptz   NOT NULL DEFAULT now(),
  updated_at                   timestamptz   NOT NULL DEFAULT now(),
  deleted_at                   timestamptz,
  UNIQUE (session_template_exercise_id, set_number)
);

CREATE INDEX session_template_exercise_sets_parent_idx
  ON session_template_exercise_sets (session_template_exercise_id, set_number)
  WHERE deleted_at IS NULL;

CREATE TRIGGER session_template_exercise_sets_touch_updated_at
  BEFORE UPDATE ON session_template_exercise_sets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Cross-org integrity: an exercise added to a session must belong to the same
-- org as the session. Mirrors circuit_exercise_enforce_exercise_org. SECURITY
-- DEFINER so it reads the true org regardless of RLS visibility; anon EXECUTE
-- revoked (trigger-only, but the default-grant trap).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.session_template_exercise_enforce_exercise_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_org  uuid;
  v_exercise_org uuid;
BEGIN
  SELECT organization_id INTO v_session_org  FROM session_templates WHERE id = NEW.session_template_id;
  SELECT organization_id INTO v_exercise_org FROM exercises        WHERE id = NEW.exercise_id;

  IF v_session_org IS NULL THEN
    RAISE EXCEPTION 'Session template % not found', NEW.session_template_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_exercise_org IS DISTINCT FROM v_session_org THEN
    RAISE EXCEPTION 'Exercise % is not in the session''s organization', NEW.exercise_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.session_template_exercise_enforce_exercise_org() FROM anon;

CREATE TRIGGER session_template_exercise_enforce_exercise_org
  BEFORE INSERT OR UPDATE ON session_template_exercises
  FOR EACH ROW EXECUTE FUNCTION public.session_template_exercise_enforce_exercise_org();

-- ----------------------------------------------------------------------------
-- RLS — session_templates direct org-scoped (mirrors circuits)
-- ----------------------------------------------------------------------------
ALTER TABLE session_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff select session_templates in own org"
  ON session_templates FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND deleted_at IS NULL
         AND public.user_role() IN ('owner','staff'));

CREATE POLICY "staff insert session_templates in own org"
  ON session_templates FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff'));

CREATE POLICY "staff update session_templates in own org"
  ON session_templates FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'))
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "deny delete session_templates"
  ON session_templates FOR DELETE TO authenticated USING (false);

-- ----------------------------------------------------------------------------
-- RLS — session_template_exercises via parent (Pattern C)
-- ----------------------------------------------------------------------------
ALTER TABLE session_template_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff select session_template_exercises via parent"
  ON session_template_exercises FOR SELECT TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM session_templates s
       WHERE s.id = session_template_exercises.session_template_id
         AND s.organization_id = public.user_organization_id()
         AND s.deleted_at IS NULL
    )
  );

CREATE POLICY "staff insert session_template_exercises via parent"
  ON session_template_exercises FOR INSERT TO authenticated
  WITH CHECK (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM session_templates s
       WHERE s.id = session_template_exercises.session_template_id
         AND s.organization_id = public.user_organization_id()
    )
  );

CREATE POLICY "staff update session_template_exercises via parent"
  ON session_template_exercises FOR UPDATE TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM session_templates s
       WHERE s.id = session_template_exercises.session_template_id
         AND s.organization_id = public.user_organization_id()
    )
  );

CREATE POLICY "deny delete session_template_exercises"
  ON session_template_exercises FOR DELETE TO authenticated USING (false);

-- ----------------------------------------------------------------------------
-- RLS — session_template_exercise_sets via grandparent walk (Pattern C)
-- ----------------------------------------------------------------------------
ALTER TABLE session_template_exercise_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff select session_template_exercise_sets via parent"
  ON session_template_exercise_sets FOR SELECT TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM session_template_exercises se
        JOIN session_templates s ON s.id = se.session_template_id
       WHERE se.id = session_template_exercise_sets.session_template_exercise_id
         AND s.organization_id = public.user_organization_id()
         AND s.deleted_at IS NULL
    )
  );

CREATE POLICY "staff insert session_template_exercise_sets via parent"
  ON session_template_exercise_sets FOR INSERT TO authenticated
  WITH CHECK (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM session_template_exercises se
        JOIN session_templates s ON s.id = se.session_template_id
       WHERE se.id = session_template_exercise_sets.session_template_exercise_id
         AND s.organization_id = public.user_organization_id()
    )
  );

CREATE POLICY "staff update session_template_exercise_sets via parent"
  ON session_template_exercise_sets FOR UPDATE TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM session_template_exercises se
        JOIN session_templates s ON s.id = se.session_template_id
       WHERE se.id = session_template_exercise_sets.session_template_exercise_id
         AND s.organization_id = public.user_organization_id()
    )
  );

CREATE POLICY "deny delete session_template_exercise_sets"
  ON session_template_exercise_sets FOR DELETE TO authenticated USING (false);
