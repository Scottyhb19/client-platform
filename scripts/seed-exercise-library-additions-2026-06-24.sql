-- ============================================================================
-- scripts/seed-exercise-library-additions-2026-06-24.sql
-- ============================================================================
-- Third library seed: net-new loaded-library additions ("candidates"),
-- transcribed from the operator-provided "Odyssey — Exercise Library
-- Additions" markdown, committed alongside this script at
-- scripts/exercise_library_additions.md (provided 2026-06-24).
--
-- NOT a migration (org-specific personal content). Org-scoped to
-- "The Odyssey. Platform" (33d23c20). Idempotent: skips any exercise whose
-- name already exists (active) in the org. A collision check before this run
-- found ZERO exact dups with the existing library.
--
-- Interpretations applied (all consistent with the prior two seeds):
--   * Loaded carries "3x20m KG" -> distance_m volume AND kg load (both axes).
--   * "(machine)" stripped from names (only "Standing SL Leg Curl (machine)");
--     filed under its pattern, no Machine tag.
--   * No-metric time holds (Swiss Ball Plank / Hollow Hold, 3x30sec) -> bodyweight.
--   * Single-limb tag rule applied to SA/SL-named rows missing the tag
--     (SA Wall Pulses w Ball / w Swiss Ball -> Single Arm;
--      Band assisted SL Squat -> Single leg).
--   * Metric map: '-' -> no load; KG -> kg; reps token Nm -> distance_m.
--     Tags: Single Leg -> "Single leg"; Single Arm / Reactive Plyometrics /
--     Deep Tier Plyometrics as-is.
--
-- Run:
--   supabase db query --linked -f scripts/seed-exercise-library-additions-2026-06-24.sql
-- ============================================================================

create temp table _seed (
  name text, pattern text, sets int, reps text, rep_metric text, metric text
);

insert into _seed (name, pattern, sets, reps, rep_metric, metric) values
  -- Push --------------------------------------------------------------------
  ('DB Z Press',                                 'Push', 3, '8',  null, 'kg'),
  ('KB Z Press',                                 'Push', 3, '8',  null, 'kg'),
  ('SA DB Z Press',                              'Push', 3, '8',  null, 'kg'),
  ('SA KB Z Press',                              'Push', 3, '8',  null, 'kg'),
  ('Single-Arm Push-Up',                         'Push', 3, '8',  null, null),
  ('Deficit Push-Up',                            'Push', 3, '8',  null, null),
  ('Smith Machine Incline Press',                'Push', 3, '8',  null, 'kg'),
  ('Smith Machine Bench Press',                  'Push', 3, '8',  null, 'kg'),
  ('Smith Machine Overhead Press',               'Push', 3, '8',  null, 'kg'),
  ('Swiss Ball DB Chest Press',                  'Push', 3, '12', null, 'kg'),
  ('Swiss Ball SA DB Chest Press',               'Push', 3, '12', null, 'kg'),
  ('Swiss Ball DB Shoulder Press (seated)',      'Push', 3, '12', null, 'kg'),
  ('Swiss Ball SA DB Shoulder Press (seated)',   'Push', 3, '12', null, 'kg'),
  -- Pull --------------------------------------------------------------------
  ('Wide-Grip Pull-Up',                          'Pull', 3, '8',  null, null),
  ('L-Sit Pull-Up',                              'Pull', 3, '8',  null, null),
  ('Mixed-Grip Pull-Up',                         'Pull', 3, '8',  null, null),
  ('DB Renegade Row',                            'Pull', 3, '8',  null, 'kg'),
  ('Snatch-Grip BB Row',                         'Pull', 3, '8',  null, 'kg'),
  ('Feet-Elevated Inverted Row',                 'Pull', 3, '8',  null, null),
  ('Chest-Supported T-Bar Row',                  'Pull', 3, '8',  null, 'kg'),
  ('Close-Grip Lat Pulldown',                    'Pull', 3, '8',  null, 'kg'),
  ('Assisted Pull-Up Machine',                   'Pull', 3, '8',  null, 'kg'),
  ('Smith Machine Bent-Over Row',                'Pull', 3, '8',  null, 'kg'),
  -- Hinge -------------------------------------------------------------------
  ('Snatch-Grip Deadlift',                       'Hinge', 3, '8',  null, 'kg'),
  ('Jefferson Deadlift',                         'Hinge', 3, '8',  null, 'kg'),
  ('KB Deadlift',                                'Hinge', 3, '8',  null, 'kg'),
  ('Smith Machine RDL',                          'Hinge', 3, '8',  null, 'kg'),
  ('Seated Hip Extension Machine',               'Hinge', 3, '12', null, 'kg'),
  ('Swiss Ball Hip Thrust',                      'Hinge', 3, '12', null, 'kg'),
  -- Squat -------------------------------------------------------------------
  ('Heels-Elevated BB Back Squat',               'Squat', 3, '8',  null, 'kg'),
  ('Front-Rack BB Reverse Lunge',                'Squat', 3, '8',  null, 'kg'),
  ('Front-Rack KB Reverse Lunge',                'Squat', 3, '8',  null, 'kg'),
  ('Deficit DB Bulgarian Split Squat',           'Squat', 3, '8',  null, 'kg'),
  ('Front-Rack BB Bulgarian Split Squat',        'Squat', 3, '8',  null, 'kg'),
  ('Front-Rack KB SL Squat',                     'Squat', 3, '8',  null, 'kg'),
  ('Front-Rack KB SL Box Squat',                 'Squat', 3, '8',  null, 'kg'),
  ('Pendulum Squat',                             'Squat', 3, '8',  null, 'kg'),
  ('Smith Machine Back Squat',                   'Squat', 3, '8',  null, 'kg'),
  ('Single-Leg Press',                           'Squat', 3, '8',  null, 'kg'),
  ('B-Stance Leg Press',                         'Squat', 3, '8',  null, 'kg'),
  ('Leg Press w Ball Squeeze',                   'Squat', 3, '8',  null, 'kg'),
  ('Smith Machine Front Squat',                  'Squat', 3, '8',  null, 'kg'),
  ('Smith Machine Split Squat',                  'Squat', 3, '8',  null, 'kg'),
  ('Smith Machine Back Squat to Box',            'Squat', 3, '8',  null, 'kg'),
  ('Smith Machine Front Squat to Box',           'Squat', 3, '8',  null, 'kg'),
  ('Band assisted SL Squat',                     'Squat', 3, '8',  null, null),
  -- Carry (distance + load) -------------------------------------------------
  ('Sandbag Shoulder Carry',                     'Carry', 3, '20', 'distance_m', 'kg'),
  ('Lateral Sled Drag',                          'Carry', 3, '20', 'distance_m', 'kg'),
  ('Lateral Crossover Sled Drag',                'Carry', 3, '20', 'distance_m', 'kg'),
  ('Sled Sprints',                               'Carry', 3, '20', 'distance_m', 'kg'),
  -- Core --------------------------------------------------------------------
  ('GHD Sit-Up',                                 'Core', 3, '12', null,          'kg'),
  ('Weighted Sit-Up',                            'Core', 3, '12', null,          'kg'),
  ('Reverse Crunch',                             'Core', 3, '12', null,          null),
  ('Standing Cable Oblique Crunch',              'Core', 3, '12', null,          'kg'),
  ('Kneeling Cable Crunch',                      'Core', 3, '12', null,          'kg'),
  ('Swiss Ball Rollout',                         'Core', 3, '12', null,          null),
  ('Swiss Ball Plank',                           'Core', 3, '30', 'time_minsec', null),
  ('Swiss Ball Crunch',                          'Core', 3, '12', null,          null),
  ('Swiss Ball Weighted Crunch',                 'Core', 3, '12', null,          'kg'),
  ('Swiss Ball Hollow Hold',                     'Core', 3, '30', 'time_minsec', null),
  -- Accessory ---------------------------------------------------------------
  ('EZ-Bar Curl',                                'Accessory', 3, '12', null, 'kg'),
  ('EZ-Bar Reverse Curl',                        'Accessory', 3, '12', null, 'kg'),
  ('Drag Curl',                                  'Accessory', 3, '12', null, 'kg'),
  ('Cross-Body Hammer Curl',                     'Accessory', 3, '12', null, 'kg'),
  ('Incline DB Hammer Curl',                     'Accessory', 3, '12', null, 'kg'),
  ('Bench Dip',                                  'Accessory', 3, '12', null, null),
  ('Machine Lateral Raise',                      'Accessory', 3, '12', null, 'kg'),
  ('Plate Front Raise',                          'Accessory', 3, '12', null, 'kg'),
  ('Standing SL Leg Curl',                       'Accessory', 3, '12', null, 'kg'),
  ('Glute Kickback Machine',                     'Accessory', 3, '12', null, 'kg'),
  ('Calf Press on Leg Press',                    'Accessory', 3, '12', null, 'kg'),
  ('Jefferson Curl',                             'Accessory', 3, '8',  null, 'kg'),
  ('Deficit Jefferson Curl',                     'Accessory', 3, '8',  null, 'kg'),
  ('Banded Neck Iso (4 way)',                    'Accessory', 2, '5',  null, null),
  ('Banded Neck Iso Walks (2 way)',              'Accessory', 2, '5',  null, null),
  ('Cable Neck Iso (4 way)',                     'Accessory', 2, '5',  null, 'kg'),
  ('Cable Neck Iso Walks (2 way)',               'Accessory', 2, '5',  null, 'kg'),
  ('Cable Neck Rotations',                       'Accessory', 2, '12', null, 'kg'),
  ('Swiss Ball Hamstring Curl',                  'Accessory', 3, '12', null, 'kg'),
  ('SL Swiss Ball Hamstring Curl',               'Accessory', 3, '12', null, null),
  ('Swiss Ball DB Fly',                          'Accessory', 3, '12', null, 'kg'),
  ('Swiss Ball Prone Rear-Delt Raise',           'Accessory', 3, '12', null, 'kg'),
  -- Plyometrics -------------------------------------------------------------
  ('Approach Box Jump',                          'Plyometrics', 4, '5',  null, null),
  ('Single-Leg Hurdle Hop',                      'Plyometrics', 4, '3',  null, null),
  ('Lateral Pogo',                               'Plyometrics', 4, '20', null, null),
  ('Med Ball Wall Chest Pass (continuous)',      'Plyometrics', 4, '8',  null, 'kg'),
  ('Supine Med Ball Catch & Throw',              'Plyometrics', 4, '5',  null, 'kg'),
  ('SA Med Ball Wall Throw',                     'Plyometrics', 4, '6',  null, 'kg'),
  ('Med Ball Granny Toss',                       'Plyometrics', 4, '5',  null, 'kg'),
  ('Med Ball Squat-to-Throw',                    'Plyometrics', 4, '5',  null, 'kg'),
  ('Med Ball Squat-to-Slam',                     'Plyometrics', 4, '5',  null, 'kg'),
  ('Med Ball Half-Kneeling Rotational Throw',    'Plyometrics', 4, '5',  null, 'kg'),
  ('Med Ball Lateral Throw',                     'Plyometrics', 4, '5',  null, 'kg'),
  ('Seated Med Ball Lateral Throw',              'Plyometrics', 4, '5',  null, 'kg'),
  ('Kneeling Med Ball Throw',                    'Plyometrics', 4, '5',  null, 'kg'),
  ('Seated Med Ball Chest Pass',                 'Plyometrics', 4, '5',  null, 'kg'),
  ('SA Wall Pulses w Ball',                      'Plyometrics', 3, '20', null, null),
  ('SA Wall Pulses w Swiss Ball',                'Plyometrics', 3, '20', null, null);

-- Guard: every pattern must resolve in this org.
do $$
declare v_bad text;
begin
  select string_agg(distinct s.pattern, ', ') into v_bad
  from _seed s
  where not exists (
    select 1 from movement_patterns mp
    where mp.organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
      and lower(mp.name) = lower(s.pattern) and mp.deleted_at is null
  );
  if v_bad is not null then raise exception 'Unresolved movement patterns: %', v_bad; end if;
end $$;

create temp table _result (step text, n int);
insert into _result select 'seed_exercise_rows', count(*) from _seed;

with ins as (
  insert into exercises (
    organization_id, created_by_user_id, movement_pattern_id,
    name, default_sets, default_reps, default_rep_metric, default_metric
  )
  select
    '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid,
    '641422e8-a927-4985-9cff-ff5e4fc2b127'::uuid,
    mp.id, s.name, s.sets, s.reps, s.rep_metric, s.metric
  from _seed s
  join movement_patterns mp
    on mp.organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
   and lower(mp.name) = lower(s.pattern) and mp.deleted_at is null
  where not exists (
    select 1 from exercises e
    where e.organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
      and lower(e.name) = lower(s.name) and e.deleted_at is null
  )
  returning 1
)
insert into _result select 'exercises_inserted', count(*) from ins;

-- ---- Tag assignments (name -> tag) --------------------------------------
create temp table _seedtags (name text, tag text);
insert into _seedtags (name, tag) values
  ('SA DB Z Press','Single Arm'),
  ('SA KB Z Press','Single Arm'),
  ('Single-Arm Push-Up','Single Arm'),
  ('Swiss Ball SA DB Chest Press','Single Arm'),
  ('Swiss Ball SA DB Shoulder Press (seated)','Single Arm'),
  ('DB Renegade Row','Single Arm'),
  ('Deficit DB Bulgarian Split Squat','Single leg'),
  ('Front-Rack BB Bulgarian Split Squat','Single leg'),
  ('Front-Rack KB SL Squat','Single leg'),
  ('Front-Rack KB SL Box Squat','Single leg'),
  ('Single-Leg Press','Single leg'),
  ('B-Stance Leg Press','Single leg'),
  ('Band assisted SL Squat','Single leg'),
  ('Standing SL Leg Curl','Single leg'),
  ('SL Swiss Ball Hamstring Curl','Single leg'),
  ('Single-Leg Hurdle Hop','Single leg'),
  ('Single-Leg Hurdle Hop','Reactive Plyometrics'),
  ('Lateral Pogo','Reactive Plyometrics'),
  ('Med Ball Wall Chest Pass (continuous)','Reactive Plyometrics'),
  ('Supine Med Ball Catch & Throw','Deep Tier Plyometrics'),
  ('SA Med Ball Wall Throw','Single Arm'),
  ('SA Med Ball Wall Throw','Reactive Plyometrics'),
  ('SA Wall Pulses w Ball','Reactive Plyometrics'),
  ('SA Wall Pulses w Ball','Single Arm'),
  ('SA Wall Pulses w Swiss Ball','Reactive Plyometrics'),
  ('SA Wall Pulses w Swiss Ball','Single Arm');

do $$
declare v_bad text;
begin
  select string_agg(distinct st.tag, ', ') into v_bad
  from _seedtags st
  where not exists (
    select 1 from exercise_tags t
    where t.organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
      and lower(t.name) = lower(st.tag) and t.deleted_at is null
  );
  if v_bad is not null then raise exception 'Unresolved tags: %', v_bad; end if;

  select string_agg(distinct st.name, ', ') into v_bad
  from _seedtags st
  where not exists (
    select 1 from exercises e
    where e.organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
      and lower(e.name) = lower(st.name) and e.deleted_at is null
  );
  if v_bad is not null then raise exception 'Unresolved tagged exercise names: %', v_bad; end if;
end $$;

with t as (
  insert into exercise_tag_assignments (exercise_id, tag_id)
  select e.id, tg.id
  from _seedtags st
  join exercises e
    on e.organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
   and lower(e.name) = lower(st.name) and e.deleted_at is null
  join exercise_tags tg
    on tg.organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
   and lower(tg.name) = lower(st.tag) and tg.deleted_at is null
  on conflict (exercise_id, tag_id) do nothing
  returning 1
)
insert into _result select 'tag_assignments_inserted', count(*) from t;
insert into _result select 'tagseed_pairs', count(*) from _seedtags;

select step, n from _result order by step;
