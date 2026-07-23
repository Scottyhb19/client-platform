-- ============================================================================
-- 20260723150000_auth_events_threshold_scan.sql
-- ============================================================================
-- G-6 register F-2 — the alert-threshold half of docs/auth.md §11, closed by
-- the 2026-07-23 parity pass. The scan function computes both §11 thresholds
-- over a trailing window:
--
--   * >10 signup failures / hour            (F-2a — computable since G-6)
--   * >50 login failures / hour / IP        (F-2b — computable since
--                                            20260723120000 added client_ip)
--
-- The consumer is the auth-events-alerts Edge Function (hourly pg_cron, see
-- 20260723160000): it calls this RPC with the service key and emails the
-- operator (ALERT_EMAIL) when a threshold is breached. Raw counts are
-- returned (not just booleans) so the alert email carries the evidence.
--
-- SECURITY INVOKER on purpose: the ONLY role that can both execute this and
-- read auth_events is service_role (auth_events has no anon/authenticated
-- grants — 20260721140000), so the function adds no privilege of its own.
-- authenticated's auto-EXECUTE grant is stripped below (anon/PUBLIC are
-- covered by the 20260702170000 default-privilege revoke, stripped again
-- anyway for belt).
-- ============================================================================

CREATE FUNCTION public.auth_events_threshold_scan(
  p_window interval DEFAULT interval '1 hour'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'window_minutes', (EXTRACT(epoch FROM p_window) / 60)::int,
    'signup_failures', (
      SELECT count(*)
        FROM auth_events
       WHERE event = 'auth.signup.failure'
         AND occurred_at > now() - p_window
    ),
    'login_failures_total', (
      SELECT count(*)
        FROM auth_events
       WHERE event = 'auth.login.failure'
         AND occurred_at > now() - p_window
    ),
    'login_failure_ip_breaches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('ip', b.ip_text, 'count', b.n))
        FROM (
          SELECT host(client_ip) AS ip_text, count(*) AS n
            FROM auth_events
           WHERE event = 'auth.login.failure'
             AND occurred_at > now() - p_window
             AND client_ip IS NOT NULL
           GROUP BY 1
          HAVING count(*) > 50
        ) b
    ), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION public.auth_events_threshold_scan(interval) IS
  'auth.md §11 alert thresholds over a trailing window: signup-failure count, login-failure count, and per-IP login-failure breaches (>50). Consumed hourly by the auth-events-alerts Edge Function (service_role). SECURITY INVOKER — only service_role can execute AND read auth_events.';

REVOKE ALL ON FUNCTION public.auth_events_threshold_scan(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_events_threshold_scan(interval) TO service_role;
