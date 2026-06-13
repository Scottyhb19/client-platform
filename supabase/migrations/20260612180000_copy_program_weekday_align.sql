-- ============================================================================
-- 20260612180000_copy_program_weekday_align
-- ============================================================================
-- P1-4 issue 5 of the program-calendar polish pass (operator-reported during
-- the P1-3 re-walkthrough, 2026-06-12).
--
-- What happened: copying a block onto a new start date shifted every session
-- by the RAW calendar-day delta (new_start - source_start). When the EP
-- picked a different weekday than the source's start (e.g. clicked Monday
-- 15 Jun for a block that started Friday 8 May — a 38-day, non-week-multiple
-- shift), every session moved 3 weekdays: a Tue/Thu block became Fri/Sun.
-- The operator's rule: "no matter what day you click it should match the
-- same days as the previous block."
--
-- Fix: copy_program ALIGNS the picked start so the clone shift is always a
-- whole number of weeks, which preserves every session's weekday. The
-- aligned start is the source-start weekday placed within the picked date's
-- Mon–Sun week:
--     aligned = picked - isodow(picked) + isodow(source_start)
-- (both reduce to the same Monday-of-week + source-weekday-offset, so
-- aligned - source_start is always a multiple of 7). The picked date still
-- chooses WHICH week; alignment only fixes the weekday.
--
-- repeat_program is untouched — its computed start is source_start +
-- duration_weeks*7, already a whole-week multiple, so it never misaligned.
-- _clone_program is untouched (it faithfully shifts by aligned - source).
--
-- Built on the 20260612170000 copy_program body (overlap pre-check with
-- block detail) per the function-rewrite rule. The overlap check now runs
-- against the ALIGNED start. CREATE OR REPLACE re-trips the Supabase
-- auto-grant, so the anon revoke is re-applied; pgTAP 23 §A is the tripwire.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.copy_program(
  p_source_program_id uuid,
  p_new_start_date    date,
  p_new_name          text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org      uuid := public.user_organization_id();
  caller_role     text := public.user_role();
  src_program_org uuid;
  src_client_id   uuid;
  src_name        text;
  src_start       date;
  src_duration    smallint;
  aligned_start   date;
  effective_name  text;
  v_conflicts     jsonb;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id, client_id, name, start_date, duration_weeks
    INTO src_program_org, src_client_id, src_name, src_start, src_duration
    FROM programs
   WHERE id = p_source_program_id
     AND deleted_at IS NULL;

  IF src_program_org IS NULL THEN
    RAISE EXCEPTION 'Source program % not found', p_source_program_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF src_program_org <> caller_org THEN
    RAISE EXCEPTION 'Source program not in your organization'
      USING ERRCODE = '42501';
  END IF;

  IF src_start IS NULL OR src_duration IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_source');
  END IF;

  -- Weekday alignment (issue 5): place the source's start weekday within the
  -- picked date's Mon–Sun week. The result differs from the picked date by a
  -- whole number of weeks from source_start, so every cloned session keeps
  -- its weekday. The picked date still selects the week.
  aligned_start := p_new_start_date
                 - EXTRACT(ISODOW FROM p_new_start_date)::int
                 + EXTRACT(ISODOW FROM src_start)::int;

  -- Overlap pre-check (P1-4 issue 1) against the ALIGNED start.
  SELECT jsonb_agg(
           jsonb_build_object(
             'name',       p.name,
             'start_date', p.start_date,
             'end_date',   (p.start_date + p.duration_weeks * 7 - 1)
           )
           ORDER BY p.start_date
         )
    INTO v_conflicts
    FROM programs p
   WHERE p.client_id = src_client_id
     AND p.status = 'active'
     AND p.deleted_at IS NULL
     AND p.start_date IS NOT NULL
     AND p.duration_weeks IS NOT NULL
     AND daterange(p.start_date, (p.start_date + p.duration_weeks * 7)::date, '[)')
      && daterange(aligned_start, (aligned_start + src_duration * 7)::date, '[)');

  IF v_conflicts IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'overlap', 'conflicts', v_conflicts);
  END IF;

  effective_name := COALESCE(NULLIF(trim(p_new_name), ''), src_name || ' (copy)');

  RETURN public._clone_program(
    p_source_program_id,
    aligned_start,
    effective_name
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.copy_program(uuid, date, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.copy_program(uuid, date, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.copy_program(uuid, date, text) TO authenticated;

COMMENT ON FUNCTION public.copy_program(uuid, date, text) IS
  'Clones a program (weeks, days, exercises, per-set rows) onto an EP-picked start date, ALIGNED to preserve source session weekdays (shift is always whole weeks; picked date chooses the week). Defaults the new name to <source.name> + " (copy)". Returns jsonb status: created | overlap | invalid_source; overlap carries conflicts[{name,start_date,end_date}]. Weekday alignment added 2026-06-12 (P1-4 issue 5).';
