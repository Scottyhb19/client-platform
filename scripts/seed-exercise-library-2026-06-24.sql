-- ============================================================================
-- scripts/seed-exercise-library-2026-06-24.sql
-- ============================================================================
-- One-off, idempotent seed of the operator's exercise library, transcribed
-- from the operator-provided "Odyssey — Exercise Library Seed" markdown,
-- committed alongside this script at scripts/exercise_library_seed.md
-- (provided 2026-06-24). 236 entries across the eight movement patterns.
--
-- NOT a migration. This is "The Odyssey. Platform" org's personal library
-- content, not a default every new org should inherit, so it is deliberately
-- kept out of the migration chain and out of seed_organization_defaults().
--
-- Org-scoped to "The Odyssey. Platform" (33d23c20). Re-runnable: an exercise
-- whose name already exists (active) in the org is skipped, so this never
-- creates duplicates against the 94 exercises already in the library.
--
-- Mapping rules (from the file's own legend):
--   SETSxREPS         -> default_sets + default_reps
--   third token KG    -> default_metric = 'kg' (no number; load left unset)
--   third token  -    -> bodyweight: load left empty (operator decision 2026-06-24)
--   reps token  Nm    -> reps = N, default_rep_metric = 'distance_m' (carries/sleds)
--   reps token Nsec   -> reps = N, default_rep_metric = 'time_minsec' (holds/isos)
--   (machine) marker  -> stripped from the name; filed under its movement pattern
--                        (no "Machine" tag created — operator decision 2026-06-24)
-- No videos / rest / RPE / descriptions: the file specifies none.
--
-- Two faithful-but-flagged transcriptions:
--   "Ring DipS 3X12" (no load token, irregular casing) -> "Ring Dips", 3x12, bodyweight
--   "Neutral-Grip Pull-Up 3x8 KG" -> kept as written (kg), though its siblings are bodyweight
--
-- Run:
--   supabase db query --linked -f scripts/seed-exercise-library-2026-06-24.sql
-- Reverse (if ever needed): soft-delete by created_by + created_at window, or
-- by the name set, via soft_delete_exercise / an UPDATE deleted_at = now().
-- ============================================================================

create temp table _seed (
  name        text,
  pattern     text,
  sets        int,
  reps        text,
  rep_metric  text,
  metric      text
);

insert into _seed (name, pattern, sets, reps, rep_metric, metric) values
  -- Push ---------------------------------------------------------------------
  ('BB Bench Press',                     'Push', 3, '8',  null, 'kg'),
  ('BB Incline Bench Press',             'Push', 3, '8',  null, 'kg'),
  ('BB Decline Bench Press',             'Push', 3, '8',  null, 'kg'),
  ('BB Close-Grip Bench Press',          'Push', 3, '8',  null, 'kg'),
  ('DB Bench Press',                     'Push', 3, '8',  null, 'kg'),
  ('DB Incline Bench Press',             'Push', 3, '8',  null, 'kg'),
  ('DB Decline Bench Press',             'Push', 3, '8',  null, 'kg'),
  ('DB Floor Press',                     'Push', 3, '8',  null, 'kg'),
  ('DB Neutral-Grip Bench Press',        'Push', 3, '8',  null, 'kg'),
  ('SA DB Bench Press',                  'Push', 3, '8',  null, 'kg'),
  ('BB Shoulder Press (standing)',       'Push', 3, '8',  null, 'kg'),
  ('BB Push Press',                      'Push', 3, '8',  null, 'kg'),
  ('BB Z Press',                         'Push', 3, '8',  null, 'kg'),
  ('DB Shoulder Press (standing)',       'Push', 3, '8',  null, 'kg'),
  ('DB Seated Shoulder Press',           'Push', 3, '8',  null, 'kg'),
  ('DB Arnold Press',                    'Push', 3, '8',  null, 'kg'),
  ('SA DB Shoulder Press',               'Push', 3, '8',  null, 'kg'),
  ('SA DB Push Press',                   'Push', 3, '8',  null, 'kg'),
  ('Half-Kneeling SA DB Shoulder Press', 'Push', 3, '8',  null, 'kg'),
  ('Landmine Press',                     'Push', 3, '8',  null, 'kg'),
  ('SA Landmine Press',                  'Push', 3, '8',  null, 'kg'),
  ('Half-Kneeling SA Landmine Press',    'Push', 3, '8',  null, 'kg'),
  ('Landmine Push Press',                'Push', 3, '8',  null, 'kg'),
  ('Push-up',                            'Push', 3, '8',  null, null),
  ('Incline Push-up',                    'Push', 3, '8',  null, null),
  ('Wall Push-up',                       'Push', 3, '8',  null, null),
  ('Push-up Sliderz',                    'Push', 3, '8',  null, null),
  ('Weighted Push-Up',                   'Push', 3, '8',  null, 'kg'),
  ('Weighted Dip (parallel bar)',        'Push', 3, '12', null, 'kg'),
  ('Ring Dips',                          'Push', 3, '12', null, null),
  ('Machine Chest Press',                'Push', 3, '12', null, 'kg'),
  ('Hammer Strength Incline Press',      'Push', 3, '12', null, 'kg'),
  ('Machine Shoulder Press',             'Push', 3, '12', null, 'kg'),
  -- Pull ---------------------------------------------------------------------
  ('Pull-Up',                            'Pull', 3, '8',  null, null),
  ('Chin-Up',                            'Pull', 3, '8',  null, null),
  ('Neutral-Grip Pull-Up',               'Pull', 3, '8',  null, 'kg'),
  ('Weighted Pull-Up',                   'Pull', 3, '8',  null, 'kg'),
  ('Weighted Chin-Up',                   'Pull', 3, '8',  null, 'kg'),
  ('Weighted Neutral-Grip Pull-Up',      'Pull', 3, '8',  null, 'kg'),
  ('SA Half-Kneeling Lat Pulldown',      'Pull', 3, '8',  null, 'kg'),
  ('Straight-Arm Pulldown (cable)',      'Pull', 3, '12', null, 'kg'),
  ('BB Bent-Over Row (pronated)',        'Pull', 3, '8',  null, 'kg'),
  ('BB Pendlay Row',                     'Pull', 3, '8',  null, 'kg'),
  ('BB Yates Row (underhand)',           'Pull', 3, '8',  null, 'kg'),
  ('BB Seal Row',                        'Pull', 3, '8',  null, 'kg'),
  ('Landmine T-Bar Row',                 'Pull', 3, '8',  null, 'kg'),
  ('DB Bent-Over Row (two-arm)',         'Pull', 3, '8',  null, 'kg'),
  ('SA DB Row (bench-supported)',        'Pull', 3, '8',  null, 'kg'),
  ('Chest-Supported DB Row (incline)',   'Pull', 3, '8',  null, 'kg'),
  ('DB Chest-Supported Rear-Delt Row',   'Pull', 3, '8',  null, 'kg'),
  ('SA Landmine Row',                    'Pull', 3, '8',  null, 'kg'),
  ('Seated Cable Row (neutral grip)',    'Pull', 3, '8',  null, 'kg'),
  ('Wide-Grip Seated Cable Row',         'Pull', 3, '8',  null, 'kg'),
  ('SA Half-Kneeling Cable Row',         'Pull', 3, '8',  null, 'kg'),
  ('Standing SA Row',                    'Pull', 3, '8',  null, 'kg'),
  ('Inverted Row',                       'Pull', 3, '8',  null, null),
  ('Weighted Inverted Row',              'Pull', 3, '8',  null, 'kg'),
  ('Hammer Strength Iso-Lateral Row',    'Pull', 3, '8',  null, 'kg'),
  ('Machine High Row',                   'Pull', 3, '8',  null, 'kg'),
  -- Hinge --------------------------------------------------------------------
  ('BB Conventional Deadlift',           'Hinge', 3, '8', null, 'kg'),
  ('BB Sumo Deadlift',                   'Hinge', 3, '8', null, 'kg'),
  ('BB Deficit Deadlift',                'Hinge', 3, '8', null, 'kg'),
  ('BB Rack Pull',                       'Hinge', 3, '8', null, 'kg'),
  ('Trap Bar RDL',                       'Hinge', 3, '8', null, 'kg'),
  ('B-stance Trap Bar RDL',              'Hinge', 3, '8', null, 'kg'),
  ('DB RDL',                             'Hinge', 3, '8', null, 'kg'),
  ('Landmine RDL',                       'Hinge', 3, '8', null, 'kg'),
  ('SL BB RDL',                          'Hinge', 3, '8', null, 'kg'),
  ('B-Stance DB RDL',                    'Hinge', 3, '8', null, 'kg'),
  ('B-Stance BB RDL',                    'Hinge', 3, '8', null, 'kg'),
  ('BB Good Morning',                    'Hinge', 3, '8', null, 'kg'),
  ('BB Seated Good Morning',             'Hinge', 3, '8', null, 'kg'),
  ('BB Hip Thrust',                      'Hinge', 3, '8', null, 'kg'),
  ('SL Hip Thrust',                      'Hinge', 3, '8', null, 'kg'),
  ('B-Stance Hip Thrust',                'Hinge', 3, '8', null, 'kg'),
  ('BB Glute Bridge',                    'Hinge', 3, '8', null, 'kg'),
  ('Glute-Ham Raise — GHD',              'Hinge', 3, '8', null, 'kg'),
  -- Squat --------------------------------------------------------------------
  ('BB Back Squat (high-bar)',           'Squat', 3, '8', null, 'kg'),
  ('BB Low-Bar Back Squat',              'Squat', 3, '8', null, 'kg'),
  ('BB Front Squat',                     'Squat', 3, '8', null, 'kg'),
  ('BB Box Squat',                       'Squat', 3, '8', null, 'kg'),
  ('BB Pause Squat',                     'Squat', 3, '8', null, 'kg'),
  ('BB Zercher Squat',                   'Squat', 3, '8', null, 'kg'),
  ('BB Overhead Squat',                  'Squat', 3, '8', null, 'kg'),
  ('Safety Bar Squat',                   'Squat', 3, '8', null, 'kg'),
  ('Goblet Squat',                       'Squat', 3, '8', null, 'kg'),
  ('DB Front Squat',                     'Squat', 3, '8', null, 'kg'),
  ('Heels-Elevated Goblet Squat',        'Squat', 3, '8', null, 'kg'),
  ('Landmine Goblet Squat',              'Squat', 3, '8', null, 'kg'),
  ('Landmine Hack Squat',                'Squat', 3, '8', null, 'kg'),
  ('DB Split Squat',                     'Squat', 3, '8', null, 'kg'),
  ('BB Split Squat',                     'Squat', 3, '8', null, 'kg'),
  ('DB Bulgarian Split Squat',           'Squat', 3, '8', null, 'kg'),
  ('BB Bulgarian Split Squat',           'Squat', 3, '8', null, 'kg'),
  ('Front-Foot-Elevated DB Split Squat', 'Squat', 3, '8', null, 'kg'),
  ('DB Reverse Lunge',                   'Squat', 3, '8', null, 'kg'),
  ('BB Reverse Lunge',                   'Squat', 3, '8', null, 'kg'),
  ('Deficit DB Reverse Lunge',           'Squat', 3, '8', null, 'kg'),
  ('DB Walking Lunge',                   'Squat', 3, '8', null, 'kg'),
  ('DB Forward Lunge',                   'Squat', 3, '8', null, 'kg'),
  ('DB Step-Up',                         'Squat', 3, '8', null, 'kg'),
  ('BB Step-Up',                         'Squat', 3, '8', null, 'kg'),
  ('SL Lateral Step-Up',                 'Squat', 3, '8', null, 'kg'),
  ('KB SL Squat',                        'Squat', 3, '8', null, 'kg'),
  ('DB Skater Squat',                    'Squat', 3, '8', null, 'kg'),
  ('Leg Press (45°)',                    'Squat', 3, '8', null, 'kg'),
  ('Hack Squat',                         'Squat', 3, '8', null, 'kg'),
  -- Carry (distance, metres) -------------------------------------------------
  ('Farmer''s Carry (DB)',               'Carry', 3, '20', 'distance_m', null),
  ('Farmer''s Carry (trap bar)',         'Carry', 3, '20', 'distance_m', null),
  ('Farmer''s Carry (handles)',          'Carry', 3, '20', 'distance_m', null),
  ('SA Suitcase Carry (DB)',             'Carry', 3, '20', 'distance_m', null),
  ('SA Suitcase Carry (KB)',             'Carry', 3, '20', 'distance_m', null),
  ('BB Overhead Carry',                  'Carry', 3, '20', 'distance_m', null),
  ('DB SA Overhead Carry',               'Carry', 3, '20', 'distance_m', null),
  ('SA Bottoms-Up KB Carry',             'Carry', 3, '20', 'distance_m', null),
  ('Zercher Carry (BB)',                 'Carry', 3, '20', 'distance_m', null),
  ('Bear-Hug Sandbag Carry',             'Carry', 3, '20', 'distance_m', null),
  ('Sled Push',                          'Carry', 3, '20', 'distance_m', null),
  ('Forward Sled Drag',                  'Carry', 3, '20', 'distance_m', null),
  ('Backward Sled Drag (quad)',          'Carry', 3, '20', 'distance_m', null),
  -- Core ---------------------------------------------------------------------
  ('Ab Wheel Rollout (from knees)',      'Core', 3, '6',  null,          null),
  ('Weighted Plank',                     'Core', 3, '30', 'time_minsec', null),
  ('Plank',                              'Core', 3, '30', 'time_minsec', null),
  ('Hollow-Body Hold',                   'Core', 3, '30', 'time_minsec', null),
  ('Weighted Hollow-Body Hold',          'Core', 3, '30', 'time_minsec', null),
  ('Weighted Dead Bug',                  'Core', 3, '16', null,          'kg'),
  ('Banded Dead bug',                    'Core', 3, '16', null,          'kg'),
  ('Banded Dead bug iso',                'Core', 3, '30', 'time_minsec', null),
  ('Bear Crawl Isometric',               'Core', 3, '30', 'time_minsec', null),
  ('Bear Crawl',                         'Core', 3, '12', null,          null),
  ('Pallof Press (cable)',               'Core', 3, '12', null,          'kg'),
  ('Banded Pallof Press',                'Core', 3, '12', null,          'kg'),
  ('Kneeling Pallof Press (cable)',      'Core', 3, '12', null,          'kg'),
  ('Cable Woodchop (high-to-low)',       'Core', 3, '12', null,          'kg'),
  ('Cable Reverse Woodchop (low-to-high)','Core', 3, '12', null,         'kg'),
  ('Landmine Rotation (180)',            'Core', 3, '16', null,          'kg'),
  ('Landmine Anti-Rotation (rainbow)',   'Core', 3, '16', null,          'kg'),
  ('Kneeling Landmine Anti-Rotation (rainbow)', 'Core', 3, '16', null,   'kg'),
  ('Russian Twist',                      'Core', 3, '20', null,          null),
  ('Side Plank on Knees',                'Core', 3, '30', 'time_minsec', null),
  ('Side Plank',                         'Core', 3, '30', 'time_minsec', null),
  ('Side Plank w Knee Flexion',          'Core', 3, '30', 'time_minsec', null),
  ('Side Plank Dips',                    'Core', 3, '12', null,          null),
  ('Side Plank w Leg Lift (Isometric)',  'Core', 3, '30', 'time_minsec', null),
  ('Side Plank w Leg Lifts',             'Core', 3, '12', null,          null),
  ('GHD Oblique Hold',                   'Core', 3, '30', 'time_minsec', null),
  ('GHD Oblique Crunches',               'Core', 3, '12', null,          'kg'),
  ('45 Degree Oblique Hold',             'Core', 3, '30', 'time_minsec', null),
  ('45 Degree Oblique Crunches',         'Core', 3, '12', null,          'kg'),
  ('Turkish Get-Up (KB)',                'Core', 3, '10', null,          'kg'),
  ('Stir-the-Pot (ball)',                'Core', 3, '20', null,          null),
  ('Machine Crunch',                     'Core', 3, '20', null,          'kg'),
  -- Accessory ----------------------------------------------------------------
  ('BB Bicep Curl',                      'Accessory', 3, '12', null, 'kg'),
  ('DB Incline Curl',                    'Accessory', 3, '12', null, 'kg'),
  ('DB Concentration Curl',              'Accessory', 3, '12', null, 'kg'),
  ('DB Zottman Curl',                    'Accessory', 3, '12', null, 'kg'),
  ('Cable Curl',                         'Accessory', 3, '12', null, 'kg'),
  ('Cable Hammer Curl (rope)',           'Accessory', 3, '12', null, 'kg'),
  ('Preacher Curl',                      'Accessory', 3, '12', null, 'kg'),
  ('BB Skull Crusher',                   'Accessory', 3, '12', null, 'kg'),
  ('DB Skull Crusher',                   'Accessory', 3, '12', null, 'kg'),
  ('DB Overhead Triceps Extension (two-hand)', 'Accessory', 3, '12', null, 'kg'),
  ('SA DB Overhead Extension',           'Accessory', 3, '12', null, 'kg'),
  ('Overhead Cable Triceps Extension',   'Accessory', 3, '12', null, 'kg'),
  ('Cable Triceps Kickback',             'Accessory', 3, '12', null, 'kg'),
  ('DB Triceps Kickback',                'Accessory', 3, '12', null, 'kg'),
  ('DB Lateral Raise',                   'Accessory', 3, '12', null, 'kg'),
  ('Cable Lateral Raise',                'Accessory', 3, '12', null, 'kg'),
  ('SA Cable Lateral Raise',             'Accessory', 3, '12', null, 'kg'),
  ('DB Front Raise',                     'Accessory', 3, '12', null, 'kg'),
  ('DB Rear-Delt Fly',                   'Accessory', 3, '12', null, 'kg'),
  ('Cable Rear-Delt Fly',                'Accessory', 3, '12', null, 'kg'),
  ('Incline DB Y-Raise',                 'Accessory', 3, '12', null, 'kg'),
  ('Incline DB T-Raise',                 'Accessory', 3, '12', null, 'kg'),
  ('Incline DB I-Raise',                 'Accessory', 3, '12', null, 'kg'),
  ('Incline DB W-Raise',                 'Accessory', 3, '12', null, 'kg'),
  ('Half Cubans',                        'Accessory', 3, '12', null, 'kg'),
  ('Full Cubans',                        'Accessory', 3, '12', null, 'kg'),
  ('DB Upright Row',                     'Accessory', 3, '12', null, 'kg'),
  ('BB Shrug',                           'Accessory', 3, '12', null, 'kg'),
  ('DB Shrug',                           'Accessory', 3, '12', null, 'kg'),
  ('Trap Bar Shrug',                     'Accessory', 3, '12', null, 'kg'),
  ('Cable Face Pull',                    'Accessory', 3, '12', null, 'kg'),
  ('DB Fly (flat)',                      'Accessory', 3, '12', null, 'kg'),
  ('DB Incline Fly',                     'Accessory', 3, '12', null, 'kg'),
  ('Mid Cable Fly',                      'Accessory', 3, '12', null, 'kg'),
  ('Low-to-High Cable Fly',              'Accessory', 3, '12', null, 'kg'),
  ('High-to-Low Cable Fly',              'Accessory', 3, '12', null, 'kg'),
  ('Pec Deck',                           'Accessory', 3, '12', null, 'kg'),
  ('Leg Extension',                      'Accessory', 3, '12', null, 'kg'),
  ('SL Leg Extension',                   'Accessory', 3, '12', null, 'kg'),
  ('Lying Leg Curl',                     'Accessory', 3, '8',  null, 'kg'),
  ('Seated Leg Curl',                    'Accessory', 3, '8',  null, 'kg'),
  ('Nordic Hamstring Curl',              'Accessory', 3, '8',  null, null),
  ('Weighted 45° Back Extension',        'Accessory', 3, '8',  null, 'kg'),
  ('KB Swing (heavy)',                   'Accessory', 3, '8',  null, 'kg'),
  ('Seated Calf Raise',                  'Accessory', 3, '12', null, 'kg'),
  ('BB Wrist Curl',                      'Accessory', 3, '12', null, 'kg'),
  ('BB Reverse Wrist Curl',              'Accessory', 3, '12', null, 'kg'),
  ('DB Wrist Extension Iso',             'Accessory', 3, '45', 'time_minsec', null),
  ('DB Wrist Extension (Eccentric)',     'Accessory', 4, '5',  null, 'kg'),
  ('DB Wrist Flexion Iso',               'Accessory', 3, '45', 'time_minsec', null),
  ('DB Wrist Flexion (Eccentric)',       'Accessory', 4, '5',  null, 'kg'),
  ('Finger Plate Holds',                 'Accessory', 1, '30', 'time_minsec', null),
  ('DB Supination (Eccentric)',          'Accessory', 4, '5',  null, 'kg'),
  ('DB Pronation (Eccentric)',           'Accessory', 4, '5',  null, 'kg'),
  -- Plyometrics --------------------------------------------------------------
  ('Box Jump',                           'Plyometrics', 4, '5',  null, null),
  ('Seated Box Jump (concentric-only)',  'Plyometrics', 4, '5',  null, null),
  ('Counter Movement Jump',              'Plyometrics', 4, '5',  null, null),
  ('Drop Landing',                       'Plyometrics', 4, '5',  null, null),
  ('Drop Jump to Box',                   'Plyometrics', 4, '5',  null, null),
  ('Standing Broad Jump',                'Plyometrics', 4, '5',  null, null),
  ('Broad Jump (Continuous)',            'Plyometrics', 4, '3',  null, null),
  ('Continuous Hurdle Hop',              'Plyometrics', 4, '3',  null, null),
  ('Tuck Jump',                          'Plyometrics', 3, '10', null, null),
  ('DB Jump Squat',                      'Plyometrics', 4, '5',  null, 'kg'),
  ('DB Jump Squat (Eccentric Only)',     'Plyometrics', 4, '5',  null, 'kg'),
  ('Trap Bar Jump',                      'Plyometrics', 4, '5',  null, 'kg'),
  ('DL Pogos',                           'Plyometrics', 4, '20', null, null),
  ('SL Pogo',                            'Plyometrics', 4, '20', null, null),
  ('SL Box Jump',                        'Plyometrics', 4, '5',  null, null),
  ('SL Broad Jump',                      'Plyometrics', 4, '5',  null, null),
  ('Alternating Bound',                  'Plyometrics', 3, '16', null, null),
  ('SL Lateral Bound (skater)',          'Plyometrics', 3, '16', null, null),
  ('SL Continuous Hop (distance)',       'Plyometrics', 4, '3',  null, null),
  ('Depth Jump to Broad Jump',           'Plyometrics', 4, '3',  null, null),
  ('Plyo Push-Up',                       'Plyometrics', 4, '5',  null, null),
  ('Clap Push-Up',                       'Plyometrics', 4, '5',  null, null),
  ('Band Assisted Plyo Push-up',         'Plyometrics', 4, '5',  null, null),
  ('Depth-Drop Push-Up',                 'Plyometrics', 4, '5',  null, null),
  ('Med Ball Chest Pass',                'Plyometrics', 4, '5',  null, 'kg'),
  ('Med Ball Overhead Throw',            'Plyometrics', 4, '5',  null, 'kg'),
  ('Med Ball Slam',                      'Plyometrics', 4, '5',  null, 'kg'),
  ('Med Ball Rotational Throw',          'Plyometrics', 4, '5',  null, 'kg'),
  ('Med Ball Scoop Toss',                'Plyometrics', 4, '5',  null, 'kg'),
  ('SA Med Ball Throw',                  'Plyometrics', 4, '5',  null, 'kg');

-- Guard: fail loud if any seed row names a movement pattern that does not
-- resolve in this org (prevents a typo silently dropping rows via the JOIN).
do $$
declare
  v_bad text;
begin
  select string_agg(distinct s.pattern, ', ')
    into v_bad
  from _seed s
  where not exists (
    select 1 from movement_patterns mp
    where mp.organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
      and lower(mp.name) = lower(s.pattern)
      and mp.deleted_at is null
  );
  if v_bad is not null then
    raise exception 'Unresolved movement patterns: %', v_bad;
  end if;
end $$;

-- Insert, skipping any name already present (active) in the org.
with ins as (
  insert into exercises (
    organization_id, created_by_user_id, movement_pattern_id,
    name, default_sets, default_reps, default_rep_metric, default_metric
  )
  select
    '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid,
    '641422e8-a927-4985-9cff-ff5e4fc2b127'::uuid,
    mp.id,
    s.name, s.sets, s.reps, s.rep_metric, s.metric
  from _seed s
  join movement_patterns mp
    on mp.organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
   and lower(mp.name) = lower(s.pattern)
   and mp.deleted_at is null
  where not exists (
    select 1 from exercises e
    where e.organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
      and lower(e.name) = lower(s.name)
      and e.deleted_at is null
  )
  returning 1
)
select
  (select count(*) from _seed)                                  as seed_rows,
  (select count(*) from ins)                                    as inserted,
  (select count(*) from exercises
    where organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
      and deleted_at is null)                                   as org_total_after;
