-- ============================================================================
-- 20260420101600_exercise_tag_assignments
-- ============================================================================
-- Why: Many-to-many join between exercises and exercise_tags. Pure join row
-- with no standalone lifecycle — CASCADE-deletes with either parent.
--
-- Cross-org enforcement: both parents must live in the same organization.
-- Neither side of the join carries self.organization_id, so the generic
-- enforce_same_org_fk cannot be used directly; a bespoke trigger walks
-- both parents and compares.
-- ============================================================================

CREATE TABLE exercise_tag_assignments (
  exercise_id  uuid        NOT NULL REFERENCES exercises(id)      ON DELETE CASCADE,
  tag_id       uuid        NOT NULL REFERENCES exercise_tags(id)  ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (exercise_id, tag_id)
);

-- Filter queries from either side
CREATE INDEX exercise_tag_assignments_tag_idx ON exercise_tag_assignments (tag_id);
-- exercise_id is covered by the composite PK leading column.


-- Cross-org enforcement: exercise and tag must share the same organization.
CREATE OR REPLACE FUNCTION public.enforce_exercise_tag_assignment_same_org()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  exercise_org_id uuid;
  tag_org_id      uuid;
BEGIN
  SELECT organization_id INTO exercise_org_id
    FROM exercises
   WHERE id = NEW.exercise_id;

  SELECT organization_id INTO tag_org_id
    FROM exercise_tags
   WHERE id = NEW.tag_id;

  IF exercise_org_id IS NULL OR tag_org_id IS NULL THEN
    RAISE EXCEPTION 'exercise_tag_assignments: parent lookup failed — exercise % or tag % missing',
      NEW.exercise_id, NEW.tag_id;
  END IF;

  IF exercise_org_id IS DISTINCT FROM tag_org_id THEN
    RAISE EXCEPTION 'Cross-org: exercise % in org % cannot be tagged with tag % in org %',
      NEW.exercise_id, exercise_org_id, NEW.tag_id, tag_org_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_exercise_tag_assignment_same_org() IS
  'BEFORE INSERT/UPDATE trigger on exercise_tag_assignments. Walks both parents to confirm they share an organization.';

CREATE TRIGGER exercise_tag_assignments_enforce_same_org
  BEFORE INSERT OR UPDATE ON exercise_tag_assignments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_exercise_tag_assignment_same_org();

COMMENT ON TABLE exercise_tag_assignments IS
  'Many-to-many between exercises and exercise_tags. Cross-org enforcement via bespoke trigger.';
