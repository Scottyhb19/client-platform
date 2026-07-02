-- ============================================================================
-- 20260702180000_archived_client_access
-- ============================================================================
-- Why: CN-7 (docs/polish/archived-client-access.md — gap P0-1 + P1-5;
-- master brief §7.2). Archived records must remain queryable, but the single
-- clients SELECT policy bakes `deleted_at IS NULL` into every role's read —
-- so archiving a client made their entire record UI-unreachable (the profile
-- 404s off the missing parent row). The child tables were never sealed; only
-- the parent-row read and list navigation were.
--
-- §1 — the archived-read path (P0-1). One ADDITIVE staff-only SELECT policy.
--   Policies OR, so staff sessions gain archived visibility while the
--   existing policy is untouched; the client self-read arm still requires
--   deleted_at IS NULL, so an archived client stays locked out of their own
--   row and the portal. Chosen over an RPC fork (which would split the read
--   model forever) — see gap doc Q1. Fail-closed: both policies carry the
--   org + role predicates independently; dropping either only narrows.
--   Blast radius audited before this migration (gap doc §2 + the P0-2
--   classification): every deployed staff surface already filters live-only
--   explicitly except four action lookups in clients/[id]/actions.ts, which
--   gain guards in the same release. Live at push time: 1 archived client,
--   0 future appointments — the DB-before-frontend window is benign.
--
-- §2 — archive cancels the future (P1-5, premortem FM-4). soft_delete_client
--   is rewritten (base: 20260429130000, the latest body — nothing replaced
--   it since) to also cancel the client's future live appointments. The
--   appointment_manage_reminder trigger (20260615170000) fires on the status
--   UPDATE and cancels each queued reminder — so an archived client can no
--   longer receive a "see you tomorrow" email. cancelled_by_role='staff'
--   (the archiving actor; allowed by the 20260513130000 CHECK), reason
--   recorded. restore_client deliberately does NOT resurrect cancelled
--   appointments — the slot may have been re-booked; re-booking is a human
--   decision (recorded in the gap doc).
--
-- pgTAP 55_archived_client_access.sql locks all of it; 17/38/46/54 re-run
-- as regression canaries (this migration touches RLS → the §6 rule fires).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1. The additive archived-read policy (staff/owner only, own org only).
-- ----------------------------------------------------------------------------
CREATE POLICY "staff select archived clients in own org"
  ON clients FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NOT NULL
    AND public.user_role() IN ('owner', 'staff')
  );

COMMENT ON POLICY "staff select archived clients in own org" ON clients IS
  'CN-7 (brief §7.2): archived records stay queryable by staff. ORs with the live-row policy; the client self-read arm still requires deleted_at IS NULL, so archived clients cannot read their own row. pgTAP 55.';

-- ----------------------------------------------------------------------------
-- §2. soft_delete_client v2 — archive the client AND cancel their future.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_client(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_org  uuid := public.user_organization_id();
  caller_role text := public.user_role();
  ts          timestamptz := now();
BEGIN
  IF caller_org IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE clients
     SET deleted_at  = ts,
         archived_at = ts
   WHERE id = p_id
     AND organization_id = caller_org
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'client % not found in your organization, or already archived', p_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- P1-5: an archived client keeps no future bookings. Cancelling here (not
  -- deleting) preserves the schedule history; the reminder-lifecycle trigger
  -- fires on this status change and cancels each queued reminder, so no
  -- reminder email can reach an archived client. Past/completed/no-show rows
  -- are untouched — they are the record.
  UPDATE appointments
     SET status              = 'cancelled',
         cancelled_at        = ts,
         cancelled_by_role   = 'staff',
         cancellation_reason = 'Client archived'
   WHERE client_id = p_id
     AND organization_id = caller_org
     AND start_at > ts
     AND status IN ('pending', 'confirmed')
     AND deleted_at IS NULL;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_client(uuid) IS
  'Archive a client: set deleted_at + archived_at, and cancel their future live appointments (reminders cascade-cancel via appointment_manage_reminder). Releases the (org, lower(email)) unique-active slot for re-invites. CN-7 P1-5; restore_client deliberately does not resurrect cancelled bookings.';
