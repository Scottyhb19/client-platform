# Runbook — Verify auth dashboard-config

> Mechanism and design cited from `docs/polish/auth-onboarding-staff.md` ("A.1 resolution — buildable design"). Script: `scripts/verify-auth-config.mjs`. This runbook covers the three behaviourally/probe-verified properties (G-1, G-3, G-7) plus the one documentation-only property (G-4). The four are consolidated because each is a security property that lives in a Supabase dashboard setting, is invisible to application code, and silently degrades security if changed — with no drift detection otherwise.

**Purpose:** Confirm four Supabase auth settings match their target values: the custom-access-token hook is enabled (G-1, the tenant-isolation boundary), HIBP leaked-password protection is on (G-3), the refresh-token lifetime is 30 days (G-4), and email confirmations are required (G-7).

**Prerequisites**

- `.env.local` at the repo root with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The script reads these directly; the service-role key is passed only to the Supabase client and is never logged.
- Node (the repo's pinned version). The script is plain ESM — `node scripts/verify-auth-config.mjs`, no extra tooling.
- Run from the **repository root** (the script reads `./.env.local`).
- Run on the **operator's machine only** — never in CI (CI would mean a standing copy of the service-role key in a third party) and never as an HTTP endpoint.

**One-time setup (reviewed first-run step)**

G-1 needs a persistent, inert, **memberless** verification organisation to attach an ephemeral probe user to. It is created once:

```
node scripts/verify-auth-config.mjs --bootstrap
```

This inserts one `organizations` row — name `[VERIFY] auth-config probe org - do not use`, slug `verify-auth-config-probe`. It has no members and no seeded lookup rows, so it is invisible to every RLS-scoped operator surface; it appears only in service-role/admin raw-table scans. **Org UUID (bootstrapped 2026-05-21):** `483ca6b6-7d58-4618-b83e-22b8da9f857d`. Without it, G-1 reports `CND` and tells you to bootstrap.

**Steps**

1. Run the script:
   ```
   node scripts/verify-auth-config.mjs
   ```
2. Read the per-property output. Each line is `G-x [STATUS] label` followed by an explanation. Statuses: `GREEN` (target met), `RED` (target not met — act), `CND` (could-not-determine — re-run or investigate), `DOC` (documentation-only, G-4).
3. Exit code mirrors the worst result: `0` all green · `1` any red · `2` any could-not-determine · `3` fatal.

**What each check does**

- **G-1 — hook enabled.** Creates a pre-confirmed ephemeral user (`admin.createUser`, `email_confirm: true`), attaches it as a **non-owner** (`staff`) member of the verification org, signs it in to obtain a fresh JWT, and asserts the JWT carries `organization_id`. Present ⇒ `GREEN`. Absent ⇒ `RED` (hook disabled — the catastrophic case: every RLS policy matches zero rows and the platform reads as empty). Teardown is leaf-to-root deletes (membership then user), no trigger-disabling, because a non-owner deletion does not fire `enforce_last_owner_invariant`.
- **G-3 — HIBP.** Calls the **front-door** `signUp` (never the admin path, which bypasses HIBP) with a known-breached `>=12`-char password. Because the project enforces no character-class rules, the only weak reason that can fire is `pwned`, so a rejection isolates HIBP. Rejected ⇒ `GREEN`. Accepted ⇒ `RED` (HIBP off; the created user is torn down). **Free-tier status (2026-05-21): this automated probe is blocked — `signUp` rejects throwaway recipient domains with `email_address_invalid` and consumes a small rolling email rate limit, so the script returns `CND`. Verified manually instead — see "Free-tier status" below.**
- **G-7 — confirmations.** Calls front-door `signUp` and asserts a null session is returned (confirmation required before login). Null session ⇒ `GREEN`. Immediate session ⇒ `RED`. Partial assertion per design (it cannot distinguish "confirmations on" from "on but the email template is broken"). **Free-tier status (2026-05-21): blocked for the same reason as G-3 (the `signUp` email layer); the script returns `CND`. Verified manually instead — see "Free-tier status" below.**
- **G-4 — refresh-token lifetime.** Documentation-only. The script does not assert it (the only observable consequence takes the lifetime itself to observe). **Target: 2592000 seconds (30 days).** Re-verify by reading the dashboard value (below) at the cadence below. **Pro-gated (2026-05-21): refresh-token max-lifetime configuration requires Supabase Pro; the project is on the free tier, so this is deferred — set and record the value when the project moves to Pro, and at the latest before any paying clinical client (per CLAUDE.md Open gates).**

### Free-tier status (2026-05-21) — G-3 and G-7 are verified manually, not by the script

The automated G-3/G-7 probes call Supabase's front-door `signUp`, which on this project's free tier is blocked two ways: (1) `signUp` rejects throwaway recipient domains with `email_address_invalid` — it applies stricter domain/deliverability validation than the admin path, confirmed on 2026-05-21 when the **same** domain (`@verify.mail.odysseyhq.com.au`) succeeded via `admin.createUser` in G-1 but failed via `signUp` in G-3; and (2) it sends real auth email against a small rolling rate limit (`over_email_send_rate_limit`). The script therefore returns `CND` for G-3/G-7 on this setup — that is **expected**, not a failure.

Both dashboard toggles are confirmed **set** by the operator (2026-05-21): HIBP leaked-password protection ON (G-3), email confirmations ON (G-7). The toggles being set is not the same as the behaviour being verified — per the trust-nothing posture, close each with a single manual confirmation:

- **G-3 (HIBP):** Once, attempt a real signup (app `/signup`, or the Supabase dashboard "Add user → with password") using an email you control and a known-breached password ≥12 chars (pick one confirmed at `https://haveibeenpwned.com/Passwords`). Expect rejection for a leaked/weak password. Rejected ⇒ HIBP confirmed on. Accepted ⇒ HIBP is off; re-check the dashboard toggle.
- **G-7 (confirmations):** During any real signup (normal friends-and-family onboarding counts), confirm you cannot log in until you click the emailed confirmation link — i.e. no active session is granted at signup. Required ⇒ confirmations confirmed on.

Re-verify these manually whenever you change the relevant dashboard settings or migrate auth config. **G-1 remains the automated check** (admin path, sends no email, unaffected by these blockers) at the cadence below. Record manual results in the run log at the bottom of this runbook.

> **Future automation option (unbuilt, unverified).** Both probes could likely be rebuilt to sidestep the email layer entirely — G-7 by creating an `email_confirm: false` admin user and asserting `signInWithPassword` returns `email_not_confirmed`; G-3 by a front-door `updateUser({ password })` on an admin-created, signed-in user. Both avoid `signUp` domain validation and send no signup email. Revisit if automating G-3/G-7 becomes worth it (e.g. after a Pro upgrade or more practitioners).

**The four dashboard values (where they live)**

> Supabase rearranges its dashboard periodically; confirm the menu path against the current UI.

- **G-1:** Authentication → Hooks → Custom Access Token → enabled, URI `pg-functions://postgres/auth_hooks/custom_access_token`.
- **G-3:** Authentication → Providers → Email → Password Settings → "Prevent use of leaked passwords (HIBP)".
- **G-4:** Authentication → Sessions → Refresh token max lifetime → `2592000` s (30 days). Confirm rotation on, reuse interval 10 s. **This is the documentation-only value — record it here when set:** `__________` (date/value/screenshot reference).
- **G-7:** Authentication → Providers → Email → "Confirm email" enabled.

**Self-cleaning and orphans**

- Every ephemeral probe user this script creates is torn down on **all** exit paths (pass, fail, or throw) via a guaranteed post-run sweep by the run's email prefix. A crash mid-run does not leave an orphaned production user.
- Naming convention: ephemeral users are `verify-probe-<runId>-<check>@<domain>`; the persistent org slug is `verify-auth-config-probe`. Nothing real can collide with these.
- A **pre-run orphan scan** reports any leftover `verify-probe-*` users from a prior crashed run (it runs before any new user is created, so every match is residue). It does **not** auto-delete — re-run with `--clean-orphans` to remove them:
  ```
  node scripts/verify-auth-config.mjs --clean-orphans
  ```

**Cadence (two triggers — the second is the one with teeth)**

- **Quarterly.** Catches silent dashboard drift.
- **On every migration that touches RLS policies, the JWT hook, the auth helpers, or `user_organization_roles` / `organizations` shape.** This is the trigger that catches the change that actually moves the boundary. Add a line to the migration's PR/notes confirming this was run.

**Verification (what healthy looks like)**

- First-ever run is not a formality — it is the first real look at four properties the platform has been depending on by inference. By inference G-1 is likely `GREEN` (a disabled hook would have made the finished sections render no data — a dead platform you'd have noticed); G-3, G-4, G-7 have no prior signal. Treat the first run as discovery, not confirmation.
- Healthy steady state: `G-1 GREEN`, `G-3 GREEN`, `G-7 GREEN`, `G-4 DOC` (dashboard value recorded), orphan scan clean, teardown sweep clean, exit 0.

**Remediation**

- **G-1 RED** — enable the hook (dashboard path above). This is the highest-severity finding; until it is green the multi-tenant boundary is not being enforced through the JWT. After enabling, re-run; also run [`verify-cross-tenant-isolation.md`](verify-cross-tenant-isolation.md).
- **G-3 RED** — enable HIBP (dashboard path above), re-run. If G-3 is `RED` but the dashboard shows HIBP enabled, the test password may not be in the HIBP corpus: set `VERIFY_G3_BREACHED_PASSWORD` to a confirmed known-breached `>=12`-char string (verify a candidate at `https://haveibeenpwned.com/Passwords`) and re-run.
- **G-4 (doc)** — set the dashboard value to 2592000 s and record it above.
- **G-7 RED** — enable "Confirm email" (dashboard path above), re-run.
- **CND** on G-1/G-3/G-7 — read the explanation. Common causes: verification org not bootstrapped (G-1), a rate limit on repeated signups (G-3/G-7 — wait and re-run), or a transient network error.

**Rollback**

N/A — this is a read/verify runbook plus a one-time additive bootstrap (the inert org). To remove the verification artefacts entirely: `--clean-orphans` clears any probe users, and the inert org row can be deleted by hand (it is memberless, so a plain `DELETE FROM organizations WHERE slug = 'verify-auth-config-probe'` succeeds — no trigger or RESTRICT blocks a memberless org).

---

## Run log

| Date | G-1 | G-3 | G-7 | G-4 | Notes |
|---|---|---|---|---|---|
| 2026-05-21 | GREEN (script) | CND (script — free-tier blocked) | CND (script — free-tier blocked) | DOC (Pro-gated, deferred) | First production run + bootstrap. Inert org `483ca6b6-7d58-4618-b83e-22b8da9f857d` created (memberless). Teardown clean, 0 stray probe users. G-3/G-7 reclassified to manual check (toggles set; behaviour pending one-off manual confirmation). |
| _(pending)_ | | _manual_ | _manual_ | | One-off manual confirmations per "Free-tier status" above — to be recorded when run. |
