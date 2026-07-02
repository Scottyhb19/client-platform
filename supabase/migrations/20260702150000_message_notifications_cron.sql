-- ============================================================================
-- 20260702150000_message_notifications_cron
-- ============================================================================
-- Schedules the `message-notifications-5min` pg_cron job driving the
-- send-message-notifications Edge Function (messaging P1-1c queue+cron —
-- see 20260702140000 for the queue + enqueue trigger). Verbatim mirror of
-- 20260701120000_appointment_reminders_cron_to_vault:
--
--   * The URL is a REVIEWED LITERAL in version control (the anti-placeholder
--     property — the 2026-07-01 lesson where a hand-typed placeholder host
--     silently killed the reminder cron for weeks).
--   * The bearer is read from Supabase Vault at each tick via
--     `vault.decrypted_secrets` — the SAME `cron_shared_secret` entry the
--     reminder job uses, because both Edge Functions gate on the one
--     project-level CRON_SHARED_SECRET. No new secret; nothing to seed
--     (the Vault entry exists since 20260701120000).
--   * Idempotent: ALTER in place if the job exists (preserves jobid +
--     schedule), SCHEDULE if not. Matched by jobname, never a jobid.
--
-- Ordering: the Edge Function was deployed BEFORE this migration is applied
-- (deploy log 2026-07-02), so the first tick hits a live function — no
-- 404 window.
--
-- Verify: the Cron-path send check (docs/runbooks/deploy-an-edge-function.md)
-- — plant/await a due message_notifications row and confirm it reaches
-- status='sent' with a provider_message_id on a tick, `succeeded≥1`. On
-- failure, read net._http_response.error_msg.
-- ============================================================================

DO $do$
DECLARE
  v_cmd   text;
  v_jobid bigint;
BEGIN
  v_cmd := $cron_cmd$SELECT net.http_post(
    url := 'https://azjllcsffixswiigjqhj.supabase.co/functions/v1/send-message-notifications',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret'),
      'Content-Type',  'application/json'
    ),
    body := '{}'::jsonb
  )$cron_cmd$;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'message-notifications-5min';

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(job_id := v_jobid, command := v_cmd);
  ELSE
    PERFORM cron.schedule('message-notifications-5min', '*/5 * * * *', v_cmd);
  END IF;
END
$do$;
