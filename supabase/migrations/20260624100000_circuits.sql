-- ============================================================================
-- 20260624100000_circuits
-- ============================================================================
-- Why: C-1 of the Library Circuits/Sessions pass
-- (docs/polish/library-circuits-sessions.md). A circuit is a reusable named
-- exercise group (warm-up / finisher / superset / tri-set) carrying its own
-- prescriptions, dropped into a session by name (C-2 insert RPC, copy-on-apply).
--
-- Owner-directed extension beyond brief v2.1 (the brief specs Exercise Library +
-- Program Templates, is silent on circuits) — gap doc §1, approved 2026-06-23.
--
-- Mirrors the program_exercises / program_exercise_sets SHAPE (scalar per-exercise
-- prescription + a per-set child) so a circuit copies into a program day 1:1.
-- Per-set child is mandatory, NOT optional: without it a pyramid (12/10/8) would
-- collapse to a scalar "3 × 12" on save→insert — the exact silent clinical data
-- loss that template_exercise_sets (G-1, 20260612120000) was added to prevent.
-- rep_metric (the volume axis, 20260623100000) lives at the SET level, matching
-- program_exercise_sets — NOT on the exercise row.
--
-- "Template library, not a patient record" (schema.md §11.2), same as
-- program_templates: intentionally NOT audited — no audit trigger, no
-- audit_resolve_org_id branch.
--
-- Tables: circuits (direct org-scoped, mirrors program_templates) →
-- circuit_exercises (via-parent RLS) → circuit_exercise_sets (via-parent RLS).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- circuits  (mirrors program_templates: direct org-scoped)
-- ----------------------------------------------------------------------------
CREATE TABLE circuits (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid          NOT NULL REFERENCES organizations(id)  ON DELETE RESTRICT,
  created_by_user_id  uuid          REFERENCES user_profiles(user_id)      ON DELETE SET NULL,
  name                text          NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  circuit_type        text          NOT NULL DEFAULT 'circuit'
                        CHECK (circuit_type IN ('superset','triset','circuit','finisher','warmup')),
  notes               text          CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

CREATE INDEX circuits_org_idx
  ON circuits (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX circuits_org_name_idx
  ON circuits (organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE TRIGGER circuits_touch_updated_at
  BEFORE UPDATE ON circuits
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE circuits IS
  'Reusable named exercise group (superset/triset/circuit/finisher/warmup) carrying its own prescriptions. Copied into a program day on insert; edits here do NOT propagate to already-placed instances. Template library, not a patient record — intentionally not audited (schema.md §11.2).';

-- ----------------------------------------------------------------------------
-- circuit_exercises  (mirrors program_exercises' scalar prescription columns)
-- ----------------------------------------------------------------------------
CREATE TABLE circuit_exercises (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  circuit_id          uuid          NOT NULL REFERENCES circuits(id)    ON DELETE CASCADE,
  exercise_id         uuid          NOT NULL REFERENCES exercises(id)   ON DELETE RESTRICT,
  sort_order          int           NOT NULL DEFAULT 0,
  -- Scalar prescription; NULL falls back to exercise defaults at time-of-use.
  -- Per-set detail (incl. rep_metric) lives in circuit_exercise_sets below.
  sets                smallint      CHECK (sets IS NULL OR sets BETWEEN 1 AND 50),
  reps                text          CHECK (reps IS NULL OR length(trim(reps)) BETWEEN 1 AND 40),
  rest_seconds        int           CHECK (rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 3600),
  rpe                 smallint      CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  optional_metric     text,
  optional_value      text,
  tempo               text          CHECK (tempo IS NULL OR tempo ~ '^[0-9x]{4}$'),
  instructions        text,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

CREATE INDEX circuit_exercises_circuit_idx
  ON circuit_exercises (circuit_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE TRIGGER circuit_exercises_touch_updated_at
  BEFORE UPDATE ON circuit_exercises
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- circuit_exercise_sets  (mirrors program_exercise_sets: per-set detail)
-- ----------------------------------------------------------------------------
CREATE TABLE circuit_exercise_sets (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  circuit_exercise_id uuid          NOT NULL REFERENCES circuit_exercises(id) ON DELETE CASCADE,
  set_number          smallint      NOT NULL CHECK (set_number BETWEEN 1 AND 50),
  reps                text          CHECK (reps IS NULL OR length(trim(reps)) BETWEEN 1 AND 40),
  rep_metric          text          CHECK (rep_metric IS NULL OR rep_metric IN
                          ('time_minsec','distance_m','distance_km','distance_miles')),
  optional_metric     text,         -- load axis: kg / lb / percentage / ...
  optional_value      text,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  UNIQUE (circuit_exercise_id, set_number)
);

CREATE INDEX circuit_exercise_sets_parent_idx
  ON circuit_exercise_sets (circuit_exercise_id, set_number)
  WHERE deleted_at IS NULL;

CREATE TRIGGER circuit_exercise_sets_touch_updated_at
  BEFORE UPDATE ON circuit_exercise_sets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Cross-org integrity: an exercise added to a circuit must belong to the same
-- org as the circuit. Mirrors template_exercises' enforce-exercise-org trigger.
-- RLS already blocks inserting under another org's circuit and hides other orgs'
-- exercises on read — but without this a raw-PostgREST staffer could plant a
-- dangling cross-org exercise_id that a SECURITY DEFINER copy RPC (C-2) would
-- later resolve. SECURITY DEFINER so it reads the true org regardless of RLS
-- visibility; anon EXECUTE revoked (trigger-only, but the default-grant trap).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.circuit_exercise_enforce_exercise_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_circuit_org  uuid;
  v_exercise_org uuid;
BEGIN
  SELECT organization_id INTO v_circuit_org  FROM circuits  WHERE id = NEW.circuit_id;
  SELECT organization_id INTO v_exercise_org FROM exercises WHERE id = NEW.exercise_id;

  IF v_circuit_org IS NULL THEN
    RAISE EXCEPTION 'Circuit % not found', NEW.circuit_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_exercise_org IS DISTINCT FROM v_circuit_org THEN
    RAISE EXCEPTION 'Exercise % is not in the circuit''s organization', NEW.exercise_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.circuit_exercise_enforce_exercise_org() FROM anon;

CREATE TRIGGER circuit_exercise_enforce_exercise_org
  BEFORE INSERT OR UPDATE ON circuit_exercises
  FOR EACH ROW EXECUTE FUNCTION public.circuit_exercise_enforce_exercise_org();

-- ----------------------------------------------------------------------------
-- RLS — circuits direct org-scoped (mirrors program_templates)
-- ----------------------------------------------------------------------------
ALTER TABLE circuits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff select circuits in own org"
  ON circuits FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND deleted_at IS NULL
         AND public.user_role() IN ('owner','staff'));

CREATE POLICY "staff insert circuits in own org"
  ON circuits FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff'));

CREATE POLICY "staff update circuits in own org"
  ON circuits FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'))
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "deny delete circuits"
  ON circuits FOR DELETE TO authenticated USING (false);

-- ----------------------------------------------------------------------------
-- RLS — circuit_exercises via parent (Pattern C, mirrors template_exercises)
-- ----------------------------------------------------------------------------
ALTER TABLE circuit_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff select circuit_exercises via parent"
  ON circuit_exercises FOR SELECT TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM circuits c
       WHERE c.id = circuit_exercises.circuit_id
         AND c.organization_id = public.user_organization_id()
         AND c.deleted_at IS NULL
    )
  );

CREATE POLICY "staff insert circuit_exercises via parent"
  ON circuit_exercises FOR INSERT TO authenticated
  WITH CHECK (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM circuits c
       WHERE c.id = circuit_exercises.circuit_id
         AND c.organization_id = public.user_organization_id()
    )
  );

CREATE POLICY "staff update circuit_exercises via parent"
  ON circuit_exercises FOR UPDATE TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM circuits c
       WHERE c.id = circuit_exercises.circuit_id
         AND c.organization_id = public.user_organization_id()
    )
  );

CREATE POLICY "deny delete circuit_exercises"
  ON circuit_exercises FOR DELETE TO authenticated USING (false);

-- ----------------------------------------------------------------------------
-- RLS — circuit_exercise_sets via grandparent walk (Pattern C)
-- ----------------------------------------------------------------------------
ALTER TABLE circuit_exercise_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff select circuit_exercise_sets via parent"
  ON circuit_exercise_sets FOR SELECT TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM circuit_exercises ce
        JOIN circuits c ON c.id = ce.circuit_id
       WHERE ce.id = circuit_exercise_sets.circuit_exercise_id
         AND c.organization_id = public.user_organization_id()
         AND c.deleted_at IS NULL
    )
  );

CREATE POLICY "staff insert circuit_exercise_sets via parent"
  ON circuit_exercise_sets FOR INSERT TO authenticated
  WITH CHECK (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM circuit_exercises ce
        JOIN circuits c ON c.id = ce.circuit_id
       WHERE ce.id = circuit_exercise_sets.circuit_exercise_id
         AND c.organization_id = public.user_organization_id()
    )
  );

CREATE POLICY "staff update circuit_exercise_sets via parent"
  ON circuit_exercise_sets FOR UPDATE TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM circuit_exercises ce
        JOIN circuits c ON c.id = ce.circuit_id
       WHERE ce.id = circuit_exercise_sets.circuit_exercise_id
         AND c.organization_id = public.user_organization_id()
    )
  );

CREATE POLICY "deny delete circuit_exercise_sets"
  ON circuit_exercise_sets FOR DELETE TO authenticated USING (false);
