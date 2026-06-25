-- ============================================================================
-- 20260625120000_loose_one_off_sessions
-- ============================================================================
-- Why: item 3 of the 2026-06-25 dogfooding batch — "you should be able to go
-- to the calendar without needing a block ... and create one-off sessions."
-- See docs/polish/one-off-sessions.md (G3-1, G3-2).
--
-- Approach (owner-approved 2026-06-25): a per-client hidden "loose" container
-- program. One-off sessions on dates no dated block covers attach to it. The
-- container is a NORMAL programs row — same RLS, same audit, same portal
-- visibility path — so this adds NO new security surface and NO nullable
-- program_id. `is_loose = true` + null start_date/duration_weeks distinguishes
-- it from an authored block.
--
-- Safe for the shared dev/prod DB (pre-launch, no real client data —
-- CLAUDE.md): ADD COLUMN is additive (DEFAULT false, no rewrite); the index
-- is empty on creation (no existing loose rows); create_program_day is
-- CREATE OR REPLACE (no signature change, no DROP — the deployed master still
-- calls it, and only ever on block-covered dates, so its behaviour there is
-- unchanged).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. is_loose flag + one-container-per-client guarantee.
--
-- The partial unique index is the race backstop: two tabs creating the first
-- one-off for the same client cannot mint two containers (the ON CONFLICT in
-- §2 targets this index).
-- ----------------------------------------------------------------------------
ALTER TABLE programs
  ADD COLUMN is_loose boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN programs.is_loose IS
  'TRUE marks the per-client hidden "one-off sessions" container (item 3, 2026-06-25). Such a row has NULL start_date/duration_weeks, status=active, and is excluded from the dated-block surfaces (calendar block list, current-block resolution, "Active" tag). One live container per client (programs_one_loose_per_client_idx).';

CREATE UNIQUE INDEX programs_one_loose_per_client_idx
  ON programs (client_id)
  WHERE is_loose AND deleted_at IS NULL;

-- Note on programs_no_active_overlap (20260503110000): its WHERE clause fires
-- only when start_date AND duration_weeks are both NOT NULL, so a null-date
-- loose container is ignored by it and coexists with active dated blocks.


-- ----------------------------------------------------------------------------
-- §2. create_program_day — fall back to the loose container instead of
--     returning 'no_program' when no dated block covers the target date.
--
-- Based on the latest body (20260504130000); only the IF target_program IS
-- NULL branch changes. The get-or-create is INLINED (no new public function,
-- so no new anon-EXECUTE surface to sweep) and race-safe via ON CONFLICT
-- against programs_one_loose_per_client_idx.
--
-- 'no_program' is now effectively unreachable for a valid client; the return
-- shape is kept (callers still branch on it defensively).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_program_day(
  p_client_id   uuid,
  p_target_date date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org         uuid := public.user_organization_id();
  caller_role        text := public.user_role();
  client_org         uuid;
  target_program     uuid;
  target_program_org uuid;
  existing_day_id    uuid;
  next_sort_order    int;
  new_day_id         uuid;
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id INTO client_org
    FROM clients
   WHERE id = p_client_id
     AND deleted_at IS NULL;

  IF client_org IS NULL OR client_org <> caller_org THEN
    RAISE EXCEPTION 'Client % not in your organization', p_client_id
      USING ERRCODE = '42501';
  END IF;

  -- A dated block covering the date wins (unchanged behaviour).
  target_program := public._program_for_date(p_client_id, p_target_date);

  -- No dated block — get-or-create the client's loose one-off container.
  IF target_program IS NULL THEN
    SELECT id INTO target_program
      FROM programs
     WHERE client_id = p_client_id
       AND is_loose
       AND deleted_at IS NULL
     LIMIT 1;

    IF target_program IS NULL THEN
      INSERT INTO programs (organization_id, client_id, name, status, is_loose)
      VALUES (caller_org, p_client_id, 'One-off sessions', 'active', true)
      ON CONFLICT (client_id) WHERE (is_loose AND deleted_at IS NULL)
        DO NOTHING
      RETURNING id INTO target_program;

      -- Lost the race (a concurrent call created it first) — re-select.
      IF target_program IS NULL THEN
        SELECT id INTO target_program
          FROM programs
         WHERE client_id = p_client_id
           AND is_loose
           AND deleted_at IS NULL
         LIMIT 1;
      END IF;
    END IF;

    -- Defensive: should be impossible after get-or-create.
    IF target_program IS NULL THEN
      RAISE EXCEPTION 'Could not resolve a one-off container for client %',
        p_client_id USING ERRCODE = 'internal_error';
    END IF;
  END IF;

  SELECT organization_id INTO target_program_org
    FROM programs WHERE id = target_program;

  IF target_program_org <> caller_org THEN
    RAISE EXCEPTION 'Target program not in your organization'
      USING ERRCODE = '42501';
  END IF;

  -- One session per date per program (defensive against double-click races).
  SELECT id INTO existing_day_id
    FROM program_days
   WHERE program_id = target_program
     AND scheduled_date = p_target_date
     AND deleted_at IS NULL;

  IF existing_day_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'conflict',
      'existing_day_id', existing_day_id
    );
  END IF;

  next_sort_order := 0;

  INSERT INTO program_days (
    program_id, program_week_id, day_label, scheduled_date, sort_order
  ) VALUES (
    target_program,
    NULL,
    'Day 1',
    p_target_date,
    next_sort_order
  )
  RETURNING id INTO new_day_id;

  RETURN jsonb_build_object(
    'status', 'created',
    'new_day_id', new_day_id
  );
END;
$$;

-- Grants persist across CREATE OR REPLACE (the function OID is stable), but
-- re-assert for clarity and to keep anon off (the calendar RPC sweep,
-- 20260612150000).
REVOKE EXECUTE ON FUNCTION public.create_program_day(uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_program_day(uuid, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_program_day(uuid, date) TO authenticated;

COMMENT ON FUNCTION public.create_program_day(uuid, date) IS
  'D-PROG-004 + item 3 (2026-06-25): create an ad-hoc program_day on p_target_date for p_client_id. A dated active block covering the date wins; otherwise the day attaches to the client''s get-or-created loose one-off container (is_loose). Returns jsonb status: created | conflict (no_program is now unreachable for a valid client). SECURITY DEFINER + manual org gate. Default day_label ''Day 1''.';
