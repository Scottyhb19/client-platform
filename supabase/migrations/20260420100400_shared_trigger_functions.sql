-- ============================================================================
-- 20260420100400_shared_trigger_functions
-- ============================================================================
-- Why: Shared BEFORE-trigger functions used by every subsequent table
-- migration. Defined once, attached many times.
--
--   enforce_same_org_fk()      — cross-org FK guard (see /docs/schema.md §5.4)
--   bump_version_and_touch()   — optimistic-concurrency version bump + touch
--                                updated_at (see /docs/schema.md §12)
--
-- touch_updated_at() was defined in the identity-tables migration for the
-- three identity tables; it is still in public and reused throughout.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- enforce_same_org_fk — cross-organization FK integrity.
--
-- FK constraints alone cannot enforce that a referenced row belongs to the
-- same tenant as the referring row. A malicious/buggy code path using the
-- service role could write a child in org A referencing a parent in org B.
-- This trigger closes the gap for tables where the child carries
-- `organization_id` directly.
--
-- Usage: attach as BEFORE INSERT OR UPDATE with TG_ARGV =
--   [0] referenced table name (regclass-friendly, must have organization_id)
--   [1] FK column on NEW (holds the referenced id)
--   [2] self-org column on NEW (holds the referring row's org)
--
-- Nested tables that don't carry organization_id use a separate walker
-- defined when programs/templates land.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_same_org_fk()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_table   text := TG_ARGV[0];
  referenced_id_col  text := TG_ARGV[1];
  self_org_col       text := TG_ARGV[2];
  new_row            jsonb := to_jsonb(NEW);
  ref_id             uuid;
  ref_org_id         uuid;
  self_org_id        uuid;
BEGIN
  ref_id      := NULLIF(new_row ->> referenced_id_col, '')::uuid;
  self_org_id := NULLIF(new_row ->> self_org_col,     '')::uuid;

  -- Nullable FK: nothing to check.
  IF ref_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Self org must be populated — tenant-owned tables declare organization_id
  -- NOT NULL. Defensive check catches wiring mistakes early.
  IF self_org_id IS NULL THEN
    RAISE EXCEPTION 'enforce_same_org_fk: % has NULL %',
      TG_TABLE_NAME, self_org_col;
  END IF;

  EXECUTE format('SELECT organization_id FROM %I WHERE id = $1', referenced_table)
    INTO ref_org_id
    USING ref_id;

  IF ref_org_id IS NULL THEN
    RAISE EXCEPTION 'Cross-org FK: %.% references non-existent % id %',
      TG_TABLE_NAME, referenced_id_col, referenced_table, ref_id;
  END IF;

  IF ref_org_id IS DISTINCT FROM self_org_id THEN
    RAISE EXCEPTION 'Cross-org FK violation on %.%: self in org %, % % in org %',
      TG_TABLE_NAME, referenced_id_col, self_org_id, referenced_table, ref_id, ref_org_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_same_org_fk() IS
  'Generic BEFORE INSERT/UPDATE trigger: raises if the FK in TG_ARGV[1] points to a row in a different organization than self (TG_ARGV[2]). For tables where both sides carry organization_id directly.';


-- ----------------------------------------------------------------------------
-- bump_version_and_touch — OCC version increment + updated_at.
--
-- For tables where two users may concurrently edit the same row. The
-- application includes the last-read version in its UPDATE WHERE clause;
-- a concurrent write will match zero rows and the app surfaces a 409.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bump_version_and_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.version    := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.bump_version_and_touch() IS
  'Generic BEFORE UPDATE trigger: increments version column and touches updated_at. Attach to tables with optimistic concurrency control.';
