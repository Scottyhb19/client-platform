-- ============================================================================
-- 20260420101200_section_titles
-- ============================================================================
-- Why: Per-exercise section labels displayed in the session builder (Mobility,
-- Strength, Hypertrophy, Conditioning, ...). Tenant-configurable (brief §6.5.1).
--
-- Usage in template_exercises/program_exercises is as a text column, not as
-- an FK. Editing a section title in settings does not retroactively change
-- existing exercise cards — title text is copied at prescribe time. This
-- matches the brief's "section titles are labels, not links."
-- ============================================================================

CREATE TABLE section_titles (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name             text         NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  sort_order       int          NOT NULL DEFAULT 0,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE UNIQUE INDEX section_titles_org_name_unique
  ON section_titles (organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX section_titles_org_idx
  ON section_titles (organization_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER section_titles_touch_updated_at
  BEFORE UPDATE ON section_titles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE section_titles IS
  'Tenant-configurable per-exercise section labels. Ten defaults seeded on signup.';
