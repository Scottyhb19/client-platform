# Runbook — Verify auth dashboard-config

> Mechanism and design cited from `docs/polish/auth-onboarding-staff.md` ("A.1 resolution — buildable design"). Script: `scripts/verify-auth-config.mjs`. This runbook covers the behaviourally/probe-verified properties (G-1, G-3, G-3u, G-7) plus the one documentation-only property (G-4). The four are consolidated because each is a security property that lives in a Supabase dashboard setting, is invisible to application code, and silently degrades security if changed — with no drift detection otherwise.

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
- **G-3u — HIBP on the `updateUser` path (C-7, added 2026-06-10).** Admin-creates a pre-confirmed ephemeral user, signs it in on the **anon (front-door)** client, then attempts `updateUser({ password: <known-breached> })` — the exact call clients make in the welcome/accept flow (`src/app/welcome/actions.ts`) and password reset (`src/app/auth/reset-password/actions.ts`). Sends no mail at any step, so it runs cleanly on the free tier where G-3's signUp probe cannot. Rejected with `pwned` ⇒ `GREEN` (HIBP covers the path every client uses). Accepted ⇒ `RED` — **but read the plan-gate section above before acting**: on the free tier RED is the expected steady state (HIBP cannot be enabled at all); only on Pro with the toggle ON does RED mean the C-7 platform hole (updateUser exempt from the signUp policy), which is the support-ticket case. Caveat recorded at the C-7 close: the probe holds a *password* session; the app's real calls run under *invite* and *recovery* sessions. HIBP is a password-strength check at GoTrue's update endpoint and is not known to vary by session type, so the probe is representative — but a session-type-gated HIBP would evade it.
- **G-7 — confirmations.** Calls front-door `signUp` and asserts a null session is returned (confirmation required before login). Null session ⇒ `GREEN`. Immediate session ⇒ `RED`. Partial assertion per design (it cannot distinguish "confirmations on" from "on but the email template is broken"). **Free-tier status (2026-05-21): blocked for the same reason as G-3 (the `signUp` email layer); the script returns `CND`. Verified manually instead — see "Free-tier status" below.**
- **G-4 — refresh-token lifetime.** Documentation-only. The script does not assert it (the only observable consequence takes the lifetime itself to observe). **Target: 2592000 seconds (30 days).** Re-verify by reading the dashboard value (below) at the cadence below. **Pro-gated (2026-05-21): refresh-token max-lifetime configuration requires Supabase Pro; the project is on the free tier, so this is deferred — set and record the value when the project moves to Pro, and at the latest before any paying clinical client (per CLAUDE.md Open gates).**

### Free-tier status (2026-05-21) — G-3 and G-7 are verified manually, not by the script

The automated G-3/G-7 probes call Supabase's front-door `signUp`, which on this project's free tier is blocked two ways: (1) `signUp` rejects throwaway recipient domains with `email_address_invalid` — it applies stricter domain/deliverability validation than the admin path, confirmed on 2026-05-21 when the **same** domain (`@verify.mail.odysseyhq.com.au`) succeeded via `admin.createUser` in G-1 but failed via `signUp` in G-3; and (2) it sends real auth email against a small rolling rate limit (`over_email_send_rate_limit`). The script therefore returns `CND` for G-3/G-7 on this setup — that is **expected**, not a failure.

Both dashboard toggles are confirmed **set** by the operator (2026-05-21): HIBP leaked-password protection ON (G-3), email confirmations ON (G-7). The toggles being set is not the same as the behaviour being verified — per the trust-nothing posture, close each with a single manual confirmation:

- **G-3 (HIBP):** Once, attempt a real signup (app `/signup`, or the Supabase dashboard "Add user → with password") using an email you control and a known-breached password ≥12 chars (pick one confirmed at `https://haveibeenpwned.com/Passwords`). Expect rejection for a leaked/weak password. Rejected ⇒ HIBP confirmed on. Accepted ⇒ HIBP is off; re-check the dashboard toggle.
- **G-7 (confirmations):** During any real signup (normal friends-and-family onboarding counts), confirm you cannot log in until you click the emailed confirmation link — i.e. no active session is granted at signup. Required ⇒ confirmations confirmed on.

Re-verify these manually whenever you change the relevant dashboard settings or migrate auth config. **G-1 remains the automated check** (admin path, sends no email, unaffected by these blockers) at the cadence below. Record manual results in the run log at the bottom of this runbook.

### Plan-gate correction (2026-06-10) — HIBP cannot be enabled on the free tier

The 2026-05-21 statement above that the HIBP toggle is "confirmed set" is **superseded**: a direct Management API read on 2026-06-10 (`GET /v1/projects/<ref>/config/auth`) returned `password_hibp_enabled: false`, and a PATCH attempting to enable it was refused with *"Configuring leaked password protection via HaveIBeenPwned.org is available on Pro Plans and up."* HIBP leaked-password protection is a **Pro-plan feature**; on this project's free tier it is off and cannot be switched on, in the dashboard or via API. Consequences:

- **G-3 target state is unsatisfiable on the current plan.** Until a Pro upgrade, no password-write path (signUp, updateUser, recovery) performs any breach check. The app-layer 12-char minimum (enforced server-side on the client welcome and reset paths) is the only password-strength control in force, now backstopped by GoTrue `password_min_length = 12` (below).
- **G-3u reports RED as the expected steady state on free tier.** Read its detail text; do not file a Supabase support ticket for a free-tier RED — the platform is behaving as priced, not malfunctioning.
- **Re-trigger:** on Pro upgrade, enable the dashboard HIBP toggle, then re-run this script. G-3u then answers the original C-7 question — whether HIBP fires on `updateUser` (the path every client uses) or only on `signUp`. GREEN closes it; RED *on Pro with the toggle on* is the real platform hole and the support-ticket case.
- **Same finding, adjacent field:** GoTrue `password_min_length` was found at **6** (the GoTrue default — it had never been configured; the 12 in `supabase/config.toml` applies only to local dev / `config push`, which has never been run). Restored to **12** via Management API PATCH on 2026-06-10 and confirmed by re-read. The §12.1 length commitment was never exposed to users (the app layer enforces 12 on both client paths), but the GoTrue backstop was 6 until this correction.

### Management API config read (capability note, 2026-06-10 onward)

The "invisible to code" premise of this runbook is now partially obsolete: the Supabase CLI's stored access token (Windows Credential Manager, generic credential `Supabase CLI:supabase`) authorises `GET https://api.supabase.com/v1/projects/<ref>/config/auth`, which returns the live auth config including `password_hibp_enabled`, `password_min_length`, `mailer_autoconfirm`, `refresh_token_rotation_enabled`, `security_refresh_token_reuse_interval`, and the custom-access-token hook fields. This is a direct read of the *setting*; the script's probes remain the verification of the *behaviour*. Posture: never log or persist the token; read-only by default; PATCH only to restore a documented target value, recording it in the run log. The 2026-06-10 read confirmed G-7's setting (`mailer_autoconfirm=false`) and G-4's rotation settings (rotation on, 10 s reuse interval) directly.

> **Future automation option (partially built 2026-06-10).** The G-3 variant is **built**: `G-3u` in the script drives a front-door `updateUser({ password })` on an admin-created, signed-in user — no signUp domain validation, no mail; it runs on the free tier (where its RED is expected per the plan-gate above) and delivers the definitive updateUser answer once the project is on Pro with HIBP enabled. The G-7 variant (an `email_confirm: false` admin user + asserting `signInWithPassword` returns `email_not_confirmed`) remains unbuilt — less needed now that the Management API read confirms the setting directly.

**The four dashboard values (where they live)**

> Supabase rearranges its dashboard periodically; confirm the menu path against the current UI.

- **G-1:** Authentication → Hooks → Custom Access Token → enabled, URI `pg-functions://postgres/auth_hooks/custom_access_token`.
- **G-3:** Authentication → Providers → Email → Password Settings → "Prevent use of leaked passwords (HIBP)". **Plan-gated (2026-06-10): Pro plans and up — cannot be enabled on the free tier; see the plan-gate correction above.** Same screen: minimum password length, target **12** (restored from the GoTrue default of 6 via Management API, 2026-06-10).
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
- Healthy steady state **on the current free tier**: `G-1 GREEN`, `G-3 CND` (signUp email blockers), `G-3u RED` (plan-gated — expected, not actionable), `G-7 CND` (setting confirmed via Management API instead), `G-4 DOC`, orphan scan clean, teardown sweep clean, exit 1 (the G-3u RED). Healthy steady state **after a Pro upgrade with HIBP enabled**: `G-1 GREEN`, `G-3u GREEN`, `G-4 DOC` (max-lifetime recorded), orphan + teardown clean.

**Remediation**

- **G-1 RED** — enable the hook (dashboard path above). This is the highest-severity finding; until it is green the multi-tenant boundary is not being enforced through the JWT. After enabling, re-run; also run [`verify-cross-tenant-isolation.md`](verify-cross-tenant-isolation.md).
- **G-3 / G-3u RED** — first check the plan: on the free tier HIBP cannot be enabled and G-3u RED is expected (plan-gate section above) — no action. On Pro: enable HIBP (dashboard path above), re-run. If still `RED` with the dashboard showing HIBP enabled, the test password may not be in the HIBP corpus: set `VERIFY_G3_BREACHED_PASSWORD` to a confirmed known-breached `>=12`-char string (verify a candidate at `https://haveibeenpwned.com/Passwords`) and re-run. (The default `password12345` was corpus-confirmed 2026-06-10 via the range API — 181,374 occurrences.) A G-3u RED on Pro with the toggle ON and a corpus-confirmed password is the C-7 platform hole: file a Supabase support ticket asking that `updateUser` share the signUp leaked-password policy.
- **G-4 (doc)** — set the dashboard value to 2592000 s and record it above.
- **G-7 RED** — enable "Confirm email" (dashboard path above), re-run.
- **CND** on G-1/G-3/G-7 — read the explanation. Common causes: verification org not bootstrapped (G-1), a rate limit on repeated signups (G-3/G-7 — wait and re-run), or a transient network error.

**Rollback**

N/A — this is a read/verify runbook plus a one-time additive bootstrap (the inert org). To remove the verification artefacts entirely: `--clean-orphans` clears any probe users, and the inert org row can be deleted by hand (it is memberless, so a plain `DELETE FROM organizations WHERE slug = 'verify-auth-config-probe'` succeeds — no trigger or RESTRICT blocks a memberless org).

---

## Run log

| Date | G-1 | G-3 | G-3u | G-7 | G-4 | Notes |
|---|---|---|---|---|---|---|
| 2026-05-21 | GREEN (script) | CND (script — free-tier blocked) | — (not yet built) | CND (script — free-tier blocked) | DOC (Pro-gated, deferred) | First production run + bootstrap. Inert org `483ca6b6-7d58-4618-b83e-22b8da9f857d` created (memberless). Teardown clean, 0 stray probe users. G-3/G-7 reclassified to manual check (toggles set; behaviour pending one-off manual confirmation). **Note 2026-06-10: the "HIBP toggle set" half of this entry is superseded — HIBP is plan-gated and was not enforceable; see the plan-gate correction above and the next row.** |
| 2026-06-10 | GREEN (script) | CND (script — free-tier signUp blockers). Setting read directly via Management API: `password_hibp_enabled=false`, **plan-gated** — enabling refused with "available on Pro Plans and up" | **RED (script — expected steady state on free tier).** updateUser accepted the corpus-confirmed breached password because HIBP cannot be enabled at all on this plan. Not drift, not an updateUser exemption | CND (script — email rate limit). Setting confirmed ON via Management API: `mailer_autoconfirm=false` | DOC (rotation `true` + reuse interval `10s` confirmed via Management API; max-lifetime still Pro-gated, deferred) | First G-3u run (C-7). Breached test password corpus-confirmed via HIBP k-anonymity range API (181,374 occurrences). GoTrue `password_min_length` found at **6** (GoTrue default — never configured in the dashboard), restored to **12** via Management API PATCH, re-read confirmed. Teardown sweep + orphan scan clean on all runs. The pending one-off manual confirmations are superseded: G-3's is moot (plan-gated — there is no enforcement to confirm), G-7's setting-level question is closed by the API read (a behavioural spot-check rides along free with the first real beta signup). |
| 2026-07-02 | GREEN (script) | CND (script — run 1 `email_address_invalid` on the probe address, run 2 `over_email_send_rate_limit`) | RED (script — expected steady state on free tier, unchanged) | CND (same signUp blockers as G-3) | DOC — **rotation behaviourally verified on live this run** via a mail-free probe (admin-created pre-confirmed `verify-probe-rotation-*` user; sign-in → refresh issued a *distinct* single-use refresh token; teardown clean). Lifetime setting still Pro-gated | Post-`sb_secret`-migration + go-live §3 verification run. **G-1 GREEN is the load-bearing result — the custom-access-token hook survived the 2026-07-02 API-key migration.** ⚠️ **For the Pro-cutover run:** run 1 rejected the `VERIFY_EMAIL_DOMAIN` probe address as `email_address_invalid` *before* any rate limit was plausible — if this recurs at cutover, check whether GoTrue's newer email validation wants the probe domain to resolve (MX); `verify.mail.odysseyhq.com.au` has no DNS records. Space runs ≥1h apart on the free-tier auth mailer. |
