# Diagnostic — Auth, Onboarding, Multi-Tenancy
Generated: 2026-05-15
Codebase commit: d4d8980 ("Testing module polish: Phase M — Staff Reports Category ↔ Battery view toggle + rail rewrite")
Auditor: Claude Code (forensic read of repo at HEAD; no code modified)
Independently re-verified: 2026-05-16, same commit d4d8980 — all 5 CRITICAL findings and the large majority of file:line citations re-checked directly against code and confirmed exact. One numeric correction applied (FORCE-RLS table count: 5 → 11; conclusion unchanged). See "Re-verification note (2026-05-16)" at the end of this document.

This is a read-only diagnostic. Every claim links to a file path (`src/...`), a migration filename, or a policy name. Statements that require external verification (Supabase dashboard, Vercel dashboard, Resend dashboard, DNS) are flagged as such.

Severity framing for this document is shaped by the Privacy Act 1988 — the platform stores clinical/health data, so "an RLS hole" is a notifiable-data-breach surface, not a code-quality matter.

---

## CRITICAL FINDINGS

1. **Email sender is Resend's sandbox address — only the Resend-account-verified recipient can ever receive mail.** [src/lib/email/client.ts:31](src/lib/email/client.ts:31) defaults `EMAIL_FROM` to `Odyssey <onboarding@resend.dev>`; the sandbox sender per Resend policy only delivers to the verified account email. This explains the stakeholder's observation that "invites only work to myself." Until a custom sending domain is verified in Resend and `EMAIL_FROM` is set to it (server-side env, including the Supabase Edge Function secrets), **no real client can be invited**. Severity: blocks the entire client-onboarding path for any non-Scotty email.

2. **External IT-advisor review of `docs/auth.md` and `docs/rls-policies.md` is parked and not closed.** [CLAUDE.md "Open gates"](CLAUDE.md) explicitly names this as non-negotiable before first real client onboards. There is no `docs/external-reviews.md`. Severity: documented launch gate — production launch without this is a posture violation, not a code bug.

3. **Edge Function `send-appointment-reminders` fails OPEN if `CRON_SHARED_SECRET` is unset.** [supabase/functions/send-appointment-reminders/index.ts:76-83](supabase/functions/send-appointment-reminders/index.ts:76-83) — the guard reads `if (expectedToken && authHeader !== ...)`; an empty `expectedToken` short-circuits to "no check." Combined with `verify_jwt = false` in [supabase/config.toml:78-79](supabase/config.toml:78-79), an unauthenticated request from anywhere on the internet executes the function. Worst-case impact in current shape: unauthorised drain of the `appointment_reminders` queue and Resend cost abuse; no PHI leaks because the function does not return appointment context.

4. **`RESEND_API_KEY` and `CRON_SHARED_SECRET` appeared in chat transcripts during deploy** per the self-documented note in [docs/polish/client-portal-booking.md:167](docs/polish/client-portal-booking.md:167). Rotation is acknowledged but pending. Severity: high — these are live production secrets in a Supabase project that already holds the only production database.

5. **No automated test proves direct cross-tenant SELECT/UPDATE on RLS-protected tables is blocked.** Tests under [supabase/tests/database/](supabase/tests/database/) exercise SECURITY DEFINER RPCs (test 05 explicitly covers cross-org deny on soft-delete RPCs) and the audit resolver coverage guard (test 14), but no test stands up two organisations, issues a bare `SELECT * FROM clients` as staff_b with org_b's JWT, and asserts zero rows from org_a's data. The single highest-impact failure mode in a multi-tenant system has no regression net. Severity: high — depends on policy code being right; cannot be re-verified after every migration.

---

## Section 1 — Authentication

### What exists

- **Supabase Auth is the only identity provider.** [src/lib/supabase/server.ts:12-36](src/lib/supabase/server.ts:12-36) creates a server client wired to anon-key + cookie-store. [src/lib/supabase/client.ts:11-16](src/lib/supabase/client.ts:11-16) is the browser equivalent. There are no custom auth routes that bypass Supabase.
- **Session-refresh middleware** in [src/lib/supabase/middleware.ts:17-62](src/lib/supabase/middleware.ts:17-62) reads `supabase.auth.getUser()` (not `getSession()`) on every request and protects `/dashboard`, `/portal`, `/onboarding` prefixes. Mounted via Next.js 16's renamed convention at [src/proxy.ts](src/proxy.ts).
- **Every server-side auth check uses `getUser()`** (verifies the JWT against the auth server). Verified via grep across `src/`: 17 call sites in [src/app/page.tsx:10](src/app/page.tsx:10), [src/app/portal/layout.tsx:48](src/app/portal/layout.tsx:48), [src/app/welcome/page.tsx:32](src/app/welcome/page.tsx:32), [src/app/welcome/actions.ts:48](src/app/welcome/actions.ts:48), [src/app/welcome/install/page.tsx:23](src/app/welcome/install/page.tsx:23), [src/app/onboarding/org/page.tsx:15](src/app/onboarding/org/page.tsx:15), [src/app/onboarding/org/actions.ts:23](src/app/onboarding/org/actions.ts:23), [src/app/portal/you/page.tsx:12](src/app/portal/you/page.tsx:12), [src/lib/supabase/middleware.ts:45](src/lib/supabase/middleware.ts:45), [src/app/portal/session/[dayId]/complete/page.tsx:18](src/app/portal/session/[dayId]/complete/page.tsx:18), [src/app/portal/session/[dayId]/actions.ts:29,69](src/app/portal/session/[dayId]/actions.ts:29), [src/app/portal/reports/page.tsx:30](src/app/portal/reports/page.tsx:30), [src/lib/auth/require-role.ts:31,70](src/lib/auth/require-role.ts:31), [src/app/portal/page.tsx:37](src/app/portal/page.tsx:37). No call site uses `getSession()`.
- **Role + organisation lookup via JWT custom-claim hook.** [supabase/migrations/20260420100300_auth_helpers_and_jwt_hook.sql:24-32 (`user_organization_id`)](supabase/migrations/20260420100300_auth_helpers_and_jwt_hook.sql:24-32) and `:42-47` (`user_role`) read the claims; the hook function `auth_hooks.custom_access_token` (lines 65-109) injects `organization_id` + `user_role` into every issued JWT from `user_organization_roles`. The Phase-4 multi-org "preferred org" path is already wired (line 79).
- **`requireRole` helper** in [src/lib/auth/require-role.ts:26-59](src/lib/auth/require-role.ts:26-59) calls `getUser`, then `user_organization_id` and `user_role` RPCs, redirects to `/login` / `/onboarding/org` / `/unauthorized` as appropriate. Used on every staff page (e.g. [src/app/(staff)/dashboard/page.tsx:28](src/app/(staff)/dashboard/page.tsx:28), [src/app/(staff)/settings/page.tsx:28-31](src/app/(staff)/settings/page.tsx:28-31)).
- **Email+password sign-in.** [src/app/login/page.tsx:27-98](src/app/login/page.tsx:27-98) form posts to [src/app/login/actions.ts:6-23](src/app/login/actions.ts:6-23), which calls `supabase.auth.signInWithPassword`.
- **Self-service signup.** [src/app/signup/page.tsx](src/app/signup/page.tsx) + [src/app/signup/actions.ts:6-51](src/app/signup/actions.ts:6-51) enforce a 12-char minimum (line 15) matching [supabase/config.toml:47](supabase/config.toml:47), and rely on `enable_confirmations = true` ([supabase/config.toml:52](supabase/config.toml:52)) so the user is sent to `/signup?info=check-email` until they verify ([src/app/signup/actions.ts:46-50](src/app/signup/actions.ts:46-50)).
- **Email-confirmation + invite callback** at [src/app/auth/callback/route.ts](src/app/auth/callback/route.ts) handles `code` exchange (line 34-45), `token_hash` OTP verify (lines 47-61), AND the implicit-flow fragment with a client-side bridge (lines 71-118) POSTing to [src/app/auth/set-session/route.ts](src/app/auth/set-session/route.ts) which validates via `setSession`. Robust handling of every Supabase email flow.
- **Logout** in [src/app/login/actions.ts:25-29](src/app/login/actions.ts:25-29) calls `supabase.auth.signOut()`, which revokes the refresh token server-side (Supabase default).
- **JWT TTL = 1 hour, refresh rotation enabled, reuse interval = 10s.** [supabase/config.toml:41-43](supabase/config.toml:41-43). Matches the design in [docs/auth.md §4.2](docs/auth.md).
- **Refresh tokens in HttpOnly cookies** (Supabase SSR default; no localStorage path).

### What's missing

- **Password-reset flow is not implemented.** [src/app/login/page.tsx:54](src/app/login/page.tsx:54) renders a "Forgot?" link whose `href="/login"` simply reloads the login page. No `/reset` route, no `supabase.auth.resetPasswordForEmail` call site anywhere. The callback at [src/app/auth/callback/route.ts:22-29](src/app/auth/callback/route.ts:22-29) types `'recovery'` so the plumbing would work — the user-entry point is absent.
- **Email-change flow** — confirmed deferred per [docs/auth.md §5.6](docs/auth.md).
- **Application-layer rate limiting** — [docs/auth.md §7.2](docs/auth.md) calls out a `rate_limit_log` table for `staffInviteClient`, `sendCommunication`, and `clientAcceptInvite`. No such table exists in migrations (grep across `supabase/migrations/`); no rate-limit code path in `src/`. Supabase's built-in auth rate limits at [docs/auth.md §7.1](docs/auth.md) ARE in effect (cannot be verified from code — Supabase dashboard config).
- **No auth-event audit log.** `audit_log` (defined in [supabase/migrations/20260420102300_audit_log_and_triggers.sql:55-71](supabase/migrations/20260420102300_audit_log_and_triggers.sql:55-71)) captures **table mutations** via trigger. There is no record written on `auth.signInWithPassword`, `signOut`, `updateUser({password})`, `admin.generateLink`, role grant/revoke. The taxonomy planned in [docs/auth.md §11](docs/auth.md) (`auth.signup.success`, `auth.jwt.hook_failure`, etc.) is unimplemented.
- **MFA not implemented** — confirmed deferred per [docs/auth.md §8.1](docs/auth.md).
- **No `auth.cross_tenant_access_attempt` alert hook** — planned at [docs/auth.md §11](docs/auth.md) line "Page immediately." Not wired.

### What's broken or risky

- **`/signup` is publicly reachable from `/`.** [src/app/page.tsx:34-39](src/app/page.tsx:34-39) renders a "Start your practice" link. Middleware at [src/proxy.ts:11-21](src/proxy.ts:11-21) matches `/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|...)).*)` then [src/lib/supabase/middleware.ts:49-59](src/lib/supabase/middleware.ts:49-59) protects only `/dashboard|/portal|/onboarding`. Any visitor can self-create an organisation. This is a SaaS-shaped flow consistent with [docs/auth.md §3](docs/auth.md), but the diagnostic prompt framed the platform as "closed" — flagging the divergence between framing and current behaviour.
- **`FORCE ROW LEVEL SECURITY` is inconsistent.** [docs/rls-policies.md §1](docs/rls-policies.md) line "ALTER TABLE x ENABLE ROW LEVEL SECURITY; ALTER TABLE x FORCE ROW LEVEL SECURITY;" is the stated standard. In practice, 11 tables use FORCE — none of them the core clinical tables: [supabase/migrations/20260421100000_contacts.sql:47](supabase/migrations/20260421100000_contacts.sql:47) (`contacts`), [supabase/migrations/20260428100000_client_files.sql:102](supabase/migrations/20260428100000_client_files.sql:102) (`client_files`), the testing-module RLS migration [supabase/migrations/20260428120800_testing_module_rls.sql:35](supabase/migrations/20260428120800_testing_module_rls.sql:35) (7 tables: `practice_test_settings` :35, `practice_disabled_tests` :73, `practice_custom_tests` :104, `test_batteries` :137, `test_sessions` :179, `test_results` :248, `client_publications` :331), and [supabase/migrations/20260428120100_physical_markers_schema_seed_table.sql:100](supabase/migrations/20260428120100_physical_markers_schema_seed_table.sql:100) (2 tables: `physical_markers_schema_version` :100, `physical_markers_schema_seed` :102). (Earlier draft of this document said "5 tables"; corrected on 2026-05-16 re-verification — the original grep used a single-space pattern and missed the `FORCE  ROW LEVEL SECURITY` double-space variant in the testing-module migration.) The original RLS migration [supabase/migrations/20260420102600_rls_enable_and_policies.sql](supabase/migrations/20260420102600_rls_enable_and_policies.sql) — covering clients, clinical_notes, programs, sessions, appointments, communications, reports, audit_log — uses only `ENABLE`. Practical impact on Supabase is muted (postgres role has BYPASSRLS regardless; the `authenticated` and `anon` roles are unprivileged so RLS applies to them either way), but this is a doc/code divergence that an IT advisor will flag immediately.
- **`SUPABASE_SERVICE_ROLE_KEY` import surface is 2 files only** (plus the helper itself): [src/app/(staff)/clients/new/actions.ts](src/app/(staff)/clients/new/actions.ts) and [src/app/i/[id]/page.tsx](src/app/i/[id]/page.tsx). Both are server-only (no `'use client'`), both are reviewable. Service role is **not** used to handle user-supplied input directly — the invite-create action validates email and role before any service-role call; the `/i/[id]` route looks up tokens by UUID only. Safe by inspection.

### Evidence

- Server client: [src/lib/supabase/server.ts:12-68](src/lib/supabase/server.ts:12-68)
- Browser client: [src/lib/supabase/client.ts:11-16](src/lib/supabase/client.ts:11-16)
- Middleware: [src/lib/supabase/middleware.ts:17-62](src/lib/supabase/middleware.ts:17-62) + [src/proxy.ts:6-21](src/proxy.ts:6-21)
- Role helpers: [src/lib/auth/require-role.ts:26-77](src/lib/auth/require-role.ts:26-77)
- JWT hook: [supabase/migrations/20260420100300_auth_helpers_and_jwt_hook.sql](supabase/migrations/20260420100300_auth_helpers_and_jwt_hook.sql)
- Auth callback: [src/app/auth/callback/route.ts](src/app/auth/callback/route.ts), [src/app/auth/set-session/route.ts](src/app/auth/set-session/route.ts)
- Login/signup/logout: [src/app/login/actions.ts](src/app/login/actions.ts), [src/app/signup/actions.ts](src/app/signup/actions.ts)
- Auth config: [supabase/config.toml:37-67](supabase/config.toml:37-67)
- Design vs. implementation gap on FORCE RLS: [docs/rls-policies.md §1](docs/rls-policies.md) vs. [supabase/migrations/20260420102600_rls_enable_and_policies.sql](supabase/migrations/20260420102600_rls_enable_and_policies.sql)

---

## Section 2 — Client Invite and Onboarding

### What exists

- **End-to-end invite trigger.** Staff fills the "Invite a client" form at [src/app/(staff)/clients/new/page.tsx](src/app/(staff)/clients/new/page.tsx) with a single "send invite" checkbox. Submit calls [src/app/(staff)/clients/new/actions.ts:27-263 (`inviteClientAction`)](src/app/(staff)/clients/new/actions.ts:27-263). Sequence:
  1. `requireRole(['owner','staff'])` (line 31)
  2. Validate email shape, owner-as-client guard (lines 59-67), cross-staff email guard (lines 77-96)
  3. INSERT into `clients` with RLS-enforced `organization_id` (line 100-115)
  4. If `sendInvite`: `admin.generateLink({ type: 'invite' })` (line 162-167) — falls back to `magiclink` if the email is already in `auth.users` (line 169-185); robust against returning-client + orphaned-clients-row cases
  5. Insert the verify-URL into `invite_tokens` and email a SHORT URL pointing at `/i/<token_id>` (line 202-220) — defeats Gmail link prefetch per [supabase/migrations/20260426100000_invite_tokens.sql](supabase/migrations/20260426100000_invite_tokens.sql)
  6. Pull practice + practitioner names, send via Resend (line 225-258)
- **Custom HTML+text email template** at [src/lib/email/templates/client-invite.ts:41-130](src/lib/email/templates/client-invite.ts:41-130). Apple Mail / Gmail safe (inline styles, table layout). Subject: `"${practitionerName} invited you to ${practiceName}"` (line 39). Body greets by first name; CTA button "Set up my portal" with copy-paste fallback URL. Plain-text version included.
- **From address logic.** [src/lib/email/client.ts:30-32](src/lib/email/client.ts:30-32): `process.env.EMAIL_FROM ?? 'Odyssey <onboarding@resend.dev>'`. Comment names the production switchover path.
- **Invite link target = a same-origin gate** at [src/app/i/[id]/page.tsx:29-88](src/app/i/[id]/page.tsx:29-88). The page looks up the row in `invite_tokens` via service role (RLS denies all authenticated access — [supabase/migrations/20260426100000_invite_tokens.sql:67-78](supabase/migrations/20260426100000_invite_tokens.sql:67-78)), checks `expires_at` (8-hour window per line 38) and `consumed_at`, renders [src/app/i/[id]/_components/ContinueGate.tsx:16-35](src/app/i/[id]/_components/ContinueGate.tsx:16-35) — a `'use client'` button that `window.location.assign`s the real Supabase verify URL on click only. Prefetcher-safe; the action_link does not appear as an `<a href>` in the HTML.
- **Landing on `/welcome`** at [src/app/welcome/page.tsx:22-82](src/app/welcome/page.tsx:22-82). Reads `client_id` from query, redirects to `/portal` if already linked. Greeting by first name when readable. Form is [src/app/welcome/_components/WelcomeForm.tsx](src/app/welcome/_components/WelcomeForm.tsx) — password + confirm. Action [src/app/welcome/actions.ts:22-86](src/app/welcome/actions.ts:22-86) updates password, calls `client_accept_invite` RPC (defined in [supabase/migrations/20260420102400_bootstrap_functions.sql:249-303](supabase/migrations/20260420102400_bootstrap_functions.sql:249-303) — verifies email match between `auth.users` and `clients`, links `clients.user_id`, creates the `client` role row), refreshes the session.
- **PWA install interstitial** at [src/app/welcome/install/page.tsx](src/app/welcome/install/page.tsx) + [src/app/welcome/install/_components/InstallScreen.tsx](src/app/welcome/install/_components/InstallScreen.tsx). Platform detection (lines 22-40) handles iOS (manual Share→Add-to-Home-Screen instructions with an inline icon hint), Android (`beforeinstallprompt` capture for one-tap install with fallback instructions), desktop ("open this on your phone"), and `standalone` (auto-skip to portal). iOS-aware as required.
- **Password requirement.** 12 chars minimum, validated server-side at [src/app/welcome/actions.ts:31](src/app/welcome/actions.ts:31). Matches [supabase/config.toml:47](supabase/config.toml:47).
- **Single-use enforcement** via `consumed_at` column on `invite_tokens` (currently reserved but not consumed — the 8-hour expiry is the primary gate; the action_link itself is single-use enforced by Supabase Auth on token exchange).

### What's missing

- **No "Resend invite" UI.** Multiple comments in [src/app/(staff)/clients/new/actions.ts:182,213,255](src/app/(staff)/clients/new/actions.ts:182) reference "You can resend from the client profile" but [src/app/(staff)/clients/[id]/_components/ClientProfile.tsx](src/app/(staff)/clients/[id]/_components/ClientProfile.tsx) (the client profile component) has no resend-invite button (grep across `src/app/(staff)/clients` finds zero "Resend" / "Re-send" matches). The only "re-invite" reference is the copy "[the email] will be freed up so it can be re-invited later" at [src/app/(staff)/clients/[id]/_components/ClientProfile.tsx:646](src/app/(staff)/clients/[id]/_components/ClientProfile.tsx:646), in the archive-confirmation modal. If the EP creates a client and the 8-hour token expires before the client clicks, the only path is to archive the client and re-create — a workaround, not a UI.
- **No automatic re-invite on first sign-in attempt by an unverified client.** Not in scope per docs/auth.md but worth noting.
- **No first-run welcome screen inside `/portal`.** A newly-onboarded client whose EP has not yet built a program lands directly at [src/app/portal/page.tsx](src/app/portal/page.tsx) — empty-state handling exists in the page, but there is no specific "welcome, here's how to use the portal" screen distinct from the empty-state.
- **No data-retention purge.** The 7+ years clinical-records retention is documented in [docs/incident-response.md](docs/incident-response.md) but no scheduled job exists in migrations or in `supabase/functions/`. Only `send-appointment-reminders` is deployed.
- **No global sign-out on client archive.** [src/app/(staff)/clients/[id]/actions.ts:50-65](src/app/(staff)/clients/[id]/actions.ts:50-65) calls `soft_delete_client` RPC and prints an info log, but does NOT call `supabase.auth.admin.signOut(user_id, 'global')` as planned in [docs/auth.md §5.8](docs/auth.md). An archived client with an active refresh token can continue to use the portal until their access token expires (≤1 hour, then RLS now denies because the role row was removed by the RPC).

### What's broken or risky

- **CRITICAL: The from-address is Resend's sandbox sender** (CRITICAL FINDING #1). Without `EMAIL_FROM` set to a verified-domain address, **no email reaches anyone except the Resend-account-verified email**. Cross-references: [src/lib/email/client.ts:31](src/lib/email/client.ts:31) (client invite), [supabase/functions/send-appointment-reminders/index.ts:89](supabase/functions/send-appointment-reminders/index.ts:89) (booking reminders). The self-documented note at [docs/polish/client-portal-booking.md:165](docs/polish/client-portal-booking.md:165) names the fix: "Verify a sending domain in Resend (resend.com/domains) and set EMAIL_FROM Supabase secret to a real address … this MUST happen before any real client books." Verification of domain status is dashboard-only (cannot be confirmed from code).
- **Returning-client / orphan path** (line 169-185 in [src/app/(staff)/clients/new/actions.ts](src/app/(staff)/clients/new/actions.ts)) is well-handled in code but **untested** — no pgTAP test exercises `generateLink({type:'invite'})` → "already registered" → fallback to `magiclink`. If Supabase's error shape changes again, the fallback silently breaks. Marker in `isAlreadyRegisteredError` at line 278-287 tries two phrasings; brittle.
- **Site-URL env var inconsistency.** [src/app/signup/actions.ts:27-28](src/app/signup/actions.ts:27-28) reads `NEXT_PUBLIC_SITE_URL` (then `VERCEL_URL`). [src/app/portal/book/new/actions.ts:137](src/app/portal/book/new/actions.ts:137) reads `NEXT_PUBLIC_APP_URL` (then `VERCEL_URL`). The same logical value is keyed differently in two places — one of them will be missing in production unless both are set.

### Evidence

- Invite trigger: [src/app/(staff)/clients/new/actions.ts:27-263](src/app/(staff)/clients/new/actions.ts:27-263)
- Email template: [src/lib/email/templates/client-invite.ts:30-133](src/lib/email/templates/client-invite.ts:30-133)
- Email send: [src/lib/email/send-client-invite.ts:20-49](src/lib/email/send-client-invite.ts:20-49)
- From address default: [src/lib/email/client.ts:30-32](src/lib/email/client.ts:30-32)
- Click-through gate: [src/app/i/[id]/page.tsx](src/app/i/[id]/page.tsx) + [src/app/i/[id]/_components/ContinueGate.tsx](src/app/i/[id]/_components/ContinueGate.tsx)
- Invite token RLS (deny-all to authenticated): [supabase/migrations/20260426100000_invite_tokens.sql:60-78](supabase/migrations/20260426100000_invite_tokens.sql:60-78)
- Token expiry (8h): [supabase/migrations/20260426100000_invite_tokens.sql:38](supabase/migrations/20260426100000_invite_tokens.sql:38)
- Welcome landing: [src/app/welcome/page.tsx](src/app/welcome/page.tsx), [src/app/welcome/actions.ts](src/app/welcome/actions.ts)
- `client_accept_invite` RPC (email-match verification): [supabase/migrations/20260420102400_bootstrap_functions.sql:249-303](supabase/migrations/20260420102400_bootstrap_functions.sql:249-303)
- Install interstitial: [src/app/welcome/install/_components/InstallScreen.tsx](src/app/welcome/install/_components/InstallScreen.tsx)
- Cannot verify from code: Resend domain verification (dashboard), DNS SPF/DKIM/DMARC, deliverability scoring

---

## Section 3 — Practitioner Invite and Multi-Tenancy

### What exists

- **`organizations` table is the tenant root** at [supabase/migrations/20260420100200_identity_tables.sql:18-66](supabase/migrations/20260420100200_identity_tables.sql:18-66). UUID PK, NOT NULL `name`+`slug`+`timezone`, soft-delete via `deleted_at`. Slug validated by regex; timezone validated by trigger against `pg_timezone_names`.
- **`user_organization_roles` is the membership join** at [supabase/migrations/20260420100200_identity_tables.sql:112-119](supabase/migrations/20260420100200_identity_tables.sql:112-119). Composite unique `(user_id, organization_id)`. `role` is the `user_role` enum (`owner|staff|client` per [supabase/migrations/20260420100100_enums.sql](supabase/migrations/20260420100100_enums.sql)).
- **`prevent_last_owner_delete` trigger** at lines 130-150 of identity_tables.sql blocks DELETE on the last `owner` row.
- **JWT custom-claim hook** (see Section 1) injects the `organization_id` + `user_role`. Hook source: [supabase/migrations/20260420100300_auth_helpers_and_jwt_hook.sql:65-109](supabase/migrations/20260420100300_auth_helpers_and_jwt_hook.sql:65-109). **Note**: the hook must be enabled in the Supabase dashboard (Auth → Hooks → Custom Access Token); migration comment at lines 11-13 documents the wiring step. Cannot verify dashboard state from code.
- **`organization_id` is NOT NULL on every tenant table.** Spot-checked: `clients` ([supabase/migrations/20260420100600_clients.sql](supabase/migrations/20260420100600_clients.sql)), `clinical_notes` ([supabase/migrations/20260420100800_clinical_notes.sql](supabase/migrations/20260420100800_clinical_notes.sql)), `messages` ([supabase/migrations/20260425100000_messages.sql:72](supabase/migrations/20260425100000_messages.sql:72) — denormalised for RLS without join), `test_sessions`, `test_results`, `client_files`, etc.
- **RLS policies on every tenant table.** Enumerated in [supabase/migrations/20260420102600_rls_enable_and_policies.sql:18-1283](supabase/migrations/20260420102600_rls_enable_and_policies.sql) for the original 34-table set; testing module adds 7 ENABLE+FORCE pairs at [supabase/migrations/20260428120800_testing_module_rls.sql](supabase/migrations/20260428120800_testing_module_rls.sql); messaging adds RLS at [supabase/migrations/20260425100000_messages.sql:151-258](supabase/migrations/20260425100000_messages.sql:151-258); invite_tokens has deny-all-to-authenticated at [supabase/migrations/20260426100000_invite_tokens.sql:67-78](supabase/migrations/20260426100000_invite_tokens.sql:67-78); contacts and client_files have their own ENABLE+FORCE migrations. **All tenant tables have RLS enabled** (verified via grep `ENABLE ROW LEVEL SECURITY` across migrations).
- **Patterns are well-defined** in [docs/rls-policies.md §3](docs/rls-policies.md) and applied consistently: Pattern A (staff-org CRUD), Pattern B (staff CRUD + client SELECT own), Pattern C (nested via parent), Pattern D (client-own-only writes), Pattern E (lookup), Pattern F (audit).
- **First-practitioner bootstrap** via [supabase/migrations/20260420102400_bootstrap_functions.sql:97-165 (`create_organization_with_owner`)](supabase/migrations/20260420102400_bootstrap_functions.sql:97-165). SECURITY DEFINER, refuses to run if caller already belongs to any org (line 117-121). Transactional. Seeds default `movement_patterns`, `section_titles`, `client_categories`, `exercise_metric_units`, `vald_device_types` via `seed_organization_defaults` (line 22-87). The path used to create Scotty's account is still open: `/signup` → `/onboarding/org` is publicly reachable for any new auth.users row with no membership.
- **Audit resolver coverage guard.** [supabase/migrations/20260513160000_audit_resolver_coverage_guard.sql](supabase/migrations/20260513160000_audit_resolver_coverage_guard.sql) installs `assert_audit_resolver_coverage()` and (when permitted) an event trigger that aborts any future `CREATE OR REPLACE` of the resolver function if any audited table is missing from its CASE list. Backed by pgTAP test 14. This is a serious piece of multi-tenant hygiene — wrong `organization_id` resolution on an audit-log write would silently mis-attribute mutations between tenants.
- **Cross-tenant RPC tests.** [supabase/tests/database/05_soft_delete_rpcs.sql](supabase/tests/database/05_soft_delete_rpcs.sql) stands up `org_a` + `org_b`, grants staff to each, and asserts that staff_b cannot restore/soft-delete `test_sessions`/`test_results`/`clinical_notes`/etc. in org_a (lines 182-313, 41-test plan). [supabase/tests/database/06_soft_delete_rpcs_clients_and_program_exercises.sql](supabase/tests/database/06_soft_delete_rpcs_clients_and_program_exercises.sql) extends to clients + program_exercises. Tests 09 (`programs_dates`), 10-13 (program-day operations) also do cross-org assertions for those specific RPCs.

### What's missing

- **No practitioner-invite flow.** Confirmed by grep across `src/`: no `staff_invite`, `staffInviteClient` for staff, `inviteUserByEmail` call site for staff, no settings UI for team management ([src/app/(staff)/settings/page.tsx](src/app/(staff)/settings/page.tsx) lists practice info, notifications, lookups, session-types, note-templates only). [docs/auth.md §5.2](docs/auth.md): "Staff invite (Phase 4 — deferred) — Not built in v1." This is a deliberate scope decision, not a bug, but it means the second-practitioner story is **schema-ready but UI-absent**.
- **Owner CAN create staff via direct SQL.** RLS allows `owner` to INSERT into `user_organization_roles` with any role within their own org ([supabase/migrations/20260420102600_rls_enable_and_policies.sql:102-110](supabase/migrations/20260420102600_rls_enable_and_policies.sql:102-110)). With service-role access or SQL Editor, a second practitioner could be wired in manually today. There is no UI to do so safely (no `auth.users` creation, no invite email, no role link transaction).
- **No pgTAP tests for direct cross-tenant SELECT/UPDATE on RLS-protected tables.** Tests 05/06/09/10/11/12/13 prove SECURITY DEFINER RPCs reject cross-org, and test 14 proves the audit resolver covers every audited table. **No test of the form:** "spoof staff_b's JWT with org_b, `SELECT * FROM clients` (or programs, sessions, clinical_notes, ...), assert zero rows from org_a." That is the highest-impact failure mode a multi-tenant system can have, and the regression net is missing for it.
- **No test for the JWT custom hook itself.** The hook is the entry point for all RLS scoping; if it silently fails (e.g. SECURITY DEFINER lost EXECUTE grant after a Supabase auth-service migration), the symptoms are subtle — every client sees no data, the symptom is mistaken for "RLS too strict," the fix attempt loosens RLS. Worth a pgTAP integration test that issues a JWT and asserts the claims are set.

### What's broken or risky

- **`SECURITY DEFINER` surface is wide.** Grep across `supabase/migrations/` shows 139 occurrences of `SECURITY DEFINER` across 46 files. Each function is a potential RLS bypass if it accepts caller-tainted input that escapes its WHERE clause. Spot-check of [supabase/migrations/20260420102500_client_portal_functions.sql:24-66](supabase/migrations/20260420102500_client_portal_functions.sql:24-66) shows the right pattern (pin to `auth.uid()` in the join, narrow GRANT to `authenticated`, REVOKE from `PUBLIC`). Independent review of every function is the only safe answer — naming and convention are not enforcement.
- **No `FORCE ROW LEVEL SECURITY` on the core tenant tables** (Section 1). Practical impact muted in Supabase (no user-callable role bypasses RLS by default), but it does mean a future `ALTER TABLE OWNER TO some_role` could create an unexpected bypass.
- **Schema supports multi-org membership; the JWT only carries one org at a time.** The hook prefers `auth.users.raw_app_meta_data.active_organization_id` if set ([supabase/migrations/20260420100300_auth_helpers_and_jwt_hook.sql:79-90](supabase/migrations/20260420100300_auth_helpers_and_jwt_hook.sql:79-90)) — the Phase-4 multi-org switch path. Today no code writes that field; if a future bug writes it inadvertently (e.g. via admin API), a user could be silently switched to another org they don't belong to. Mitigation in the hook itself at line 86: it requires the membership row to exist before honouring the preferred-org claim.

### Evidence

- Identity schema: [supabase/migrations/20260420100200_identity_tables.sql](supabase/migrations/20260420100200_identity_tables.sql)
- Bootstrap: [supabase/migrations/20260420102400_bootstrap_functions.sql:97-165](supabase/migrations/20260420102400_bootstrap_functions.sql:97-165)
- Original RLS migration: [supabase/migrations/20260420102600_rls_enable_and_policies.sql](supabase/migrations/20260420102600_rls_enable_and_policies.sql)
- Testing-module RLS: [supabase/migrations/20260428120800_testing_module_rls.sql](supabase/migrations/20260428120800_testing_module_rls.sql)
- Messages RLS: [supabase/migrations/20260425100000_messages.sql:151-258](supabase/migrations/20260425100000_messages.sql:151-258)
- invite_tokens RLS (deny-all): [supabase/migrations/20260426100000_invite_tokens.sql:60-78](supabase/migrations/20260426100000_invite_tokens.sql:60-78)
- Audit resolver guard: [supabase/migrations/20260513160000_audit_resolver_coverage_guard.sql](supabase/migrations/20260513160000_audit_resolver_coverage_guard.sql)
- Cross-org RPC tests: [supabase/tests/database/05_soft_delete_rpcs.sql](supabase/tests/database/05_soft_delete_rpcs.sql), 06, 09-13
- Cross-tenant raw-table test coverage: NONE FOUND (gap)
- Cannot verify from code: Custom Access Token Hook is **enabled** in the Supabase dashboard; the migration is a one-side install only

---

## Section 4 — Production Readiness

### What exists

- **Vercel deploy posture.** `vercel.json` does not exist (verified via `find`). [package.json](package.json) declares `next: 16.2.4` with the standard `dev`/`build`/`start` scripts. `.gitignore` excludes `.vercel`. Deployment status (production / preview / not yet) cannot be confirmed from code — Vercel dashboard required.
- **Env-var contract.** [.env.local.example](.env.local.example) lists `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` only. The codebase reads additionally: `RESEND_API_KEY` ([src/lib/email/client.ts:15](src/lib/email/client.ts:15)), `EMAIL_FROM` ([src/lib/email/client.ts:31](src/lib/email/client.ts:31), [supabase/functions/send-appointment-reminders/index.ts:88-89](supabase/functions/send-appointment-reminders/index.ts:88-89)), `NEXT_PUBLIC_SITE_URL` ([src/app/signup/actions.ts:27](src/app/signup/actions.ts:27)), `NEXT_PUBLIC_APP_URL` ([src/app/portal/book/new/actions.ts:137](src/app/portal/book/new/actions.ts:137), [supabase/functions/send-appointment-reminders/index.ts:90](supabase/functions/send-appointment-reminders/index.ts:90)), `VERCEL_URL`, `CRON_SHARED_SECRET`. **Five env vars are referenced by code but missing from `.env.local.example`** — see "What's missing" below.
- **Supabase Edge Function `send-appointment-reminders`** deployed and live per [docs/polish/client-portal-booking.md:161](docs/polish/client-portal-booking.md:161). Cron-driven via pg_cron + `net.http_post`. Bearer-token auth via `CRON_SHARED_SECRET`. `verify_jwt = false` ([supabase/config.toml:78-79](supabase/config.toml:78-79)) — required because the cron caller is not a Supabase-issued JWT.
- **Migrations track all schema** ([CLAUDE.md "Code standards"](CLAUDE.md)) — 92 migration files in [supabase/migrations/](supabase/migrations/). Type generation via `npm run supabase:types` ([package.json](package.json)).
- **Resend SDK installed** (`resend: ^6.12.2` in [package.json](package.json)).
- **AGENTS.md + CLAUDE.md** present in repo root for operator and AI tooling.
- **Self-documented polish pass** under [docs/polish/](docs/polish/) records launch-readiness state per section.

### What's missing

- **Five env vars are read by code but not listed in `.env.local.example`:** `RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL`, `CRON_SHARED_SECRET`. A new operator would not know to set them by reading the example.
- **No `vercel.json`** — Vercel's defaults will be used for build/output. Acceptable for Next.js but worth confirming no custom headers or routes are needed (security headers like `Strict-Transport-Security`, `X-Content-Type-Options`, CSP for the portal — none configured anywhere).
- **No custom domain configuration in code.** `supabase/config.toml:39-40` carries `site_url = "http://localhost:3000"` + `additional_redirect_urls = ["https://localhost:3000"]`. The production Supabase auth redirect-URL allowlist must be set in the dashboard — not verifiable from code.
- **Resend domain verification status** — code is sandbox-default ([src/lib/email/client.ts:31](src/lib/email/client.ts:31)). Dashboard-only check.
- **Database backups + PITR** — referenced in [docs/incident-response.md](docs/incident-response.md) and [docs/slos.md](docs/slos.md) as required (Supabase Pro tier). Dashboard-only verification.
- **Sentry / error tracking not installed.** [package.json](package.json) has no `@sentry/*` dependency. Grep across `src/` finds no `Sentry.init`, no `beforeSend` PHI-strip hook, no DSN env var read. The planned event taxonomy at [docs/auth.md §11](docs/auth.md) and [docs/slos.md §5](docs/slos.md) is paper-only.
- **No `/api/health` endpoint.** Glob `src/app/**/route.ts` returns 3 files: [src/app/auth/callback/route.ts](src/app/auth/callback/route.ts), [src/app/auth/set-session/route.ts](src/app/auth/set-session/route.ts), [src/app/portal/reports/file/[id]/route.ts](src/app/portal/reports/file/[id]/route.ts). None of them health.
- **No post-deploy smoke checklist** in `docs/` (other than per-section polish gap docs). No runbook for "after pushing to prod, click these 7 things."
- **No HTTPS-only enforcement in code.** Vercel terminates TLS at the edge; the app assumes it. [src/app/(staff)/clients/new/actions.ts:144-146](src/app/(staff)/clients/new/actions.ts:144-146) reads `x-forwarded-proto` and falls back to `https` for non-localhost — implicit assumption that the deploy is HTTPS, but no redirect/upgrade middleware exists.

### What's broken or risky

- **EMAIL_FROM = Resend sandbox sender on all email paths.** Already a CRITICAL FINDING. Restated here because it gates both the client-invite path AND the booking-reminder path; without a verified domain, no real client can receive any platform email.
- **Secret rotation outstanding.** `RESEND_API_KEY`, `CRON_SHARED_SECRET`, and the service-role key (which was in the `.env.local` file at audit time — `.env.local` is gitignored and was never committed, verified via `git log --all --diff-filter=A -- .env.local`) all need rotation per [docs/polish/client-portal-booking.md:167](docs/polish/client-portal-booking.md:167) and the CLAUDE.md feedback memory about premortem hygiene. The current Supabase project has its anon-key URL hardcoded into `.env.local.example:8` as a comment — `https://azjllcsffixswiigjqhj.supabase.co` — which on its own is fine (project URL is public) but is a marker that the project was used during early development with shared keys.
- **The Edge Function fail-open on missing CRON_SHARED_SECRET.** Already CRITICAL FINDING #3. If a deploy fails to set the secret, the function accepts any caller from the public internet.
- **External IT review gate.** Already CRITICAL FINDING #2.

### Evidence

- Package manifest: [package.json](package.json)
- Env example: [.env.local.example](.env.local.example)
- Local Supabase auth config: [supabase/config.toml:37-67](supabase/config.toml:37-67)
- Edge function: [supabase/functions/send-appointment-reminders/index.ts](supabase/functions/send-appointment-reminders/index.ts)
- Sentry: NOT INSTALLED (package.json grep)
- Health endpoint: NOT FOUND (glob `src/app/**/route.ts`)
- Cannot verify from code: Vercel deploy state, custom domain DNS, Resend domain verification, Supabase Pro tier + PITR config, Supabase dashboard redirect-URL allowlist, Custom Access Token Hook enabled state

---

## Section 5 — Cross-Cutting Risks

1. **Edge Function `send-appointment-reminders` fails OPEN on missing `CRON_SHARED_SECRET`.** [supabase/functions/send-appointment-reminders/index.ts:76-83](supabase/functions/send-appointment-reminders/index.ts:76-83) — `if (expectedToken && authHeader !== ...)` skips the check entirely when `expectedToken` is falsy. Combined with `verify_jwt = false`, any internet caller can invoke. (CRITICAL FINDING #3.)

2. **Production secrets posted in chat transcripts.** [docs/polish/client-portal-booking.md:167](docs/polish/client-portal-booking.md:167) self-documents this. Rotation has not happened. (CRITICAL FINDING #4.)

3. **No pgTAP tests assert direct cross-tenant SELECT/UPDATE/INSERT on RLS-protected tables.** Highest-impact regression net is missing. (CRITICAL FINDING #5.)

4. **All outgoing email uses the Resend sandbox sender.** [src/lib/email/client.ts:31](src/lib/email/client.ts:31), [supabase/functions/send-appointment-reminders/index.ts:88-89](supabase/functions/send-appointment-reminders/index.ts:88-89). (CRITICAL FINDING #1.)

5. **"Resend invite" UI is documented but not implemented.** Three comments in [src/app/(staff)/clients/new/actions.ts:182,213,255](src/app/(staff)/clients/new/actions.ts:182) tell the operator to "resend from the client profile"; no such button exists in [src/app/(staff)/clients/[id]/_components/ClientProfile.tsx](src/app/(staff)/clients/[id]/_components/ClientProfile.tsx).

6. **`FORCE ROW LEVEL SECURITY` is on 11 tables; the ~35 core tenant tables (clients, clinical_notes, programs, sessions, appointments, communications, reports, audit_log) use `ENABLE` only.** [supabase/migrations/20260420102600_rls_enable_and_policies.sql](supabase/migrations/20260420102600_rls_enable_and_policies.sql) contains **zero** `FORCE` statements (verified 2026-05-16 — `\bFORCE\b` returns 0 matches in that file). Doc/code divergence vs [docs/rls-policies.md §1](docs/rls-policies.md), which states FORCE is the standard. Files using FORCE: [supabase/migrations/20260421100000_contacts.sql:47](supabase/migrations/20260421100000_contacts.sql:47) (1), [supabase/migrations/20260428100000_client_files.sql:102](supabase/migrations/20260428100000_client_files.sql:102) (1), [supabase/migrations/20260428120800_testing_module_rls.sql](supabase/migrations/20260428120800_testing_module_rls.sql) (7), [supabase/migrations/20260428120100_physical_markers_schema_seed_table.sql](supabase/migrations/20260428120100_physical_markers_schema_seed_table.sql) (2). Practical impact on Supabase is muted (the `authenticated`/`anon` roles never bypass RLS regardless of FORCE; FORCE only matters for the table-owner role), but it is a doc/code divergence an IT advisor will flag.

7. **139 `SECURITY DEFINER` functions across 46 migration files.** Each is a potential RLS bypass; not all are independently audited. Convention is followed (pin to `auth.uid()`, narrow EXECUTE grant) but convention is not enforcement.

8. **No auth-event audit log.** `audit_log` captures table mutations only. Login success/failure, password change, role grant/revoke, JWT-hook failure are unrecorded. The taxonomy at [docs/auth.md §11](docs/auth.md) is paper-only.

9. **Sentry / error tracking not installed.** No `@sentry/*` in [package.json](package.json); no `beforeSend` PHI-strip hook anywhere. (Section 4 evidence.)

10. **No `/api/health` endpoint.** No smoke-test checklist in `docs/`.

11. **Env-var contract incomplete.** [.env.local.example](.env.local.example) lists 3 of the 8+ env vars the code reads.

12. **Site-URL env-var name inconsistency.** `NEXT_PUBLIC_SITE_URL` ([src/app/signup/actions.ts:27](src/app/signup/actions.ts:27)) vs `NEXT_PUBLIC_APP_URL` ([src/app/portal/book/new/actions.ts:137](src/app/portal/book/new/actions.ts:137), [supabase/functions/send-appointment-reminders/index.ts:90](supabase/functions/send-appointment-reminders/index.ts:90)). Same logical value, two key names — one will be missing on first deploy.

13. **`/signup` is publicly reachable** from `/`; anyone on the open internet can self-create an organisation. Consistent with the SaaS architecture but inconsistent with the "closed clinical platform" framing in this audit's prompt.

14. **External IT-advisor review of `auth.md` + `rls-policies.md` not closed.** [CLAUDE.md](CLAUDE.md) "Open gates." No `docs/external-reviews.md` exists.

15. **Client archive does not revoke active sessions.** [src/app/(staff)/clients/[id]/actions.ts:50-65](src/app/(staff)/clients/[id]/actions.ts:50-65) calls `soft_delete_client` but not `supabase.auth.admin.signOut(user_id, 'global')` as planned in [docs/auth.md §5.8](docs/auth.md). An archived client retains portal access for up to 1 hour (until access-token expiry) — at which point the absent role row trips RLS deny.

16. **Token-prefetch defence is via a same-origin gate, not via Supabase invite-burning.** [src/app/i/[id]/page.tsx](src/app/i/[id]/page.tsx) defeats Gmail's link prefetch by routing through `/i/<token>` — but the underlying `action_link` is still a Supabase verify URL that any holder can exchange. The token is single-use enforced server-side by Supabase Auth; the threat model is link-leak (forwarded email, IT scanning) rather than prefetch. Defence sufficient for the documented threat; documented in migration comments.

17. **No data-retention purge.** The 7+-year clinical-records retention is policy in [docs/incident-response.md](docs/incident-response.md) but no scheduled job exists. Only `send-appointment-reminders` is deployed.

---

## Summary Table

| Capability | State | Evidence | Risk if shipped today |
|---|---|---|---|
| Client invite (real email) | ✗ Missing (sandbox sender) | [src/lib/email/client.ts:31](src/lib/email/client.ts:31), [docs/polish/client-portal-booking.md:165](docs/polish/client-portal-booking.md:165) | Cannot onboard any client whose email is not the Resend-verified account. Blocks Phase-1 launch. |
| Client signup + first login | ✓ Working (code-complete) | [src/app/welcome/](src/app/welcome/), [src/app/i/[id]/](src/app/i/[id]/), [supabase/migrations/20260420102400_bootstrap_functions.sql:249-303](supabase/migrations/20260420102400_bootstrap_functions.sql:249-303) | Once email reaches the inbox, the flow is solid. Untested in production for non-Scotty recipients. |
| Client PWA install | ✓ Working | [src/app/welcome/install/_components/InstallScreen.tsx](src/app/welcome/install/_components/InstallScreen.tsx) | iOS / Android / desktop branches implemented. Untested on real devices outside dev. |
| Practitioner invite | ✗ Missing (deferred) | [docs/auth.md §5.2](docs/auth.md), no `staff_invite` server action | Cannot onboard a second practitioner via UI. Schema supports it; would require manual SQL today. Acceptable for current solo-EP scope per the brief. |
| Multi-tenant RLS isolation | ~ Partial | Policy code in [supabase/migrations/20260420102600_rls_enable_and_policies.sql](supabase/migrations/20260420102600_rls_enable_and_policies.sql); no direct cross-tenant pgTAP tests; FORCE RLS inconsistent | Policy code looks correct on inspection and is reinforced by indirect tests (cross-org RPC tests, audit resolver coverage). Without independent pgTAP coverage of direct table access, regressions can ship silently. **Independent IT/AppSec review remains the launch gate.** |
| Production deployment | ? Cannot verify from code | No `vercel.json`; [.env.local.example](.env.local.example) lists only 3 env vars; `supabase/config.toml:39-40` carries localhost site_url | Need to confirm: Vercel project exists, custom domain attached, full env-var set populated, redirect URLs added to Supabase dashboard. |
| Email deliverability (Resend domain verified) | ✗ Missing | [src/lib/email/client.ts:31](src/lib/email/client.ts:31) — sandbox sender | All outgoing email gated. CRITICAL. |
| Backups + PITR | ? Cannot verify from code | [docs/slos.md](docs/slos.md) requires Pro tier; no migration / config reference | Need to confirm Supabase project is on Pro and PITR window is set per SLOs. |
| Error tracking (Sentry) | ✗ Missing | No `@sentry/*` in [package.json](package.json); no init code | First production error has no diagnostic trail. |
| Audit logging on auth events | ✗ Missing | [supabase/migrations/20260420102300_audit_log_and_triggers.sql](supabase/migrations/20260420102300_audit_log_and_triggers.sql) covers table mutations only | Login failures, password changes, role grants invisible. Forensic recovery from a credential incident is hampered. |

State legend: ✓ Working, ~ Partial, ✗ Missing, ? Cannot verify from code alone.

---

## Items the stakeholder needs to confirm externally

The following cannot be verified from the codebase. The stakeholder (or external IT advisor) needs to confirm directly from the dashboard / DNS / vendor:

1. **Resend dashboard**: is a custom sending domain verified with SPF / DKIM / DMARC records resolving? Is `EMAIL_FROM` set on the Supabase Edge Function secrets to a real address on that domain?
2. **Supabase dashboard → Authentication → Hooks → Custom Access Token**: is the hook **enabled** and pointing at `pg-functions://postgres/auth_hooks/custom_access_token`? If disabled, every RLS policy returns zero rows and the app appears "broken" rather than "insecure."
3. **Supabase dashboard → Authentication → URL Configuration**: is the production domain in the allowed redirect URLs?
4. **Supabase project plan**: is the project on Pro (PITR available)?
5. **Vercel dashboard**: project exists? Production env vars populated for all 8 env vars listed in Section 4? Custom domain attached?
6. **Secret rotation**: have `RESEND_API_KEY`, `CRON_SHARED_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` been rotated since they appeared in chat transcripts?
7. **External IT-advisor review** of `docs/auth.md` and `docs/rls-policies.md`: scheduled, in progress, complete? Documented at `docs/external-reviews.md`?

---

## Re-verification note (2026-05-16)

This document was first generated 2026-05-15. On 2026-05-16, at the **same commit** (`d4d8980`; no code changed in between — `git status` shows only `src/types/database.ts` modified and this doc untracked), every CRITICAL finding and the load-bearing section claims were independently re-checked directly against the code, per the diagnostic prompt's forensic mandate ("infer from what is actually written and committed").

**Confirmed exact (no change):**

- All 5 CRITICAL findings, with their cited line numbers:
  1. Sandbox email sender — [src/lib/email/client.ts:31](src/lib/email/client.ts:31) and [supabase/functions/send-appointment-reminders/index.ts:88-89](supabase/functions/send-appointment-reminders/index.ts:88-89) both default to `Odyssey <onboarding@resend.dev>`. Cross-confirmed by [docs/polish/client-portal-booking.md:162](docs/polish/client-portal-booking.md:162) ("email landed in Resend-verified inbox").
  2. External-review gate open — `docs/external-reviews.md` does not exist (glob returns nothing); CLAUDE.md "Open gates" names it non-negotiable.
  3. Edge-function fail-open — [supabase/functions/send-appointment-reminders/index.ts:78-83](supabase/functions/send-appointment-reminders/index.ts:78-83) `if (expectedToken && authHeader !== ...)` short-circuits when the secret is unset; [supabase/config.toml:78-79](supabase/config.toml:78-79) `verify_jwt = false`. Response body is counts only (`{processed, succeeded, failed}`) — no PHI in the response, as stated.
  4. Secrets in transcripts — [docs/polish/client-portal-booking.md:167](docs/polish/client-portal-booking.md:167) verbatim: "Rotate `CRON_SHARED_SECRET` and `RESEND_API_KEY` — both appeared in chat transcript during deploy."
  5. No direct cross-tenant pgTAP test — confirmed by test 05's own header ([supabase/tests/database/05_soft_delete_rpcs.sql:24-29](supabase/tests/database/05_soft_delete_rpcs.sql:24-29)): "SECURITY DEFINER RPC bypasses RLS for the UPDATE; assertions query through the staff RLS." Two orgs are stood up, but the assertions test RPC cross-org rejection, not a bare `SELECT * FROM <tenant_table>` as staff_b.
- Every `supabase/config.toml` citation (JWT TTL 3600, refresh rotation, reuse interval 10, `minimum_password_length = 12`, `enable_confirmations = true`, localhost `site_url`, hook block, `verify_jwt = false`).
- `getSession()` is never called in an auth path — the only occurrence in `src/` is an explanatory comment at [src/lib/supabase/middleware.ts:41](src/lib/supabase/middleware.ts:41).
- Password reset absent — zero `resetPasswordForEmail` call sites in `src/`; no `/reset` or `/reset-password` route (glob empty).
- Sentry absent — no `@sentry/*` in [package.json](package.json); no `Sentry.init` in `src/`.
- No `vercel.json`, no `/api/health`, no `src/app/api/**` (glob empty).
- [.env.local.example](.env.local.example) lists exactly 3 vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
- `SECURITY DEFINER`: exactly **139 occurrences across 46 files** (grep count — matches the doc).
- "Resend invite" UI absent — the only matches in `src/app/(staff)/clients` are the operator-facing comments in [src/app/(staff)/clients/new/actions.ts](src/app/(staff)/clients/new/actions.ts) (lines 182, 190, 215, 244, 255 — earlier draft cited 182/213/255; the substantive claim is unchanged: no resend control exists in the client profile).
- Core RLS migration [supabase/migrations/20260420102600_rls_enable_and_policies.sql](supabase/migrations/20260420102600_rls_enable_and_policies.sql) has **35** `ENABLE ROW LEVEL SECURITY` and **0** `FORCE` — the central multi-tenancy conclusion holds.

**One correction applied:**

- **FORCE-RLS table count: "5" → "11."** The original draft's grep used a single-space pattern (`FORCE ROW LEVEL SECURITY`) and missed the double-space variant (`FORCE  ROW LEVEL SECURITY`) used by the testing-module and physical-markers-seed migrations. Definitive list of tables with `FORCE`: `contacts`; `client_files`; `practice_test_settings`, `practice_disabled_tests`, `practice_custom_tests`, `test_batteries`, `test_sessions`, `test_results`, `client_publications` (testing module); `physical_markers_schema_version`, `physical_markers_schema_seed`. **The risk conclusion is unchanged and arguably understated in the original**: the core clinical tables (clients, clinical_notes, programs, sessions, appointments, communications, reports, audit_log) still use `ENABLE` only — the tables that *do* use FORCE are the testing-module and file/contact tables, not the core PHI set. Section 1 "What's broken or risky" and Section 5 item 6 have been corrected in place.

**Net:** the 2026-05-15 diagnostic is high-fidelity. Of the dozens of file:line claims spot-checked, one numeric summary was wrong (FORCE count) and a handful of line numbers drifted by 1–2 (e.g. the resend-comment citations); no CRITICAL finding, no risk conclusion, and no Summary Table state changed on re-verification. The "Items the stakeholder needs to confirm externally" list above remains the set of things that genuinely cannot be settled from code.
