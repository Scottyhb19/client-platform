-- ============================================================================
-- 20260616140000_calendar_feed
-- ============================================================================
-- Section 9 (Scheduling) — P2-15 (B): de-identified .ics calendar subscribe.
--
-- Lets a practitioner subscribe to their own schedule from Google/Apple/Outlook
-- calendar via a private, revocable URL. A calendar app cannot authenticate, so
-- the feed is authenticated BY TOKEN only — the token is the credential.
--
-- SECURITY DESIGN (reviewed):
--   * NO new service-role public route. The health route is, and stays, the
--     only unauthenticated service-role route (its file documents that
--     invariant). The .ics route instead calls one narrow SECURITY DEFINER RPC,
--     calendar_feed_events(token), as anon.
--   * That RPC is the security boundary, not RLS and not a broad client: it
--     RETURNS only de-identified columns (appointment_type, kind, start, end,
--     location). It is structurally incapable of returning client_id, notes,
--     or any client name — PHI can never enter the public feed. (pgTAP 32
--     asserts the return signature + an invalid token → empty.)
--   * calendar_feed_events is the ONE deliberate anon-EXECUTE in the scheduling
--     family — the opposite of the P0-1 sweep, justified because the token is
--     the credential and the projection is de-identified. The token-management
--     RPCs (regenerate/revoke) are authenticated-only and anon-revoked.
--   * The token lives in its own table with OWNER-ONLY SELECT RLS, so a
--     co-member (a 2nd EP in the org) cannot read another practitioner's token.
--     Writes go only through the SECURITY DEFINER RPCs (direct writes denied).
--   * Unavailable-block notes can name a client ("ask Sarah about her knee");
--     the feed emits only the TYPE label + time, never notes, for any kind.
--
-- Additive + backward-compatible with deployed master (which has no feed UI and
-- never calls any of this). The token table carries no organization_id (it is a
-- per-user feed credential, not tenant/clinical data) and gets no audit trigger.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. Per-practitioner feed token — own table, owner-only read.
-- ----------------------------------------------------------------------------
CREATE TABLE calendar_feed_tokens (
  staff_user_id uuid        PRIMARY KEY REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  token         text        NOT NULL UNIQUE CHECK (length(token) BETWEEN 32 AND 128),
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE calendar_feed_tokens IS
  'Private, revocable .ics calendar-feed token per practitioner (Section 9 P2-15). The token is the feed credential; owner-only read, writes via SECURITY DEFINER RPCs. Not tenant/clinical data — no organization_id, no audit trigger.';

ALTER TABLE calendar_feed_tokens ENABLE ROW LEVEL SECURITY;

-- Owner reads only their own token (to display + copy the feed URL in settings).
CREATE POLICY "select own calendar feed token"
  ON calendar_feed_tokens FOR SELECT TO authenticated
  USING (staff_user_id = auth.uid());

-- All writes go through the RPCs below; deny direct table writes.
CREATE POLICY "deny insert calendar_feed_tokens"
  ON calendar_feed_tokens FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "deny update calendar_feed_tokens"
  ON calendar_feed_tokens FOR UPDATE TO authenticated USING (false);
CREATE POLICY "deny delete calendar_feed_tokens"
  ON calendar_feed_tokens FOR DELETE TO authenticated USING (false);


-- ----------------------------------------------------------------------------
-- §2. Mint / rotate the caller's token. Returns the new token.
-- A new random token replaces any existing one (rotate = revoke + re-issue).
-- 64 hex chars from two UUIDs (~244 bits) — unguessable, no pgcrypto dependency.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.regenerate_calendar_feed_token()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id   uuid := auth.uid();
  caller_role text := public.user_role();
  v_token     text;
BEGIN
  IF caller_id IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO calendar_feed_tokens (staff_user_id, token)
  VALUES (caller_id, v_token)
  ON CONFLICT (staff_user_id)
  DO UPDATE SET token = EXCLUDED.token, created_at = now();

  RETURN v_token;
END;
$$;

COMMENT ON FUNCTION public.regenerate_calendar_feed_token() IS
  'Mint or rotate the caller''s .ics feed token (rotating instantly revokes the old URL). Owner/staff only; anon revoked. Section 9 P2-15.';

REVOKE EXECUTE ON FUNCTION public.regenerate_calendar_feed_token() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.regenerate_calendar_feed_token() FROM anon;
GRANT  EXECUTE ON FUNCTION public.regenerate_calendar_feed_token() TO authenticated;


-- ----------------------------------------------------------------------------
-- §3. Turn the feed off — delete the caller's token row.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_calendar_feed_token()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id   uuid := auth.uid();
  caller_role text := public.user_role();
BEGIN
  IF caller_id IS NULL OR caller_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  DELETE FROM calendar_feed_tokens WHERE staff_user_id = caller_id;
END;
$$;

COMMENT ON FUNCTION public.revoke_calendar_feed_token() IS
  'Turn off the caller''s .ics feed (deletes the token; the URL stops working). Owner/staff only; anon revoked. Section 9 P2-15.';

REVOKE EXECUTE ON FUNCTION public.revoke_calendar_feed_token() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_calendar_feed_token() FROM anon;
GRANT  EXECUTE ON FUNCTION public.revoke_calendar_feed_token() TO authenticated;


-- ----------------------------------------------------------------------------
-- §4. The public feed — token in, DE-IDENTIFIED events out. anon-EXECUTE by
-- design (the token is the credential). RETURNS only type/kind/time/location —
-- structurally cannot leak client_id, notes, or names.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_feed_events(p_token text)
RETURNS TABLE (
  appointment_type text,
  kind             text,
  start_at         timestamptz,
  end_at           timestamptz,
  location         text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staff uuid;
BEGIN
  -- Defend against empty / trivially short tokens before touching the table.
  IF p_token IS NULL OR length(p_token) < 32 THEN
    RETURN;
  END IF;

  SELECT cft.staff_user_id INTO v_staff
    FROM calendar_feed_tokens cft
   WHERE cft.token = p_token;

  IF v_staff IS NULL THEN
    RETURN; -- invalid / revoked token → empty feed, never an error
  END IF;

  RETURN QUERY
  SELECT
    a.appointment_type,
    a.kind,
    a.start_at,
    a.end_at,
    a.location
  FROM appointments a
  WHERE a.staff_user_id = v_staff
    AND a.deleted_at    IS NULL
    AND a.status        IN ('pending', 'confirmed', 'completed')
    AND a.start_at      >= now() - interval '7 days'
    AND a.start_at      <  now() + interval '90 days'
  ORDER BY a.start_at;
END;
$$;

COMMENT ON FUNCTION public.calendar_feed_events(text) IS
  'PUBLIC de-identified .ics feed (Section 9 P2-15). Token-authenticated; anon EXECUTE granted BY DESIGN (the token is the credential). Returns ONLY appointment_type/kind/start/end/location for the token''s practitioner — never client_id, notes, or names. Invalid token → empty. Boundary is this body + the return signature, not RLS.';

-- Intentional anon grant — the one deliberate exception to the P0-1 sweep.
REVOKE EXECUTE ON FUNCTION public.calendar_feed_events(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.calendar_feed_events(text) TO anon, authenticated;
