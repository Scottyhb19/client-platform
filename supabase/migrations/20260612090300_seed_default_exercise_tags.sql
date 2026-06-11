-- ============================================================================
-- 20260612090300_seed_default_exercise_tags
-- ============================================================================
-- Why: Exercise library re-audit pass, gap G-10 / Q-D sign-off (operator,
-- 2026-06-12) in /docs/polish/exercise-library.md. Brief §6.6 names the
-- default tag set (DGR, PRI, Plyometrics, Rehab, Prehab) and the
-- exercise_tags table comment has promised "seeded on signup" since
-- 20260420101400 — but seed_organization_defaults() never seeded them, so
-- a new org starts with the tag chips and the form's Tags section
-- invisible (both render nothing when the list is empty).
--
-- Two parts:
--   §1 CREATE OR REPLACE seed_organization_defaults — body reproduced
--      VERBATIM from the latest canonical version (20260423100000 — NOT
--      the original 20260420102400; per the audit-resolver incidents,
--      monolithic function replacements must start from the newest body)
--      plus the exercise_tags block.
--   §2 Backfill — ONLY organizations with zero active tags. The operator
--      org has a curated live set (DGR, PRI, Single leg, Deep Tier
--      Plyometrics, Reactive Plyometrics — preflight 2026-06-12) that
--      deliberately differs from the brief's five; Settings owns the list
--      and a seed must never inject rows into a curated one.
--
-- The backfill INSERT fires the exercise_tags audit trigger; the resolver
-- has covered exercise_tags since 20260505100100, and migration-context
-- writes with a NULL actor have precedent (20260507100200 backfill).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. seed_organization_defaults with the exercise-tags block.
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

  -- Exercise tags (brief §6.6) — NEW as of 20260612090300. Starter set
  -- only; the EP owns the list in Settings from first login.
  INSERT INTO exercise_tags (organization_id, name, sort_order) VALUES
    (p_org_id, 'DGR',         10),
    (p_org_id, 'PRI',         20),
    (p_org_id, 'Plyometrics', 30),
    (p_org_id, 'Rehab',       40),
    (p_org_id, 'Prehab',      50);

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

  -- Session types (appointment categories) — as of 20260423100000
  INSERT INTO session_types (organization_id, name, color, sort_order) VALUES
    (p_org_id, 'Session',            '#1E1A18', 10),
    (p_org_id, 'Initial assessment', '#2DB24C', 20),
    (p_org_id, 'Review',             '#E8A317', 30),
    (p_org_id, 'Telehealth',         '#3B82F6', 40);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_organization_defaults(uuid) FROM PUBLIC, authenticated, anon;

COMMENT ON FUNCTION public.seed_organization_defaults(uuid) IS
  'Seeds lookup tables for a newly bootstrapped organization. 2026-06-12: now includes the brief §6.6 default exercise tags (DGR, PRI, Plyometrics, Rehab, Prehab).';


-- ----------------------------------------------------------------------------
-- §2. Backfill — orgs with zero active tags only (see header).
-- ----------------------------------------------------------------------------
INSERT INTO exercise_tags (organization_id, name, sort_order)
SELECT o.id, v.name, v.sort_order
  FROM organizations o
 CROSS JOIN (VALUES
   ('DGR',         10),
   ('PRI',         20),
   ('Plyometrics', 30),
   ('Rehab',       40),
   ('Prehab',      50)
 ) AS v(name, sort_order)
 WHERE NOT EXISTS (
   SELECT 1
     FROM exercise_tags t
    WHERE t.organization_id = o.id
      AND t.deleted_at IS NULL
 );
