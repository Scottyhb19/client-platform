-- ============================================================================
-- scripts/seed-exercise-library-rehab-2026-06-24.sql
-- ============================================================================
-- Second library seed: the foundation / rehab & mobility tier, transcribed
-- from the operator-provided "Odyssey — Exercise Library Seed (Foundation /
-- Rehab & Mobility)" markdown (exercise_library_rehab_seed.md, 2026-06-24).
--
-- NOT a migration (org-specific personal content). Org-scoped to
-- "The Odyssey. Platform" (33d23c20). Idempotent: skips any exercise whose
-- name already exists (active) in the org.
--
-- Decisions agreed with the operator before this run (2026-06-24):
--   * Skipped as existing dups: "Curtsey to Lateral Lunge" (already there,
--     2x10) and "Side Plank on knees" (= existing "Side Plank on Knees").
--     The existing Curtsey is given the "Single leg" tag below.
--   * In-file dup removed: kept "Adductor Rock-Back" (2x12), dropped
--     "Adductor Rockbacks" (2x10).
--   * Filled-in prescriptions: Leg Extension (2 up 1 down) 3x8 KG;
--     Springy Lunge 3x8 bw; Decel Lunge 3x8 bw.
--   * "Deep Tier" tag -> existing "Deep Tier Plyometrics".
--   * "Prone W Raise" -KG -> kg. Reverse Nordic / Band Assisted Reverse
--     Nordic / Sprint to 180 COD -> bodyweight (load empty).
--   * "Drop Lunge Landing" split into bodyweight + "(Weighted)" (kg).
--   * "Step-up to TKR" -> "Step-up to TKE".
--   * Single-leg rule applied to SL-named rows missing the tag (SL RDL Iso,
--     SL Wall Stride Iso, SL Band Assisted Pogo, SL Tuck Jump) and to
--     "DL to SL Tall to Short".
--   * Metric map: '-' -> no load; KG -> kg; reps token Nm -> distance_m;
--     Nsec -> time_minsec.  Tags: SL->Single leg, SA->Single Arm.
--
-- Run:
--   supabase db query --linked -f scripts/seed-exercise-library-rehab-2026-06-24.sql
-- ============================================================================

create temp table _seed (
  name text, pattern text, sets int, reps text, rep_metric text, metric text
);

insert into _seed (name, pattern, sets, reps, rep_metric, metric) values
  -- Movement Restoration ----------------------------------------------------
  ('Calf Stretch (wall)',                 'Movement Restoration', 1, '45', 'time_minsec', null),
  ('Soleus Calf Stretch',                 'Movement Restoration', 1, '45', 'time_minsec', null),
  ('Floating Toe Ankle Pulses',           'Movement Restoration', 1, '5',  null,          null),
  ('Banded Ankle Distractions',           'Movement Restoration', 1, '12', null,          null),
  ('Big Toe Lifts',                       'Movement Restoration', 1, '12', null,          null),
  ('Little Toe Lifts',                    'Movement Restoration', 1, '12', null,          null),
  ('Piano Toes',                          'Movement Restoration', 1, '12', null,          null),
  ('Heel Walks',                          'Movement Restoration', 1, '12', null,          null),
  ('Toe Walks',                           'Movement Restoration', 1, '12', null,          null),
  ('Kneeling Hip Flexor Stretch',         'Movement Restoration', 1, '45', 'time_minsec', null),
  ('90/90 Hip Stretch',                   'Movement Restoration', 1, '45', 'time_minsec', null),
  ('90/90 Hip Rotations',                 'Movement Restoration', 1, '12', null,          null),
  ('Figure-4 Glute Stretch',              'Movement Restoration', 1, '45', 'time_minsec', null),
  ('Pigeon Stretch',                      'Movement Restoration', 1, '45', 'time_minsec', null),
  ('Seated Butterfly (Adductor) Stretch', 'Movement Restoration', 1, '45', 'time_minsec', null),
  ('Frog Stretch',                        'Movement Restoration', 1, '45', 'time_minsec', null),
  ('Side-Lying Quad Stretch',             'Movement Restoration', 1, '45', 'time_minsec', null),
  ('Banded Supine Hamstring Stretch',     'Movement Restoration', 1, '45', 'time_minsec', null),
  ('4 point Hip Circles',                 'Movement Restoration', 2, '12', null,          null),
  ('World''s Greatest Stretch',           'Movement Restoration', 2, '12', null,          null),
  ('Adductor Rock-Back',                  'Movement Restoration', 2, '12', null,          null),
  ('Front-to-Back Leg Swings',            'Movement Restoration', 1, '12', null,          null),
  ('Lateral Leg Swings',                  'Movement Restoration', 1, '12', null,          null),
  ('Supine Knee Rocks',                   'Movement Restoration', 1, '45', 'time_minsec', null),
  ('Child''s Pose',                       'Movement Restoration', 1, '45', 'time_minsec', null),
  ('Cobras',                              'Movement Restoration', 1, '12', null,          null),
  ('Scorpions',                           'Movement Restoration', 1, '12', null,          null),
  ('Book Openers',                        'Movement Restoration', 1, '12', null,          null),
  ('Foam Roller Book Openers',            'Movement Restoration', 1, '12', null,          null),
  ('Wall Book Openers',                   'Movement Restoration', 1, '12', null,          null),
  ('Quadruped Thread-the-Needle',         'Movement Restoration', 1, '12', null,          null),
  ('Cat-Cow',                             'Movement Restoration', 1, '12', null,          null),
  ('Child''s Pose with Reach (2 way)',    'Movement Restoration', 1, '45', 'time_minsec', null),
  ('Sleeper Stretch',                     'Movement Restoration', 1, '45', 'time_minsec', null),
  ('Doorway Pec Stretch',                 'Movement Restoration', 1, '45', 'time_minsec', null),
  ('Dowel Shoulder Pass-Through',         'Movement Restoration', 1, '12', null,          null),
  ('Wrist Flexor Stretch',                'Movement Restoration', 1, '45', 'time_minsec', null),
  ('Wrist Extensor Stretch',              'Movement Restoration', 1, '45', 'time_minsec', null),
  ('Side-lying stacked breathing',        'Movement Restoration', 1, '10', null,          null),
  ('90/90 breathing hamstring facilitation','Movement Restoration', 1, '10', null,        null),
  ('Side bridges + banded clam',          'Movement Restoration', 2, '10', null,          null),
  ('Captain Morgans w Foam Roller',       'Movement Restoration', 3, '30', 'time_minsec', null),
  ('Terminal Knee Extensions',            'Movement Restoration', 1, '20', null,          null),
  ('Kneeling Rock backs',                 'Movement Restoration', 1, '12', null,          null),
  ('Hamstring Flossing',                  'Movement Restoration', 1, '12', null,          null),
  ('Couch Stretch',                       'Movement Restoration', 1, '60', 'time_minsec', null),
  ('Foam Roller Thoracic extension',      'Movement Restoration', 1, '12', null,          null),
  -- Push --------------------------------------------------------------------
  ('Scapular Push-Up',                    'Push', 2, '12', null, null),
  ('Rotating SA Wall Push up',            'Push', 2, '8',  null, null),
  ('Rotating SA Wall Push up Iso',        'Push', 2, '8',  null, null),
  -- Hinge -------------------------------------------------------------------
  ('Dowel Hip Hinge',                     'Hinge', 2, '12', null,          null),
  ('Glute Bridge March',                  'Hinge', 2, '12', null,          null),
  ('Glute Bridge Iso',                    'Hinge', 1, '45', 'time_minsec', null),
  ('SL RDL Iso',                          'Hinge', 2, '30', 'time_minsec', null),
  ('SL Wall Stride Iso',                  'Hinge', 3, '45', 'time_minsec', null),
  -- Squat -------------------------------------------------------------------
  ('Sit-to-Stand',                        'Squat', 2, '12', null,          null),
  ('Bodyweight Squat',                    'Squat', 2, '12', null,          null),
  ('Heel-Elevated Bodyweight Squat',      'Squat', 2, '12', null,          null),
  ('Supported Split Squat (bodyweight)',  'Squat', 2, '12', null,          null),
  ('Split Squat Iso',                     'Squat', 1, '45', 'time_minsec', null),
  ('Spanish squat Iso',                   'Squat', 3, '30', 'time_minsec', null),
  ('Short split squat',                   'Squat', 3, '15', null,          null),
  ('SL Wall Squat',                       'Squat', 3, '6',  null,          null),
  ('Vertical Shin Lunge Iso',             'Squat', 3, '45', 'time_minsec', null),
  ('Step-up to TKE',                      'Squat', 2, '12', null,          null),
  ('SL Spanish Squat to Box',             'Squat', 2, '10', null,          null),
  ('Walking Lunge to Hip Lock',           'Squat', 2, '15', null,          'kg'),
  ('Overcoming Lunge Iso',                'Squat', 4, '10', 'time_minsec', null),
  ('SL Wall Squat (Positive Shin)',       'Squat', 3, '5',  null,          null),
  ('SL Wall Sit',                         'Squat', 3, '30', 'time_minsec', null),
  ('SL Wall Sit (Positive Shin)',         'Squat', 3, '30', 'time_minsec', null),
  -- Core --------------------------------------------------------------------
  ('Bird Dog',                            'Core', 2, '12', null,          null),
  ('Plank on knees',                      'Core', 3, '30', 'time_minsec', null),
  -- Accessory ---------------------------------------------------------------
  ('KB Tib Ant Raise',                    'Accessory', 2, '12', null,          'kg'),
  ('DL Tib Ant Raise',                    'Accessory', 2, '12', null,          'kg'),
  ('Prone A Pulses',                      'Accessory', 1, '15', null,          'kg'),
  ('Prone A Pulses w ER/IR',              'Accessory', 1, '15', null,          'kg'),
  ('Prone Y Raise',                       'Accessory', 1, '12', null,          'kg'),
  ('Prone T Raise',                       'Accessory', 1, '12', null,          'kg'),
  ('Prone W Raise',                       'Accessory', 1, '12', null,          'kg'),
  ('Serratus Wall Slide',                 'Accessory', 2, '12', null,          null),
  ('Side-lying Clamshell',                'Accessory', 2, '15', null,          null),
  ('Figure 4 Clamshell',                  'Accessory', 2, '15', null,          null),
  ('Crab Walks (Lateral)',                'Accessory', 2, '15', 'distance_m',  null),
  ('Crab walks (Forward/Back)',           'Accessory', 2, '15', 'distance_m',  null),
  ('Soleus Raise (Lunge Position)',       'Accessory', 3, '12', null,          null),
  ('Forward Lean Calf Raise',             'Accessory', 3, '20', null,          null),
  ('SL Forward Lean Calf Raise',          'Accessory', 3, '20', null,          null),
  ('SL Forward Lean Calf Raise w Rotation','Accessory', 3, '20', null,         null),
  ('SL Calf Bridge',                      'Accessory', 3, '30', 'time_minsec', null),
  ('Single leg calf iso',                 'Accessory', 3, '45', 'time_minsec', null),
  ('A-Walk With Rotation',                'Accessory', 2, '20', 'distance_m',  null),
  ('A-Walk w Dowel OH',                   'Accessory', 2, '20', 'distance_m',  null),
  ('Side lying DB ER',                    'Accessory', 2, '15', null,          'kg'),
  ('Side lying DB ER w push',             'Accessory', 2, '15', null,          'kg'),
  ('Side lying DB ext',                   'Accessory', 2, '15', null,          'kg'),
  ('Side lying DB ext (3-way)',           'Accessory', 2, '15', null,          'kg'),
  ('P-star',                              'Accessory', 2, '15', null,          'kg'),
  ('P-star (2-way)',                      'Accessory', 2, '15', null,          'kg'),
  ('Rec Fem Iso',                         'Accessory', 3, '45', 'time_minsec', null),
  ('RecFeminator',                        'Accessory', 3, '12', null,          'kg'),
  ('SL RecFeminator',                     'Accessory', 3, '12', null,          'kg'),
  ('Foam Roller Bridge Oscillations',     'Accessory', 2, '30', 'time_minsec', null),
  ('SL Partial Leg Extension (90-30 degrees)','Accessory', 3, '8', null,       'kg'),
  ('DL Partial Leg Extension (90-30 degrees)','Accessory', 3, '8', null,       'kg'),
  ('Positive Shin Wall Sit',              'Accessory', 3, '30', 'time_minsec', null),
  ('Band Assisted Reverse Nordic',        'Accessory', 2, '8',  null,          null),
  ('Reverse Nordic',                      'Accessory', 2, '8',  null,          null),
  ('Leg Extension (2 up 1 down)',         'Accessory', 3, '8',  null,          'kg'),
  -- Plyometrics -------------------------------------------------------------
  ('Band Assisted Pogo',                  'Plyometrics', 4, '20', null,         null),
  ('SL Band Assisted Pogo',               'Plyometrics', 4, '20', null,         null),
  ('DL Pogo 4-way',                       'Plyometrics', 4, '20', null,         null),
  ('SL Pogo 4-way',                       'Plyometrics', 4, '20', null,         null),
  ('Alternating split stance pogo',       'Plyometrics', 4, '20', null,         null),
  ('Hop to Bound pogo',                   'Plyometrics', 4, '20', null,         null),
  ('Drop Jump DL',                        'Plyometrics', 3, '5',  null,         null),
  ('SL Drop Jump',                        'Plyometrics', 3, '5',  null,         null),
  ('Narrow to Wide Pogo',                 'Plyometrics', 3, '15', null,         null),
  ('Carioca',                             'Plyometrics', 3, '15', 'distance_m', null),
  ('Low Box Lunge Pulses',                'Plyometrics', 3, '15', null,         null),
  ('Lateral Bound Reach OH',              'Plyometrics', 3, '6',  null,         null),
  ('Lateral Bound Mid Range',             'Plyometrics', 3, '6',  null,         null),
  ('Lateral Bound w Toe Touch',           'Plyometrics', 3, '6',  null,         null),
  ('Crossover Bound',                     'Plyometrics', 3, '15', 'distance_m', null),
  ('Carioca to Bound',                    'Plyometrics', 3, '12', null,         null),
  ('Pogo to Lunge',                       'Plyometrics', 3, '8',  null,         null),
  ('Continuous Lateral to Vertical Bound','Plyometrics', 3, '8',  null,         null),
  ('DL Tall to Short',                    'Plyometrics', 1, '10', null,         null),
  ('DL to SL Tall to Short',              'Plyometrics', 1, '10', null,         null),
  ('SL Tall to Short',                    'Plyometrics', 1, '10', null,         null),
  ('Springy Lunge',                       'Plyometrics', 3, '8',  null,         null),
  ('Decel Lunge',                         'Plyometrics', 3, '8',  null,         null),
  ('SL CMJ',                              'Plyometrics', 3, '3',  null,         null),
  ('Drop Lunge Landing',                  'Plyometrics', 3, '3',  null,         null),
  ('Drop Lunge Landing (Weighted)',       'Plyometrics', 3, '3',  null,         'kg'),
  ('Sinky Bound',                         'Plyometrics', 2, '10', null,         null),
  ('Continuous Weighted Jump',            'Plyometrics', 3, '3',  null,         'kg'),
  ('Sprint to Decel (10m)',               'Plyometrics', 1, '8',  null,         null),
  ('SL Tuck Jump',                        'Plyometrics', 2, '8',  null,         null),
  ('Shuffle to Sprint (5m)',              'Plyometrics', 2, '8',  null,         null),
  ('Sprint to 180 Degree COD (10m)',      'Plyometrics', 2, '8',  null,         null);

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

-- ---- Tag assignments (name -> tag). Names resolve to the just-inserted rows
-- ---- or to an existing row (e.g. Curtsey, tagged below). ------------------
create temp table _seedtags (name text, tag text);
insert into _seedtags (name, tag) values
  ('4 point Hip Circles','DGR'),
  ('Side-lying stacked breathing','PRI'),
  ('90/90 breathing hamstring facilitation','PRI'),
  ('Captain Morgans w Foam Roller','Single leg'),
  ('Curtsey to Lateral Lunge','Single leg'),
  ('Terminal Knee Extensions','Single leg'),
  ('Kneeling Rock backs','DGR'),
  ('Hamstring Flossing','Single leg'),
  ('Couch Stretch','Single leg'),
  ('Rotating SA Wall Push up','Single Arm'),
  ('Rotating SA Wall Push up Iso','Single Arm'),
  ('SL RDL Iso','DGR'),
  ('SL RDL Iso','Single leg'),
  ('SL Wall Stride Iso','DGR'),
  ('SL Wall Stride Iso','Single leg'),
  ('Supported Split Squat (bodyweight)','Single leg'),
  ('Split Squat Iso','Single leg'),
  ('Short split squat','DGR'),
  ('Short split squat','Single leg'),
  ('SL Wall Squat','DGR'),
  ('SL Wall Squat','Single leg'),
  ('Vertical Shin Lunge Iso','DGR'),
  ('Step-up to TKE','DGR'),
  ('Step-up to TKE','Single leg'),
  ('SL Spanish Squat to Box','DGR'),
  ('SL Spanish Squat to Box','Single leg'),
  ('Walking Lunge to Hip Lock','DGR'),
  ('Overcoming Lunge Iso','DGR'),
  ('SL Wall Squat (Positive Shin)','DGR'),
  ('SL Wall Squat (Positive Shin)','Single leg'),
  ('SL Wall Sit','Single leg'),
  ('SL Wall Sit (Positive Shin)','Single leg'),
  ('KB Tib Ant Raise','Single leg'),
  ('SL Forward Lean Calf Raise','Single leg'),
  ('SL Forward Lean Calf Raise w Rotation','Single leg'),
  ('SL Calf Bridge','Single leg'),
  ('Single leg calf iso','Single leg'),
  ('A-Walk With Rotation','DGR'),
  ('A-Walk w Dowel OH','DGR'),
  ('Side lying DB ER','Single Arm'),
  ('Side lying DB ER w push','Single Arm'),
  ('Side lying DB ext','Single Arm'),
  ('Side lying DB ext (3-way)','Single Arm'),
  ('P-star','Single Arm'),
  ('P-star (2-way)','Single Arm'),
  ('Rec Fem Iso','DGR'),
  ('SL RecFeminator','Single leg'),
  ('Foam Roller Bridge Oscillations','Single leg'),
  ('Foam Roller Bridge Oscillations','DGR'),
  ('SL Partial Leg Extension (90-30 degrees)','Single leg'),
  ('Positive Shin Wall Sit','DGR'),
  ('Band Assisted Pogo','Reactive Plyometrics'),
  ('SL Band Assisted Pogo','Reactive Plyometrics'),
  ('SL Band Assisted Pogo','Single leg'),
  ('DL Pogo 4-way','Reactive Plyometrics'),
  ('SL Pogo 4-way','Reactive Plyometrics'),
  ('SL Pogo 4-way','Single leg'),
  ('Alternating split stance pogo','Reactive Plyometrics'),
  ('Hop to Bound pogo','Reactive Plyometrics'),
  ('Drop Jump DL','Reactive Plyometrics'),
  ('SL Drop Jump','Reactive Plyometrics'),
  ('SL Drop Jump','Single leg'),
  ('Narrow to Wide Pogo','Reactive Plyometrics'),
  ('Narrow to Wide Pogo','DGR'),
  ('Carioca','Reactive Plyometrics'),
  ('Low Box Lunge Pulses','Deep Tier Plyometrics'),
  ('Low Box Lunge Pulses','DGR'),
  ('Lateral Bound Reach OH','Reactive Plyometrics'),
  ('Lateral Bound Reach OH','DGR'),
  ('Lateral Bound Mid Range','Reactive Plyometrics'),
  ('Lateral Bound Mid Range','DGR'),
  ('Lateral Bound w Toe Touch','Deep Tier Plyometrics'),
  ('Lateral Bound w Toe Touch','DGR'),
  ('Crossover Bound','Reactive Plyometrics'),
  ('Crossover Bound','DGR'),
  ('Carioca to Bound','Reactive Plyometrics'),
  ('Carioca to Bound','DGR'),
  ('Pogo to Lunge','Reactive Plyometrics'),
  ('Pogo to Lunge','DGR'),
  ('Continuous Lateral to Vertical Bound','Reactive Plyometrics'),
  ('Continuous Lateral to Vertical Bound','DGR'),
  ('DL Tall to Short','Reactive Plyometrics'),
  ('DL to SL Tall to Short','Reactive Plyometrics'),
  ('DL to SL Tall to Short','Single leg'),
  ('SL Tall to Short','Reactive Plyometrics'),
  ('SL Tall to Short','Single leg'),
  ('Springy Lunge','Deep Tier Plyometrics'),
  ('Springy Lunge','DGR'),
  ('Decel Lunge','Deep Tier Plyometrics'),
  ('Decel Lunge','DGR'),
  ('SL CMJ','Single leg'),
  ('Drop Lunge Landing','Deep Tier Plyometrics'),
  ('Drop Lunge Landing','DGR'),
  ('Drop Lunge Landing (Weighted)','Deep Tier Plyometrics'),
  ('Drop Lunge Landing (Weighted)','DGR'),
  ('Sinky Bound','Deep Tier Plyometrics'),
  ('Sinky Bound','DGR'),
  ('Continuous Weighted Jump','DGR'),
  ('Sprint to Decel (10m)','DGR'),
  ('SL Tuck Jump','DGR'),
  ('SL Tuck Jump','Single leg'),
  ('Shuffle to Sprint (5m)','DGR'),
  ('Sprint to 180 Degree COD (10m)','DGR');

-- Guards: every tag must resolve, and every tagged name must resolve to an
-- active exercise in the org (catches a typo before it silently no-ops).
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
