# Secrets Inventory

**Last updated:** 2026-05-18
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

- **Purpose:** Server-only Supabase key that bypasses Row-Level Security; used by the small set of Server Actions / Route Handlers that legitimately need elevated access, and by the reminder Edge Function.
- **Used in:**
  - `src/lib/supabase/server.ts:59` (Next.js server client, service-role variant)
  - `supabase/functions/send-appointment-reminders/index.ts:81` (Edge Function — see "Stored where")
- **Stored where:**
  - Next.js runtime: Vercel env vars (server-only; Production / Preview / Development).
  - Local dev: `.env.local` (gitignored; never committed — verified in the 2026-05-15 diagnostic via `git log --all --diff-filter=A`).
  - Edge Function: **platform-injected by the Supabase Edge runtime** — not operator-set there (function header comment, `index.ts:16-18`). Same underlying project key, so rotating the project key affects both surfaces at once.
- **Rotation procedure:** [`runbooks/rotate-a-secret.md`](runbooks/rotate-a-secret.md)
- **Last rotated:** Not recorded. `secrets-rotation-log.md` documents only `RESEND_API_KEY` and `CRON_SHARED_SECRET` (2026-05-17). Whether the service-role key has been rotated since it sat in `.env.local` is **not determinable from code or the rotation log** — the 2026-05-15 diagnostic lists it as an open external-confirmation item (#6). Flagged for stakeholder confirmation, not asserted either way.
- **Rotation frequency:** No scheduled cadence; rotate on suspicion of exposure.

### `RESEND_API_KEY`

- **Purpose:** Authenticates outbound transactional email (client invites, appointment reminders) against the Resend API.
- **Used in:**
  - `src/lib/email/client.ts:15` (Next.js email client)
  - `supabase/functions/send-appointment-reminders/index.ts:82` (reminder Edge Function)
- **Stored where:**
  - Next.js runtime: Vercel env vars (Production / Preview / Development) — per the 2026-05-17 rotation log entry.
  - Edge Function: Supabase Edge Function secrets (`supabase secrets set RESEND_API_KEY=...`, per `index.ts:19-20`).
  - Local dev: `.env.local` (gitignored).
- **Rotation procedure:** [`runbooks/rotate-a-secret.md`](runbooks/rotate-a-secret.md)
- **Last rotated:** **2026-05-17.** Old key revoked in the Resend dashboard; new key generated and stored in Vercel env vars; verified production running on the new key. Source: [`secrets-rotation-log.md`](secrets-rotation-log.md). Reason: pasted in a chat transcript during initial deploy (diagnostic Finding #4).
- **Rotation frequency:** No scheduled cadence; rotate on suspicion of exposure.

### `CRON_SHARED_SECRET`

- **Purpose:** Bearer token the pg_cron caller presents to the `send-appointment-reminders` Edge Function. The function **fails closed** if it is unset (post-Finding-#3 fix, commit `701041c` — `authorizeCronRequest`, `index.ts:192-206`).
- **Used in:**
  - `supabase/functions/send-appointment-reminders/index.ts:76` (read), `:192-206` (enforcement)
  - `supabase/config.toml:74` (comment reference only)
- **Stored where (two places — both must be updated on rotation):**
  - Supabase Edge Function secrets.
  - pg_cron `job_id 1` — **inline literal** in the cron command (not Vault). Known tech-debt: `secrets-rotation-log.md` Follow-ups, and `docs/polish/client-portal-booking.md:161-168` TODO ("Migrate to Supabase Vault when convenient").
- **Rotation procedure:** [`runbooks/rotate-a-secret.md`](runbooks/rotate-a-secret.md) — must call out the two-place update explicitly.
- **Last rotated:** **2026-05-17.** Old value not retained (acceptable — rotation invalidates it); new value via `openssl rand -base64 32`, stored in password manager; updated in Supabase Edge Function secrets and pg_cron `job_id 1` via `cron.alter_job()`; verified by 10 consecutive successful pg_cron runs at 5-min intervals 00:30–01:15 UTC 2026-05-17. Source: [`secrets-rotation-log.md`](secrets-rotation-log.md). Reason: pasted in a chat transcript during deploy (diagnostic Finding #4).
- **Rotation frequency:** No scheduled cadence; rotate on suspicion of exposure.

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

**`NEXT_PUBLIC_SITE_URL` vs `NEXT_PUBLIC_APP_URL` — failure mode (Flag E).** Same logical value, two different keys. Signup uses `NEXT_PUBLIC_SITE_URL`; booking and reminder emails use `NEXT_PUBLIC_APP_URL`. If only one is set in an environment, the other code path emits broken signup/booking confirmation URLs. Both must be set and kept in sync until reconciled. Tracked in the runbook README backlog.

**`EMAIL_FROM` — fail-loud enforcement.** Both code paths — `src/lib/email/client.ts` (`defaultFromAddress()`) and the `send-appointment-reminders` Edge Function — now throw `EmailConfigError` when `EMAIL_FROM` is unset; the Resend sandbox-sender fallback was removed by commit `1656859` (resolves diagnostic CRITICAL Finding #1). The booking-confirmation caller path was hardened by commit `8780e7c` (Flag F) to re-throw `EmailConfigError` rather than swallow it via `.catch(() => null)`. There is no fallback — set `EMAIL_FROM` to a verified-domain address before deploying, e.g. `EMAIL_FROM="OdysseyHQ <noreply@odysseyhq.com.au>"`.

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
