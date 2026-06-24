-- ============================================================================
-- scripts/tag-single-limb-exercises-orgwide-2026-06-24.sql
-- ============================================================================
-- Applies the operator's single-limb tagging rule across the WHOLE library
-- (not just the seeded set — operator instruction 2026-06-24):
--   name carries SL token  OR  B-stance  ->  "Single leg"
--   name carries SA token                ->  "Single Arm"
--
-- Token-matched, not substring-matched, to avoid false positives:
--   SL / SA are matched only as whole, UPPERCASE words (LIKE is
--   case-sensitive in Postgres), so "Sliderz", "Slam", "Sled", "Safety"
--   are NOT caught. b-stance is matched case-insensitively.
--
-- Idempotent: ON CONFLICT (exercise_id, tag_id) DO NOTHING — an exercise
-- already carrying the tag is skipped, so this only fills gaps. Safe to
-- re-run (e.g. after adding more SL/SA/B-stance exercises later).
--
-- Both tags must already exist in the org (they do). The final SELECT
-- reports exactly which (tag, exercise) pairs were newly created.
--
-- Run:
--   supabase db query --linked -f scripts/tag-single-limb-exercises-orgwide-2026-06-24.sql
-- ============================================================================

-- Guard: both tags must exist (fail loud rather than silently tag nothing).
do $$
begin
  if not exists (
    select 1 from exercise_tags
    where organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
      and lower(name) = 'single leg' and deleted_at is null
  ) or not exists (
    select 1 from exercise_tags
    where organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
      and lower(name) = 'single arm' and deleted_at is null
  ) then
    raise exception 'Missing "Single leg" or "Single Arm" tag in org';
  end if;
end $$;

with sl as (
  insert into exercise_tag_assignments (exercise_id, tag_id)
  select
    e.id,
    (select id from exercise_tags
       where organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
         and lower(name) = 'single leg' and deleted_at is null)
  from exercises e
  where e.organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
    and e.deleted_at is null
    and (
      e.name = 'SL' or e.name like 'SL %' or e.name like '% SL %' or e.name like '% SL'
      or e.name ilike '%b-stance%'
    )
  on conflict (exercise_id, tag_id) do nothing
  returning exercise_id
),
sa as (
  insert into exercise_tag_assignments (exercise_id, tag_id)
  select
    e.id,
    (select id from exercise_tags
       where organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
         and lower(name) = 'single arm' and deleted_at is null)
  from exercises e
  where e.organization_id = '33d23c20-4c41-42c9-8918-ec663895ea56'::uuid
    and e.deleted_at is null
    and (
      e.name = 'SA' or e.name like 'SA %' or e.name like '% SA %' or e.name like '% SA'
    )
  on conflict (exercise_id, tag_id) do nothing
  returning exercise_id
)
select 'Single leg' as tag, e.name
  from sl join exercises e on e.id = sl.exercise_id
union all
select 'Single Arm' as tag, e.name
  from sa join exercises e on e.id = sa.exercise_id
order by 1, 2;
