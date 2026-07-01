# Runbook — Deploy an Edge Function

> Procedure reconstructed from: `supabase/functions/send-appointment-reminders/index.ts:19-39` (deploy command + schedule SQL), `supabase/config.toml:74-79` (`verify_jwt`), `docs/polish/client-portal-booking.md:161-162` (2026-05-12 deploy + end-to-end verification), commit `701041c`. The curl smoke-test in Verification is **reconstructed from the auth contract (`index.ts:192-206`), not a transcript command**.

**Purpose:** Deploy (or redeploy) a Supabase Edge Function and ensure its pg_cron trigger is correctly scheduled and authenticated.

**Prerequisites**

- Supabase CLI linked. Note: a git worktree's `supabase/.temp` is half-populated and `db push`/deploy can fail with "Cannot find project ref" — work from the main checkout (memory-noted gotcha).
- Decide auth model: a cron/webhook-triggered function is **not** called with a Supabase JWT, so it needs `verify_jwt = false`.

**Steps**

1. **Set `verify_jwt` BEFORE the first deploy.** Edge Functions default to `verify_jwt = true`; deploying a cron-triggered function without overriding it makes the gateway reject the non-JWT bearer with `UNAUTHORIZED_INVALID_JWT_FORMAT`. `supabase/config.toml:78-79` already carries `[functions.send-appointment-reminders] verify_jwt = false` with the rationale in the comment above it (`:74-77`). For a new function, add the equivalent block first.
2. Deploy: `supabase functions deploy send-appointment-reminders` (`index.ts:22-23`).
3. Set required secrets (read via `Deno.env.get`, independent of Vercel):
   `supabase secrets set RESEND_API_KEY=re_... CRON_SHARED_SECRET=<value>`
   (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the Edge runtime — do not set them.)
4. Schedule via pg_cron (run once in SQL Editor after the function URL is known). The canonical SQL is in `index.ts:26-39`: `cron.schedule('appointment-reminders-5min', '*/5 * * * *', $$ SELECT net.http_post(url:=..., headers:=jsonb_build_object('Authorization','Bearer '||<token>, ...), body:='{}') $$)`. The bearer token is **inlined as a literal** — the documented `current_setting('app.cron_token')` indirection requires `ALTER DATABASE`, which hosted Supabase blocks (memory note; `client-portal-booking.md:162`).

   **⚠️ Substitute the real project ref into `url :=` BEFORE you run this — a placeholder host fails silently.** The canonical SQL (and the older runbook template) ships the host as a placeholder (`url := '<function-url>'` / `https://YOUR-PROJECT.supabase.co/...`). pg_net does **not** validate the host: an unsubstituted placeholder makes every tick fail with `error_msg='Couldn't resolve host name'` and `status_code=null`, while `cron.job_run_details.status` still reads `succeeded` (that status only means `net.http_post` *queued* the request — it never confirms the function was reached). This is exactly how the live job hid a dead URL for weeks until it was caught on 2026-07-01 (memory `project_reminder_cron_placeholder_url`). The correct, full value for this project is:
   ```
   https://azjllcsffixswiigjqhj.supabase.co/functions/v1/send-appointment-reminders
   ```
   After scheduling, do **not** stop at "the SQL ran without error." Run the **Cron-path send check** below — it proves the URL pg_cron actually *stored* delivers. The curl-based Synthetic send check tests the function and its secrets; by design it cannot catch a wrong cron URL.

**Verification**

- Curl smoke-test — *reconstructed from the auth contract (`index.ts:192-206`), not a command copied from a transcript; verify before relying on it:*
  - No `Authorization` header → expect **401** (`unauthorized`).
  - `Authorization: Bearer <wrong>` → expect **401**.
  - Correct bearer → **200** with JSON `{processed: N}` (or `{processed: 0}` when the queue is empty).
  - If the Edge secret is unset the function returns **500** `server misconfigured` — this is the intended fail-closed behaviour (`701041c`), not a deploy failure.
- pg_cron inspection → see [`check-cron-health.md`](check-cron-health.md).
- Historical reference point: `client-portal-booking.md:162` records the 2026-05-12 end-to-end verification (cron fires every 5 min; a test reminder flipped to `status='sent'` with `provider_message_id` populated; email delivered).

### Synthetic send check (STANDING — run after every (re)deploy of `send-appointment-reminders`)

> **Why this exists.** On 2026-06-16 the reminder system was found non-functional in production (`EMAIL_FROM` unset → 500; then a stale `RESEND_API_KEY` → `resend 401` on every send) — invisible because every prior verification stopped at *enqueue* and at the HTTP status code. **The curl smoke-test above is not enough: the function returns HTTP `200` even when every send fails** — a failed send is reported in the body as `{processed:N, succeeded:0, failed:N}`, not as a non-200. So a deploy check that asserts "200" passes while sending is broken. This check drives a *real* send to a safe sink and asserts the row reaches `status='sent'`. Encodes the lesson from `docs/polish/scheduling.md` §8c (enqueue ≠ send) and the §9 reviewer's standing-check requirement. The setup/teardown SQL below was validated against live 2026-06-17.

The sink is Resend's `delivered@resend.dev` — Resend accepts and processes it but routes it to no inbox, so this is safe to run on production without emailing anyone.

1. **Set up a due synthetic reminder** (SQL Editor or `supabase db query --linked`). Creates a throwaway client (`delivered@resend.dev`) + a far-future confirmed appointment + a past-dated `scheduled` reminder. Note the returned `reminder_id`:
   ```sql
   WITH org AS (SELECT id FROM organizations ORDER BY created_at LIMIT 1),
   st AS (
     SELECT r.user_id FROM user_organization_roles r, org
     WHERE r.organization_id = org.id AND r.role IN ('owner','staff')
     ORDER BY r.user_id LIMIT 1
   ),
   cl AS (
     INSERT INTO clients (organization_id, first_name, last_name, email)
     SELECT org.id, 'EF', 'Healthcheck (delete me)', 'delivered@resend.dev' FROM org
     RETURNING id, organization_id
   ),
   ap AS (
     INSERT INTO appointments (organization_id, client_id, staff_user_id, appointment_type, start_at, end_at, status, confirmed_at)
     SELECT cl.organization_id, cl.id, st.user_id, 'EF healthcheck',
            date_trunc('day', now()) + interval '370 days' + interval '13 hours 7 minutes',
            date_trunc('day', now()) + interval '370 days' + interval '13 hours 37 minutes',
            'confirmed', now()
     FROM cl, st RETURNING id
   )
   INSERT INTO appointment_reminders (appointment_id, reminder_type, provider, scheduled_for, status)
   SELECT ap.id, 'reminder_24h_email', 'resend', now() - interval '1 minute', 'scheduled' FROM ap
   RETURNING id AS reminder_id, appointment_id;
   ```
   **⚠️ Re-time the reminder before invoking — the insert's past `scheduled_for` does NOT stick.** The confirmed-appointment insert fires the `appointment_manage_reminder` AFTER-trigger, which runs at statement-end and **upserts** on `(appointment_id, reminder_type)`, overwriting the past `scheduled_for` you just set with the appointment's real lead time (far future). So after the insert there is **one** reminder row, future-dated, and the EF returns `{processed:0}`. Re-time it directly — an `appointment_reminders` UPDATE does **not** fire that trigger, so the past date sticks:
   ```sql
   UPDATE appointment_reminders ar
   SET scheduled_for = now() - interval '1 minute',
       status = 'scheduled', retry_count = 0,
       failure_reason = NULL, sent_at = NULL, provider_message_id = NULL
   FROM appointments a, clients c
   WHERE ar.appointment_id = a.id AND a.client_id = c.id
     AND c.email = 'delivered@resend.dev' AND c.last_name = 'Healthcheck (delete me)'
   RETURNING ar.id, ar.status, ar.scheduled_for;
   ```
   (Verified live 2026-06-22 during the §12 EF redeploy: bare insert → trigger re-times to future → `{processed:0}`; the UPDATE re-time → invoke → `{succeeded:1}`, row `sent`. Teardown removes the row regardless of its date.)
2. **Invoke the function** with the cron bearer (`CRON_SHARED_SECRET`, from your password manager):
   ```powershell
   curl.exe -s -X POST "https://azjllcsffixswiigjqhj.supabase.co/functions/v1/send-appointment-reminders" `
     -H "Authorization: Bearer <CRON_SHARED_SECRET>" -H "Content-Type: application/json" -d "{}"
   ```
3. **Assert on the BODY, not the status code.** Expect `succeeded` ≥ 1, e.g. `{"processed":1,"succeeded":1,"failed":0,...}`. **`failed:1` or `succeeded:0` is a FAIL even though the HTTP status is 200** — that is the exact blind spot this check exists to catch (it is what a stale/invalid `RESEND_API_KEY` looks like). Then confirm the row landed:
   ```sql
   SELECT status, provider_message_id, failure_reason
   FROM appointment_reminders WHERE id = '<reminder_id>';
   ```
   Pass = `status='sent'` and `provider_message_id` is non-null. If `status='failed'`, read `failure_reason` (a `resend 401` means the EF's `RESEND_API_KEY` secret is stale — re-set it per step 3 of Steps above).
4. **Tear down** (always — leaves no synthetic rows):
   ```sql
   DELETE FROM appointment_reminders WHERE appointment_id IN (
     SELECT a.id FROM appointments a JOIN clients c ON c.id = a.client_id
     WHERE c.email = 'delivered@resend.dev' AND c.last_name = 'Healthcheck (delete me)'
   );
   DELETE FROM appointments WHERE client_id IN (
     SELECT id FROM clients WHERE email = 'delivered@resend.dev' AND last_name = 'Healthcheck (delete me)'
   );
   DELETE FROM clients WHERE email = 'delivered@resend.dev' AND last_name = 'Healthcheck (delete me)';
   ```

The branch logic the live send does *not* exercise (email-off → cancel, 4xx/5xx/429/network classification) is covered by `node scripts/reminder-logic-verify.mjs` (12/12) — run it whenever the EF's send loop changes. See `docs/polish/scheduling.md` §8d for the branch-coverage posture.

### Cron-path send check (run after first scheduling the job, and after any `cron.alter_job` that touches the URL)

> **Why this is separate from the Synthetic send check above.** That check curls the function URL **directly**, so it proves the function code + secrets — but it never reads the URL pg_cron actually stored. On 2026-07-01 the cron command still held the placeholder host `https://YOUR-PROJECT.supabase.co/...`; pg_net failed every tick with `error_msg='Couldn't resolve host name'` and no reminder ever sent, yet `cron.job_run_details.status` read `succeeded` and a direct curl passed. This check drives a send **through the scheduled job, with no manual curl** (memory `project_reminder_cron_placeholder_url`).

1. **Eyeball the stored URL first — instant, zero wait, and this step alone would have caught the 2026-07-01 bug.** The regex stops at the first single-quote, so the bearer literal is never returned:
   ```sql
   SELECT jobname, active,
          (regexp_match(command, 'https?://[^'']+'))[1] AS posted_url
   FROM cron.job WHERE jobname = 'appointment-reminders-5min';
   ```
   **Pass = `posted_url` is exactly `https://azjllcsffixswiigjqhj.supabase.co/functions/v1/send-appointment-reminders`.** Any `YOUR-PROJECT`, `<function-url>`, or other host is the bug. Fix it secret-safely — the bearer is an inline literal, so a server-side `replace` never reads the token out:
   ```sql
   SELECT cron.alter_job(
     job_id := 1,
     command := replace(
       (SELECT command FROM cron.job WHERE jobid = 1),
       'YOUR-PROJECT.supabase.co',
       'azjllcsffixswiigjqhj.supabase.co'
     )
   );
   ```
2. **Drive a send through the cron — do not curl.** Plant + re-time a due synthetic reminder using **step 1 of the Synthetic send check above** (the same setup, *including* the ⚠️ re-time `UPDATE` — the `appointment_manage_reminder` AFTER-trigger re-times a fresh insert to the future). Then **do nothing**: wait for the next 5-minute boundary tick (≤5 min). The whole point is to exercise the URL pg_cron stored, so invoking the function by hand defeats the check.
3. **Assert the row sent on its own.** After one tick:
   ```sql
   SELECT status, provider_message_id, failure_reason, sent_at
   FROM appointment_reminders WHERE id = '<reminder_id>';
   ```
   Pass = `status='sent'`, `provider_message_id` non-null, `sent_at` just now. If it is still `scheduled`, the cron never reached the function — read the transport outcome (pg_net prunes `net._http_response` within hours, so read it promptly after the tick):
   ```sql
   SELECT status_code, error_msg, timed_out, created
   FROM net._http_response ORDER BY created DESC LIMIT 5;
   ```
   - `error_msg='Couldn't resolve host name'`, `status_code` null → placeholder / typo'd host (the 2026-07-01 bug). Fix per step 1.
   - `status_code=401` → bearer mismatch between the inlined cron literal and the Edge `CRON_SHARED_SECRET` (re-sync per [`rotate-a-secret.md`](rotate-a-secret.md) → CRON_SHARED_SECRET).
   - `status_code=200` but the row never flipped to `sent` → transport is fine; the failure is inside the function or Resend. Localise with the curl-based **Synthetic send check** above.
4. **Tear down** using **step 4 of the Synthetic send check above** (same `delivered@resend.dev` / `Healthcheck (delete me)` rows).

### Durable fix — the job is now a tracked migration (implemented 2026-07-01)

The root cause on 2026-07-01 was **process, not code**: the job was hand-typed into the SQL Editor (Step 4), so a placeholder URL got no code review and no deterministic re-apply. It is now defined in a tracked migration — [`supabase/migrations/20260701120000_appointment_reminders_cron_to_vault.sql`](../../supabase/migrations/20260701120000_appointment_reminders_cron_to_vault.sql) — alongside the project's first cron-in-migration [`20260604120100_rate_limit_log_cleanup_cron.sql`](../../supabase/migrations/20260604120100_rate_limit_log_cleanup_cron.sql). The URL is now a **reviewed literal** in version control: a placeholder host can no longer silently ship. The migration also moved the bearer token off the inline literal into **Supabase Vault** (read per-tick via `vault.decrypted_secrets`), closing README backlog item #2 — `cron.job.command` no longer contains the token. Step 4's SQL-Editor path remains the documented procedure for a *new* function; for this job, the migration is canonical.

**This migration is special: it depends on a one-time Vault seed that cannot live in git, and it rewrites the live `job_id 1`. Apply it in this exact order — there is no local Docker, so `db push` goes straight to prod.**

1. **Seed the Vault secret (once, SQL Editor).** Use the SAME value as the Edge `CRON_SHARED_SECRET` — the two ends of one shared secret (mismatch → the EF returns 401):
   ```sql
   SELECT vault.create_secret(
     '<CRON_SHARED_SECRET from the password manager>',
     'cron_shared_secret',
     'Bearer token for the appointment-reminders pg_cron job.'
   );
   ```
2. **Pre-flight (read-only, secret-free).** Proves the role the cron tick runs as (`postgres`) can read the secret — the one risk that could re-break the job, checked *before* the live job is touched:
   ```sql
   SELECT length(decrypted_secret) AS token_len
   FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret';
   ```
   Pass = the token length (44 for an `openssl rand -base64 32` value), not null, no permission error. If this errors, **stop** — do not apply the migration; the Vault read would fail at tick time too.
3. **Apply the migration** from the main checkout (a worktree's `supabase/.temp` is half-populated and `db push` fails there): `supabase migration list` (confirm only this one is pending) → `supabase db push`. Apply does **not** evaluate the Vault subquery, so it succeeds whether or not the secret is seeded; the swap takes effect on the live job immediately.
4. **Verify via the Cron-path send check above** — a synthetic reminder must reach `status='sent'` on the next ≤5-min tick with no manual curl. This is the gate; the change is not done until it passes.
5. **Rollback if step 4 fails.** Re-inline the literal on the live job (token from the password manager) — restores the prior behaviour with no Vault dependency and no Edge-side change:
   ```sql
   SELECT cron.alter_job(
     job_id := (SELECT jobid FROM cron.job WHERE jobname = 'appointment-reminders-5min'),
     command := $$ SELECT net.http_post(url := 'https://azjllcsffixswiigjqhj.supabase.co/functions/v1/send-appointment-reminders', headers := jsonb_build_object('Authorization', 'Bearer ' || '<token>', 'Content-Type', 'application/json'), body := '{}'::jsonb) $$
   );
   ```

After this lands, **rotating `CRON_SHARED_SECRET` changes** — you update the Vault secret, not the cron command. See [`rotate-a-secret.md`](rotate-a-secret.md) → CRON_SHARED_SECRET.

**Rollback**

- `supabase functions deploy` always ships the current working copy. To roll back, restore the prior source and redeploy: `git checkout <prev-sha> -- supabase/functions/send-appointment-reminders && supabase functions deploy send-appointment-reminders`.
- To stop invocations without touching code: `SELECT cron.unschedule('appointment-reminders-5min');` then reschedule when fixed.
