# Runbook — Rotate a secret

> Procedure reconstructed from: `docs/secrets-rotation-log.md` (2026-05-17 entry), `supabase/functions/send-appointment-reminders/index.ts:19-20` & `:192-206`, commits `701041c` (fail-closed cron auth), `fc3c38b` (diagnostic + rotation log added), `667a509`→`798bfd9` (rotation-log repair). **`SUPABASE_SERVICE_ROLE_KEY` rotation is NOT evidenced anywhere — that section is an explicit TODO.**

**Purpose:** Rotate a leaked or suspected-leaked secret with no outage and a verifiable cutover.

**Prerequisites**

- Supabase CLI linked to the project (`supabase link`); access to Supabase dashboard.
- Vercel project access (env vars).
- For `RESEND_API_KEY`: Resend dashboard access.
- The standing rule: there is no rotation cadence — rotate on suspicion of exposure. Log every rotation in `docs/secrets-rotation-log.md` and update `docs/secrets-inventory.md` "Last rotated".

---

## RESEND_API_KEY

**Steps** (new-everywhere-then-revoke; never revoke first — that causes an email outage):

1. Resend dashboard → API Keys → create a new key.
2. Vercel → project → Settings → Environment Variables → update `RESEND_API_KEY` for **Production, Preview, Development**.
3. Supabase Edge secret: `supabase secrets set RESEND_API_KEY=re_...` (the Edge Function reads this independently of Vercel — `index.ts:19-20`, `:96`). **This store is separate from Vercel and nothing else updates it** — the 2026-05-17 rotation skipped it and left reminders sending on a stale key for a month (`secrets-rotation-log.md` 2026-06-16 entry). Confirm with `supabase secrets list` (it shows a digest per name). While here, verify the EF's other reader-secrets are present too: `EMAIL_FROM`, `NEXT_PUBLIC_APP_URL`, `CRON_SHARED_SECRET`.
4. Trigger a Vercel redeploy (or wait for next deploy) so the running app reads the new value.
5. Verify (below) **before** revoking.
6. Resend dashboard → revoke the old key.

**Verification**

- Vercel: a server action that sends mail (e.g. client invite) succeeds; Resend dashboard shows the message under the new key.
- Edge: run the **synthetic send check** in [`deploy-an-edge-function.md`](deploy-an-edge-function.md#synthetic-send-check-standing--run-after-every-redeploy-of-send-appointment-reminders) — drive a real send to `delivered@resend.dev` and assert the row reaches `status='sent'`. **Do not settle for "the function returned 200"** — it returns 200 with `failed:N` on an auth failure, which is exactly what a stale key looks like (`resend 401`). Assert on `succeeded` ≥ 1.

**Rollback:** if the new key fails, re-add the old key value in Vercel + Edge secret and redeploy — only possible if the old key is not yet revoked. This is why step 6 is last.

---

## CRON_SHARED_SECRET

This secret lives in **two places** that must both change. Between updating place 1 and place 2 the cron caller is rejected (401) — keep the gap short. The Edge Function fails **closed**: an unset secret returns 500, a mismatched bearer returns 401 (`index.ts:192-206`, commit `701041c`).

**Steps**

1. Generate: `openssl rand -base64 32`. Store in the password manager.
2. Supabase Edge secret: `supabase secrets set CRON_SHARED_SECRET=<value>`.
3. pg_cron `job_id 1` carries the bearer token as an **inline literal** in its `net.http_post(...)` command (not Vault — known tech-debt, see backlog). Update it via `cron.alter_job()` to embed the new token. Do this immediately after step 2.
4. Verify (below).

**Verification**

- `check-cron-health.md` → `cron.job_run_details` shows `status='succeeded'` on the next 5-minute tick after the change. The 2026-05-17 rotation confirmed via 10 consecutive succeeded ticks (00:30–01:15 UTC) — `secrets-rotation-log.md`.

**Rollback:** re-apply the previous token to both the Edge secret and `cron.alter_job()`. If the previous value was not retained (the 2026-05-17 entry notes old values are not kept), generate a fresh one and repeat — there is no dependency on the old value.

---

## SUPABASE_SERVICE_ROLE_KEY

**TODO — procedure not yet documented.**

This has never been exercised for this project and no procedure exists in the codebase, commits, or rotation log. Do **not** follow invented steps. What is known in principle (verify against current Supabase documentation before attempting): the service-role key is regenerated from the Supabase dashboard (Project Settings → API); the Vercel `SUPABASE_SERVICE_ROLE_KEY` env var would need updating; the Edge runtime auto-injects this key so no manual Edge update is expected; the same project key backs both surfaces, so cutover is global and likely causes a brief elevated-privilege outage if mis-sequenced.

Before attempting, resolve **diagnostic external-confirm item #6** and see `docs/secrets-inventory.md` → `SUPABASE_SERVICE_ROLE_KEY` ("Last rotated: Not recorded"). Tracked in the README backlog ("SUPABASE_SERVICE_ROLE_KEY rotation").
