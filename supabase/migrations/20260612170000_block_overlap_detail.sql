-- ============================================================================
-- 20260612170000_block_overlap_detail
-- ============================================================================
-- P1-4 of the program-calendar polish pass (docs/polish/program-calendar.md;
-- operator-reported during the P1-3 walkthrough, 2026-06-12).
--
-- What happened in the field: a day-level repeat auto-extended the active
-- block from 4 to 7 weeks. Coverage is invisible on the calendar (an empty
-- covered week looks identical to an uncovered one), so when the operator
-- then tried to copy the block into "empty" July weeks, every attempt
-- returned a bare 'overlap' — technically true, humanly unexplainable. The
-- one attempt that landed (start exactly at the extended end) succeeded
-- silently off-screen and read as another failure.
--
-- Fix at this layer: copy_program / repeat_program now PRE-CHECK the
-- candidate range against the client's active blocks and return the
-- colliding block(s) by name and range:
--   { status: 'overlap',
--     conflicts: [{ name, start_date, end_date }, …] }   -- end_date inclusive
-- The EXCLUDE constraint (programs_no_active_overlap) remains the
-- race-proof backstop inside _clone_program — its catch still returns a
-- bare 'overlap' if a concurrent write slips between check and insert.
-- _clone_program itself is untouched.
--
-- Bodies are based on the CURRENT definitions (20260503130000 — never
-- replaced since) per the function-rewrite rule. CREATE OR REPLACE re-trips
-- the Supabase auto-grant, so the anon revokes are re-applied below;
-- pgTAP 23 §A is the tripwire if this is ever forgotten.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. copy_program — overlap pre-check with block detail.
-- ----------------------------------------------------------------------------
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

  -- Overlap pre-check (P1-4): same predicate as programs_no_active_overlap,
  -- but returning WHO collides. Includes the source itself — copying into
  -- the source's own (possibly auto-extended) range is exactly the case
  -- that needs naming.
  IF src_duration IS NOT NULL THEN
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
        && daterange(p_new_start_date, (p_new_start_date + src_duration * 7)::date, '[)');

    IF v_conflicts IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'overlap', 'conflicts', v_conflicts);
    END IF;
  END IF;

  effective_name := COALESCE(NULLIF(trim(p_new_name), ''), src_name || ' (copy)');

  RETURN public._clone_program(
    p_source_program_id,
    p_new_start_date,
    effective_name
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.copy_program(uuid, date, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.copy_program(uuid, date, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.copy_program(uuid, date, text) TO authenticated;

COMMENT ON FUNCTION public.copy_program(uuid, date, text) IS
  'Clones a program (weeks, days, exercises, per-set rows) onto an EP-picked new start_date. Defaults the new name to <source.name> + " (copy)". Returns jsonb status: created | overlap | invalid_source; overlap carries conflicts[{name,start_date,end_date}] naming the colliding active block(s) (P1-4, 2026-06-12).';

-- ----------------------------------------------------------------------------
-- §2. repeat_program — same overlap detail on the back-to-back path.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.repeat_program(
  p_source_program_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org           uuid := public.user_organization_id();
  caller_role          text := public.user_role();
  src_program_org      uuid;
  src_client_id        uuid;
  src_name             text;
  src_program_start    date;
  src_program_duration smallint;
  new_start_date       date;
  v_conflicts          jsonb;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id, client_id, name, start_date, duration_weeks
    INTO src_program_org, src_client_id, src_name,
         src_program_start, src_program_duration
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

  IF src_program_start IS NULL OR src_program_duration IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_source');
  END IF;

  new_start_date := (src_program_start + (src_program_duration * 7))::date;

  -- Overlap pre-check (P1-4). The source itself never collides here —
  -- the candidate range starts exactly at the source's half-open end.
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
      && daterange(new_start_date, (new_start_date + src_program_duration * 7)::date, '[)');

  IF v_conflicts IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'overlap', 'conflicts', v_conflicts);
  END IF;

  RETURN public._clone_program(
    p_source_program_id,
    new_start_date,
    src_name || ' (next)'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.repeat_program(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.repeat_program(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.repeat_program(uuid) TO authenticated;

COMMENT ON FUNCTION public.repeat_program(uuid) IS
  'Clones a program back-to-back immediately following its end. new_start = source.start_date + duration_weeks * 7. New name = <source.name> + " (next)". Returns jsonb status: created | overlap | invalid_source; overlap carries conflicts[{name,start_date,end_date}] naming the colliding active block(s) (P1-4, 2026-06-12).';
