# Secrets Inventory

**Last updated:** 2026-07-21 (environment-separation flip)

> **Environment-separation note (2026-07-21).** `.env.local`'s **default** Supabase keys (`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`) now hold the **staging** project's values — local dev targets staging by default. The **production** values moved to `PROD_SUPABASE_URL` / `PROD_SUPABASE_ANON_KEY` / `PROD_SUPABASE_SERVICE_ROLE_KEY` in the same file, read only by the `--prod` verify-script channel. The Vercel runtime is untouched (its env vars remain the production values). Per-secret entries below describe the *production* credential; the staging counterparts are catalogued at the end of Section 1.
**Audited at commit:** `ff42cff` (latest landed at write-time). Most file:line citations were authored at `0a29535`; the Build Prompt #2 code phase (`1656859`, `8780e7c`, `63b6942`, `ff42cff`) shifted some line numbers — notably the EMAIL_FROM paths in `client.ts` and the reminder Edge Function — so treat cited line numbers as approximate, not exact. Re-audit and bump this reference whenever a commit touches a path cited in this file.
**Companion documents:**
- Rotation history → [`secrets-rotation-log.md`](secrets-rotation-log.md)
- How to rotate → [`runbooks/rotate-a-secret.md`](runbooks/rotate-a-secret.md)

**Scope.** Every environment variable the codebase reads, classified by sensitivity. Section 1 is the true secrets (exposure = security incident). Section 2 is everything else — public, operator-set-but-not-sensitive, or platform-injected — listed for completeness so future-me has the full runtime picture.

**Rotation frequency — standing policy.** No scheduled rotation cadence exists for any secret. There is no cadence policy in the codebase or `secrets-rotation-log.md`. The standing rule is: **rotate on suspicion of exposure.** Known rotation events are recorded per-secret below and in the rotation log.

---

## Section 1 — Secrets

Exposure of any value here is a notifiable-data-breach-adjacent event (the platform stores Privacy Act 1988 clinical data). Treat accordingly.

### `SUPABASE_SERVICE_ROLE_KEY`

> **Gateway-disable verified — Supabase dashboard, 2026-07-09.** The legacy anon and `service_role` keys are **disabled at the gateway**, verified on the Supabase dashboard Legacy API Keys tab on 2026-07-09 (its control reads "re-enable service keys" — i.e. they are in the disabled state). The distinction that matters: **disabled, not revoked.** The JWT signing secret has **not been revoked**, so the disable is **one-click reversible** — the leaked legacy `service_role` JWT is **neutralised, not destroyed**. Revoking the JWT signing secret is a **logged follow-up**, gated on first confirming no server-side consumer still rides a legacy JWT. (Separately, the DR backup-restore drill remains pending the Supabase Pro upgrade — the last open Beta-entry gate item.)

- **Purpose:** Server-only Supabase key that bypasses Row-Level Security; used by the small set of Server Actions / Route Handlers that legitimately need elevated access, and by the reminder + message-notification Edge Functions.
- **Used in:**
  - `src/lib/supabase/server.ts:59` (Next.js server client, service-role variant)
  - `supabase/functions/send-appointment-reminders/index.ts:81` (Edge Function — see "Stored where")
  - `supabase/functions/send-message-notifications/index.ts:70-71` (message-notification Edge Function, via `REMINDER_SERVICE_KEY` with the legacy key as fallback — added 2026-07-02)
- **Stored where:**
  - Next.js runtime: Vercel env vars (server-only; Production / Preview / Development).
  - Local dev: `.env.local` (gitignored; never committed — verified in the 2026-05-15 diagnostic via `git log --all --diff-filter=A`).
  - Edge Function: as of 2026-07-02 the EF reads `REMINDER_SERVICE_KEY` (an operator-set `sb_secret` value in its Supabase secret set), falling back to the platform-injected legacy key — which is now **disabled**. So the EF runs entirely on `REMINDER_SERVICE_KEY`.
- **Key type:** as of 2026-07-02 this is a new-format `sb_secret_…` API key (was a legacy `eyJ…` service_role JWT). The legacy JWT keys are disabled.
- **Rotation procedure:** [`runbooks/rotate-a-secret.md`](runbooks/rotate-a-secret.md)
- **Last rotated / migrated:** **2026-07-02** — migrated from the legacy `service_role` JWT to a new `sb_secret` API key (Vercel all-envs + `.env.local`; EF via `REMINDER_SERVICE_KEY`), and the **legacy keys were disabled** in Supabase — **disabled at the gateway, verified via the Supabase dashboard on 2026-07-09** (disabled, not revoked; see the note above). The leaked legacy `service_role` JWT is thereby **neutralised, not destroyed**. See `secrets-rotation-log.md` (2026-07-02 entry).
- **Rotation frequency:** No scheduled cadence; rotate on suspicion of exposure.

### `RESEND_API_KEY`

- **Purpose:** Authenticates outbound transactional email (client invites, appointment reminders) against the Resend API.
- **Used in:**
  - `src/lib/email/client.ts:15` (Next.js email client)
  - `supabase/functions/send-appointment-reminders/index.ts:82` (reminder Edge Function)
  - `supabase/functions/send-message-notifications/index.ts:73` (message-notification Edge Function — added 2026-07-02)
- **Stored where:**
  - Next.js runtime: Vercel env vars (Production / Preview / Development) — per the 2026-05-17 rotation log entry.
  - Edge Function: Supabase Edge Function secrets (`supabase secrets set RESEND_API_KEY=...`, per `index.ts:19-20`).
  - Local dev: `.env.local` (gitignored).
- **Rotation procedure:** [`runbooks/rotate-a-secret.md`](runbooks/rotate-a-secret.md)
- **Last rotated:** **2026-05-17.** Old key revoked in the Resend dashboard; new key generated and stored in Vercel env vars; verified production running on the new key. Source: [`secrets-rotation-log.md`](secrets-rotation-log.md). Reason: pasted in a chat transcript during initial deploy (diagnostic Finding #4).
- **Dashboard verified:** **2026-07-03** — Resend → API Keys shows exactly one active key (created 2026-05-17, the current key); the stale pre-rotation key is gone. Recorded in `secrets-rotation-log.md` (closure note under the 2026-06-16 entry).
- **Rotation frequency:** No scheduled cadence; rotate on suspicion of exposure.

### `CRON_SHARED_SECRET`

- **Purpose:** Bearer token the pg_cron caller presents to the `send-appointment-reminders` Edge Function. The function **fails closed** if it is unset (post-Finding-#3 fix, commit `701041c` — `authorizeCronRequest`, `index.ts:192-206`).
- **Used in:**
  - `supabase/functions/send-appointment-reminders/index.ts:76` (read), `:192-206` (enforcement)
  - `supabase/functions/send-message-notifications/index.ts:64` (message-notification Edge Function — reads + enforces the same bearer; added 2026-07-02)
  - `supabase/config.toml:74` (comment reference only)
- **Stored where (two places — both must be updated on rotation):**
  - Supabase Edge Function secrets.
  - pg_cron `job_id 1` — **inline literal** in the cron command (not Vault). Known tech-debt: `secrets-rotation-log.md` Follow-ups, and `docs/polish/client-portal-booking.md:161-168` TODO ("Migrate to Supabase Vault when convenient").
- **Rotation procedure:** [`runbooks/rotate-a-secret.md`](runbooks/rotate-a-secret.md) — must call out the two-place update explicitly.
- **Last rotated:** **2026-05-17.** Old value not retained (acceptable — rotation invalidates it); new value via `openssl rand -base64 32`, stored in password manager; updated in Supabase Edge Function secrets and pg_cron `job_id 1` via `cron.alter_job()`; verified by 10 consecutive successful pg_cron runs at 5-min intervals 00:30–01:15 UTC 2026-05-17. Source: [`secrets-rotation-log.md`](secrets-rotation-log.md). Reason: pasted in a chat transcript during deploy (diagnostic Finding #4).
- **Rotation frequency:** No scheduled cadence; rotate on suspicion of exposure.

### `STAGING_DB_PASSWORD` (+ assembled `STAGING_DB_URL`)

- **Purpose:** Postgres password for the **staging** project `odyssey-staging` (`fbtfzlgvnivgwydlijka`) — the non-prod test target (`go-live-checklist.md` §5). `STAGING_DB_URL` is the assembled session-pooler connection string built from it.
- **Used in:** `scripts/run-pgtap-staging.sh` (reads the ref only; the Management API channel needs no password) and the `--db-url` commands in [`runbooks/use-the-staging-project.md`](runbooks/use-the-staging-project.md).
- **Stored where:** `.env.local` only (gitignored). Not in Vercel, not in Edge Function secrets — staging has no app or functions pointing at it.
- **Stakes:** LOW — staging must never hold real client data (see the runbook's rollback note), so exposure is not a data event. It is still kept out of chat transcripts and commits on principle.
- **Rotation procedure:** Supabase dashboard → `odyssey-staging` → Settings → Database → reset password; update `.env.local` (`STAGING_DB_PASSWORD` + rebuild `STAGING_DB_URL`).
- **Set:** 2026-07-03 (project creation).

### Staging API keys (`sb_secret` / `sb_publishable`, staging project)

- **Purpose:** the staging project's new-format API keys. Since the 2026-07-21 environment-separation flip they are the values of `.env.local`'s **default** `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, so local dev and all default-channel scripts hit staging.
- **Stored where:** `.env.local` only (gitignored). Not in Vercel, not in Edge Function secrets.
- **Stakes:** LOW — staging holds synthetic data only (`scripts/seed-staging.mjs`); exposure is not a data event. Kept out of transcripts/commits on principle.
- **Rotation:** Supabase dashboard → `odyssey-staging` → API keys; or re-read via the Management API (`/v1/projects/<ref>/api-keys?reveal=true`, CLI token auth).

### Supabase CLI access token (Windows Credential Manager)

- **Purpose:** the operator-machine login token the Supabase CLI stores after `supabase login`. Authorises the **Management API** (`api.supabase.com/v1/...`) for **both** projects — including `GET/PATCH /v1/projects/<ref>/config/auth` (reads *and writes* production auth config: HIBP, confirmations, session time-box, the custom-access-token hook fields) and `GET /v1/projects/<ref>/api-keys?reveal=true` (reveals API keys). Catalogued 2026-07-22 — the reviewer pass on `polish/auth-onboarding-staff.md` found it in active use as a verification read channel since 2026-06-10 (`runbooks/verify-auth-config.md`, Management API note) but absent from this inventory. Its use is a recorded, conscious reversal of that doc's A.1(revised) Q4 "no Management API token" posture: no *new* credential was minted, but the channel exists and this entry is its ledger home.
- **Stored where:** Windows Credential Manager, generic credential `Supabase CLI:supabase` — operator machine only. Never in `.env.local`, never in CI, never deployed.
- **Stakes:** HIGH — it can silently flip the same dashboard-invisible auth settings the `verify-auth-config` workstream exists to guard, on production. Declared posture (from the runbook, restated here): never log or persist the token; read-only by default; PATCH only to restore a documented target value, recorded in the run log.
- **Rotation procedure:** `supabase logout` then `supabase login` (old token revoked server-side via the dashboard → Account → Access Tokens if one was minted explicitly). Rotate on suspicion the machine or credential store is compromised.
- **Set:** predates this entry (CLI link); catalogued 2026-07-22.

### `STAGING_DEV_LOGIN_*` / `STAGING_DEV_CLIENT_*` / `STAGING_DEV_EXCO_*`

- **Purpose:** synthetic dev logins for the seeded staging orgs (staff owner, portal client, EXCO owner), written into `.env.local` by `scripts/seed-staging.mjs`. Also the credential source for the authed render harness.
- **Stakes:** effectively none — they open a synthetic-data staging account and nothing else. Regenerated on every `seed-staging.mjs --wipe` run.

---

## Section 2 — Public values — not secrets, listed for completeness

Nothing here is a credential. Leaking any of it is not a security incident. Listed so the inventory is a complete picture of what flows through the runtime.

### 2a — Operator-set, public or non-sensitive

| Var | Purpose | Used in | Stored where | Why not a secret |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL for the SDK clients | `src/lib/supabase/server.ts:16,58`, `middleware.ts:21`, `client.ts:13` | Vercel env vars; `.env.local` | Project URL is public by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key for client/server SDK | `src/lib/supabase/server.ts:17`, `middleware.ts:22`, `client.ts:14` | Vercel env vars; `.env.local` | Anon key is RLS-bounded and shipped to the browser by design |
| `NEXT_PUBLIC_SITE_URL` | Absolute base URL for signup confirmation redirects | `src/app/signup/actions.ts:27` | Vercel env vars; `.env.local` | Public site address |
| `NEXT_PUBLIC_APP_URL` | Absolute base URL for booking links + reminder emails | `src/app/portal/book/new/actions.ts:137`, `supabase/functions/send-appointment-reminders/index.ts:85` | Vercel env vars; Edge Function secret | Public app address |
| `EMAIL_FROM` | Sender identity for all outbound email | `src/lib/email/client.ts:31`, `supabase/functions/send-appointment-reminders/index.ts:84` | Vercel env vars; Edge Function secret | A From: address, not a credential |
| `SENTRY_DSN` | Optional error-tracking DSN; the observability stub reads it but never branches on it (console-only until the real SDK is wired) | `src/lib/observability/sentry.ts:12` (plumbing landed by commit `63b6942`) | Vercel env vars (optional; unset → console-only) | Sentry DSNs are designed to be embeddable in client bundles — not a credential |
| `PUBLIC_SIGNUP_ENABLED` | Gates public staff signup at `/signup`; **fails closed** (enabled only when the value is exactly `"true"`) | `src/lib/env/signup.ts` (`isPublicSignupEnabled`), `src/app/signup/page.tsx`, `src/app/signup/actions.ts` | Vercel env vars; `.env.local` | A feature flag, not a credential — leaking it is not a security incident |

**`NEXT_PUBLIC_SITE_URL` vs `NEXT_PUBLIC_APP_URL` — failure mode (Flag E).** Same logical value, two different keys. Signup uses `NEXT_PUBLIC_SITE_URL`; booking and reminder emails use `NEXT_PUBLIC_APP_URL`. If only one is set in an environment, the other code path emits broken signup/booking confirmation URLs. Both must be set and kept in sync until reconciled. Tracked in the runbook README backlog. **Verified 2026-07-03:** Vercel has both keys set across all environments and in sync (operator dashboard check); a shadowing duplicate pair in `.env.local` (prod values re-declared below the localhost pair — dotenv last-key-wins pointed local dev at prod) was removed the same day, restoring `http://localhost:3000` for local dev. The keep-in-sync invariant remains standing until the two keys are consolidated.

**`EMAIL_FROM` — fail-loud enforcement.** Both code paths — `src/lib/email/client.ts` (`defaultFromAddress()`) and the `send-appointment-reminders` Edge Function — now throw `EmailConfigError` when `EMAIL_FROM` is unset; the Resend sandbox-sender fallback was removed by commit `1656859` (resolves diagnostic CRITICAL Finding #1). The booking-confirmation caller path was hardened by commit `8780e7c` (Flag F) to re-throw `EmailConfigError` rather than swallow it via `.catch(() => null)`. There is no fallback — set `EMAIL_FROM` to a verified-domain address before deploying, e.g. `EMAIL_FROM="OdysseyHQ <noreply@odysseyhq.com.au>"`.

**`PUBLIC_SIGNUP_ENABLED` — fail-closed enforcement.** Deliberately the *inverse* of the `EMAIL_FROM` fail-loud posture. `isPublicSignupEnabled()` (`src/lib/env/signup.ts`) returns `true` only when the value is exactly the string `"true"`; any other value — `"false"`, empty, malformed, or unset — returns `false` and keeps `/signup` closed. It never throws, because this var guards a security door: a missing value should keep the door shut, not crash the route. Both the page (`src/app/signup/page.tsx`, which renders a quiet closed state) and the action (`src/app/signup/actions.ts`, which redirects to `/signup?closed=1`) read this single helper. **During the friends-and-family beta, leave it unset (or not `"true"`) in production so public signup stays closed; set it to `"true"` only in development.**

### 2b — Platform-injected (operator never sets these)

| Var | Injected by | Used in | Note |
|---|---|---|---|
| `VERCEL_URL` | Vercel build/runtime | `src/app/signup/actions.ts:28`, `src/app/portal/book/new/actions.ts:137` | Deployment URL fallback; auto-populated, never set by hand |
| `NODE_ENV` | Next.js / Node | `src/app/portal/_components/RegisterSW.tsx:13` | `development` / `production` / `test`; framework-managed |
| `SUPABASE_URL` | Supabase Edge runtime | `supabase/functions/send-appointment-reminders/index.ts:80` | Edge-only (no `NEXT_PUBLIC_` prefix); auto-injected into deployed functions |
| `SUPABASE_SERVICE_ROLE_KEY` *(Edge context)* | Supabase Edge runtime | `supabase/functions/send-appointment-reminders/index.ts:81` | Same value as the Section 1 secret, but in the Edge Function it is platform-injected, not operator-set. Listed here so the injection path is visible; the credential itself is governed by Section 1. |

---

## Maintenance

- Audited from the codebase, not memory. Re-audit (`grep` for `process.env.` and `Deno.env.get`) whenever an env var is added, renamed, or removed.
- When an env var is removed or renamed in code, update this file in the same commit. A stale inventory entry pointing at a non-existent var is worse than no entry at all.
- `secrets-rotation-log.md` already forward-references this file (its Follow-ups section), so the two are mutually discoverable: rotation *history* there, secret *catalogue* here, rotation *procedure* in `runbooks/rotate-a-secret.md`.
- On rotation: append to `secrets-rotation-log.md` (history) **and** update the per-secret "Last rotated" line here.
