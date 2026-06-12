-- ============================================================================
-- 20260612160000_program_week_copy_repeat
-- ============================================================================
-- P1-1 of the program-calendar polish pass (docs/polish/program-calendar.md,
-- FM-5; Q1 sign-off = option a, amended). Week-level batch operations:
--
--   copy_program_week   — clone every programmed day in a Mon–Sun source
--                         week onto the same weekday offsets in a target
--                         week.
--   repeat_program_week — clone the whole source week onto each subsequent
--                         week through an end date (day-granular cutoff:
--                         a day whose target lands past p_end_date is
--                         excluded, matching repeat_program_day_weekly).
--
-- Design: both are ORCHESTRATORS over public.copy_program_day (the G-1-fixed
-- clone path verified by pgTAP 10/23). Pass 1 buckets every (source day →
-- target date) pair into {will-create, conflict, no-program} so the UI can
-- show one confirm dialog for the whole operation; pass 2 calls
-- copy_program_day(source, target, true) per pair — force=true is safe
-- because pass 1 already gated conflicts (or the caller forced). Each call
-- clones exercises, remaps superset groups, and fans out per-set rows; the
-- whole week operation is one function call = one transaction, so a failure
-- anywhere rolls back everything. Trade-off, documented: pass 1 duplicates
-- copy_program_day's ~10-line conflict detection rather than refactoring a
-- shared helper out of it — zero churn on clone internals that were
-- verified the same day this migration landed.
--
-- TOCTOU between pass 1 and pass 2 (a day created concurrently could be
-- overwritten by pass 2's force=true) is the same accepted window as
-- repeat_program_day_weekly — Q-D concurrency acceptance, re-accepted at
-- friends-and-family scale in the section-6 premortem.
--
-- Statuses (UI contract, mirroring the day-level family):
--   copy_program_week:   created | conflict | empty_week | invalid_week
--   repeat_program_week: created | conflict | empty_week | invalid_week
--                        | invalid_end_date
--   Both report out-of-coverage targets in no_program_dates.
--
-- Also in this migration (operator-approved 2026-06-12, recorded in
-- docs/go-live-checklist.md §4): lock down the _test_* pgTAP fixture
-- helpers, which the P0-1 live probe found anon-executable. See §3.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. copy_program_week
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.copy_program_week(
  p_client_id         uuid,
  p_source_week_start date,
  p_target_week_start date,
  p_force             boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org       uuid := public.user_organization_id();
  caller_role      text := public.user_role();
  v_client_org     uuid;
  v_src            record;
  v_target         date;
  v_target_program uuid;
  v_existing       uuid;
  v_result         jsonb;
  v_found_any      boolean := false;
  conflicts        jsonb := '[]'::jsonb;
  no_program_dates jsonb := '[]'::jsonb;
  new_day_ids      jsonb := '[]'::jsonb;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id INTO v_client_org
    FROM clients
   WHERE id = p_client_id
     AND deleted_at IS NULL;

  IF v_client_org IS NULL OR v_client_org <> caller_org THEN
    RAISE EXCEPTION 'Client not in your organization'
      USING ERRCODE = '42501';
  END IF;

  -- Week starts must be Mondays (the calendar's week rows are Mon-first by
  -- construction) and the target must be a different week.
  IF EXTRACT(ISODOW FROM p_source_week_start) <> 1
     OR EXTRACT(ISODOW FROM p_target_week_start) <> 1
     OR p_target_week_start = p_source_week_start THEN
    RETURN jsonb_build_object('status', 'invalid_week');
  END IF;

  -- Pass 1: bucket every source day's target into {create, conflict,
  -- no-program}. Source days = what the EP sees on the calendar: live days
  -- of the client's live ACTIVE programs.
  FOR v_src IN
    SELECT pd.id, pd.scheduled_date
      FROM program_days pd
      JOIN programs p ON p.id = pd.program_id
     WHERE p.client_id = p_client_id
       AND p.organization_id = caller_org
       AND p.status = 'active'
       AND p.deleted_at IS NULL
       AND pd.deleted_at IS NULL
       AND pd.scheduled_date >= p_source_week_start
       AND pd.scheduled_date <  p_source_week_start + 7
     ORDER BY pd.scheduled_date, pd.sort_order
  LOOP
    v_found_any := true;
    v_target := p_target_week_start + (v_src.scheduled_date - p_source_week_start);
    v_target_program := public._program_for_date(p_client_id, v_target);

    IF v_target_program IS NULL THEN
      no_program_dates := no_program_dates || to_jsonb(v_target);
    ELSE
      SELECT id INTO v_existing
        FROM program_days
       WHERE program_id = v_target_program
         AND scheduled_date = v_target
         AND deleted_at IS NULL;

      IF v_existing IS NOT NULL THEN
        conflicts := conflicts || jsonb_build_object(
          'date', v_target,
          'existing_day_id', v_existing
        );
      END IF;
    END IF;
  END LOOP;

  IF NOT v_found_any THEN
    RETURN jsonb_build_object('status', 'empty_week');
  END IF;

  IF jsonb_array_length(conflicts) > 0 AND NOT p_force THEN
    RETURN jsonb_build_object(
      'status', 'conflict',
      'conflicts', conflicts,
      'no_program_dates', no_program_dates
    );
  END IF;

  -- Pass 2: delegate each pair to the verified day-clone path. force=true:
  -- conflicts were either absent (pass 1) or confirmed by the caller.
  FOR v_src IN
    SELECT pd.id, pd.scheduled_date
      FROM program_days pd
      JOIN programs p ON p.id = pd.program_id
     WHERE p.client_id = p_client_id
       AND p.organization_id = caller_org
       AND p.status = 'active'
       AND p.deleted_at IS NULL
       AND pd.deleted_at IS NULL
       AND pd.scheduled_date >= p_source_week_start
       AND pd.scheduled_date <  p_source_week_start + 7
     ORDER BY pd.scheduled_date, pd.sort_order
  LOOP
    v_target := p_target_week_start + (v_src.scheduled_date - p_source_week_start);
    v_result := public.copy_program_day(v_src.id, v_target, true);

    IF v_result->>'status' = 'created' THEN
      new_day_ids := new_day_ids || (v_result->'new_day_id');
    END IF;
    -- no_program between passes: already reported by pass 1; skip silently
    -- (same tolerance as repeat_program_day_weekly's second pass).
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'created',
    'new_day_ids', new_day_ids,
    'no_program_dates', no_program_dates
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.copy_program_week(uuid, date, date, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.copy_program_week(uuid, date, date, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.copy_program_week(uuid, date, date, boolean) TO authenticated;

COMMENT ON FUNCTION public.copy_program_week(uuid, date, date, boolean) IS
  'Clones every live day in the Mon-Sun week starting p_source_week_start onto the same weekday offsets in the week starting p_target_week_start, delegating each day to copy_program_day (exercises, superset remap, per-set fan-out). Returns jsonb status: created | conflict | empty_week | invalid_week; out-of-coverage targets in no_program_dates. p_force=true overwrites conflicting days. SECURITY DEFINER + manual org gate. P1-1, program-calendar polish pass 2026-06-12.';

-- ----------------------------------------------------------------------------
-- §2. repeat_program_week
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.repeat_program_week(
  p_client_id         uuid,
  p_source_week_start date,
  p_end_date          date,
  p_force             boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org        uuid := public.user_organization_id();
  caller_role       text := public.user_role();
  v_client_org      uuid;
  v_src             record;
  v_offset          int;
  v_target          date;
  v_target_program  uuid;
  v_existing        uuid;
  v_result          jsonb;
  v_found_any       boolean := false;
  v_anchor_program  uuid;
  v_anchor_start    date;
  v_anchor_duration int;
  required_duration int;
  conflicts         jsonb := '[]'::jsonb;
  no_program_dates  jsonb := '[]'::jsonb;
  new_day_ids       jsonb := '[]'::jsonb;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id INTO v_client_org
    FROM clients
   WHERE id = p_client_id
     AND deleted_at IS NULL;

  IF v_client_org IS NULL OR v_client_org <> caller_org THEN
    RAISE EXCEPTION 'Client not in your organization'
      USING ERRCODE = '42501';
  END IF;

  IF EXTRACT(ISODOW FROM p_source_week_start) <> 1 THEN
    RETURN jsonb_build_object('status', 'invalid_week');
  END IF;

  -- End date must reach past the source week, and is capped at 105 weeks
  -- (~2 years) out — beyond any real programming horizon. The cap bounds
  -- the loop below; the day-level repeat has no cap (accepted), but a week
  -- repeat multiplies the work by up to 7 days, so the bound is cheap
  -- insurance against a runaway input.
  IF p_end_date <= p_source_week_start + 6
     OR p_end_date > p_source_week_start + (7 * 105) THEN
    RETURN jsonb_build_object('status', 'invalid_end_date');
  END IF;

  -- Anchor for auto-extend: the program covering the LATEST source day in
  -- the week (the one whose range the repeat runs past). Dominant case is
  -- a single block; if the source week straddles a block boundary, only
  -- the later block is extended and any still-uncovered targets are
  -- reported in no_program_dates — same fallback as the day-level repeat.
  SELECT p.id, p.start_date, p.duration_weeks
    INTO v_anchor_program, v_anchor_start, v_anchor_duration
    FROM program_days pd
    JOIN programs p ON p.id = pd.program_id
   WHERE p.client_id = p_client_id
     AND p.organization_id = caller_org
     AND p.status = 'active'
     AND p.deleted_at IS NULL
     AND pd.deleted_at IS NULL
     AND pd.scheduled_date >= p_source_week_start
     AND pd.scheduled_date <  p_source_week_start + 7
   ORDER BY pd.scheduled_date DESC, pd.sort_order DESC
   LIMIT 1;

  IF v_anchor_program IS NULL THEN
    RETURN jsonb_build_object('status', 'empty_week');
  END IF;

  IF v_anchor_start IS NOT NULL AND v_anchor_duration IS NOT NULL THEN
    required_duration := (p_end_date - v_anchor_start) / 7 + 1;
    IF required_duration > v_anchor_duration THEN
      BEGIN
        UPDATE programs
           SET duration_weeks = required_duration
         WHERE id = v_anchor_program;
      EXCEPTION WHEN exclusion_violation THEN
        NULL;  -- extending would overlap another block; fall back to
               -- per-date coverage (uncovered dates reported below).
      END;
    END IF;
  END IF;

  -- Pass 1: bucket every (source day x target week) pair.
  v_offset := 7;
  WHILE p_source_week_start + v_offset <= p_end_date LOOP
    FOR v_src IN
      SELECT pd.id, pd.scheduled_date
        FROM program_days pd
        JOIN programs p ON p.id = pd.program_id
       WHERE p.client_id = p_client_id
         AND p.organization_id = caller_org
         AND p.status = 'active'
         AND p.deleted_at IS NULL
         AND pd.deleted_at IS NULL
         AND pd.scheduled_date >= p_source_week_start
         AND pd.scheduled_date <  p_source_week_start + 7
       ORDER BY pd.scheduled_date, pd.sort_order
    LOOP
      v_found_any := true;
      v_target := v_src.scheduled_date + v_offset;
      EXIT WHEN v_target > p_end_date;  -- day-granular cutoff within the
                                        -- final partial week (dates ordered
                                        -- ascending, so the rest are out too)

      v_target_program := public._program_for_date(p_client_id, v_target);

      IF v_target_program IS NULL THEN
        no_program_dates := no_program_dates || to_jsonb(v_target);
      ELSE
        SELECT id INTO v_existing
          FROM program_days
         WHERE program_id = v_target_program
           AND scheduled_date = v_target
           AND deleted_at IS NULL;

        IF v_existing IS NOT NULL THEN
          conflicts := conflicts || jsonb_build_object(
            'date', v_target,
            'existing_day_id', v_existing
          );
        END IF;
      END IF;
    END LOOP;

    v_offset := v_offset + 7;
  END LOOP;

  IF NOT v_found_any THEN
    RETURN jsonb_build_object('status', 'empty_week');
  END IF;

  IF jsonb_array_length(conflicts) > 0 AND NOT p_force THEN
    RETURN jsonb_build_object(
      'status', 'conflict',
      'conflicts', conflicts,
      'no_program_dates', no_program_dates
    );
  END IF;

  -- Pass 2: delegate to the verified day-clone path.
  v_offset := 7;
  WHILE p_source_week_start + v_offset <= p_end_date LOOP
    FOR v_src IN
      SELECT pd.id, pd.scheduled_date
        FROM program_days pd
        JOIN programs p ON p.id = pd.program_id
       WHERE p.client_id = p_client_id
         AND p.organization_id = caller_org
         AND p.status = 'active'
         AND p.deleted_at IS NULL
         AND pd.deleted_at IS NULL
         AND pd.scheduled_date >= p_source_week_start
         AND pd.scheduled_date <  p_source_week_start + 7
         -- Exclude days pass 2 itself just created in earlier target weeks:
         -- only days that existed when the call started belong to the
         -- source week, and the source week's range already guarantees
         -- that. (Targets are always >= source_week_start + 7.)
       ORDER BY pd.scheduled_date, pd.sort_order
    LOOP
      v_target := v_src.scheduled_date + v_offset;
      EXIT WHEN v_target > p_end_date;

      v_target_program := public._program_for_date(p_client_id, v_target);
      IF v_target_program IS NOT NULL THEN
        v_result := public.copy_program_day(v_src.id, v_target, true);
        IF v_result->>'status' = 'created' THEN
          new_day_ids := new_day_ids || (v_result->'new_day_id');
        END IF;
      END IF;
    END LOOP;

    v_offset := v_offset + 7;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'created',
    'new_day_ids', new_day_ids,
    'no_program_dates', no_program_dates
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.repeat_program_week(uuid, date, date, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.repeat_program_week(uuid, date, date, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.repeat_program_week(uuid, date, date, boolean) TO authenticated;

COMMENT ON FUNCTION public.repeat_program_week(uuid, date, date, boolean) IS
  'Clones the Mon-Sun week starting p_source_week_start onto every subsequent week through p_end_date (day-granular cutoff, 105-week cap), delegating each day to copy_program_day. Auto-extends the latest covering block, best-effort (23P01 falls back to per-date coverage). Returns jsonb status: created | conflict | empty_week | invalid_week | invalid_end_date; out-of-coverage targets in no_program_dates. SECURITY DEFINER + manual org gate. P1-1, program-calendar polish pass 2026-06-12.';

-- ----------------------------------------------------------------------------
-- §3. _test_* fixture-helper lockdown (operator-approved 2026-06-12).
--
-- The P0-1 live grant probe found every pgTAP fixture helper anon- AND
-- authenticated-executable on the live project (the same auto-grant trap).
-- Several are SECURITY DEFINER WRITE helpers that deliberately bypass
-- normal flow (user creation, membership grants, fixture inserts) — anon-
-- reachable they are a tenant-boundary bypass, not defence-in-depth. The
-- test runner connects as the database owner and every _test_* call in the
-- suite happens BEFORE `SET [LOCAL] ROLE authenticated` (verified across
-- tests 05-23), so no API role needs EXECUTE. Suite re-run after this
-- migration is the empirical proof.
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._test_clear_jwt()                                   FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._test_set_jwt(uuid, uuid, text)                     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._test_make_user(text)                               FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._test_grant_membership(uuid, uuid, user_role)       FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._test_insert_test_session(uuid, uuid, uuid, uuid, timestamptz, test_source_t) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._test_insert_test_result(uuid, uuid, text, text, test_side_t, numeric, text)  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._test_insert_client_publication(uuid, uuid, uuid, text, text)                 FROM anon, authenticated;
