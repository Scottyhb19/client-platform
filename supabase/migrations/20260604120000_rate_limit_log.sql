-- ============================================================================
-- 20260604120000_rate_limit_log
-- ============================================================================
-- Why: closes the `rate_limit_log` half of the §7.2 commitment in
-- `docs/auth.md`. C-6 in `docs/polish/auth-onboarding-client.md` opened the
-- gap — the §7.2 promise of application-level rate limiting on
-- `staffInviteClient`, `clientAcceptInvite`, and `sendCommunication` has sat
-- unenforced since the doc was written. This migration lands the
-- infrastructure (table + RPCs); the TS wrapper + call-site wiring lives
-- in `src/lib/rate-limit/index.ts` and the two call sites it imports from.
--
-- Two of the three §7.2 ops are closed by C-6: `staffInviteClient` and
-- `clientAcceptInvite`. `sendCommunication` is infrastructure-ready here
-- (the generic RPC covers it) but has NO live call site today — there is
-- no broadcast/reply send path to wrap, and the existing invite-send is
-- already inside `staffInviteClient`'s perimeter (wrapping it again would
-- double-count). The TS wrapper deliberately omits a sendCommunication
-- export so a wrong wire-up cannot ship by accident. See
-- `docs/polish/auth-onboarding-client.md` flag P-I for the deferred-to-
-- feature posture.
--
-- Key choice: `auth.uid()` for both live ops.
--   - `staff_invite:<uid>` — matches spec §7.2 ("per user").
--   - `accept_invite:<uid>` — OVERRIDES spec §7.2 ("per IP"). Rationale:
--     the call site is post-authentication; the email-match gate inside
--     `client_accept_invite` already requires the attacker to hold a
--     session whose email matches the target client's. Rotating uid means
--     creating a new auth.users row (subject to Supabase signup throttle);
--     rotating IP is cheaper. Per-uid throttles the more expensive
--     dimension. Per-IP would also collaterally throttle friends-and-
--     family testers behind shared carrier NAT. See flag P-H.
--
-- Schema posture:
--   - Sliding window, not fixed bucket. Counts are computed via
--     `created_at >= now() - p_window`. One row per attempt; outcome
--     distinguishes the `'attempt'` and `'failure'` log lines so the
--     failed-only `clientAcceptInvite` semantics ("10 failed per hour")
--     can filter `WHERE outcome = 'failure'`. The other ops use
--     `WHERE TRUE` over both outcomes (no filter).
--
-- Cleanup posture (LOAD-BEARING):
--   - Under a row-per-attempt sliding-window schema this table grows
--     monotonically until the sweep runs. Unlike a fixed-bucket counter
--     it has no natural ceiling. The sweep is in place and load-bearing
--     in this commit — see the companion migration
--     `20260604120100_rate_limit_log_cleanup_cron.sql` for the
--     hourly `cron.schedule(...)` job. **Do not remove the cron job
--     without replacing the sweep.** If the schema is later changed to
--     fixed-bucket-with-count, the cleanup tightness can relax; until
--     then the cron sweep is the only thing keeping this table bounded.
--
-- RLS posture: deny-all on `authenticated` — exact mirror of the
-- `invite_tokens` deny posture at
-- `supabase/migrations/20260426100000_invite_tokens.sql:68-78`. The table
-- is reachable only via service-role (cleanup sweep) and SECURITY DEFINER
-- RPCs (application-level check/record paths). No authenticated user
-- ever reads or writes this table directly.
--
-- Atomicity: the check-and-record path acquires
-- `pg_advisory_xact_lock(hashtext('rl:' || p_key))` so concurrent attempts
-- on the same key serialize. The TypeScript SELECT-then-INSERT race that
-- would otherwise leak N concurrent admissions past the limit cannot
-- occur. `hashtext` collisions across different keys cause a rare benign
-- false-serialization (two unrelated keys briefly share the same lock
-- slot for the duration of a single transaction); both keys still see
-- consistent counts. Not a correctness bug — a transient throughput
-- imperceptibility under burst.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. rate_outcome enum
-- ----------------------------------------------------------------------------
-- Distinguishes attempt-log lines from failure-log lines on the same row
-- schema. The failed-only operation (`clientAcceptInvite`) reads with
-- `WHERE outcome = 'failure'`; all-attempts operations read without an
-- outcome filter (both values count).

CREATE TYPE public.rate_outcome AS ENUM ('attempt', 'failure');

COMMENT ON TYPE public.rate_outcome IS
  'Whether a rate_limit_log row records a generic attempt (counts toward all-attempts limits like staff_invite) or a recorded failure (counts toward failed-only limits like accept_invite).';


-- ----------------------------------------------------------------------------
-- §2. rate_limit_log table
-- ----------------------------------------------------------------------------

CREATE TABLE public.rate_limit_log (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Free-text composite key. No FK to users/orgs to keep this a pure log
  -- table; cascade semantics on identity churn would complicate the
  -- cleanup sweep. Convention: `<op>:<identifier>`, e.g.
  -- `staff_invite:<auth.uid()>`, `accept_invite:<auth.uid()>`,
  -- `send_comm:<organization_id>`. Key construction lives in the TS
  -- wrapper (`src/lib/rate-limit/index.ts`) so call sites never spell it
  -- themselves.
  key         text          NOT NULL,
  outcome     public.rate_outcome NOT NULL DEFAULT 'attempt',
  created_at  timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.rate_limit_log IS
  'Sliding-window rate-limit ledger. One row per attempt or recorded failure. Mutated only via the rate_limit_check_and_record / rate_limit_check_failures / rate_limit_record_failure RPCs (SECURITY DEFINER) or the cleanup cron sweep (service-role). Authenticated role has zero direct access (deny-all RLS). Cleanup is in place and load-bearing — see companion migration 20260604120100_rate_limit_log_cleanup_cron.sql; do not remove the cron job without replacing the sweep.';

-- Hot path: SELECT count(*) FROM rate_limit_log WHERE key = ? AND created_at >= ?
-- The DESC ordering on created_at lets the planner use the index to
-- short-circuit min(created_at) lookups when computing seconds_to_reset.
CREATE INDEX rate_limit_log_key_created_idx
  ON public.rate_limit_log (key, created_at DESC);

-- Cleanup sweep: DELETE FROM rate_limit_log WHERE created_at < ?
CREATE INDEX rate_limit_log_created_idx
  ON public.rate_limit_log (created_at);


-- ----------------------------------------------------------------------------
-- §3. RLS — deny all from authenticated; service role and SECURITY DEFINER
--     bypass. Exact mirror of invite_tokens at
--     20260426100000_invite_tokens.sql:68-78.
-- ----------------------------------------------------------------------------

ALTER TABLE public.rate_limit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny select rate_limit_log"
  ON public.rate_limit_log FOR SELECT TO authenticated USING (false);

CREATE POLICY "deny insert rate_limit_log"
  ON public.rate_limit_log FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "deny update rate_limit_log"
  ON public.rate_limit_log FOR UPDATE TO authenticated USING (false);

CREATE POLICY "deny delete rate_limit_log"
  ON public.rate_limit_log FOR DELETE TO authenticated USING (false);


-- ----------------------------------------------------------------------------
-- §4. rate_limit_check_and_record — all-attempts entry point.
--
-- Use for ops whose §7.2 limit counts all attempts (staff_invite, future
-- send_comm). Atomically: acquire per-key advisory lock, count rows in
-- the window, admit or refuse, and on admit record an attempt row before
-- the lock releases at transaction end.
--
-- Returns under_limit + seconds_to_reset via OUT parameters (single
-- composite row, supabase-js receives it as a plain object).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rate_limit_check_and_record(
  p_key       text,
  p_window    interval,
  p_max       int,
  OUT under_limit       boolean,
  OUT seconds_to_reset  int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cur     int;
  oldest  timestamptz;
BEGIN
  -- Serialize concurrent attempts on the same key. Auto-released at
  -- transaction end. hashtext collisions cause rare benign false-
  -- serialization (two unrelated keys briefly share a lock slot); not a
  -- correctness bug — both keys still see consistent counts.
  PERFORM pg_advisory_xact_lock(hashtext('rl:' || p_key));

  -- Sliding-window count + oldest-in-window for the reset calculation.
  -- All outcomes count for all-attempts semantics.
  SELECT count(*), min(created_at)
    INTO cur, oldest
    FROM public.rate_limit_log
   WHERE key = p_key
     AND created_at >= now() - p_window;

  IF cur >= p_max THEN
    under_limit := false;
    -- Seconds until the oldest in-window row drops out and count goes
    -- from cur to cur-1. CEIL to round up; GREATEST(0, ...) clamps the
    -- already-elapsed boundary case.
    seconds_to_reset := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (oldest + p_window) - now())))::int;
    RETURN;
  END IF;

  -- Admit and record. The default outcome is 'attempt'.
  INSERT INTO public.rate_limit_log (key) VALUES (p_key);

  under_limit := true;
  seconds_to_reset := 0;
END;
$$;

COMMENT ON FUNCTION public.rate_limit_check_and_record(text, interval, int) IS
  'All-attempts rate-limit gate. Atomically counts rows in the trailing window for the given key and, if under p_max, records an attempt and returns under_limit=true. Otherwise returns under_limit=false + seconds_to_reset until the oldest in-window row expires. Concurrent same-key requests serialize via pg_advisory_xact_lock(hashtext(rl:|| p_key)).';

REVOKE EXECUTE ON FUNCTION public.rate_limit_check_and_record(text, interval, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rate_limit_check_and_record(text, interval, int) TO authenticated;


-- ----------------------------------------------------------------------------
-- §5. rate_limit_check_failures — read-only failures count for the
--     failed-only ops (clientAcceptInvite).
--
-- Read-only (no insert, no advisory lock needed — concurrent reads see
-- monotonically-newer state at worst, which is the safe direction for a
-- limit check). Returns under_limit + seconds_to_reset via OUT params.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rate_limit_check_failures(
  p_key       text,
  p_window    interval,
  p_max       int,
  OUT under_limit       boolean,
  OUT seconds_to_reset  int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cur     int;
  oldest  timestamptz;
BEGIN
  SELECT count(*), min(created_at)
    INTO cur, oldest
    FROM public.rate_limit_log
   WHERE key = p_key
     AND outcome = 'failure'
     AND created_at >= now() - p_window;

  IF cur >= p_max THEN
    under_limit := false;
    seconds_to_reset := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (oldest + p_window) - now())))::int;
  ELSE
    under_limit := true;
    seconds_to_reset := 0;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.rate_limit_check_failures(text, interval, int) IS
  'Failed-only rate-limit check. Counts only rows where outcome = failure in the trailing window. Returns under_limit + seconds_to_reset. Read-only; pair with rate_limit_record_failure called from the protected operation catch branch.';

REVOKE EXECUTE ON FUNCTION public.rate_limit_check_failures(text, interval, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rate_limit_check_failures(text, interval, int) TO authenticated;


-- ----------------------------------------------------------------------------
-- §6. rate_limit_record_failure — failure-recording counterpart.
--
-- Called from the catch branch of a protected operation. Records a
-- failure row under the same advisory-lock posture as check_and_record
-- so concurrent failures on the same key serialize cleanly and the
-- monotonic-failures invariant holds.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rate_limit_record_failure(
  p_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('rl:' || p_key));

  INSERT INTO public.rate_limit_log (key, outcome) VALUES (p_key, 'failure');
END;
$$;

COMMENT ON FUNCTION public.rate_limit_record_failure(text) IS
  'Record a failure row under the given key. Called from the catch branch of an operation gated by rate_limit_check_failures. Holds the same per-key advisory lock as check_and_record to keep concurrent same-key failures monotonic.';

REVOKE EXECUTE ON FUNCTION public.rate_limit_record_failure(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rate_limit_record_failure(text) TO authenticated;
