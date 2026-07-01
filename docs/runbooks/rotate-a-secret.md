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

**Steps** (current — assumes the Vault migration `20260701120000_appointment_reminders_cron_to_vault.sql` is applied, so the cron reads the token from Vault each tick):

1. Generate: `openssl rand -base64 32`. Store in the password manager.
2. Supabase Edge secret: `supabase secrets set CRON_SHARED_SECRET=<value>`.
3. Vault secret (the value the cron reads each tick). Do this immediately after step 2:
   ```sql
   SELECT vault.update_secret(
     (SELECT id FROM vault.secrets WHERE name = 'cron_shared_secret'),
     '<value>'
   );
   ```
   The next 5-minute tick picks it up automatically — no `cron.alter_job`, and the token never enters `cron.job.command`.
4. Verify (below).

**Pre-migration fallback** — only if `20260701120000` is NOT yet applied (the live job still carries an inline-literal token). Update the embedded token directly, immediately after step 2: `SELECT cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname='appointment-reminders-5min'), command := <command with the new token inlined>);`. Then apply the Vault migration per `deploy-an-edge-function.md` so future rotations are Vault-only and the token leaves the command.

**Verification**

- `check-cron-health.md` → `cron.job_run_details` shows `status='succeeded'` on the next 5-minute tick. The 2026-05-17 rotation confirmed via 10 consecutive succeeded ticks (00:30–01:15 UTC) — `secrets-rotation-log.md`. **But `succeeded` only means `net.http_post` queued** — a 401 from a mismatched token is invisible there. Confirm a *real* send with the **Cron-path send check** in [`deploy-an-edge-function.md`](deploy-an-edge-function.md) (assert a synthetic reminder reaches `status='sent'`).

**Rollback:** re-apply the previous token to both the Edge secret and the Vault secret (`vault.update_secret`). If the previous value was not retained (the 2026-05-17 entry notes old values are not kept), generate a fresh one and repeat — there is no dependency on the old value.

---

## SUPABASE_SERVICE_ROLE_KEY

**Procedure run 2026-07-02** (legacy → new API keys, then disable legacy). Supabase **removed** legacy-key rotation (you can no longer regenerate the legacy anon/service_role/JWT secret). A leaked legacy `service_role` key is neutralised by migrating clients to the new `sb_secret`/`sb_publishable` API keys and then **disabling** the legacy keys — the gateway then rejects them. It is a **value swap, not a code change**: the new secret key works with supabase-js's default `createClient(url, key)` (the docs' "secret keys can't go on `Authorization: Bearer`" warning did not bite this project — the gateway honours the `apikey` header regardless).

**Steps** (new-everywhere-and-verified, THEN disable legacy — never disable first):

1. Get a secret key: Supabase → Settings → API Keys → "Publishable and secret API keys" → Secret keys (`sb_secret_…`). The publishable key (`sb_publishable_…`) is the anon replacement.
2. **Prove the key works first** — a throwaway `node` script using the app's supabase-js: `createClient(url, sb_secret)`, count an RLS-protected table, expect rows (bypasses RLS = service-role works). Pass the key as a CLI arg locally; never let it enter a chat/transcript.
3. **Worker (EF):** `send-appointment-reminders` reads `REMINDER_SERVICE_KEY` (=sb_secret) first, with a fallback to the injected legacy key during cutover. `supabase secrets set REMINDER_SERVICE_KEY=sb_secret_…`; make sure the EF's supabase-js import is `sb_`-aware (≥ the app's version — the old `2.50.0` is too old); redeploy; run the **Cron-path send check** (`deploy-an-edge-function.md`).
4. **App:** swap the *values* (keep the variable NAMES) in **Vercel (all environments) + `.env.local`** — `SUPABASE_SERVICE_ROLE_KEY`→`sb_secret_…`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`→`sb_publishable_…`. No code change. Trigger a **fresh** production build (a `NEXT_PUBLIC_` value only re-bakes on a clean build; a cached redeploy won't pick it up — a `git push` to master forces one).
5. **Verify BEFORE disabling.** Local: service key bypasses RLS; publishable accepted for reads + a bogus login returns "Invalid login credentials" (= key accepted, account just doesn't exist). Prod: log in in a **private/incognito window** (forces the publishable path, no cached session).
6. **Disable legacy:** Supabase → API Keys → "Legacy anon, service_role" tab → **Disable JWT-based API keys** (one toggle, both keys). Re-test prod login + EF send with legacy off. The leaked legacy `service_role` JWT is now rejected.

**Rollback:** re-enable the legacy keys in the dashboard (instant, one click). They stay valid until deliberately disabled — which is why disable is the last step.

**Note:** the anon key is public and not itself a rotation item, but it must migrate to `sb_publishable` too because the disable toggle covers both legacy keys at once.
