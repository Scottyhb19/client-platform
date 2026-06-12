-- ============================================================================
-- Section 5 (program engine + session builder) — operator verification pack
-- ============================================================================
-- READ-ONLY. Paste the whole thing into the Supabase SQL Editor and Run.
-- Nothing here mutates data. It returns ONE grid: one row per check with an
-- `ok` column. If every `ok` is true, the structural claims in the closing
-- commit hold on the live database. `detail` shows the evidence.
--
-- (Org id 33d23c20-… and client 0ff9c22b-… are your operator org and the
-- "Scott Official Test Block" seed client — adjust only if you verify a
-- different org.)
-- ----------------------------------------------------------------------------
with checks as (
  -- 1. The three migrations this pass added are applied.
  select '1. migrations applied' as check_name,
         (select string_agg(version, ', ' order by version)
            from supabase_migrations.schema_migrations
           where version in ('20260612100000','20260612110000','20260612120000')) as detail,
         (select count(*) = 3 from supabase_migrations.schema_migrations
           where version in ('20260612100000','20260612110000','20260612120000')) as ok
  union all
  -- 2. G-1: all four clone RPCs fan out per-set rows.
  select '2. G-1 clone RPCs fan out per-set rows',
         (select string_agg(p.proname, ', ' order by p.proname)
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname='public'
             and p.proname in ('copy_program_day','repeat_program_day_weekly','_clone_program','duplicate_program_day')
             and pg_get_functiondef(p.oid) ilike '%insert into program_exercise_sets%'),
         (select count(*) = 4
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname='public'
             and p.proname in ('copy_program_day','repeat_program_day_weekly','_clone_program','duplicate_program_day')
             and pg_get_functiondef(p.oid) ilike '%insert into program_exercise_sets%')
  union all
  -- 3. G-3: exactly one insert_program_exercise_at, the 4-arg p_slot version
  --    (two rows would mean the old 3-arg overload survived the DROP).
  select '3. G-3 insert RPC: single p_slot signature',
         (select string_agg(pg_get_function_identity_arguments(p.oid), '  |  ')
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname='public' and p.proname='insert_program_exercise_at'),
         (select count(*) = 1
            and bool_and(pg_get_function_identity_arguments(p.oid) ilike '%p_slot%')
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname='public' and p.proname='insert_program_exercise_at')
  union all
  -- 4. G-2: template per-set table exists, RLS on, 4 policies.
  select '4. G-2 template_exercise_sets: RLS + 4 policies',
         'rls=' || coalesce((select c.relrowsecurity::text from pg_class c
                               join pg_namespace n on n.oid=c.relnamespace
                              where n.nspname='public' and c.relname='template_exercise_sets'),'MISSING')
           || ', policies=' || (select count(*)::text from pg_policies
                                 where schemaname='public' and tablename='template_exercise_sets'),
         coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='public' and c.relname='template_exercise_sets'), false)
           and (select count(*) = 4 from pg_policies
                 where schemaname='public' and tablename='template_exercise_sets')
  union all
  -- 5. G-2: both lifecycle RPCs present.
  select '5. G-2 lifecycle RPCs present',
         (select string_agg(proname, ', ' order by proname)
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and proname in ('save_program_as_template','create_program_from_template')),
         (select count(*) = 2 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and proname in ('save_program_as_template','create_program_from_template'))
  union all
  -- 6. Security gate: anon (logged-out) cannot EXECUTE any of these
  --    SECURITY DEFINER functions (the go-live grant-sweep check).
  select '6. security: anon cannot EXECUTE these funcs',
         (select string_agg(p.proname || '=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text, ', ' order by p.proname)
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public'
             and p.proname in ('save_program_as_template','create_program_from_template',
                               'copy_program_day','repeat_program_day_weekly','_clone_program','insert_program_exercise_at')),
         (select bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE'))
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public'
             and p.proname in ('save_program_as_template','create_program_from_template',
                               'copy_program_day','repeat_program_day_weekly','_clone_program','insert_program_exercise_at'))
  union all
  -- 7. Cleanliness: no throwaway verification users remain.
  select '7. no leftover verification users',
         (select count(*)::text from auth.users where email like 'lib-verify-%'),
         (select count(*) = 0 from auth.users where email like 'lib-verify-%')
  union all
  -- 8. Cleanliness: no LIVE verification templates/programs remain.
  select '8. no live verification artifacts',
         'templates=' || (select count(*)::text from program_templates
                            where deleted_at is null and (name ilike '%verify%' or name ilike '%delete me%'))
           || ', repeat-blocks=' || (select count(*)::text from programs
                                      where deleted_at is null and name ilike '%(next)%'
                                        and client_id='0ff9c22b-57d1-4d13-afa2-73dc78986746'),
         (select count(*) = 0 from program_templates
           where deleted_at is null and (name ilike '%verify%' or name ilike '%delete me%'))
           and (select count(*) = 0 from programs
                 where deleted_at is null and name ilike '%(next)%'
                   and client_id='0ff9c22b-57d1-4d13-afa2-73dc78986746')
  union all
  -- 9. Informational: live section-title count for your org (10 seeded
  --    defaults + any you've added; ok is always true — this is a readout).
  select '9. section titles live count (info only)',
         (select count(*)::text from section_titles
           where organization_id='33d23c20-4c41-42c9-8918-ec663895ea56' and deleted_at is null),
         true
)
select check_name, ok, detail from checks order by check_name;
