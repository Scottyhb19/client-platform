-- ============================================================================
-- 20260527140000_password_recovery_tickets
-- ============================================================================
-- Gate 1 of the recovery-session conflation fix (Shape B — server-minted
-- recovery ticket). Closes the documented open risk at
-- src/app/auth/reset-password/page.tsx:19-31, where the set-new-password
-- page accepts ANY active session — converting any session foothold into
-- permanent account takeover by calling updateUser({password}) under that
-- session's auth.uid().
--
-- This migration adds the DB layer only. Application wiring (forgot-password
-- inserts a row; reset-password/actions.ts calls consume_recovery_ticket
-- before updateUser) is Gate 2 — no application code changes here.
--
-- What lands:
--   1. password_recovery_tickets table — short-lived ticket bound to an
--      email at forgot-password mint time, consumed at the moment of
--      updateUser({password}).
--   2. consume_recovery_ticket(uuid) RPC — atomic email-match + single-use
--      consume in ONE UPDATE statement. No time-of-check-to-time-of-use
--      gap between "this ticket is mine" and "mark it consumed".
--   3. RLS enabled with NO permissive policy: the table is service-role-
--      only and SECURITY-DEFINER-RPC-only. authenticated and anon cannot
--      read or write directly, even their own row — the RPC is the only
--      consumption surface. The absence of a SELECT policy is
--      intentional: a logged-in user must not be able to read other
--      users' tickets, and has no need to read their own.
--
-- Multi-tenancy decision (NO organization_id column):
--   Recovery is a pre-auth flow keyed by email. At forgot-password mint
--   time there is no session and no organization context. RLS does not
--   scope this table by org — it denies all to authenticated/anon
--   outright — so an org_id would carry no security value and would
--   force an email→org lookup at insert time that does not exist today.
--   Different from invite_tokens, which IS org-scoped because invites
--   are issued by an authenticated staff for a known client in a known
--   org.
--
-- Retention / audit posture:
--   Rows carry an email (low-sensitivity, PHI-adjacent only by
--   association). Rows are short-lived (1-hour expiry set by Gate-2's
--   INSERT site). The ticket id is a cryptographically-random UUID. A
--   periodic cleanup of expired-and-consumed rows can land with that
--   job's own migration; no cleanup mechanism in this gate.
-- ============================================================================

CREATE TABLE password_recovery_tickets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz
);

COMMENT ON TABLE password_recovery_tickets IS
  'Server-minted password-recovery tickets bound to an email at mint time. Consumed atomically by consume_recovery_ticket() during the password update. Service-role / SECURITY-DEFINER-RPC access only; RLS denies all authenticated/anon. See the Gate-1 migration header for the design.';

-- Indexing: only the PK index. The single read path is
-- consume_recovery_ticket's WHERE id = p_ticket_id (PK-covered). No
-- access pattern by email or by expires_at exists in this gate; a
-- cleanup-job migration can add a partial index alongside its DELETE.


-- ============================================================================
-- consume_recovery_ticket — the heart of the fix.
--
-- ONE atomic UPDATE: the email-match against the caller's auth.users row,
-- the not-consumed check, the not-expired check, and the consumption
-- mark all live in the same WHERE + SET. The email-match is bound to
-- auth.uid() inside the WHERE — never to a caller-supplied identity —
-- so authenticated callers cannot consume each other's tickets even
-- though they share the GRANT.
--
-- MUST NOT be split into a SELECT-then-UPDATE; doing so would
-- reintroduce the time-of-check-to-time-of-use seam this shape exists
-- to close.
--
-- Return shape: the consumed ticket id on success; NULL when no row
-- matched (already consumed, expired, wrong email, or non-existent id).
-- Gate-2 callers branch on `result IS NOT NULL`.
-- ============================================================================

CREATE FUNCTION public.consume_recovery_ticket(p_ticket_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  consumed_id uuid;
BEGIN
  UPDATE password_recovery_tickets
     SET consumed_at = now()
   WHERE id = p_ticket_id
     AND consumed_at IS NULL
     AND expires_at > now()
     AND lower(email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
   RETURNING id INTO consumed_id;

  RETURN consumed_id;
END;
$$;

COMMENT ON FUNCTION public.consume_recovery_ticket(uuid) IS
  'Atomic single-statement consume of a password-recovery ticket. Returns the ticket id on success, NULL on failure (already consumed, expired, wrong-email, or unknown id). Email-match is bound to auth.uid() inside the WHERE — never to a caller-supplied identity.';

REVOKE EXECUTE ON FUNCTION public.consume_recovery_ticket(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.consume_recovery_ticket(uuid) TO authenticated;


-- ============================================================================
-- RLS — enabled with NO permissive policy.
--
-- A logged-in user MUST NOT be able to read other users' tickets, and
-- they have no need to read their own (the consume RPC is the only
-- legitimate interaction). Direct SELECT/INSERT/UPDATE/DELETE from
-- authenticated or anon is therefore denied across the board.
--
-- The service role (used by Gate-2's forgot-password INSERT) is
-- BYPASSRLS by Supabase convention and writes directly. The
-- SECURITY DEFINER consume function runs as its function owner
-- (postgres, BYPASSRLS), so the UPDATE inside the function bypasses RLS
-- regardless of the caller's role — verified by the same pattern used in
-- _test_make_user, _test_grant_membership, and the auth.users INSERT
-- inside 00_test_helpers.sql, all of which write to RLS-protected
-- tables via SECURITY DEFINER without policies.
--
-- FORCE ROW LEVEL SECURITY is deliberately NOT applied: it would also
-- subject the owner to RLS, breaking the SECURITY DEFINER bypass that
-- the consume RPC relies on.
-- ============================================================================

ALTER TABLE password_recovery_tickets ENABLE ROW LEVEL SECURITY;
