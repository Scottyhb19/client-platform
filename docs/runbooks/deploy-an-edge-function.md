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

**Rollback**

- `supabase functions deploy` always ships the current working copy. To roll back, restore the prior source and redeploy: `git checkout <prev-sha> -- supabase/functions/send-appointment-reminders && supabase functions deploy send-appointment-reminders`.
- To stop invocations without touching code: `SELECT cron.unschedule('appointment-reminders-5min');` then reschedule when fixed.
