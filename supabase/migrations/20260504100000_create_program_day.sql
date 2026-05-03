-- ============================================================================
-- 20260504100000_create_program_day
-- ============================================================================
-- Why: Phase F.0 of the programs polish pass. The EP can now click any
-- empty in-month cell on the calendar and create a new ad-hoc session
-- on that date. Adds the create_program_day RPC and reuses the existing
-- _program_for_date helper from migration 20260503120000 to resolve the
-- target program from the date.
--
-- Design decision (D-PROG-004): default day_label = 'A'. The EP can
-- rename it inside the session builder. Going further (deriving the
-- next letter from the surrounding context, prompting for a label) is
-- deferred — the simplest path keeps the click-to-create flow snappy.
--
-- Why SECURITY DEFINER: the RPC writes program_days. Same gate pattern
-- as the rest of the soft_delete_* and copy_program_day family — the
-- caller_org check and the target_program lookup happen up front; the
-- INSERT then runs with the function owner's privileges.
--
-- Return shape mirrors copy_program_day so the UI can switch on status
-- without try/catching exceptions:
--
--   { status: 'created',  new_day_id: <uuid> }
--   { status: 'no_program', target_date: <date> }
--   { status: 'conflict', existing_day_id: <uuid> }   -- defensive
-- ============================================================================

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

  -- Client must be in the caller's org.
  SELECT organization_id INTO client_org
    FROM clients
   WHERE id = p_client_id
     AND deleted_at IS NULL;

  IF client_org IS NULL OR client_org <> caller_org THEN
    RAISE EXCEPTION 'Client % not in your organization', p_client_id
      USING ERRCODE = '42501';
  END IF;

  -- Resolve the active program covering the target date for this client.
  target_program := public._program_for_date(p_client_id, p_target_date);

  IF target_program IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'no_program',
      'target_date', p_target_date
    );
  END IF;

  -- Defensive — same client so same org, but verify before writing.
  SELECT organization_id INTO target_program_org
    FROM programs WHERE id = target_program;

  IF target_program_org <> caller_org THEN
    RAISE EXCEPTION 'Target program not in your organization'
      USING ERRCODE = '42501';
  END IF;

  -- The UI only opens the create-popover on truly empty cells, but
  -- a defensive conflict check costs almost nothing and protects
  -- against races (two tabs open, both clicking the same date).
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

  -- sort_order: keep the same scheme as new programs (one day per date,
  -- sort_order = 0). Other code paths address by date, not by sort_order
  -- inside a date, so 0 is fine.
  next_sort_order := 0;

  INSERT INTO program_days (
    program_id, program_week_id, day_label, scheduled_date, sort_order
  ) VALUES (
    target_program,
    NULL,
    'A',
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

REVOKE EXECUTE ON FUNCTION public.create_program_day(uuid, date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_program_day(uuid, date) TO authenticated;

COMMENT ON FUNCTION public.create_program_day(uuid, date) IS
  'Phase F.0 (D-PROG-004): create an ad-hoc program_day on p_target_date for p_client_id. Resolves the active program covering the date via _program_for_date. Returns jsonb with status: created | no_program | conflict. SECURITY DEFINER + manual org gate. Default day_label is ''A'' — EP renames in the session builder.';
