-- ============================================================================
-- 20260604120100_rate_limit_log_cleanup_cron
-- ============================================================================
-- Why: row-per-attempt sliding-window cleanup for the `rate_limit_log`
-- table created in the companion migration `20260604120000_rate_limit_log`.
-- That schema's count semantics are correct without pruning — the
-- `WHERE created_at >= now() - p_window` filter excludes expired rows
-- from limit decisions — but the table grows monotonically until a
-- sweep runs. The cleanup is correctness-load-bearing for size; this
-- migration lands the sweep so the table stays bounded.
--
-- Sweep policy: hourly, DELETE rows older than 2 hours. The widest
-- window currently in use is 1 hour (staff_invite, accept_invite); the
-- 2-hour cutoff gives a 1-hour safety buffer so a hypothetical
-- live-during-the-sweep query against the boundary of a 1-hour window
-- still sees its rows. If a future operation uses a wider window, the
-- buffer (or the schedule cadence) must grow with it.
--
-- ============================================================================
-- Cron-tracking state — read this if you grep `supabase/migrations` for
-- "cron".
-- ============================================================================
-- This was the FIRST pg_cron job defined in a tracked migration on this
-- project. The pre-existing `appointment-reminders-5min` job (job_id 1,
-- schedule `*/5 * * * *`, deployed 2026-05-12) was originally scheduled
-- directly via the Supabase SQL Editor and was NOT defined in any
-- migration file.
--
-- UPDATE 2026-07-01: appointment-reminders-5min is now captured in a
-- tracked migration too — `20260701120000_appointment_reminders_cron_to_vault.sql`
-- — which also moved its bearer token to Supabase Vault (closing README
-- backlog #2). With that, `supabase/migrations` IS the source of truth
-- for both pg_cron jobs on this project. The appointment job's apply
-- procedure (one-time Vault seeding + the Cron-path send check) lives in
-- `docs/runbooks/deploy-an-edge-function.md`.
--
-- ============================================================================
-- Idempotency
-- ============================================================================
-- Tracked migrations may be re-applied (pgTAP setup, branch rebuilds,
-- explicit re-runs). The conditional unschedule + schedule idiom below
-- is universal-safe across pg_cron 1.x:
--   - `cron.job` catalog exposes `jobname` in all pg_cron 1.x; safe to
--     query in a DO block.
--   - `cron.unschedule(jobname)` is available since pg_cron 1.4
--     (confirmed in use on this project per
--     `docs/runbooks/deploy-an-edge-function.md:34` and
--     `docs/runbooks/rotate-a-secret.md:44`).
--   - `cron.schedule(jobname, schedule, command)` returns a new jobid
--     each time and would otherwise duplicate the job name on re-apply.
--
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rate-limit-log-cleanup-hourly') THEN
    PERFORM cron.unschedule('rate-limit-log-cleanup-hourly');
  END IF;
END $$;

SELECT cron.schedule(
  'rate-limit-log-cleanup-hourly',
  '0 * * * *',
  $cron_cmd$DELETE FROM public.rate_limit_log WHERE created_at < now() - interval '2 hours'$cron_cmd$
);
