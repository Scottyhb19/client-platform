-- ============================================================================
-- 20260723170000_auth_events_alerts_cron
-- ============================================================================
-- Schedules the `auth-events-alerts-hourly` pg_cron job driving the
-- auth-events-alerts Edge Function (G-6 register F-2 — the auth.md §11
-- alerting half; see 20260723150000 for the threshold-scan RPC). Verbatim
-- mirror of 20260702150000_message_notifications_cron:
--
--   * The URL is a REVIEWED LITERAL in version control (the anti-placeholder
--     property — the 2026-07-01 lesson where a hand-typed placeholder host
--     silently killed the reminder cron for weeks).
--   * The bearer is read from Supabase Vault at each tick via
--     `vault.decrypted_secrets` — the SAME `cron_shared_secret` entry the
--     reminder + message-notification jobs use (one project-level
--     CRON_SHARED_SECRET gates all three Edge Functions). No new secret.
--   * Idempotent: ALTER in place if the job exists (preserves jobid +
--     schedule), SCHEDULE if not. Matched by jobname, never a jobid.
--
-- Cadence: hourly at :07 (the §11 thresholds are per-hour windows; the scan
-- reads the trailing hour, so a sustained attack re-alerts each hour — a
-- deliberate property, not a dedupe gap).
--
-- Ordering: deploy the Edge Function BEFORE applying this migration to prod
-- (the message-notifications precedent) so the first tick hits a live
-- function. On staging the job exists but points at the prod URL by the
-- established pattern (staging's Vault token differs, so prod refuses the
-- tick with 401 — same posture as the two existing jobs).
-- ============================================================================

DO $do$
DECLARE
  v_cmd   text;
  v_jobid bigint;
BEGIN
  v_cmd := $cron_cmd$SELECT net.http_post(
    url := 'https://azjllcsffixswiigjqhj.supabase.co/functions/v1/auth-events-alerts',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret'),
      'Content-Type',  'application/json'
    ),
    body := '{}'::jsonb
  )$cron_cmd$;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'auth-events-alerts-hourly';

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(job_id := v_jobid, command := v_cmd);
  ELSE
    PERFORM cron.schedule('auth-events-alerts-hourly', '7 * * * *', v_cmd);
  END IF;
END
$do$;
