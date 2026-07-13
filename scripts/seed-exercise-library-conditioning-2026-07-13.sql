-- ============================================================================
-- scripts/seed-exercise-library-conditioning-2026-07-13.sql
-- ============================================================================
-- Conditioning seed (dogfooding batch 2026-07-13, operator-approved list):
-- field-session and off-feet conditioning exercises under the new
-- 'Conditioning' movement pattern (migration 20260713120000). The existing
-- 'Field' tag marks the on-feet field work; off-feet erg/machine work is
-- untagged, so pattern chip + Field tag chip separate the two.
--
-- NOT a migration (org-specific personal content). Runs against BOTH real
-- orgs — "The Odyssey. Platform" and "The Exercise Collaborative" — resolved
-- by name; created_by resolves to each org's owner. Idempotent: skips any
-- exercise whose name already exists (active) in that org.
--
-- Deliberate adjacency, flagged at review: the library already holds
-- Carry-pattern loaded sled work (Sled Sprints, Lateral Sled Drag, …); the
-- 'Sled Push'/'Sled Drag' here are the conditioning prescriptions of the
-- implement and live under Conditioning by operator decision.
--
-- Run:
--   supabase db query --linked -f scripts/seed-exercise-library-conditioning-2026-07-13.sql
-- ============================================================================

create temp table _orgs as
select o.id as org_id, o.name as org_name,
       (select r.user_id from user_organization_roles r
         where r.organization_id = o.id and r.role = 'owner' limit 1) as owner_id
from organizations o
where o.name in ('The Odyssey. Platform', 'The Exercise Collaborative');

do $$
declare v_n int; v_null int;
begin
  select count(*), count(*) filter (where owner_id is null) into v_n, v_null from _orgs;
  if v_n <> 2 then raise exception 'Expected 2 target orgs, found %', v_n; end if;
  if v_null > 0 then raise exception 'An org resolved no owner'; end if;
end $$;

create temp table _seed (
  name text, sets int, reps text, rep_metric text, metric text, is_field boolean
);

insert into _seed (name, sets, reps, rep_metric, metric, is_field) values
  -- Off-feet conditioning ----------------------------------------------------
  ('Bike Erg',                          4, '60',   'time_minsec', null, false),
  ('Airdyne Bike',                      4, '60',   'time_minsec', null, false),
  ('Row Erg',                           4, '60',   'time_minsec', null, false),
  ('Ski Erg',                           4, '60',   'time_minsec', null, false),
  ('VersaClimber',                      4, '60',   'time_minsec', null, false),
  ('Assault Runner',                    4, '60',   'time_minsec', null, false),
  ('Treadmill Run',                     1, '1200', 'time_minsec', null, false),
  ('Incline Treadmill Walk',            1, '1200', 'time_minsec', null, false),
  ('Sled Push',                         4, '20',   'distance_m',  'kg', false),
  ('Sled Drag',                         4, '20',   'distance_m',  'kg', false),
  -- Field work (Field tag) ---------------------------------------------------
  ('Tempo Run',                         6, '100',  'distance_m',  null, true),
  ('Shuttle Run',                       4, '30',   'time_minsec', null, true),
  ('Repeat Sprint Efforts',             6, '40',   'distance_m',  null, true),
  ('MAS Intervals',                    10, '15',   'time_minsec', null, true),
  ('Broken Runs / Run-Walk',            1, '1200', 'time_minsec', null, true);

-- Guard: 'Conditioning' pattern and 'Field' tag must resolve in every org.
do $$
declare v_bad text;
begin
  select string_agg(o.org_name, ', ') into v_bad
  from _orgs o
  where not exists (
    select 1 from movement_patterns mp
    where mp.organization_id = o.org_id
      and lower(mp.name) = 'conditioning' and mp.deleted_at is null
  );
  if v_bad is not null then raise exception 'No Conditioning pattern in: %', v_bad; end if;

  select string_agg(o.org_name, ', ') into v_bad
  from _orgs o
  where not exists (
    select 1 from exercise_tags t
    where t.organization_id = o.org_id
      and lower(t.name) = 'field' and t.deleted_at is null
  );
  if v_bad is not null then raise exception 'No Field tag in: %', v_bad; end if;
end $$;

create temp table _result (step text, n int);
insert into _result select 'seed_rows_per_org', count(*) from _seed;

with ins as (
  insert into exercises (
    organization_id, created_by_user_id, movement_pattern_id,
    name, default_sets, default_reps, default_rep_metric, default_metric
  )
  select o.org_id, o.owner_id, mp.id, s.name, s.sets, s.reps, s.rep_metric, s.metric
  from _seed s
  cross join _orgs o
  join movement_patterns mp
    on mp.organization_id = o.org_id
   and lower(mp.name) = 'conditioning' and mp.deleted_at is null
  where not exists (
    select 1 from exercises e
    where e.organization_id = o.org_id
      and lower(e.name) = lower(s.name) and e.deleted_at is null
  )
  returning 1
)
insert into _result select 'exercises_inserted', count(*) from ins;

with t as (
  insert into exercise_tag_assignments (exercise_id, tag_id)
  select e.id, tg.id
  from _seed s
  cross join _orgs o
  join exercises e
    on e.organization_id = o.org_id
   and lower(e.name) = lower(s.name) and e.deleted_at is null
  join exercise_tags tg
    on tg.organization_id = o.org_id
   and lower(tg.name) = 'field' and tg.deleted_at is null
  where s.is_field
  on conflict (exercise_id, tag_id) do nothing
  returning 1
)
insert into _result select 'field_tag_assignments', count(*) from t;

select step, n from _result order by step;
