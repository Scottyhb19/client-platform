-- ============================================================================
-- 20260611090000_c12_client_accept_invite_profile_sync
-- ============================================================================
-- C-12 (docs/polish/auth-onboarding-client.md): a client's user_profiles row
-- stays at the ('Pending','Pending') placeholders handle_new_auth_user()
-- stamps at auth.users INSERT time, because nothing on the client path ever
-- overwrites them. The staff path overwrites inside its own SECURITY DEFINER
-- bootstrap (create_organization_with_owner; G-13 closed that round trip) —
-- this migration gives the client path the symmetric behaviour inside
-- client_accept_invite, so the sync is atomic with the linking itself: it
-- cannot end half-done (the app-side alternative could fail after the RPC
-- succeeded and strand the placeholder permanently, since the welcome page
-- short-circuits linked clients away from any retry).
--
-- The sync is UNCONDITIONAL by design (no 'Pending' filter, unlike no filter
-- being needed on the staff path for a different reason — see G-13): this RPC
-- is re-callable, and on the returning-client path (fresh clients row for an
-- existing auth user) the freshest staff-entered name should win — clients.*
-- is the canonical, staff-maintained name source.
--
-- CONSTRAINT TO REMEMBER (recorded in the polish doc): if client profile
-- self-editing ever ships (Phase 2), this UPDATE must gain a guard in the
-- same change, or a re-invoked accept will clobber a client's self-edit.
--
-- Length safety: clients.first_name/last_name carry the IDENTICAL
-- length(trim(...)) BETWEEN 1 AND 100 CHECKs as user_profiles, so this
-- UPDATE cannot violate the profile constraints.
--
-- Signature is unchanged — plain CREATE OR REPLACE (no DROP), so existing
-- EXECUTE grants persist; the COMMENT is restated because it changes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.client_accept_invite(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id       uuid := auth.uid();
  caller_email    text;
  client_row      clients%ROWTYPE;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT email INTO caller_email FROM auth.users WHERE id = caller_id;
  IF caller_email IS NULL THEN
    RAISE EXCEPTION 'Caller has no email on auth.users';
  END IF;

  SELECT * INTO client_row FROM clients WHERE id = p_client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client record not found';
  END IF;

  IF client_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This invitation has been revoked';
  END IF;

  IF lower(client_row.email) <> lower(caller_email) THEN
    RAISE EXCEPTION 'Email mismatch between invite and authenticated user';
  END IF;

  IF client_row.user_id IS NOT NULL AND client_row.user_id <> caller_id THEN
    RAISE EXCEPTION 'This invitation has already been accepted by another user';
  END IF;

  -- Link and onboard
  UPDATE clients
     SET user_id      = caller_id,
         onboarded_at = COALESCE(onboarded_at, now())
   WHERE id = p_client_id;

  -- C-12: sync the 1:1 auth-side profile from the canonical clients row,
  -- replacing the ('Pending','Pending') placeholders handle_new_auth_user()
  -- stamped. Unconditional — see migration header for the rationale and the
  -- Phase-2 self-editing constraint.
  UPDATE user_profiles
     SET first_name = client_row.first_name,
         last_name  = client_row.last_name
   WHERE user_id = caller_id;

  -- Role assignment
  INSERT INTO user_organization_roles (user_id, organization_id, role)
  VALUES (caller_id, client_row.organization_id, 'client')
  ON CONFLICT (user_id, organization_id) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.client_accept_invite(uuid) IS
  'Client-side invite acceptance. Verifies email match, links clients.user_id, syncs user_profiles names from the clients row (C-12), creates client role. Idempotent on repeated calls from the same authenticated user.';
