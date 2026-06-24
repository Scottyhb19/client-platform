-- ============================================================================
-- scripts/seed-exercise-library-tags-2026-06-24.sql
-- ============================================================================
-- Follow-up to scripts/seed-exercise-library-2026-06-24.sql: applies the two
-- single-limb tags the operator specified after the seed run (2026-06-24):
--   SL  or  B-stance  ->  "Single leg"
--   SA                ->  "Single Arm"   (existing org tag; capital A)
--
-- Scope: ONLY the 32 exercises added by the seed script (matched by exact
-- name). Pre-existing single-limb exercises (SL RDL, Standing SA BB Press,
-- B-stance TB Deadlift, ...) are deliberately left untouched — they predate
-- this seed and are the operator's own to tag.
--
-- Both tags already exist in the org, so nothing new is created. Tags are
-- resolved case-insensitively to the live tag, so "Single Arm" is reused
-- rather than a duplicate "Single arm" being introduced.
--
-- Idempotent: ON CONFLICT (exercise_id, tag_id) DO NOTHING, so re-running
-- adds nothing the second time.
--
-- Run:
--   supabase db query --linked -f scripts/seed-exercise-library-tags-2026-06-24.sql
-- ============================================================================

create temp table _tagseed (name text, tag text);

insert into _tagseed (name, tag) values
  -- Single leg — SL ---------------------------------------------------------
  ('SL BB RDL',                          'Single leg'),
  ('SL Hip Thrust',                      'Single leg'),
  ('SL Lateral Step-Up',                 'Single leg'),
  ('KB SL Squat',                        'Single leg'),
  ('SL Leg Extension',                   'Single leg'),
  ('SL Pogo',                            'Single leg'),
  ('SL Box Jump',                        'Single leg'),
  ('SL Broad Jump',                      'Single leg'),
  ('SL Lateral Bound (skater)',          'Single leg'),
  ('SL Continuous Hop (distance)',       'Single leg'),
  -- Single leg — B-stance ---------------------------------------------------
  ('B-stance Trap Bar RDL',              'Single leg'),
  ('B-Stance DB RDL',                    'Single leg'),
  ('B-Stance BB RDL',                    'Single leg'),
  ('B-Stance Hip Thrust',                'Single leg'),
  -- Single Arm — SA ---------------------------------------------------------
  ('SA DB Bench Press',                  'Single Arm'),
  ('SA DB Shoulder Press',               'Single Arm'),
  ('SA DB Push Press',                   'Single Arm'),
  ('Half-Kneeling SA DB Shoulder Press', 'Single Arm'),
  ('SA Landmine Press',                  'Single Arm'),
  ('Half-Kneeling SA Landmine Press',    'Single Arm'),
  ('SA Half-Kneeling Lat Pulldown',      'Single Arm'),
  ('SA DB Row (bench-supported)',        'Single Arm'),
  ('SA Landmine Row',                    'Single Arm'),
  ('SA Half-Kneeling Cable Row',         'Single Arm'),
  ('Standing SA Row',                    'Single Arm'),
  ('SA Suitcase Carry (DB)',             'Single Arm'),
  ('SA Suitcase Carry (KB)',             'Single Arm'),
  ('DB SA Overhead Carry',               'Single Arm'),
  ('SA Bottoms-Up KB Carry',             'Single Arm'),
  ('SA Cable Lateral Raise',             'Single Arm'),
  ('SA DB Overhead Extension',           'Single Arm'),
  ('SA Med Ball Throw',                  'Single Arm');

-- Guard: every name must resolve to an active exercise, and every tag to an
-- active tag, in this org. Fail loud otherwise (a typo would silently skip).
do $$
declare
  v_bad text;
begin
  select string_agg(ts.name, ', ' order by ts.name)
    into v_bad
  from _tagseed ts
  where not exists (
    select 1 from exercises e
    where e.organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
      and lower(e.name) = lower(ts.name)
      and e.deleted_at is null
  );
  if v_bad is not null then
    raise exception 'Unresolved exercise names: %', v_bad;
  end if;

  select string_agg(distinct ts.tag, ', ')
    into v_bad
  from _tagseed ts
  where not exists (
    select 1 from exercise_tags t
    where t.organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
      and lower(t.name) = lower(ts.tag)
      and t.deleted_at is null
  );
  if v_bad is not null then
    raise exception 'Unresolved tags: %', v_bad;
  end if;
end $$;

-- Apply the assignments, skipping any that already exist.
with ins as (
  insert into exercise_tag_assignments (exercise_id, tag_id)
  select e.id, t.id
  from _tagseed ts
  join exercises e
    on e.organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
   and lower(e.name) = lower(ts.name)
   and e.deleted_at is null
  join exercise_tags t
    on t.organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
   and lower(t.name) = lower(ts.tag)
   and t.deleted_at is null
  on conflict (exercise_id, tag_id) do nothing
  returning 1
)
select
  (select count(*) from _tagseed) as tagseed_rows,
  (select count(*) from ins)      as assignments_inserted;
