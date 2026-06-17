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
   (The confirmed appointment also auto-enqueues its own *future-dated* reminder via the `appointment_manage_reminder` trigger — harmless; the EF only processes the past-dated one. Teardown removes both.)
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

**Rollback**

- `supabase functions deploy` always ships the current working copy. To roll back, restore the prior source and redeploy: `git checkout <prev-sha> -- supabase/functions/send-appointment-reminders && supabase functions deploy send-appointment-reminders`.
- To stop invocations without touching code: `SELECT cron.unschedule('appointment-reminders-5min');` then reschedule when fixed.
