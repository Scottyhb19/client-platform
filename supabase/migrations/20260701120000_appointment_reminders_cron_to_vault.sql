-- ============================================================================
-- 20260701120000_appointment_reminders_cron_to_vault
-- ============================================================================
-- Captures the `appointment-reminders-5min` pg_cron job (the previously
-- SQL-Editor-only job_id 1) in a tracked migration, and moves its bearer
-- token from an inline literal to Supabase Vault.
--
-- ----------------------------------------------------------------------------
-- Why
-- ----------------------------------------------------------------------------
-- 1. Anti-placeholder. On 2026-07-01 this job was found to have NEVER invoked
--    the Edge Function: its `net.http_post(url := ...)` still held the runbook
--    placeholder host `https://YOUR-PROJECT.supabase.co/...`, never substituted
--    with the real project ref. pg_net failed every tick with
--    `error_msg='Couldn't resolve host name'` while `cron.job_run_details`
--    read `succeeded` (that status only means the request was *queued*). The
--    root cause was process: the job was hand-typed into the SQL Editor, so a
--    placeholder URL got no code review and no deterministic re-apply. Defining
--    the job here makes the URL a REVIEWED LITERAL in version control — a
--    placeholder host can no longer silently ship.
-- 2. Secret hygiene (README backlog item #2). The bearer was an inline literal
--    in the cron command, so the token sat in `cron.job.command` in plaintext.
--    It now lives in Supabase Vault and is read per-tick via
--    `vault.decrypted_secrets`; `cron.job.command` no longer contains the token.
--
-- ----------------------------------------------------------------------------
-- ONE-TIME OPERATOR SETUP — REQUIRED *BEFORE* APPLYING THIS MIGRATION
-- ----------------------------------------------------------------------------
-- The token value cannot be committed to git, so it is NOT in this file. The
-- operator seeds it into Vault once, in the SQL Editor, with the SAME value the
-- Edge Function expects in its `CRON_SHARED_SECRET` secret (the two ends of one
-- shared secret — they must match or the EF returns 401):
--
--   SELECT vault.create_secret(
--     '<CRON_SHARED_SECRET value from the password manager>',  -- never commit this
--     'cron_shared_secret',
--     'Bearer token for the appointment-reminders pg_cron job.'
--   );
--
-- Then PRE-FLIGHT (read-only, secret-free — proves the role that runs the cron
-- tick can read the secret; the tick runs as `postgres`, the same role the
-- SQL Editor / `db push` connect as):
--
--   SELECT length(decrypted_secret) AS token_len
--   FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret';
--   -- expect the token length (44 for an `openssl rand -base64 32` value),
--   -- NOT null and NOT a permission error.
--
-- Ordering matters: seed Vault → pre-flight → apply this migration → run the
-- Cron-path send check. Applying before the Vault secret exists does NOT fail
-- at apply time (the subquery is stored as text and only evaluated when the job
-- fires), but every tick in the gap would send `Authorization: Bearer ` with a
-- null token and get 401 — so seed Vault first.
--
-- ----------------------------------------------------------------------------
-- Verify & roll back  (full procedure: docs/runbooks/deploy-an-edge-function.md)
-- ----------------------------------------------------------------------------
-- Verify: the **Cron-path send check** — plant a due synthetic reminder and
-- confirm it reaches `status='sent'` on the next 5-minute tick with NO manual
-- curl. On failure, read `net._http_response.error_msg`.
-- Roll back: re-inline the literal on the live job (token from the password
-- manager), which restores the prior behaviour without depending on Vault:
--   SELECT cron.alter_job(job_id := (SELECT jobid FROM cron.job
--     WHERE jobname = 'appointment-reminders-5min'),
--     command := $$ ...inline 'Bearer '||'<token>'... $$);
-- The Edge `CRON_SHARED_SECRET` secret is unchanged by this migration, so a
-- rollback needs no Edge-side change.
--
-- ----------------------------------------------------------------------------
-- Idempotency
-- ----------------------------------------------------------------------------
-- Re-appliable (branch rebuilds, explicit re-runs). If the job already exists
-- (production), ALTER it in place — this preserves its jobid and schedule and
-- leaves no missed-tick window. If it does not (a fresh database), SCHEDULE it.
-- The job is matched by `jobname`, never a hard-coded jobid, so it is robust to
-- jobid drift. The command's Vault subquery is stored verbatim and not executed
-- at apply time, so apply succeeds whether or not the Vault secret is seeded yet.
-- ============================================================================

DO $do$
DECLARE
  v_cmd   text;
  v_jobid bigint;
BEGIN
  -- The URL is a reviewed literal (the anti-placeholder property). The bearer
  -- is read from Vault at each tick — never embedded here.
  v_cmd := $cron_cmd$SELECT net.http_post(
    url := 'https://azjllcsffixswiigjqhj.supabase.co/functions/v1/send-appointment-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret'),
      'Content-Type',  'application/json'
    ),
    body := '{}'::jsonb
  )$cron_cmd$;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'appointment-reminders-5min';

  IF v_jobid IS NOT NULL THEN
    -- Production path: swap only the command, keep the */5 schedule and jobid.
    PERFORM cron.alter_job(job_id := v_jobid, command := v_cmd);
  ELSE
    -- Fresh-database path: create the job.
    PERFORM cron.schedule('appointment-reminders-5min', '*/5 * * * *', v_cmd);
  END IF;
END
$do$;
