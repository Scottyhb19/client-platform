# Runbook — Check cron health

> Job identity cited from `docs/polish/client-portal-booking.md:162` (`appointment-reminders-5min`, jobid 1, `*/5 * * * *`, deployed 2026-05-12). Inspection via `cron.job_run_details` / `cron.alter_job` cited from `docs/secrets-rotation-log.md`. **Exact SELECT text was never committed — every query below is reconstructed from standard pg_cron catalogs and the cited job identity. Each carries a one-time inline label.**

**Purpose:** Determine whether the `send-appointment-reminders` pg_cron job is firing and succeeding, and triage it when it is not.

**Prerequisites**

- DB access via Supabase SQL Editor or psql.
- `pg_cron` is installed and the job was scheduled per `deploy-an-edge-function.md`.

**Steps**

1. Confirm the job exists and is active:
   `SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'appointment-reminders-5min';` `[reconstructed — verify against your database before relying on]`
   Expect one row: jobid 1, schedule `*/5 * * * *`, `active = true`.
2. Inspect recent runs:
   `SELECT runid, status, return_message, start_time, end_time FROM cron.job_run_details WHERE jobid = 1 ORDER BY start_time DESC LIMIT 20;` `[reconstructed — verify against your database before relying on]`
   Healthy = a `status = 'succeeded'` row roughly every 5 minutes with no long gaps.
3. Cross-check the effect on the queue:
   `SELECT status, count(*) FROM appointment_reminders GROUP BY status;` `[reconstructed — verify against your database before relying on]`
   `sent` should advance over time. A growing count of `scheduled` rows with `scheduled_for` in the past means the worker is not draining.

**Verification (what healthy looks like)**

- Baseline reference: the 2026-05-17 rotation verified health as **10 consecutive `succeeded` ticks at 5-minute intervals, 00:30–01:15 UTC** (`secrets-rotation-log.md`). Reproduce that shape: consecutive `succeeded`, ~5 min apart, `return_message` clean.

**Remediation (Rollback is N/A — this is a read/triage runbook)**

Read `return_message` on the failing rows and match the cause:

- HTTP **401** → `CRON_SHARED_SECRET` mismatch between the Edge secret and the inlined pg_cron literal. Fix via [`rotate-a-secret.md`](rotate-a-secret.md) → CRON_SHARED_SECRET (re-sync both places).
- HTTP **500** `server misconfigured` → Edge `CRON_SHARED_SECRET` unset (fail-closed, `701041c`). Set it (`deploy-an-edge-function.md` step 3).
- HTTP **500** `missing RESEND_API_KEY` → Edge `RESEND_API_KEY` unset (`index.ts:90-92`). Set it.
- No rows / job missing → not scheduled or `active = false`. Reschedule per `deploy-an-edge-function.md` step 4.
- To change cadence or the embedded token: `cron.alter_job()` (cited from `secrets-rotation-log.md`).

**Note:** cron health is upstream of email delivery. A cron tick can return 200 (function succeeded) while the email itself silently fails to deliver — e.g. if EMAIL_FROM is unset and the sandbox fallback restricts delivery, or if Resend rate-limits the sender. Verify end-to-end by checking the Resend dashboard, not just cron status.
