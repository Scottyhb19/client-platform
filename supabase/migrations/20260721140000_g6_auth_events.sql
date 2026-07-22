-- ============================================================================
-- 20260721140000_g6_auth_events.sql
-- ============================================================================
-- G-6 — structured auth-event audit log (master brief §7.4; the ten events of
-- docs/auth.md §11; deferred-with-trigger in polish/auth-onboarding-staff.md
-- Revision 4, pulled forward as Step 3 of the 2026-07-21 internal sequence).
--
-- Design:
--   - Append-only event table, written ONLY server-side (service-role client
--     via src/lib/auth/events.ts). No API-role grants, RLS enabled with no
--     policies — anon/authenticated can neither read nor write it; reads are
--     operator-side (SQL editor / dashboard) until an admin surface exists.
--   - organization_id is nullable (pre-auth events have no org) and
--     ON DELETE SET NULL so audit rows survive org teardown.
--   - user_id is a bare uuid (no FK) so rows survive auth-user deletion.
--   - Append-only enforced in-database: UPDATE/DELETE refused below
--     session_user = 'postgres' (retention trims are owner maintenance).
--   - Wired emitters (8/10): signup success+failure, login success+failure,
--     password_reset requested+completed, invite sent+accepted.
--     NOT app-emitted (recorded honestly, detection by other means):
--     auth.jwt.hook_failure — the custom-access-token hook is STABLE
--     (read-only) and G-1-verified; changing its volatility to log from
--     inside it is disproportionate risk. Detection: the G-1 behavioural
--     probe (verify-auth-config.mjs) + GoTrue logs.
--     auth.cross_tenant_access_attempt — no generic runtime detection point
--     exists (RLS denials are silent row-filters). Detection: pgTAP 17/57.
-- ============================================================================

CREATE TABLE public.auth_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event text NOT NULL CHECK (event IN (
    'auth.signup.success', 'auth.signup.failure',
    'auth.login.success', 'auth.login.failure',
    'auth.password_reset.requested', 'auth.password_reset.completed',
    'auth.invite.sent', 'auth.invite.accepted',
    'auth.jwt.hook_failure', 'auth.cross_tenant_access_attempt'
  )),
  user_id uuid NULL,
  organization_id uuid NULL REFERENCES public.organizations(id) ON DELETE SET NULL,
  email text NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.auth_events IS
  'G-6 structured auth-event audit log (docs/auth.md §11). Append-only; server-side writes only (service role); no API-role access. Reads are operator-side until an admin surface exists.';

CREATE INDEX auth_events_occurred_at_idx ON public.auth_events (occurred_at DESC);
CREATE INDEX auth_events_event_idx ON public.auth_events (event, occurred_at DESC);
CREATE INDEX auth_events_user_idx ON public.auth_events (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.auth_events ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: with RLS enabled and zero policies, anon and
-- authenticated are denied every operation even if a grant slips back in.
-- Belt: strip the grant layer too (anon has no default grants since
-- 20260702170000; authenticated still auto-grants on new tables).
REVOKE ALL ON TABLE public.auth_events FROM PUBLIC, anon, authenticated;

-- Append-only floor. Same exemption/enforcement shape as the
-- write-immutability guards (20260721120000): postgres maintenance is
-- exempt; the strictness-only test GUC re-enables enforcement for pgTAP.
CREATE OR REPLACE FUNCTION public.auth_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF session_user = 'postgres'
     AND COALESCE(current_setting('odyssey.test_enforce_guards', true), '') <> '1' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'auth_events is append-only'
    USING ERRCODE = 'P0001', HINT = 'G-6: audit rows are never edited or deleted';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auth_events_append_only() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER auth_events_append_only
  BEFORE UPDATE OR DELETE ON public.auth_events
  FOR EACH ROW EXECUTE FUNCTION public.auth_events_append_only();
