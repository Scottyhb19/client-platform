-- ============================================================================
-- 20260723180000_auth_events_alerts_cadence
-- ============================================================================
-- Sign-off review revision (G-6 register F-2b, auth-onboarding-staff.md
-- "Reviewer verdict — 2026-07-23"): the original hourly cadence sampled a
-- trailing-60-minute window once per 60 minutes, so a burst straddling the
-- scan boundary (e.g. 30 failures at :55 + 30 at :05) never appeared as 50+
-- in any single scan — the stated per-IP threshold was effectively ~2× at
-- the seam.
--
-- Fix: scan at 4× the window. Schedule moves from hourly (:07) to every 15
-- minutes (:07/:22/:37/:52 — the :07 offset is retained so the tick pattern
-- stays recognisable in the cron history). The scan window itself stays the
-- trailing 60 minutes (the §11 thresholds are per-hour), so any burst of
-- ≤45 minutes' duration is now fully contained in at least one scan window;
-- only a burst deliberately spread across the full hour can still shave the
-- effective threshold, and only to ~1.33× — an accepted residual, recorded
-- in the polish doc.
--
-- Re-alert cadence, re-reasoned (still dedupe-free by design): a sustained
-- breach now emails up to 4×/hour instead of 1×/hour. Accepted — the alert
-- is the operator's pager for an active attack; four emails an hour during
-- an ongoing incident is signal, not noise, and dedupe state that could go
-- stale (and silently suppress a real alert) remains the worse trade.
--
-- Same idempotent shape as 20260723170000: ALTER in place when the job
-- exists (preserves jobid), SCHEDULE when not; matched by jobname; URL is a
-- reviewed literal; bearer read from Vault at each tick.
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
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '7,22,37,52 * * * *', command := v_cmd);
  ELSE
    PERFORM cron.schedule('auth-events-alerts-hourly', '7,22,37,52 * * * *', v_cmd);
  END IF;
END
$do$;
