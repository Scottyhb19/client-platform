-- ============================================================================
-- 20260423100000_session_types
-- ============================================================================
-- Why: Tenant-configurable appointment category taxonomy. Previously the
-- column `appointments.appointment_type` was a free-text field with a hard
-- check constraint allowing only 4 values ('Session', 'Initial assessment',
-- 'Review', 'Telehealth'). The EP wants to add/delete types and choose a
-- display colour per type from a Settings screen.
--
-- This migration:
--   1. Creates a `session_types` lookup table (name, color, sort_order) scoped
--      per organization with case-insensitive unique names.
--   2. Drops the hard check constraint on appointments.appointment_type so
--      the text field is constrained only by what the app writes (a
--      session_types.name owned by the caller's org).
--   3. Seeds the four previous defaults for every existing organization.
--   4. Updates seed_organization_defaults() so future orgs pick them up.
--
-- appointment_type on appointments stays as `text` (not a FK) — matches the
-- existing convention (see client_categories / section_titles). If a type
-- is renamed, existing rows keep the old label until backfilled.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table + indexes
-- ----------------------------------------------------------------------------
CREATE TABLE session_types (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name             text         NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  color            text         NOT NULL CHECK (color ~* '^#[0-9a-f]{6}$'),
  sort_order       int          NOT NULL DEFAULT 0,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

-- Case-insensitive uniqueness within an organization (only among live rows).
CREATE UNIQUE INDEX session_types_org_name_unique
  ON session_types (organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX session_types_org_idx
  ON session_types (organization_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE TRIGGER session_types_touch_updated_at
  BEFORE UPDATE ON session_types
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE session_types IS
  'Tenant-configurable appointment type taxonomy (name + display colour). Replaces the previous appointment_type check constraint.';


-- ----------------------------------------------------------------------------
-- RLS — match the client_categories pattern
-- ----------------------------------------------------------------------------
ALTER TABLE session_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff select session_types in own org"
  ON session_types FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND deleted_at IS NULL
         AND public.user_role() IN ('owner','staff'));

CREATE POLICY "staff insert session_types in own org"
  ON session_types FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff'));

CREATE POLICY "staff update session_types in own org"
  ON session_types FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'))
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "staff delete session_types in own org"
  ON session_types FOR DELETE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'));


-- ----------------------------------------------------------------------------
-- Drop the hard appointment_type check. The app is responsible for writing
-- a value that exists in session_types for the caller's org.
-- ----------------------------------------------------------------------------
ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_appointment_type_check;


-- ----------------------------------------------------------------------------
-- Seed the four defaults for every existing organization.
-- ----------------------------------------------------------------------------
INSERT INTO session_types (organization_id, name, color, sort_order)
SELECT o.id, v.name, v.color, v.sort_order
FROM organizations o
CROSS JOIN (VALUES
  ('Session',            '#1E1A18', 10),
  ('Initial assessment', '#2DB24C', 20),
  ('Review',             '#E8A317', 30),
  ('Telehealth',         '#3B82F6', 40)
) AS v(name, color, sort_order)
ON CONFLICT DO NOTHING;


-- ----------------------------------------------------------------------------
-- Future-proof: update the bootstrap seed so new orgs get the defaults too.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_organization_defaults(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Movement patterns (brief §6.6)
  INSERT INTO movement_patterns (organization_id, name, sort_order) VALUES
    (p_org_id, 'Push',      10),
    (p_org_id, 'Pull',      20),
    (p_org_id, 'Squat',     30),
    (p_org_id, 'Hinge',     40),
    (p_org_id, 'Carry',     50),
    (p_org_id, 'Core',      60),
    (p_org_id, 'Isometric', 70);

  -- Section titles (brief §6.5.1)
  INSERT INTO section_titles (organization_id, name, sort_order) VALUES
    (p_org_id, 'Mobility',              10),
    (p_org_id, 'Movement Restoration',  20),
    (p_org_id, 'Plyometrics',           30),
    (p_org_id, 'Power',                 40),
    (p_org_id, 'Strength',              50),
    (p_org_id, 'Hypertrophy',           60),
    (p_org_id, 'Conditioning',          70),
    (p_org_id, 'On-Field Conditioning', 80),
    (p_org_id, 'Technique Work',        90),
    (p_org_id, 'Recovery',             100);

  -- Exercise metric units (brief §6.5.3)
  INSERT INTO exercise_metric_units (organization_id, code, display_label, category, sort_order) VALUES
    (p_org_id, 'kg',              'kg',            'weight',     10),
    (p_org_id, 'time_minsec',     'time (min:sec)', 'time',      20),
    (p_org_id, 'distance_m',      'distance (m)',  'distance',   30),
    (p_org_id, 'percentage',      'percentage',    'ratio',      40),
    (p_org_id, 'rpe',             'RPE (1-10)',    'rpe',        50),
    (p_org_id, 'tempo',           'tempo',         'tempo',      60),
    (p_org_id, 'bodyweight',      'bodyweight',    'bodyweight', 70),
    (p_org_id, 'lb',              'lb',            'weight',     80),
    (p_org_id, 'distance_miles',  'distance (mi)', 'distance',   90),
    (p_org_id, 'distance_km',     'distance (km)', 'distance',  100);

  -- Client categories (brief §6.8.5)
  INSERT INTO client_categories (organization_id, name, sort_order) VALUES
    (p_org_id, 'Athlete',       10),
    (p_org_id, 'Rehab',         20),
    (p_org_id, 'Lifestyle',     30),
    (p_org_id, 'Golf',          40),
    (p_org_id, 'Osteoporosis',  50),
    (p_org_id, 'Neurological',  60);

  -- VALD device types
  INSERT INTO vald_device_types (organization_id, code, display_label, sort_order) VALUES
    (p_org_id, 'forcedecks',  'ForceDecks',  10),
    (p_org_id, 'nordbord',    'NordBord',    20),
    (p_org_id, 'forceframe',  'ForceFrame',  30),
    (p_org_id, 'dynamo',      'DynaMo',      40);

  -- Session types (appointment categories) — NEW as of 20260423100000
  INSERT INTO session_types (organization_id, name, color, sort_order) VALUES
    (p_org_id, 'Session',            '#1E1A18', 10),
    (p_org_id, 'Initial assessment', '#2DB24C', 20),
    (p_org_id, 'Review',             '#E8A317', 30),
    (p_org_id, 'Telehealth',         '#3B82F6', 40);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_organization_defaults(uuid) FROM PUBLIC, authenticated, anon;
