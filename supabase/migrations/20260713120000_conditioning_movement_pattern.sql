-- ============================================================================
-- 20260713120000_conditioning_movement_pattern
-- ============================================================================
-- Dogfooding batch 2026-07-13 (operator-approved): a 'Conditioning' movement
-- pattern for field sessions and off-feet conditioning work (bike, rower,
-- running, Airdyne, ski erg, VersaClimber, …). The existing 'Field' exercise
-- tag separates on-feet field work from off-feet conditioning within the
-- pattern; no new tag is needed.
--
-- Two parts:
--   §1 Backfill — every organization that does not already have a live
--      'Conditioning' pattern gets one, appended after its current highest
--      sort_order (the live orgs have curated pattern lists that diverge
--      from the seed defaults — Movement Restoration / Accessory /
--      Plyometrics — so a fixed sort value would collide or interleave).
--      Name-guarded, so re-running is a no-op.
--   §2 CREATE OR REPLACE seed_organization_defaults — body reproduced
--      VERBATIM from the latest canonical version (20260615150000 — NOT the
--      original 20260420102400; monolithic function replacements must start
--      from the newest body) with only the movement-patterns block changed:
--      + (p_org_id, 'Conditioning', 80).
--
-- movement_patterns is reference data (not audit-triggered per schema.md
-- §12); RLS is unaffected — the table's existing staff-within-org policies
-- cover the new row like any Settings-created pattern.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. Backfill existing organizations.
-- ----------------------------------------------------------------------------
INSERT INTO movement_patterns (organization_id, name, sort_order)
SELECT o.id,
       'Conditioning',
       COALESCE((SELECT MAX(mp.sort_order)
                 FROM movement_patterns mp
                 WHERE mp.organization_id = o.id
                   AND mp.deleted_at IS NULL), 70) + 10
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1
  FROM movement_patterns mp
  WHERE mp.organization_id = o.id
    AND lower(mp.name) = 'conditioning'
    AND mp.deleted_at IS NULL
);


-- ----------------------------------------------------------------------------
-- §2. seed_organization_defaults with 'Conditioning' in the movement-pattern
-- defaults. Body from 20260615150000; only the movement-patterns block gains
-- a row.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_organization_defaults(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Movement patterns (brief §6.6; Conditioning added 2026-07-13)
  INSERT INTO movement_patterns (organization_id, name, sort_order) VALUES
    (p_org_id, 'Push',         10),
    (p_org_id, 'Pull',         20),
    (p_org_id, 'Squat',        30),
    (p_org_id, 'Hinge',        40),
    (p_org_id, 'Carry',        50),
    (p_org_id, 'Core',         60),
    (p_org_id, 'Isometric',    70),
    (p_org_id, 'Conditioning', 80);

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

  -- Exercise tags (brief §6.6)
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

  -- Session types — appointment categories (durations P1-6, kind P1-7) plus
  -- the Unavailable / non-client-time sub-types (P1-7).
  INSERT INTO session_types (organization_id, name, color, sort_order, default_duration_minutes, kind) VALUES
    (p_org_id, 'Session',                  '#1E1A18',  10, 45, 'appointment'),
    (p_org_id, 'Initial assessment',       '#2DB24C',  20, 60, 'appointment'),
    (p_org_id, 'Review',                   '#E8A317',  30, 45, 'appointment'),
    (p_org_id, 'Telehealth',               '#3B82F6',  40, 30, 'appointment'),
    (p_org_id, 'Meeting',                  '#78716c', 100, 60, 'unavailable'),
    (p_org_id, 'Admin/paperwork',          '#78716c', 110, 60, 'unavailable'),
    (p_org_id, 'Note/reminder',            '#78716c', 120, 15, 'unavailable'),
    (p_org_id, 'Break/lunch',              '#78716c', 130, 30, 'unavailable'),
    (p_org_id, 'Travel',                   '#78716c', 140, 30, 'unavailable'),
    (p_org_id, 'Phone call',               '#78716c', 150, 15, 'unavailable'),
    (p_org_id, 'Professional development', '#78716c', 160, 60, 'unavailable'),
    (p_org_id, 'Personal/leave',           '#78716c', 170, 60, 'unavailable');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_organization_defaults(uuid) FROM PUBLIC, authenticated, anon;

COMMENT ON FUNCTION public.seed_organization_defaults(uuid) IS
  'Seeds lookup tables for a newly bootstrapped organization. 2026-07-13: Conditioning added to the default movement patterns (dogfooding batch). Section 9 (2026-06-15): session_types carry default_duration_minutes (P1-6) and kind, and the Unavailable non-client-time sub-types are seeded (P1-7).';
