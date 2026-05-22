# Auth and Onboarding (staff) — gap list

**Polish-pass section:** 1 of the locked polish-pass order (foundation layer).
**Active step:** 4 of 7. Audit + premortem + gap list written; awaiting reviewer approval in the claude.ai chat before any code is touched (step 5).
**Date opened:** 2026-05-21.
**Trust-nothing posture:** every "complete" label in the codebase was re-derived against the brief and the premortem failure modes. The diagnostic at `docs/diagnostic-auth-onboarding-tenancy.md` (2026-05-15, re-verified 2026-05-16) was used as evidence to spot-check, not inherited as conclusion. Where the diagnostic and the code disagreed the code won; where they agreed the audit's confidence is the diagnostic's confidence reinforced.

---

## Composite target brief — confirmed

- **Functional flow:** `docs/auth.md §5.1` (EP owner signup, ten-step flow ending at `/dashboard`). Authoritative for what staff onboarding must do.
- **Quality bar:** CLAUDE.md design system and design philosophy. UX gaps traceable to §5.1 or the design system are **requirements**; UX improvements beyond them are **recommendations** (labelled inline below).
- **Constraints:** master brief §7.1 (Privacy Act 1988, APPs, onshore-AU), §7.2 (retention), §7.4 (security requirements); CLAUDE.md code standards (multi-tenant from commit one, RLS as the security boundary, service-role server-only).
- **§12 resolutions** (now part of target): 12-char password minimum, no forced character classes, HIBP breach check; email verification ON for EP owner; uniform 30-day session; 7-day invite-link lifetime (client-section concern); MFA deferred to Phase 2 (its absence is not a gap).
- **Scope:** trusted EP collaborator self-signs-up into their own separate org via `/signup`, same path as the operator. Staff-invite-into-shared-org is Phase 4 deferred and **not** a gap. Any partially-present staff-invite code is flagged as deferred-and-inactive, not as a feature to finish.

---

## Audit — what was verified against the target

### §5.1 ten-step conformance scorecard

| §5.1 step | Target | Implementation | Status | Evidence |
|---|---|---|---|---|
| 1 | User enters email + password + org name + timezone at `/signup` | Form collects **only** email + password; org name + timezone deferred to `/onboarding/org` step 6 | Conformant-with-deviation. §5.1 step 1 and step 6 are internally inconsistent on where org name is collected; the code resolves in favour of step 6 (defensible — defer org naming until after email verification). `/signup` copy "you'll name your practice on the next screen" makes the deferral explicit. | `src/app/signup/page.tsx:22-86`, `src/app/signup/actions.ts:6-51` |
| 2 | Call `supabase.auth.signUp({email, password})` | Server action calls `supabase.auth.signUp` with `emailRedirectTo` = `${origin}/auth/callback` | ✓ | `src/app/signup/actions.ts:31-37` |
| 3 | Supabase creates `auth.users` row, sends verification email | `enable_confirmations = true` in `supabase/config.toml:52`; signup action handles the `data.session === null` branch by redirecting to `/signup?info=check-email` | ✓ Conformant from code. Email actually arriving requires the Supabase dashboard SMTP / email-template config — not verifiable from code. | `supabase/config.toml:52`, `src/app/signup/actions.ts:43-50` |
| 4 | DB trigger on `auth.users` inserts a `user_profiles` row | `handle_new_auth_user()` trigger inserts with `first_name='Pending'`, `last_name='Pending'`, `ON CONFLICT DO NOTHING` | ✓ | `supabase/migrations/20260420100200_identity_tables.sql:89-106` |
| 5 | User signed in with JWT carrying NO `organization_id` | Custom hook reads `user_organization_roles`; if no membership row exists, no `organization_id` claim is injected. Helper `user_organization_id()` returns NULL; RLS comparisons to NULL match zero rows (fail-safe). | ✓ | `supabase/migrations/20260420100300_auth_helpers_and_jwt_hook.sql:65-109` |
| 6 | User lands on `/onboarding/org`, enters org name + first/last name | Page exists; form collects orgName + firstName + lastName + timezone (timezone defaults to `Australia/Sydney`, dropdown lists 7 AU TZs only). Page also checks `user_organization_id()` and redirects to `/dashboard` if already onboarded (idempotent re-entry). | ✓ | `src/app/onboarding/org/page.tsx:5-115` |
| 7 | Client calls server action `createOrganizationWithOwner({...})` | `createOrganization` server action calls RPC `create_organization_with_owner(p_org_name, p_timezone, p_first_name, p_last_name)` | ✓ | `src/app/onboarding/org/actions.ts:6-45` |
| 8 | Service-role transaction: INSERT org → INSERT role → UPDATE profile → seed defaults | RPC is `SECURITY DEFINER` (not service-role from app, but DB-side privilege escalation with `EXECUTE` granted to `authenticated`); slug derived + collision-guarded; `INSERT organizations` → `INSERT user_organization_roles (..., 'owner')` → `UPDATE user_profiles` (filter `first_name = 'Pending' OR last_name = 'Pending'`) → `PERFORM seed_organization_defaults(new_org_id)`. Pre-flight refuses if caller already belongs to any org. Atomic (single function = single transaction). | ✓ with one observation: the profile UPDATE is conditional on the `'Pending'` placeholders. If a future change to `handle_new_auth_user()` alters the placeholders, the UPDATE silently does nothing and the user's name remains 'Pending'. Coupling-by-magic-string. | `supabase/migrations/20260420102400_bootstrap_functions.sql:97-159`, profile-UPDATE WHERE clause at lines 148-152 |
| 9 | Client calls `supabase.auth.refreshSession()` to pick up claims | Server action calls `await supabase.auth.refreshSession()` after RPC success | ✓ structurally. **F-4 below** flags the failure-mode of an async refresh that doesn't write the new JWT back to the cookie. | `src/app/onboarding/org/actions.ts:42` |
| 10 | Redirect to `/dashboard` | Server action redirects to `/dashboard`. Staff layout's `requireRole(['owner','staff'])` reads the new JWT and renders the dashboard. | ✓ | `src/app/onboarding/org/actions.ts:44`, `src/app/(staff)/layout.tsx:20` |

**§5.1 verdict:** the ten-step flow is implemented end-to-end and the multi-tenant invariant holds (org_id established before any RLS-protected write). Two soft observations carried into the gap list as P2 polish (step 1/6 internal-brief inconsistency is not a code gap; the `'Pending'` magic-string coupling is a P2 robustness item).

### §12 conformance scorecard

| Resolution | Target | Implementation | Status |
|---|---|---|---|
| 12.1 Password policy | 12-char min, no forced character classes, HIBP breach check | 12-char min enforced both client-side (`minLength={12}`) and server-side (`password.length < 12` guard) and Supabase-server-side (`minimum_password_length = 12`). **HIBP breach check is a Supabase dashboard toggle** (Auth → Settings → Password Strength → "Enable leaked password protection") — not in `config.toml`, not visible in migration code. Cannot verify from code. | ⚠ Partial — 12-char min ✓; HIBP unverifiable from code → **G-3** below |
| 12.2 Email verification ON for owner | EP owner cannot log in before clicking confirmation link | `enable_confirmations = true` in `supabase/config.toml:52`; signup action's `data.session === null` branch redirects to `/signup?info=check-email`. Application does NOT independently verify `user.email_confirmed_at` — it trusts the Supabase toggle. If the toggle is flipped off in dashboard, the application silently accepts unverified sessions. | ⚠ Conformant via Supabase only; no application-layer defence-in-depth → **G-7** |
| 12.3 Session duration: 30 days uniform | Refresh-token lifetime = 30 days for all roles | `config.toml` sets only `jwt_expiry = 3600` (access token), `enable_refresh_token_rotation = true`, `refresh_token_reuse_interval = 10`. Refresh-token lifetime is not explicitly configured in code; the Supabase default applies (configurable in dashboard, **not verifiable from code**). The `/login` form's "Keep me signed in for 30 days" checkbox is decorative — the `remember` form field is not read by the action, and the session lifetime is whatever Supabase enforces regardless of the checkbox state. | ⚠ Cannot verify 30-day target from code → **G-4** and **G-8** |
| 12.4 Invite link lifetime: 7 days | Client-section concern. Staff onboarding's only invite-link-equivalent surface is the email-confirmation link itself. | Supabase's email-confirmation OTP expiry is not set in `config.toml`; default applies (24h per Supabase default, configurable in dashboard). | Out-of-section. Documented for cross-reference to section 2. |
| 12.5 MFA: deferred to Phase 2 | Not built, not required | `docs/auth.md §8.1` deferral confirmed; no MFA code in `src/` or `supabase/`. | ✓ Absence not a gap. |

### Organisation setup and the RLS-context-establishment hypothesis

The retroactive premortem named hypothesis: **whether onboarding reliably establishes `organization_id` on the staff user before any RLS-protected write can occur.**

Verified against the code:

- `/signup` → `/auth/callback` → `/onboarding/org`. Across this segment the user holds a JWT with no `organization_id` claim. `user_organization_id()` returns NULL. RLS comparisons `WHERE organization_id = user_organization_id()` evaluate as `WHERE col = NULL` → no rows for SELECT; equivalent failure for INSERT WITH CHECK. **No RLS-protected write can succeed.** Confirmed by reading `supabase/migrations/20260420100300_auth_helpers_and_jwt_hook.sql:24-32` (the helper) and the deny-by-NULL pattern in `supabase/migrations/20260420102600_rls_enable_and_policies.sql` (sampled).
- `/onboarding/org` → `createOrganization` action → `create_organization_with_owner` RPC (SECURITY DEFINER, atomic) → `refreshSession()` → `/dashboard`. After commit, the next JWT issued by Supabase runs the custom-access-token hook, which reads `user_organization_roles` and injects the new `organization_id`. `requireRole` in the staff layout then reads `organization_id` from the JWT before any data load.
- **Sharp edge:** the entire boundary rests on the custom-access-token hook being **enabled in the Supabase dashboard**. The hook function is defined in code (`supabase/migrations/20260420100300_auth_helpers_and_jwt_hook.sql:65-109`) and is config'd for the local stack in `supabase/config.toml:65-67`, but the cloud project requires manual enablement (Dashboard → Authentication → Hooks → Custom Access Token). If the hook is disabled, `user_organization_id()` returns NULL even for users with valid memberships, and **every dependent section's RLS resolves to zero rows**. Diagnosing this presents as "RLS too strict" — a known anti-pattern that invites loosening RLS rather than fixing the hook. **This is the load-bearing assumption every completed section silently depends on.** Promoted to a P0 retroactive gap (**G-1**).

**Hypothesis conclusion:** in the v1 happy-path with the hook enabled, the multi-tenant boundary holds. The audit confirms the implementation does not violate it. The hypothesis is verified subject to the dashboard-hook-enabled prerequisite.

### First-run EP experience

After onboarding the EP lands on `/dashboard`. Page renders four stat cards (Sessions today / Active clients / Need attention / Programs ending) — all zeroed — plus an empty Needs-attention panel ("Nothing flagged. Nice."), an empty Today's-sessions panel ("No sessions booked for today."), and an empty Recently-completed panel. Greeting is "Good morning/afternoon/evening, [FirstName]. You're clear. Take a breath."

There is no "let's get started" guidance, no contextual prompt to create the first client / configure availability / set notification preferences / review the Settings page. The first-run experience is correctly calm and not patronising (matches CLAUDE.md voice: "encouragement is earned, not free"), but it offers no signposting to the next action. This is a P2 polish item carried as **recommendation, not requirement** — §5.1 step 10 only specifies the redirect target, not what greets the user on arrival.

### Settings surface

`/settings` is reachable from the staff layout's top bar. It is gated by `requireRole(['owner','staff'])` via the route-group layout. Surfaces eight sections: Practice information, Notifications, Movement patterns, Exercise tags, Client categories, Session types, Note templates, Practitioner hours, Tests, Account (with sign-out). The `seedDefaultNoteTemplatesIfEmpty()` call is idempotent. The Account section confirms the EP's role and practice name, exposing the only practice-account-management surface in the platform. There is no "Account" sub-page for things like changing one's own email, changing password, or viewing/managing active sessions — those are §5.5 / §5.6 / §5.7 concerns and are out of scope here (5.6 is Phase 2 per docs/auth.md; 5.5 password reset is a P1 gap below).

### Session and auth state established

- Cookie-based session via `@supabase/ssr` SSR client (HttpOnly cookies, Supabase default). `src/lib/supabase/server.ts:12-36`.
- Middleware (`src/proxy.ts` → `src/lib/supabase/middleware.ts`) refreshes the session on every request via `getUser()` (re-verifies JWT, not just cookie). Protects `/dashboard`, `/portal`, `/onboarding` prefixes.
- `requireRole` helper resolves identity + claims via `getUser()` + `user_organization_id()` + `user_role()` RPCs in parallel. Redirects unauthenticated → `/login`, claimless → `/onboarding/org`, wrong-role → `/unauthorized`.
- Logout via `supabase.auth.signOut()` (revokes refresh token server-side); redirects to `/`. `src/app/login/actions.ts:25-29`.

### Pre-existing claims spot-checked against the code

The diagnostic doc's Section 1 + Section 3 findings on staff auth and onboarding were re-checked. Three substantive agreements (with the code winning where line numbers drift slightly):

1. Diagnostic: "Password-reset flow is not implemented." Code confirms: "Forgot?" link on `/login` has `href="/login"` (`src/app/login/page.tsx:54`); no `/reset` route exists; no `resetPasswordForEmail` call site in `src/` (grep confirms zero matches). Becomes **G-5**.
2. Diagnostic: "No auth-event audit log." Code confirms: no Sentry, no structured auth-event log table, no audit-trigger covering signup/login/logout/password-change/role-grant. Becomes **G-6**.
3. Diagnostic: "`/signup` is publicly reachable from `/`." Code confirms: root page at `src/app/page.tsx:34-39` renders a "Start your practice" link to `/signup`; middleware does not protect `/signup`. Conformant with target (self-signup is the v1 EP path) but worth flagging for the friends-and-family operational posture. Becomes **G-9 (recommendation)**.

---

## Premortem

### Forward-looking (friends-and-family beta scope)

Ranked by likelihood × impact. Infrastructure/security items weighted production-grade; UX/workflow items weighted friends-and-family.

| # | Failure mode | Likelihood × Impact | Closed by gap |
|---|---|---|---|
| **F-1** | **JWT custom-access-token hook silently disabled in Supabase dashboard.** Symptom: signup completes, RPC succeeds, but the new JWT has no `organization_id` claim. `user_organization_id()` returns NULL → `requireRole` redirects to `/onboarding/org` → form re-submit → RPC rejects "User already belongs to an organization" → user locked out. Indistinguishable in logs from "RLS too strict". Likelihood: low under steady state, but high during disaster recovery / project clone / dashboard misclick. Impact: total platform inoperability for every user. | High × Critical | **G-1** |
| **F-2** | **HIBP breach check not enabled in dashboard.** EP or collaborator picks a 12-character password that's in a known breach (`Password1234!` clears the length check). Credential stuffing or password-list attack succeeds. RLS isolates orgs cross-tenant, but within the compromised org the attacker has full owner privilege. | Medium × High | **G-3** |
| **F-3** | **Refresh-token lifetime not configured to 30 days.** Supabase default (configurable in dashboard) may be longer or shorter than the §12.3 target. A stolen refresh token in an HttpOnly cookie grants access for whatever the dashboard says. | Medium × High | **G-4** |
| **F-4** | **Async `refreshSession()` failure leaves user in a UX dead-end after onboarding.** RPC succeeds, refreshSession fails or doesn't write the new JWT to the cookie. User redirected to `/dashboard` → `requireRole` sees no org → redirects to `/onboarding/org` → form re-submit → RPC error "User already belongs to an organization". User cannot recover without logout. | Low × High | **G-2** |
| **F-5** | **Email-confirmation email lost or expired.** Spam filter eats the email; user clicks 25 hours after sign-up; user doesn't see the email and tries `/login` → "Email not confirmed". No "resend confirmation" UI exists in the app. | Medium × Medium | **G-10** |
| **F-6** | **EP forgets password.** "Forgot?" link is dead. EP has no self-serve recovery path. | Medium × Medium | **G-5** |
| **F-7** | **`enable_confirmations` toggled off in dashboard.** Application has no defence-in-depth — trusts Supabase's toggle. Unverified sessions silently accepted. | Low × High | **G-7** |
| **F-8** | **`NEXT_PUBLIC_SITE_URL` unset in production.** Signup action falls back to `VERCEL_URL` (deployment-specific, changes per deploy). Confirmation-email link points to a URL that may no longer be the canonical app URL by the time the user clicks it. | Low × Medium | **G-11** |
| **F-9** | **First-run EP sees empty dashboard with no signposting.** Calm copy ("you're clear, take a breath") fits the voice but offers no path to the next action (first client, availability, notifications). EP bounces. | Medium × Low | **G-12 (recommendation)** |
| **F-10** | **Credential-incident forensics impossible.** No auth-event log. If collaborator credentials leak, no way to identify when/where they were used or by whom. | Low × High | **G-6** |
| **F-11** | **`/signup` publicly reachable on the open internet.** Random visitor discovers the URL, creates a vanity organisation in the production database. RLS isolates them so no data leak, but production data is polluted with stranger orgs. | Low × Low | **G-9 (recommendation)** |
| **F-12** | **`'Pending'` placeholder coupling between trigger and bootstrap RPC.** A change to `handle_new_auth_user()` (e.g. changing placeholder strings or removing them) silently breaks `create_organization_with_owner`'s name-update — first/last name stay 'Pending'. No test catches this. | Low × Medium | **G-13** |

### Retroactive (already-built sections that depend on staff auth)

Hypothesis-driven, per the prompt scope. The dependent sections — session builder, client portal (staff-facing client management), scheduling, exercise library, testing module, programs — all sit on top of the staff layout's `requireRole(['owner','staff'])` guard, which depends on `organization_id` being present in the JWT, which depends on the custom-access-token hook being enabled, which depends on a Supabase dashboard setting.

**R-1 (verified hypothesis):** organization_id is reliably established before any RLS-protected write in the v1 happy path. Bootstrapping is atomic (SECURITY DEFINER RPC), JWT is refreshed before redirect, RLS denies-by-NULL while claim is absent. **Subject to:** the dashboard hook being enabled. Without that, every dependent section silently fails to render data and the failure mode is misdiagnosed as "RLS too strict." Closing this requires either a startup assertion that the hook is functioning (G-1) or a documented runbook check.

**R-2:** every completed section assumes `requireRole`'s redirect to `/onboarding/org` is unreachable in normal operation (i.e., once a user is onboarded they stay onboarded). Verified: there is no code path that destroys an owner's `user_organization_roles` row from inside the app; the `prevent_last_owner_delete` trigger guards against the only narrow path that could.

**R-3:** every completed section assumes the JWT contains the user's *current* org. The hook reads `user_organization_roles` at JWT-issue time. A role grant or revoke between two refreshes is reflected within ≤1 hour (access-token TTL). Phase-4 multi-org switching would require explicit `refreshSession()` — out of scope here. No retroactive concern for v1.

**R-4:** no automated test proves direct cross-tenant SELECT/UPDATE/INSERT on RLS-protected tables (diagnostic CRITICAL FINDING #5). **Not strictly a staff-auth-onboarding gap** — it is a section-spanning test-coverage gap — but the security boundary that staff onboarding *establishes* is unverified by regression tests. Per the operator handover note 2026-05-17 this is deferred until a second human practitioner has an account. Flagged here as a retroactive item that touches every dependent section and is in tension with the polish-pass section 1 closing posture; reviewer call.

**R-5:** the `'Pending'` placeholder magic-string coupling (F-12) means a future change to the trigger could silently produce profiles named "Pending Pending" for every new staff user — visible across every section that displays the EP name (top-bar greeting, dashboard, settings, client communications "from"). Listed as P2 robustness (**G-13**).

---

## Gap list

Severity grouping: **P0** architectural and security · **P1** functional · **P2** polish. Each gap names the premortem failure mode(s) it closes, labels UX items as **Requirement** (traceable to §5.1 or design system) or **Recommendation** (beyond them), and flags retroactive items that implicate completed sections.

### P0 — architectural and security

**G-1 — Custom-access-token hook enabled-state is not asserted anywhere.** Closes F-1 / R-1.
The entire multi-tenant boundary depends on `auth_hooks.custom_access_token` being enabled in the Supabase dashboard. There is no startup check, no smoke test, no runbook step in `docs/runbooks/` that verifies it. **Retroactive — implicates every completed section that depends on RLS.** Reviewer call on whether closing this requires (a) an `/api/health`-style endpoint that issues a fresh JWT and asserts `organization_id` is present, (b) a runbook step in `docs/runbooks/` plus a manual checklist, or (c) both. Requirement (traceable to docs/auth.md §11 monitoring intent and to docs/rls-policies.md fail-closed posture).

**G-2 — `refreshSession()` failure in the bootstrap server action has no detection or recovery path.** Closes F-4.
After `create_organization_with_owner` succeeds, the user has a valid membership row. If `refreshSession()` fails to write the new JWT to the cookie (network blip, response-cookie write race in Next.js 16 server actions, Supabase-side hiccup), the user lands at `/dashboard` with a stale JWT, gets redirected back to `/onboarding/org`, re-submits the form, and gets the unhelpful "User already belongs to an organization" error. No logout/login affordance. Requirement (traceable to §5.1 step 9 — refresh is named in the flow as a necessary step, and its failure mode is not handled). Closing this likely means: (i) in `OnboardingOrgPage`, detect "membership row exists but JWT claim is missing" by reading `user_organization_roles` directly (not via the helper that reads the JWT) and, if found, force `refreshSession()` again or surface a "Sign out and sign back in to finish" path; (ii) make the error in the RPC less misleading when it fires from a stale-JWT re-submit.

### P1 — functional

**G-3 — HIBP leaked-password check is not verifiable from code.** Closes F-2.
`docs/auth.md §12.1` (now resolved) calls for HIBP breach check. The check is a Supabase dashboard toggle (Auth → Settings → Password Strength → "Enable leaked password protection"). Not in `config.toml`, not in migrations. Closing this requires (a) enabling the toggle in the production project, and (b) recording the enabled state in `docs/secrets-inventory.md` or `docs/runbooks/` so its drift is detectable. Requirement (traceable to §12.1 resolution).

**G-4 — Refresh-token lifetime is not configured to 30 days in code.** Closes F-3.
`config.toml` sets only `jwt_expiry`, rotation enabled, and reuse interval. The 30-day refresh-token lifetime (§12.3) lives in the Supabase dashboard (Auth → Sessions → Refresh Token Expiry). Closing this requires (a) setting it explicitly in the production project, and (b) recording it in `docs/runbooks/` alongside G-3. Requirement (traceable to §12.3).

**G-5 — Password reset flow for EP owner is not implemented.** Closes F-6.
"Forgot?" link on `/login` returns to `/login`. No `/reset` route, no `resetPasswordForEmail` call site, no recovery email path. `docs/auth.md §5.5` specifies the flow (`supabase.auth.resetPasswordForEmail` → `/reset` with token in URL → `supabase.auth.updateUser({password})`). The `auth/callback` route already types `recovery` so the plumbing partially supports it. Requirement (traceable to docs/auth.md §5.5 — part of the composite target's constraint set even though the polish-pass active section is §5.1; §5.5 is the obvious peer that must exist for §5.1 to be operationally complete).

**G-6 — No auth-event audit log.** Closes F-10.
`docs/auth.md §11` lists ten auth events (signup success/failure, login success/failure, password reset requested/completed, invite sent/accepted, JWT hook failure, cross-tenant access attempt). None are emitted to Sentry or a structured log. The `audit_log` table captures table mutations only. Closing this requires either a `pg_log_auth_event` audit table written by the relevant server actions, or Sentry/structured logging plumbed end-to-end. Requirement at the production-grade-security level (traceable to §11 and to master brief §7.4's "audit logging for all data access and modifications").

**G-7 — No defence-in-depth against `enable_confirmations` being toggled off.** Closes F-7.
The signup action trusts Supabase's `enable_confirmations` toggle. If it gets flipped off in the dashboard (intentional or otherwise), unverified signups are silently accepted and the §12.2 resolution is violated without anyone noticing. Closing this means the signup action (or the `/auth/callback` route, or a Server-Component-level check before bootstrap) explicitly asserts `user.email_confirmed_at !== null` for the EP owner flow and refuses to proceed otherwise. Requirement (traceable to §12.2 resolution and to the trust-nothing posture this audit operates under).

**G-8 — `/login` "Keep me signed in for 30 days" checkbox is decorative.** Closes part of F-3.
The `remember` form field is read by no code path; session lifetime is unconditionally whatever Supabase enforces. The copy is accurate (30 days IS the §12.3 target) but the control implies user agency that does not exist. Two paths: (a) wire the checkbox to set a shorter session when unchecked (would require Supabase admin API call and probably custom claim handling — non-trivial), or (b) remove the checkbox and replace with a quiet "You'll stay signed in for 30 days." caption beneath the password field. **Recommendation** (the §5.1 / §5.4 flows do not specify this UI; the design system favours quiet captions over decorative controls).

### P2 — polish

**G-9 — `/signup` is publicly reachable from `/`.** Closes F-11.
Anyone on the open internet can self-create an organisation. RLS isolates them so no data leak, but the production database accumulates stranger orgs. Two paths: (a) gate `/signup` behind a feature flag / env var (`PUBLIC_SIGNUP_ENABLED`) that defaults to off in production and on in dev; (b) leave it open and document that the friends-and-family scope tolerates noise in the database (per CLAUDE.md "use the pre-launch advantages"). **Recommendation** (the master brief §4.1 only describes client onboarding; staff self-signup is the §5.1 default; this is an operational posture call, not a target conformance gap).

**G-10 — No "resend confirmation email" UI for staff signup.** Closes F-5.
If the EP's confirmation email is lost or expired, the only paths are (a) start a new signup with the same email (Supabase may or may not allow), (b) operator intervention. Add a "resend confirmation" link to `/signup?info=check-email` and to `/login` error path when the error is "Email not confirmed". Supabase has `auth.resend({ type: 'signup', email })`. **Recommendation** — §5.1 does not call for it, but the friends-and-family scope makes lost-email recovery a real concern for a population of two-to-six people.

**G-11 — `NEXT_PUBLIC_SITE_URL` falls back silently in the signup action.** Closes F-8.
`src/app/signup/actions.ts:26-29` falls back to `VERCEL_URL` (deployment-specific) or `localhost:3000` if `NEXT_PUBLIC_SITE_URL` is unset. CLAUDE.md operational state names a precedent for fail-loud env handling (`EMAIL_FROM` throws / 500s if unset); the same posture should apply here. Closing this: throw on unset `NEXT_PUBLIC_SITE_URL` in production (detect via `NODE_ENV` or `VERCEL_ENV === 'production'`). **Requirement** (traceable to CLAUDE.md code standards — "Environment variables for all secrets and configuration. Nothing hardcoded.").

**G-12 — First-run dashboard has no signposting to the next action.** Closes F-9.
An EP who just completed onboarding lands on an empty `/dashboard` with four zeroed stat cards and three "Nothing here" panels. Calm and clinical (matches design-system voice) but offers no path forward. Suggested closure: when `activeClientCount === 0`, replace the empty Needs-attention panel with a single quiet card — "Add your first client" → links to `/clients/new`. No exclamation points, no "Let's get started!", no decorative imagery. **Recommendation** (§5.1 does not specify the dashboard's first-run content; this is a design-system-and-product-judgement call).

**G-13 — `'Pending'` placeholder coupling between trigger and bootstrap RPC is fragile.** Closes F-12 / R-5.
`handle_new_auth_user()` inserts `('Pending','Pending')`; `create_organization_with_owner` UPDATEs `user_profiles SET first_name=..., last_name=... WHERE first_name = 'Pending' OR last_name = 'Pending'`. If a future change to the trigger alters the placeholder strings, the UPDATE silently does nothing and every new staff user's profile is left at the new placeholder. No test guards this. Closing this: either (a) remove the WHERE filter on `'Pending'` and trust the SECURITY DEFINER context (the RPC is only called from `/onboarding/org`, and the pre-flight `IF EXISTS (...) RAISE EXCEPTION` already guards against double-updates from re-onboarding); (b) reference a constant in both places via a Postgres `CREATE FUNCTION pending_name() RETURNS text` or similar; (c) add a pgTAP test asserting the round-trip. Option (a) is the cleanest. **Recommendation** (no UX-visible impact today; this is robustness against a future code change).

---

## Documentation-sync flags (non-blocking)

Carrying these from step-1 brief location so they are not lost. Both are documentation drift; neither blocks the gap-list approval.

- **P-B:** `Client_Platform_Brief_v2.1.docx §8` tech-stack table lists "Authentication: Clerk or NextAuth.js". `CLAUDE.md` and `docs/auth.md` (the more-specific documents per CLAUDE.md tiebreaker) say Supabase Auth, explicitly *"NOT Clerk, NOT NextAuth"*. The v2.1 brief is stale on this point. Schedule a corrective note in a future commit (either an addendum file `docs/master-brief-corrections.md` or a footnote in the brief itself). Not a code change.

- **P-C:** `docs/auth.md` status header says *"Version: 0.1 (Gate 2 — awaiting IT-advisor review)"*, *"Status: Design document. No auth code is written yet."* Both lines are stale: code has been written, and per CLAUDE.md "Open gates" the IT-advisor review is downgraded to recommended-not-required for friends-and-family scope. Update the status header in a future commit to reflect (a) implementation status, (b) the downgraded-review posture. Not a code change.

---

## Out-of-scope per the confirmed target

Listing explicitly to avoid future re-litigation:

- **Staff-invite-into-shared-org flow.** Phase 4 deferred per `docs/auth.md §5.2` and per the confirmed scope decision (trusted EP collaborator onboards via self-signup into their own separate organisation). The audit did not find partially-present staff-invite code in the staff-auth-onboarding path; the only "invite" surfaces in `src/app/(staff)/clients/...` are client-invite, which belongs to section 2.
- **MFA.** Deferred to Phase 2 per §12.5. Absence is not a gap.
- **Email change.** Deferred to Phase 2 per `docs/auth.md §5.6`. Out of section 1.
- **Idle-timeout enforcement.** `docs/auth.md §4.2` notes a 30-minute idle timeout target for staff. Not in the §12 resolutions, not enforced in code. Not promoted to a gap here because the §12 resolutions did not name it; carry to a future iteration if it surfaces in observability.
- **Cross-tenant raw-table pgTAP test (diagnostic CRITICAL FINDING #5).** Section-spanning test-coverage gap. Per operator handover 2026-05-17 deferred until a second human practitioner has an account. Flagged under premortem R-4 for reviewer awareness; not promoted to a gap on this section's list. Reviewer call.

---

## Closing posture

- No code was changed in this task.
- No existing record was relabelled or vandalised. The diagnostic doc at `docs/diagnostic-auth-onboarding-tenancy.md` was used as evidence to spot-check, not as a substitute for reading the code.
- Step 5 of the polish-pass protocol (approval) happens in the claude.ai chat. Awaiting that approval before step 6 (addressing gaps in dependency order) is engaged.
- If the reviewer adds gaps or revises priorities, append a "Reviewer revisions" section below this line; the seven-step protocol re-engages from step 5.

---

## Reviewer revisions and approval

**Date:** 2026-05-21.
**Reviewer:** claude.ai project chat for the staff-auth-and-onboarding section (per the polish-pass sign-off ritual; the review is logical and documentary, not code-level).
**Decision:** **Approved with revisions.** Step 6 (addressing gaps) is authorised to begin in a subsequent task in the sequence defined under "Step six fix sequence" below. This task records the approval and the revisions only — it changes no application code and writes no file other than this one.

### Revision 1 — G-5 promoted to lead P1

G-5 (password reset for EP owner) is promoted to the highest-priority P1 and sequenced first among the functional gaps. **Rationale:** in a two-person beta, owner lockout has no self-serve recovery path and the owner account is the sole owner per the `prevent_last_owner_delete` guard (`supabase/migrations/20260420100200_identity_tables.sql:130-150`). It does not break the security model — the JWT, RLS, and tenant boundary are unaffected — so it remains P1 rather than P0, but it leads the P1 work.

### Revision 2 — Dashboard-config consolidation

G-1, G-3, G-4, and G-7 are consolidated into a single workstream named **"dashboard-config verification."** The original four-gap framing missed the shared underlying problem: each of these four is a security property that

- lives in a Supabase dashboard setting,
- is invisible to code,
- silently degrades security if changed in the dashboard,
- has no drift detection in the current architecture.

The four properties:

- **G-1** Custom-access-token hook enabled (the `organization_id` boundary).
- **G-3** HIBP leaked-password protection enabled.
- **G-4** Refresh-token lifetime set to 30 days.
- **G-7** Email-confirmation requirement enabled.

Closing this workstream is **not** four independent runbook notes. It is one mechanism that verifies behaviour — i.e., issues or inspects a fresh session and asserts the observable consequences: that a freshly-issued JWT for an onboarded user carries `organization_id`, that a known-breached password is rejected at signup, that confirmations are enforced. Where a property cannot be behaviourally asserted, it is recorded in a single production-configuration document under `docs/runbooks/` with the means to re-verify it, not merely the assertion that it was set once.

The health-check approach is to be **framed as an option to verify against the Next.js 16 and Supabase setup, not as a settled design.** What it can and cannot assert is to be surfaced before building it. See Track A step 1 below.

### Revision 3 — R-4 conscious deferral, with G-1 manual-verification compensation

The cross-tenant pgTAP regression test (R-4 in the premortem, diagnostic CRITICAL FINDING #5) **remains deferred** until a second practitioner account exists, per the prior operator handover (2026-05-17). This deferral is now re-affirmed deliberately with the G-1 finding in view.

The reason it matters: the multi-tenant boundary is sound but rests on the fragile dashboard hook (G-1). The automated tripwire that would catch a G-1 silent regression is the very cross-tenant pgTAP test being deferred. The deferral is therefore not free.

**Compensation:** the G-1 portion of the dashboard-config workstream must include a **manual cross-tenant verification step** — a documented procedure to confirm, by hand, that one org cannot read another org's rows — so the boundary is not left entirely unverified while the automated test waits. This documented procedure becomes Track A step 4 below.

### Revision 4 — G-6 deferred to pre-paying-client hardening

G-6 (structured auth-event audit log, ten events from `docs/auth.md §11`) is deferred to the pre-paying-client hardening pass. **Rationale:** a production-grade ten-event audit log is disproportionate to a two-to-six person friends-and-family beta where the operator IS the security team. Master brief §7.4 names audit logging as a security requirement, so this is **deferred-with-trigger, not cut**.

**Trigger:** before any paying clinical client onboards — the same gate as the other items in CLAUDE.md "Open gates" (a, b, c). Recording: G-6 is to be added to the pre-beta / pre-paying-client hardening backlog wherever that backlog lives, alongside the secret-rotation task. This recording is a documentation task to be carried out **in a separate future task**, not in any step-6 task for the current section. Candidate locations for the backlog (operator to confirm): a new section in CLAUDE.md "Open gates", or a new `docs/pre-paying-client-hardening.md`. This audit doc does not unilaterally pick the location.

### All other gaps approved as written

- **G-2** (`refreshSession` failure recovery) — P0 code gap, approved.
- **G-8** (decorative "Keep me signed in for 30 days" checkbox) — P1 recommendation, approved.
- **G-9** (`/signup` operational gating) — P2 recommendation, approved.
- **G-10** (resend-confirmation UI for staff signup) — P2 recommendation, approved.
- **G-11** (fail-loud on `NEXT_PUBLIC_SITE_URL`) — P2 requirement, approved.
- **G-12** (first-run "Add your first client" quiet card when `activeClientCount === 0`) — P2 recommendation, **approved to implement**.
- **G-13** (`'Pending'` placeholder coupling cleanup) — P2 recommendation, approved.

### Documentation-sync flags carry forward unchanged

P-B (master brief Clerk/NextAuth staleness) and P-C (`docs/auth.md` status header staleness) remain non-blocking documentation-sync flags. They are not part of either Track A or Track B; they are picked up in a future commit at the operator's convenience.

### Out-of-scope items also carry forward unchanged

Staff-invite-into-shared-org (Phase 4), MFA (Phase 2), email change (Phase 2), idle-timeout enforcement (peripheral to §12 resolutions), and the cross-tenant pgTAP regression test (R-4, deferred per Revision 3) remain out of scope for the step-6 work on this section.

---

## Step six fix sequence

Two distinct tracks, deliberately not interleaved so that dashboard / operator work and local code work each get a clean ground for the operator to act in. Track A is partly an operator checklist (Claude Code cannot click dashboard toggles). Track B is the local code sequence in dependency order.

Step 6 execution is a separate task per item; each closure returns here for review before the next is picked up. No track or item is started in this task — this section is the sequencing, not the execution.

---

### Track A — Dashboard-config verification

Consolidated workstream covering G-1, G-3, G-4, G-7 (see Revision 2). The sequence below is intentionally: design → operator-set → verify → manual-cross-tenant-doc → manual-cross-tenant-run.

#### A.1 — Design the verification mechanism

**Owner:** Claude Code (writes a design note; no code yet).
**Output:** a short design doc, candidate location `docs/runbooks/verify-auth-config.md` (operator to confirm location). The design names the intent (assert the four observable consequences of the four dashboard settings), the candidate approaches, what each can and cannot assert, and what about the Next.js 16 + Supabase setup must be verified before committing to a build approach.

**Candidate approaches to evaluate — each to be framed as "verify this works" before building:**

- **Endpoint-style health check.** A protected `/api/health/auth-config` route (Claude Code can build it) that runs a small set of behavioural probes on demand and reports pass / fail / cannot-determine per property. Returns 200 with a JSON body; gated by the existing staff `requireRole(['owner'])` so only the operator can hit it. **Open question:** does Supabase's Admin API (called with `SUPABASE_SERVICE_ROLE_KEY` server-side) expose a way to inspect a freshly-issued JWT's claims for a known seed user without persisting a new auth.users row?
- **Smoke-test script in `scripts/`.** A standalone TypeScript script (Claude Code can write it) that the operator runs locally / in CI against the production project. Same probes, but lifecycle is "run on demand" rather than "live in the app surface." Better isolation; less ergonomic for periodic re-check.
- **Pure runbook.** No code at all — just a `docs/runbooks/verify-auth-config.md` with step-by-step manual instructions for the operator to verify each property by hand. Lowest engineering cost, highest operator overhead.

**What each property can and cannot be asserted automatically (subject to verification before build):**

| Property | Behavioural-assert candidate | What it cannot prove | Fallback |
|---|---|---|---|
| **G-1 hook enabled** | Issue / inspect a JWT for a known seed staff user with a known org membership; assert the JWT carries `organization_id` and `user_role`. Likely done via Supabase Admin API or a server-side `signInWithPassword` against a sealed test account, then decoding the access token. | Cannot prove the hook is *correct* across all membership states — only that it fires for the seed user. The Phase-4 preferred-org branch (lines 79-90 of the hook) is not exercised. | If Admin API doesn't expose the claims path, fall back to a runbook step that says "Dashboard → Authentication → Hooks → Custom Access Token must be enabled and pointing at `pg-functions://postgres/auth_hooks/custom_access_token`" with a screenshot template. |
| **G-3 HIBP enabled** | Attempt a signup or password-update with a known-breached password (`Password123456` and similar). Assert Supabase returns the leaked-password error. | Cannot prove the breach database is current — that is Supabase's responsibility. | If the probe creates a stray `auth.users` row, may need a teardown step or a test-only email pattern that gets purged. **Verify this works:** does Supabase reject the password *before* creating the auth.users row, or after? |
| **G-4 30-day refresh token lifetime** | **Cannot be asserted behaviourally on a useful timescale** — would require waiting 30 days. | Almost everything in real-time terms. | This property lives in the runbook only. Documented as: "Dashboard → Authentication → Sessions → Refresh Token Expiry = 2592000 seconds (30 days)", with a screenshot template and a re-verify cadence. Possibly cross-checked via Supabase Management API (REST) if that endpoint exists and is callable from a server context — **verify this works.** |
| **G-7 confirmations enabled** | Attempt a signup; assert the action returns `data.session === null` (matches the application's current branch logic). | Cannot distinguish between "confirmations enabled" and "confirmations enabled but email is broken" — both produce null session. Latter is a different failure surfaced elsewhere. | The application already implicitly relies on this (the redirect to `/signup?info=check-email`). The check is a tightened version of the same behaviour. |

**Output of A.1 is a written design note** that surfaces the candidate path, the open questions, and a single recommendation for the operator to approve. **Building the mechanism is A.3, after operator sets values.**

#### A.2 — Operator sets production values in the Supabase dashboard

**Owner:** Operator. Claude Code cannot click dashboard toggles.
**Output:** four dashboard settings confirmed in the production project.

Operator checklist (to be transcribed into a runbook in A.4 once verified):

- **G-1:** Dashboard → Authentication → Hooks → Custom Access Token → **enable** the hook, URI `pg-functions://postgres/auth_hooks/custom_access_token`.
- **G-3:** Dashboard → Authentication → Settings → Password Strength → **enable** "Prevent use of leaked passwords (HIBP)".
- **G-4:** Dashboard → Authentication → Sessions → Refresh Token Expiry → **set to 30 days** (2592000 seconds). Confirm absolute session cap matches the §4.2 intent.
- **G-7:** Dashboard → Authentication → Sign In / Sign Up → Email confirmations → **confirmed enabled**. Matches `supabase/config.toml:52` for the local stack.

The operator records the four settings (screenshot or note) before A.3 runs.

#### A.3 — Verification confirms the operator-set values

**Owner:** Claude Code (builds the mechanism approved in A.1).
**Output:** the verification mechanism in code (or in `scripts/`, or in `docs/runbooks/`, per A.1's outcome). A single command or endpoint that the operator can run on demand.

Result expected on first run after A.2: all four properties pass, or are documented in the runbook with re-verification instructions where they cannot be behaviourally asserted.

#### A.4 — Manual cross-tenant verification procedure (R-4 compensation)

**Owner:** Claude Code writes the procedure; operator runs it.
**Output:** a new file, candidate path `docs/runbooks/verify-cross-tenant-isolation.md` (operator to confirm location), containing a step-by-step procedure to confirm, by hand, that one org cannot read another org's rows.

Procedure outline (to be expanded in the runbook):

- Create two seed organisations and seed staff users via the existing self-signup flow.
- Insert one synthetic client, one clinical_note, and one program into each org via the application.
- Sign in as staff_B; run a small read script (or use the Supabase SQL editor with the staff_B JWT in headers) that issues `SELECT id FROM clients`, `SELECT id FROM clinical_notes`, `SELECT id FROM programs`, etc. against the **eight core tenant tables** named in the diagnostic (clients, clinical_notes, programs, sessions, appointments, communications, reports, audit_log).
- Expected: each query returns only org_B's rows; never org_A's.
- If any query returns an org_A row, halt and treat as a P0 incident.

This is the manual tripwire that compensates for R-4 staying deferred. To be re-run by the operator (a) after A.2 closes, (b) on any subsequent migration that touches RLS policies, (c) before the second practitioner account is created. When R-4's automated pgTAP test eventually lands, this manual procedure is retired or downgraded to a quarterly check.

---

### Track B — Code gaps in dependency order

Sequenced lead-with-P0 → lead-P1 → remaining-requirement-P1/P2 → recommendations. Each item is closed in its own step-6 task; each returns here for review before the next is picked up.

#### B.1 — G-2 (P0): `refreshSession` failure recovery in the bootstrap flow

**Closes premortem F-4.** Lockout path; lead P0 code gap.

**Dependencies / things to verify before designing the fix:**

- **Verify this works:** in Next.js 16, does a Server Action that calls `supabase.auth.refreshSession()` and then `redirect(...)` reliably persist the refreshed JWT cookie into the redirect response, or is there a race where the cookie write is lost because the redirect throws before the response flushes? `src/lib/supabase/server.ts:23-31` catches the "Server Components cannot set cookies" exception and treats it as a no-op — verify whether server actions hit the same path or a different one.
- **Verify this works:** the middleware (`src/lib/supabase/middleware.ts:43-45`) already calls `getUser()` on every request, which itself triggers a refresh if needed. After `/onboarding/org` redirects to `/dashboard`, does the middleware's refresh on the next request rescue a missed cookie-write from the server action? If so, the failure mode is narrower than premortem F-4 suggested and the fix is correspondingly smaller.
- **Verify this works:** when `create_organization_with_owner` raises "User already belongs to an organization" because of a stale-JWT re-submit, does the action's `error` branch reliably surface the exception's message to `/onboarding/org?error=...`, or is it swallowed?

**Approach to verify (not yet build):**

- In `OnboardingOrgPage`, replace the current `if (orgId) redirect("/dashboard")` check (which reads the JWT helper) with a two-step check: (a) if `user_organization_id()` returns an org, redirect to `/dashboard`; (b) else if a direct `user_organization_roles` lookup for `auth.uid()` returns a row, render a "Finishing setup..." state that auto-triggers `refreshSession()` once and a "Sign out and sign in again" fallback link if it fails twice.
- Optionally, harden `create_organization_with_owner` to surface a different `ERRCODE` for "already-belongs-but-no-JWT-claim" vs "already-belongs-genuine-double-signup" so the action can route them differently.

**Interaction with onboarding flow:** this gap and the §5.1 step 9–10 transition are the same code path. Closing G-2 may slightly refactor `OnboardingOrgPage` + `createOrganization` action; will not touch `create_organization_with_owner` semantics.

#### B.2 — G-5 (P1, promoted): Password reset for EP owner

**Closes premortem F-6.** Promoted to lead P1 per Revision 1.

**Dependencies / things to verify before designing the fix:**

- **Verify this works:** the existing `src/app/auth/callback/route.ts:22-29` already types `'recovery'` as a callback type and exchanges code-for-session correctly. Confirm that `next` parameter handling routes correctly to a `/reset` page for the recovery flow.
- **Verify this works:** does `supabase.auth.resetPasswordForEmail(email, { redirectTo })` use the project's verified sending domain (`mail.odysseyhq.com.au` per CLAUDE.md operational state) or a separate Supabase template path? If it uses Supabase's own email-template path, the deliverability depends on the cloud project's Auth → Email Templates → Reset Password configuration — not on the application's `EMAIL_FROM`.
- **Verify this works:** Supabase's `auth.updateUser({password})` requires a valid session. The recovery flow grants a short-lived session via the magic-link callback. Confirm the session is in place before `/reset` calls `updateUser`.

**Approach to verify (not yet build):**

- Wire `/login`'s "Forgot?" link (`src/app/login/page.tsx:54`) to a new `/reset-request` route.
- `/reset-request` page: simple email form + server action calling `supabase.auth.resetPasswordForEmail(email, { redirectTo: '${origin}/auth/callback?next=/reset' })`.
- `/reset` page: form to set new password + server action calling `supabase.auth.updateUser({password})`. Requires authenticated session (the recovery flow grants it via the callback).
- `/auth/callback`: confirm the `next` parameter is honoured and routes recovery flow correctly to `/reset`.

**Shared plumbing with existing recovery type:** yes — `auth/callback` already handles recovery. The work is mostly new pages + actions; the callback may need a small adjustment to route recovery → `/reset` by default if `next` is unset.

**Tightly couples to G-11 (fail-loud `NEXT_PUBLIC_SITE_URL`):** the new `/reset-request` action will also need to build a redirect URL from origin. Close G-11 first OR close them together so origin handling is uniform across signup and reset.

#### B.3 — G-11 (P2 requirement): Fail-loud on `NEXT_PUBLIC_SITE_URL`

Pulled forward from "approved recommendations" because of the dependency from B.2.

**Approach to verify (not yet build):**

- Add a small helper `getPublicOrigin()` in `src/lib/env/` (new file). In production (`process.env.VERCEL_ENV === 'production'` or `process.env.NODE_ENV === 'production'`), throw if `NEXT_PUBLIC_SITE_URL` is unset; in dev/preview, fall back to `VERCEL_URL` or `http://localhost:3000` as today.
- Replace inline reads in `src/app/signup/actions.ts:26-29` and any other site-URL-reading code site with `getPublicOrigin()`. Other current call sites: `src/app/portal/book/new/actions.ts:137` (uses `NEXT_PUBLIC_APP_URL` — same logical value, different key — see diagnostic Section 4 finding on env-var inconsistency; **note**: this section's scope is staff, so the booking call site is out of section but the helper should be designed to subsume both keys with the operator's choice of canonical name).
- **Verify this works:** confirm the precedent for fail-loud env handling per CLAUDE.md operational state (`EMAIL_FROM` throws / 500s if unset) — match that posture exactly.

#### B.4 — G-8 (P1 recommendation): Decorative "remember" checkbox

**Approach to verify (not yet build):**

- Remove the `remember` checkbox from `src/app/login/page.tsx:70-78`.
- Replace with a quiet caption directly beneath the password field: "You'll stay signed in for 30 days." (or similar — matches the design-system voice: quiet, factual, no exclamation).
- Remove the `hidden` `name="remember"` field if present.

**No code-flow dependency.** Standalone UI cleanup. Could be done in any order after B.1–B.3, or even bundled.

#### B.5 — G-9 (P2 recommendation): `/signup` operational gating

**Approach to verify (not yet build):**

- Add an env var `PUBLIC_SIGNUP_ENABLED` (boolean string). Default off in production, on in dev.
- In `src/app/signup/page.tsx`, gate the form behind the env. When disabled, render a quiet "Signup is currently closed" page that links to `/login`.
- Add the env var to `.env.local.example` and to `docs/secrets-inventory.md`.
- **Operator decision required before build:** is the friends-and-family scope tolerant of public signup (current state), or should signup be invite-only-by-env-flag during beta? This is a policy call, not a code call. Surface the decision in the build task; do not assume.

#### B.6 — G-10 (P2 recommendation): Resend-confirmation UI

**Dependencies / things to verify before designing the fix:**

- **Verify this works:** Supabase JS SDK exposes `supabase.auth.resend({ type: 'signup', email })`. Confirm the SDK version pinned by the project (`@supabase/supabase-js`, `@supabase/ssr` in `package.json`) supports this method and that calling it from a Server Action does not require service-role.
- **Verify this works:** the rate-limit on resend (`docs/auth.md §7.1` says 30/hour for signup — the resend endpoint may have a different limit per Supabase). Confirm before the action lands.

**Approach to verify (not yet build):**

- On `/signup?info=check-email`, add a "Didn't get the email? Send it again" link. The link is a button (server action) that requires the email — carry the email in the query state on the `info=check-email` redirect (`src/app/signup/actions.ts:50` currently does not carry it; add `&email=...`).
- Same affordance on `/login` error path when the error matches "Email not confirmed".

#### B.7 — G-12 (P2 recommendation): First-run signposting on dashboard

**Approach to verify (not yet build):**

- In `src/app/(staff)/dashboard/page.tsx`, when `activeClientCount === 0`, replace the empty Needs-attention panel (or the Today's-sessions panel — design call) with a single quiet card: "Add your first client" → links to `/clients/new`.
- Match design-system voice: no exclamation, no decorative imagery, no "Let's get started!". Lucide stroke icon (UserPlus or similar) at 2px stroke is acceptable.
- **No dependency on other gaps.** Pure UI addition.

#### B.8 — G-13 (P2 recommendation): `'Pending'` placeholder coupling cleanup

**Dependencies / things to verify before designing the fix:**

- **Verify this works:** `create_organization_with_owner`'s pre-flight `IF EXISTS (SELECT 1 FROM user_organization_roles WHERE user_id = caller_id) THEN RAISE EXCEPTION 'User already belongs to an organization'` is sufficient to prevent the bootstrap RPC from ever running twice for the same user. Confirmed on inspection — the function refuses to run if the user has any org membership. The `'Pending'` filter on the UPDATE clause is therefore redundant, and removing it does not risk double-overwriting a real user's name with placeholders.
- **Verify this works:** dropping the filter in a migration requires `DROP FUNCTION` + `CREATE OR REPLACE` because Postgres signatures are matched on `(text, text, text, text)` and the function name + arg shape is unchanged. Per CLAUDE.md memory item "plpgsql function arity evolution" the migration needs to be a clean DROP + CREATE, not just CREATE OR REPLACE — verify this against the current function's signature.

**Approach to verify (not yet build):**

- New migration `<timestamp>_bootstrap_drop_pending_filter.sql`:
  - `DROP FUNCTION public.create_organization_with_owner(text, text, text, text);`
  - Re-`CREATE` the function with the WHERE filter removed from the UPDATE clause; everything else identical.
- Regen `src/types/database.ts` via `npm run supabase:types` (per CLAUDE.md memory item "Schema/migration/push correctness").
- No code change in `src/`.

---

### Sequencing summary

Track A runs partly in the operator's chair (A.2) and partly in Claude Code's chair (A.1, A.3 build, A.4 doc). Track B is local code, sequenced B.1 → B.2 (paired with B.3) → B.4 → B.5 → B.6 → B.7 → B.8.

Each item closes in its own task and returns here for review before the next begins. The first step-6 task should pick up A.1 (design the verification mechanism, as a written design note for operator approval) — that is the prerequisite for the entire Track A workstream and surfaces the open framework/library questions before any code is built.

Stopping here. No track or item is started in this task.

---

## A.1 — verification mechanism design

> **SUPERSEDED 2026-05-21 by "A.1 (revised) — verification mechanism design" below.** This original is retained for trace. The reviewer accepted the assertability verdicts (G-1 automatable, G-3 probeable, G-7 partial, G-4 documentation-only) but rejected two things: (1) the permanent verification-bot account is demoted from preferred to last-resort fallback — see revised §"Create-probe-destroy disposable-account model"; (2) the always-live endpoint (Candidate A) is rejected in favour of an on-demand script (Candidate B) plus runbook (Candidate C). Read the revised section for the authoritative design; this section is context for why it changed.

**Date:** 2026-05-21.
**Task scope:** design-and-propose only. No mechanism is built, no Supabase project is touched, no application code is changed in this task. The deliverable is this section plus the operator checklist surfaced in the chat report.

The objective of the dashboard-config verification workstream is one mechanism that surfaces whether four Supabase dashboard settings — invisible to application code today — match the audit's target values. The four properties differ in their assertability; the design must reflect that honestly. A single uniform check that pretends all four are equally testable would mis-represent the load-bearing one (G-1) and fabricate signal for the genuinely-unobservable one (G-4).

### Per-property assertability

| Property | Verdict | What can be asserted | What cannot be asserted | Cost / side-effects |
|---|---|---|---|---|
| **G-1 — Custom-access-token hook enabled** | **Behaviourally assertable.** This is the load-bearing one and the highest-value automation. | A freshly-issued access token for a known seed staff user carries `organization_id` and `user_role` as JWT claims. Concretely: trigger a JWT issue (sign-in via password, or a token-refresh on an existing session) for a sealed verification account that has a known `user_organization_roles` row, then decode the returned `access_token` (JWT) and assert both claims are present and non-empty. The hook is invoked at every issue / refresh per the migration's design, so any successful issue+claim path proves the hook is firing. | Cannot prove the hook is *correct across all membership states* — only that it fires for the seed account. Cannot exercise the Phase-4 preferred-org branch (lines 79-90 of `supabase/migrations/20260420100300_auth_helpers_and_jwt_hook.sql`) without a multi-membership user, which v1 explicitly forbids. Cannot detect a hook that fires but returns malformed claims if the seed user's claims happen to look fine. | One sealed account in the production project (a permanent `auth.users` row + `user_organization_roles` row + an empty seed `organizations` row). Cost: a row in three tables forever. Probe cost per run: one `signInWithPassword` round-trip; no service-role required if the probe uses the seed account's password (server-only env var). |
| **G-3 — HIBP leaked-password protection enabled** | **Probeable with caveats.** | Submitting a known-breached but length-valid password to a password-set surface returns a Supabase-side rejection. The expected error surface needs to be verified against the SDK version pinned by the project (per CLAUDE.md memory item on Supabase API drift). Two candidate probe paths exist, with different cost: (a) signup with a throwaway user and a known-breached password — requires `admin.deleteUser` teardown afterward; (b) `updateUser({password: '<known-breached>'})` on the G-1 seed account — no throwaway, but requires resetting the seed account's password back afterward and **verify-this-works** that Supabase's HIBP check applies to the update path as well as to signup. | Cannot prove the HIBP breach database is current — that is Supabase's responsibility. Cannot probe with arbitrary breached passwords without writing them into the codebase (a maintenance and disclosure issue); the probe must reference a single, deliberately-chosen public-domain test password. | Path (a): one throwaway `auth.users` row per run plus `admin.deleteUser` cleanup, which requires `SUPABASE_SERVICE_ROLE_KEY` server-side — already an established server-only surface per `src/lib/supabase/server.ts:56-68`. Path (b): no auth.users churn but requires updating then restoring the seed account's password, which means the seed-account password env var becomes load-bearing for the probe. **Verify-this-works:** Supabase auth rate limits include "Sign up: 30/hour per IP" and "Password reset: 4/hour per email"; the operator decides cadence so neither limit is tripped. |
| **G-4 — Refresh-token lifetime 30 days** | **Not behaviourally assertable on a useful timescale.** Honest answer: this is documentation-only. | Nothing in real-time — the only observable consequence (a refresh token failing to refresh after the lifetime) takes the lifetime itself to observe. The Supabase Management API (a separate REST surface from the auth/db/storage SDK, accessed with a Management API token rather than the project's service-role key) **may** expose project auth config including `refresh_token_max_lifetime`; **verify-this-works** by inspecting the Management API reference for the project's tier. If exposed, a read-back drift check is possible (compare what the API returns to the target 30-day value). | Cannot prove correct enforcement without waiting 30 days. Cannot prove the dashboard hasn't been mid-changed between the read-back and any given user session. | If Management API exposes the field: zero auth-side cost, one extra credential to manage (Management API token, separate from service-role key, per Supabase's auth-token model). If not exposed: pure runbook with a dashboard screenshot + re-verification cadence. |
| **G-7 — Email confirmations enabled** | **Partially assertable. Observable in the existing signup flow.** | Submitting a signup with a throwaway email returns `data.session === null` (confirmations on) or `data.session !== null` (confirmations off). The application's existing signup action at `src/app/signup/actions.ts:46-50` already branches on this distinction — that branch IS a de facto check, but only if a signup happens. An automated probe makes the check explicit and cadence-able. **Verify-this-works:** whether the Supabase Admin API surfaces an introspectable "confirmations required" flag — if so, a read-back avoids the throwaway-user churn entirely. | Cannot distinguish "confirmations enabled" from "confirmations enabled but the configured email template is broken." Latter is a different failure surfaced elsewhere (no email arrives), not by this probe. | Probe-via-signup: one throwaway `auth.users` row per run plus `admin.deleteUser` cleanup (same plumbing as G-3 path (a)). Probe-via-Admin-API (if available): zero churn. |

### Genuine versus invented assertions

Two assertions worth naming as **not** going into the design, because they would create signal that doesn't really test the underlying property:

- **G-4 by inducing a token refresh and inspecting any side-effect.** A refresh that succeeds proves nothing about lifetime; the SDK refreshes opportunistically inside the access-token TTL (1 hour) regardless of refresh-token lifetime. Not a valid check.
- **G-7 by reading the application's own "session was null" branch as ground truth.** The application's branch tells us what the application saw, not what the dashboard says. If a probe never runs and the application's own signup-side observation is the only signal, drift can go unnoticed for as long as no one signs up.

### Mechanism shape — candidate approaches, not a recommendation

Three candidate shapes. Each interacts differently with the Next.js 16 + Supabase + Vercel posture documented in CLAUDE.md.

#### Candidate A — Server-only API route

Shape: a Next.js route handler (`src/app/api/health/auth-config/route.ts` — exact path operator's call) gated by `requireRole(['owner'])`. The operator hits it from the staff app via a button in `/settings` or directly via authenticated `curl`. It runs the probes server-side and returns JSON of the form:

```
{ "G-1": "pass", "G-3": "pass", "G-4": "documentation-only", "G-7": "pass", "details": { ... } }
```

| Trade | Cost / consideration |
|---|---|
| One-click verification from operator's chair | Adds an attack surface — endpoint exists in production. `requireRole` gating mitigates but the endpoint itself is a probe target. **Verify-this-works:** that `requireRole(['owner'])` is sufficient (it is what gates the entire `/settings` page today). |
| Self-documenting: the endpoint's response IS the check | Vercel function-execution time limits — sign-in, JWT decode, signup probe with cleanup, and update probe could exceed Vercel's hobby-tier 10s limit. **Verify-this-works** against the project's actual Vercel tier (the diagnostic flagged the deploy posture as unverifiable from code). |
| Lives next to the app; easy to keep current with the codebase | If G-3 path (a) is chosen, this endpoint uses `SUPABASE_SERVICE_ROLE_KEY` for the `admin.deleteUser` cleanup — already an established server-only surface (per `src/lib/supabase/server.ts:56-68` and the diagnostic's audit of service-role import surface). **Per CLAUDE.md code standards: service-role must never reach the browser.** The route handler is a server-only context; the existing convention holds. |
| Could expose a "Verify auth configuration" button in `/settings` for operator convenience | Said button is owner-only — design-system call on whether to show or hide it from staff. Trivial to gate. |

#### Candidate B — Standalone TypeScript script

Shape: `scripts/verify-auth-config.ts` (operator's call) run via `npm run verify-auth-config`. Reads creds from `.env.local` (developer machine) or CI secrets. Same probe logic as Candidate A but runs outside the deployed application.

| Trade | Cost / consideration |
|---|---|
| No production app surface; lower attack surface | Operator must run it from a machine with repo + env access; not "anywhere with a browser." |
| Easier to keep service-role key out of the always-on app process (it already lives in the app's env, but a script narrows the call sites) | More setup for CI integration. The friends-and-family beta does not currently have CI running periodic checks against production. |
| Can take longer than 60s without Vercel limits | Operator must remember to run it; less ergonomic for ad-hoc verification. |
| Cleaner for one-off "before launching" baseline verification | Less useful as an ongoing drift monitor. |

#### Candidate C — Pure runbook + manual verification

Shape: `docs/runbooks/verify-auth-config.md` (operator's call on filename). Step-by-step manual instructions: open incognito, sign in as the seed account, copy `access_token` from browser devtools (Application → Cookies → `sb-*-auth-token`), paste into a JWT decoder (e.g. jwt.io or a local one-liner), inspect claims. For G-3, attempt signup-and-cleanup manually via the dashboard. For G-4, screenshot the dashboard setting.

| Trade | Cost / consideration |
|---|---|
| Zero engineering cost; zero production code changes | Maximum operator effort per check; high friction. |
| No probe rows in `auth.users` (other than the existing seed account if chosen) | Manual JWT decoding is error-prone; pasting a JWT into a third-party decoder is a small security risk if jwt.io is compromised (it has not been, but the principle holds). A local decoder avoids that. |
| Easy to skip; easy for the check to drift from reality if the runbook isn't followed | Easy to keep current — only docs to update. |

#### Recommendation as a starting point for discussion (not as the decision)

A pragmatic shape that fits this project's posture:

- **G-1 + G-7 + G-3 path (b):** Candidate A or B, depending on whether the operator prefers one-click in-app verification or a script-based baseline.
- **G-4:** Candidate C — documented value with a re-verification cadence; optionally augmented by a Management API read-back probe in whichever of A or B is chosen, if the Management API exposes the field.
- **The runbook (Candidate C content) exists alongside whichever automation is chosen** — both as the human-readable description of what's being checked and as the fallback when automation cannot assert (e.g. G-4).

This recommendation is starting-point material; the operator's call on A versus B and on the in-app surface decides shape.

### Service-role and live-infrastructure safety

Per CLAUDE.md code standards: "Service role key is server-only — never ships to the browser." Applies to any candidate that touches `admin.deleteUser` (G-3 path (a)) or `admin.getUserById` (any property that needs to inspect a user without signing in).

If Candidate A is chosen:
- The route handler runs server-side by definition (Next.js route handlers do not ship to the client).
- `SUPABASE_SERVICE_ROLE_KEY` is read via `process.env` in a server-only file — matches the established pattern at `src/lib/supabase/server.ts:56-68` and the two existing service-role import sites (`src/app/(staff)/clients/new/actions.ts`, `src/app/i/[id]/page.tsx`) per the diagnostic.
- The seed-account password is a new server-only env var; same posture as service-role.
- **Verify-this-works at build time:** ESLint / TypeScript catch accidental client-bundle inclusion of server-only modules; the existing `'use server'` and route-handler conventions are the enforcement.

If Candidate B is chosen:
- Script runs only on operator machine or CI; service-role key lives in `.env.local` or CI secrets, never deployed.
- Even safer in principle than Candidate A.

If Candidate C is chosen:
- No service-role usage in the probe path; manual operator action only. Lowest risk surface.

The friends-and-family scope tolerates Candidate A's marginal additional surface because the operator IS the security team and gating-by-owner-role is already the convention.

### R-4 compensation — manual cross-tenant verification procedure

Designed in this section. Not run in this task. Run is a separate step after A.2 + A.3 close.

**Purpose.** The automated pgTAP cross-tenant regression test (diagnostic CRITICAL FINDING #5) is deferred until a second practitioner account exists. The G-1 hook is the load-bearing assumption every dependent section trusts. Manual verification stands in for the automated tripwire so the multi-tenant boundary is not entirely unverified during the deferral window.

**Procedure design.** Documented in a runbook (candidate path `docs/runbooks/verify-cross-tenant-isolation.md` — operator confirms).

Setup, one-time (done after A.3 closes so the dashboard config is known good):

1. Two seed organisations in the production project, created via the existing self-signup flow at `/signup` → `/onboarding/org`:
   - `Verify Org A` — owner `verify-a@<test-domain>` (decision: which test domain — see open questions).
   - `Verify Org B` — owner `verify-b@<test-domain>`.
2. Both accounts use distinct passwords stored only in the operator's password manager.
3. Per org, the operator creates via the app, signed in as that owner: one client (synthetic name, no PHI), one clinical note attached to that client, one program attached to that client, one appointment, one communication record, one report stub. Audit_log rows accumulate naturally.

Per-run procedure (initial baseline + on each migration that touches RLS / the hook / the JWT helpers + before any second-practitioner account is created):

1. **Browser session 1** — sign in as `verify-a@...`. Note `client.id`, `clinical_notes.id`, `programs.id`, `sessions.id`, `appointments.id`, `communications.id`, `reports.id` from the app's URLs or detail pages.
2. **Browser session 2 (separate browser or incognito)** — sign in as `verify-b@...`. Same notes for Org B's rows.
3. **Cross-tenant read checks.** As `verify-b@...`, against each of the eight core tenant tables named in the diagnostic (clients, clinical_notes, programs, sessions, appointments, communications, reports, audit_log):
   - Run a `SELECT id, organization_id FROM <table>` via the Supabase SQL Editor **with the verify-b JWT pasted into the SQL Editor's `auth.jwt` impersonation panel** (Supabase's SQL Editor has an "Impersonate user / role" affordance; **verify-this-works** that pasting a JWT or selecting `authenticated` with a specific user id is sufficient).
   - **Expected:** every returned row has `organization_id = <verify-b's org id>`. Any row with `organization_id = <verify-a's org id>` is a P0 incident.
   - Alternative if the SQL Editor's impersonation does not support this cleanly: a small standalone script that does `signInWithPassword({verify-b creds})` then a bare-RLS `SELECT id, organization_id FROM <table>` via the anon key + that JWT. Server-side or operator-machine only.
4. **Cross-tenant write checks.** As `verify-b@...`, attempt:
   - `INSERT INTO clients (organization_id, ...) VALUES ('<verify-a's org id>', ...)` — expect RLS denial (zero rows inserted, error from PostgREST).
   - `UPDATE clients SET first_name = 'tampered' WHERE id = '<verify-a's client_id>'` — expect zero rows affected.
5. **Record the result** in `docs/runbooks/verify-cross-tenant-isolation.md` as a dated entry: date, who ran it, all checks pass / specific check failed.
6. **On any failure:** halt, treat as a P0 incident per `docs/incident-response.md`, do not proceed with any operation until the boundary is restored.

When the manual procedure retires:

- When pgTAP cross-tenant tests land (R-4 closure), this procedure downgrades to a quarterly check and eventually retires entirely. Recorded in the runbook header.

### What is **not** designed in A.1

Stated explicitly so step-6 follow-on tasks do not blur the boundary:

- The mechanism is not built. No code is in `src/`, no script in `scripts/`, no runbook file at `docs/runbooks/`.
- No dashboard setting has been changed; A.2 is the operator's task, not Claude Code's.
- The R-4 manual procedure is designed in this section but not executed; the runbook file capturing it will be written when the operator approves the design.
- The Supabase Management API path for G-4 is named as a candidate; whether to actually call it depends on the operator's verify-this-works check against the Management API reference, which is itself a separate task once A.1 is approved.

---

## A.1 (revised) — verification mechanism design

**Date:** 2026-05-21 (revision 1). **Authoritative** — supersedes the A.1 section above.
**Task scope:** design-and-propose only. No mechanism built, no Supabase project touched, no application code changed. Deliverable is this section plus the new open questions and the (unchanged) A.2 operator checklist in the chat report.

### Reviewer decisions folded in

- **Q1 (structural):** do not default to a permanent verification-bot account. Design **create-probe-destroy** (a disposable account per check run) as the preferred path for G-1. A permanent account is reconsidered only if create-probe-destroy is shown not to work, and if used, it is a never-logged-in service artifact (Admin-API-only, no reusable stored password).
- **Q2:** mechanism shape is an **on-demand script (B) + runbook (C)**, not an always-live endpoint (A). Server-side, service-role-using, never shipped to the browser.
- **Q3:** G-3 reuses the **same disposable-account pattern** as G-1; no separate permanent-seed `updateUser` path.
- **Q4:** G-4 is **documentation-only with cadence**; no Supabase Management API token added.
- **Q5:** production-config doc is a new file `docs/runbooks/verify-auth-config.md`.
- **Q6:** R-4 cross-tenant runbook is a new file `docs/runbooks/verify-cross-tenant-isolation.md`.
- **Q7:** re-verification cadence is **quarterly AND on every migration that touches RLS or auth** (the migration trigger is the one with teeth).
- **Q8:** prefer **Admin-API-created pre-confirmed users** (no mailbox needed); fall back to a subdomain of the Resend-verified `mail.odysseyhq.com.au` only if real email delivery is required; never a personal Gmail alias.

### Per-property assertability (verdicts unchanged from the original)

| Property | Verdict | One-line basis |
|---|---|---|
| **G-1** hook enabled | **Behaviourally assertable** | Issue a fresh JWT for a probe user that has a membership; decode; assert `organization_id` claim present. The genuine automated tripwire. |
| **G-3** HIBP enabled | **Probeable with caveats** | Front-door signup with a known-breached, length-valid password; assert rejection. |
| **G-7** confirmations enabled | **Partially assertable** | Front-door signup with a strong password; assert `data.session === null`. |
| **G-4** 30-day refresh token | **Documentation-only** | No observable consequence on a useful timescale; recorded value + re-verify cadence. |

### Mechanism shape: on-demand script + runbook (Q2)

- **Automatable checks (G-1, G-3, G-7):** a standalone TypeScript script — candidate `scripts/verify-auth-config.ts` — run on demand by the operator. It is **server-side only**: it reads `SUPABASE_SERVICE_ROLE_KEY` and the project URL/anon key from the local environment (operator machine) and is never part of the deployed Vercel bundle. Per CLAUDE.md code standards, service-role never reaches the browser; a script that only ever runs in a terminal satisfies this by construction.
- **Documentation-only property (G-4) + the human-readable description of all four + the R-4 procedure:** runbooks under `docs/runbooks/` (Q5, Q6).
- **Rejected:** the always-live `/api/health/auth-config` endpoint. Rationale recorded: an endpoint that can mint users and issue JWTs is standing attack surface on the public app and needs careful gating; an on-demand script has no standing exposure and fits a periodic two-person-beta cadence. The endpoint is over-built for the need.
- **Run location open question:** operator's machine vs CI. CI would need the production service-role key in CI secrets (more standing surface); operator-machine-only keeps the key local. Surfaced below.

### Create-probe-destroy disposable-account model (Q1, Q3)

The core of the revision. Each check run creates the minimum disposable identity it needs, asserts the property, and destroys it. Three probes share a teardown helper, but **the teardown weight differs sharply between G-1 and G-3/G-7** — that asymmetry is the most important new finding and is detailed below.

#### G-1 — create-probe-destroy (preferred design)

Per run, mirroring the real onboarding flow so the check exercises hook + RPC + refresh end-to-end:

1. `admin.createUser({ email: <ephemeral>, password: <random, discarded>, email_confirm: true })` → creates `auth.users` + (via `on_auth_user_created` trigger) a `user_profiles` row with `'Pending'/'Pending'`. **Verify-this-works:** that the pinned SDK supports `email_confirm: true` to mint a pre-confirmed user with no mailbox round-trip (Q8 dissolves for this account if so).
2. `signInWithPassword(<ephemeral creds>)` on a fresh client → JWT #1 (no `organization_id` claim — no membership yet). The sign-in is acceptable here precisely because the account is destroyed seconds later; the "never logged in" hardening is a property of the demoted *permanent* fallback, not the ephemeral path.
3. `rpc('create_organization_with_owner', {...})` on that authenticated client → creates the org + owner membership + seeds the five lookup tables. **Verify-this-works:** that the RPC succeeds for an Admin-API-created user (it should — `auth.uid()` resolves normally for a signed-in session — but confirm).
4. `refreshSession()` → JWT #2. The hook fires on this refresh; if enabled, JWT #2 carries `organization_id` + `user_role`.
5. **Assert:** decode JWT #2, assert `organization_id` is present and non-empty. **This is the G-1 tripwire.** A disabled hook produces JWT #2 with no claim → assertion fails → alarm.
6. **Teardown** (the heavy part — see below).

This variant is the closest to the reviewer's literal description ("onboard it via the `create_organization_with_owner` RPC … then `admin.deleteUser` it") and is the best end-to-end test. Its teardown is heavier than that phrasing implies.

#### G-3 — front-door breached-password probe

1. `supabase.auth.signUp({ email: <ephemeral>, password: <known-breached, ≥12 chars> })` via the anon-key front door (the path real users hit; **not** `admin.createUser`, which likely bypasses user-facing password policy — that bypass is itself a thing to **verify-this-works**, and is the reason the probe must use the front door).
2. **Assert:** the call is rejected with Supabase's leaked-password error. **Verify-this-works:** the exact error shape against the pinned SDK, and that a rejected signup creates **no** `auth.users` row (expected — HIBP blocks before creation).
3. **Teardown:** only needed in the failing case (HIBP off → a user got created). Then `admin.deleteUser` — light, because the user has no membership.

The known-breached password is **not hard-coded into this design note** — baking a real breached credential into the repo looks like a planted secret and would trip security scans. Selection criteria for the build task instead: a string ≥12 characters that is present in the HIBP corpus (confirm at build time against the HIBP range API or a current public top-passwords list). The script can read it from an env var so it never lands in git.

#### G-7 — front-door confirmation probe

1. `supabase.auth.signUp({ email: <ephemeral>, password: <strong random> })` via the front door.
2. **Assert:** `data.session === null` (confirmations on). A non-null session means confirmations are off → alarm. This matches the application's own branch at `src/app/signup/actions.ts:46-50`, but runs as an explicit cadence-able probe rather than relying on a real signup happening.
3. **Teardown:** a user got created (unconfirmed). `admin.deleteUser` — light, no membership.

#### Teardown — the load-bearing complexity (key new finding)

The reviewer's framing was "create … then `admin.deleteUser` it." For **G-3 and G-7 that holds** — those probe users have no membership, so `admin.deleteUser` cleanly cascades to `user_profiles` (FK `ON DELETE CASCADE`).

For **G-1 it does not hold.** `admin.deleteUser` alone fails, because of the schema's own integrity guards:

- `auth.users` → `user_profiles` is `ON DELETE CASCADE`, so deleting the auth user *attempts* to delete the profile.
- But `user_organization_roles.user_id` → `user_profiles` is `ON DELETE RESTRICT` (`supabase/migrations/20260420100200_identity_tables.sql:114`), so the profile delete is **blocked** while the owner membership row exists.
- The membership row can't simply be deleted either: `enforce_last_owner_invariant` (BEFORE DELETE trigger, `:148-150`) blocks removing the **last owner** of the org.
- And the org can't be deleted while the membership references it (`user_organization_roles.organization_id` → `organizations` is `ON DELETE RESTRICT`, `:115`), and the org now owns five seeded lookup-table rows (`movement_patterns`, `section_titles`, `exercise_metric_units`, `client_categories`, `vald_device_types`) from `seed_organization_defaults`.

So G-1 teardown must replicate the **existing service-role org-cleanup pattern** already recorded in project memory ("Service-role org cleanup pattern — surgical `DISABLE TRIGGER enforce_last_owner_invariant`, FK order leaf→root, `audit_log` between tenant deletes and `organizations`, `v_` prefix on locals"). Concretely, in service-role context, in order:

1. `DISABLE TRIGGER enforce_last_owner_invariant` on `user_organization_roles`.
2. Delete the temp org's `user_organization_roles` row(s).
3. Delete the five seeded lookup-table rows for the temp org (and any `audit_log` rows attributed to it, per the memory note's ordering).
4. Delete the `organizations` row.
5. `ENABLE TRIGGER` (restore).
6. `admin.deleteUser(<temp user id>)` → now cascades to `user_profiles` cleanly.

**Implication the reviewer should weigh:** G-1's create-probe-destroy runs a multi-step service-role delete — including temporarily disabling an integrity trigger — against the production database on every run. That is buildable, and the safety nets are known (a `try/finally` so teardown always runs; idempotent, re-runnable teardown; a pre-run scan that finds and cleans orphaned temp artifacts by naming convention; loud breadcrumb logging of the temp user/org ids so a half-failed teardown is recoverable by hand). But it is materially more than "delete the user," and a disabled-trigger window on production — however brief — is a real consideration. This fuller picture is exactly what the original permanent-account framing obscured and what the reviewer asked to see.

#### Lighter-teardown variants, surfaced for the reviewer (not picked)

Because the teardown is the cost centre, three variants trade test-fidelity against teardown weight. The design proceeds with **Variant 1 as the preferred create-probe-destroy** per Decision Q1, but surfaces the spectrum so the reviewer can confirm or adjust with full information:

| Variant | What it creates per run | What it tests | Teardown weight |
|---|---|---|---|
| **1 — Full ephemeral (preferred)** | temp user + org via the real RPC (seeded) + membership | hook **+ RPC + refresh**, end-to-end | Heavy: trigger-disable + leaf→root org cleanup + user delete |
| **2 — Minimal ephemeral** | temp user + org + membership via **direct service-role inserts** (no RPC, no seed) | hook only | Medium: trigger-disable + membership + org + user (no seeded-table cleanup) |
| **3 — Hybrid** | a **persistent, member-less verification org** (an inert tenant row, **not** a credential) + an ephemeral user added as owner per run | hook (+ RPC if the user self-onboards into a fresh org instead) | Light per run: trigger-disable + membership + user; the org persists |
| **4 — Permanent hardened (demoted fallback)** | a permanent never-logged-in user + org, Admin-API-accessed only | hook | None per run, but a **standing** (if never-logged-in) account exists — the thing Q1 pushed back on |

Variant 3's "persistent inert org" is a middle ground worth the reviewer's explicit attention: it removes the per-run org create/delete (lightening teardown to just the membership + user, still requiring the trigger-disable) while keeping **no permanent credential** — the org row has no members between runs and cannot be logged into. It reintroduces one permanent production artifact, but an inert one, not an authenticable owner account.

### G-4 — documentation-only, no Management API (Q4)

Recorded in `docs/runbooks/verify-auth-config.md` as: target value (refresh token max lifetime = 2592000 s / 30 days), where it lives in the dashboard, a screenshot template, and the re-verify cadence (Q7). No Management API token is added — adding a high-privilege credential to verify the lowest-stakes of the four properties is a poor trade. The script does **not** probe G-4.

### Runbook locations (Q5, Q6)

- `docs/runbooks/verify-auth-config.md` — production-config doc: the four target values, the script's usage, what each check asserts and cannot assert, the G-4 documentation entry, and the cadence. Not appended to `docs/secrets-inventory.md` (different concern).
- `docs/runbooks/verify-cross-tenant-isolation.md` — the R-4 manual procedure (below).

Both are written in A.3 (build), not now.

### Re-verification cadence (Q7)

Two triggers, recorded in both runbooks:

- **Time-based:** quarterly. Catches silent dashboard drift.
- **Event-based (the one with teeth):** on every migration that touches RLS policies, the JWT hook, the auth helpers, or `user_organization_roles` / `organizations` shape. Catches the change that actually moves the boundary.

### Test-account email (Q8)

Preferred: Admin-API-created **pre-confirmed** users (`email_confirm: true`), so the disposable account needs no deliverable mailbox — contingent on the verify-this-works in the G-1 design above. Ephemeral emails use a recognisable, non-deliverable convention (e.g. `verify-<timestamp>@verify.invalid` or a `+verify` label under a non-personal domain) so orphans are greppable. Fallback if real delivery proves necessary: a subdomain of the Resend-verified `mail.odysseyhq.com.au`. Never a personal Gmail alias.

### R-4 manual cross-tenant verification procedure (carried forward, unchanged)

The reviewer did not change the R-4 procedure design from the original A.1 section; it stands as designed there (two seed orgs, per-org synthetic data, cross-tenant SELECT/UPDATE checks as staff_B against the eight core tenant tables, P0 halt on any leak, run after A.3 + on every RLS/auth migration + before any second-practitioner account). It will be written to `docs/runbooks/verify-cross-tenant-isolation.md` in A.3. **Note the interaction:** the seed orgs/users this procedure needs overlap with what the G-1 probe creates and destroys — the build task should decide whether the cross-tenant runbook uses its own dedicated seed accounts (clearer, more standing artifacts) or piggybacks on the create-probe-destroy machinery (less standing footprint, more coupling). Surfaced below.

### New verify-this-works questions raised by the create-probe-destroy design

1. **`admin.createUser({ email_confirm: true })`** mints a usable pre-confirmed user on the pinned SDK version — confirm. If yes, the disposable account needs no mailbox and Q8 is largely moot.
2. **`create_organization_with_owner` succeeds for an Admin-API-created, signed-in user** — confirm `auth.uid()` resolves and the RPC's "already belongs" guard does not false-trip.
3. **`admin.deleteUser` does NOT fully clean up a user with an owner membership** — confirmed by schema inspection (the RESTRICT + last-owner-trigger chain above). The G-1 teardown must replicate the documented service-role org-cleanup pattern; this is the design's load-bearing complexity, not an afterthought.
4. **HIBP applies at the front-door `signUp` surface and rejects before creating a row** — confirm, plus the exact error shape (Supabase API drift risk per project memory).
5. **`admin.createUser` bypasses HIBP/password policy** — confirm; it is the reason G-3 must probe via the front door, not the admin path.
6. **Front-door signup rate limits** (30/hour/IP) are not tripped by ≤3 front-door calls per run at a quarterly + on-migration cadence — confirm, trivially within limits, but note for CI-triggered runs.

### What is not designed / done in A.1 (revised)

- No script, no runbook files, no application code — A.3 builds those after approval.
- No dashboard setting changed — A.2 is the operator's task.
- The R-4 procedure is designed (carried forward) but not run.
- The variant selection (1 vs 2 vs 3, with 4 demoted) is surfaced for the reviewer, not picked unilaterally — Variant 1 is the preferred default per Q1, pending the reviewer's reaction to the teardown-weight finding.

---

## A.1 resolution — buildable design (variant chosen + SDK/schema findings)

**Date:** 2026-05-21 (resolution). **Authoritative** — this is the buildable spec; it resolves the open questions left by "A.1 (revised)" above.
**Task scope:** read-and-resolve only. No mechanism built, no Supabase project touched, no application code changed. Findings below are from the actual schema/migrations and the pinned SDK in `node_modules`, not from assumption.

**Pinned SDK confirmed:** `@supabase/supabase-js` resolves to `2.103.3`, bundling `@supabase/auth-js@2.103.3` (`node_modules/@supabase/auth-js/package.json`). All SDK citations below are against that version.

### Reviewer decisions recorded

- **Variant 1 rejected.** Its per-run teardown requires temporarily disabling `enforce_last_owner_invariant` on production every run — the mechanism that verifies the security boundary would itself routinely lower a related guard. Refused. It also over-tests: it exercises the RPC and refresh, which are not the fragile silently-toggleable surface. The fragile surface is the hook alone.
- **Variant 4 (permanent account) stays rejected** per the prior decision.
- **Variant 3 selected** (persistent inert memberless org + ephemeral non-owner user) — schema evidence below. Variant 2 is recorded as an equally-light alternative the reviewer may switch to; the choice is genuinely balanced (see the engineering note).
- **Run location:** operator's machine only, never CI. CI would require a standing copy of the production service-role key (highest-privilege credential) in a third party. The quarterly + on-migration cadence is operator discipline, run by hand, not an automated gate.
- **R-4 cross-tenant procedure:** an independent, by-hand, ephemeral procedure using throwaway orgs/users created for the occasion and torn down after — not coupled to the create-probe-destroy script, not using permanent seed accounts. The steps are written into `docs/runbooks/verify-cross-tenant-isolation.md` when A.3 builds the runbooks; only the decision is recorded now.

### Variant decision — Variant 3, with schema evidence

The decision turned on one question: can the ephemeral user be attached as a **non-owner** member such that its later removal does **not** fire `enforce_last_owner_invariant` and does **not** require disabling any trigger? Answer from the real schema: **yes.**

1. **The trigger is role-gated to owners.** `prevent_last_owner_delete()` raises only inside `IF OLD.role = 'owner' AND (count of owners) <= 1` (`supabase/migrations/20260420100200_identity_tables.sql:133`). A membership with `role = 'staff'` never enters the IF block — the trigger returns `OLD` and the delete proceeds. **No trigger-disabling needed for a non-owner.**
2. **Post-delete cascade is clean.** `user_profiles.user_id → auth.users(id)` is `ON DELETE CASCADE` (`:73`); `user_organization_roles.user_id → user_profiles(user_id)` is `ON DELETE RESTRICT` (`:114`). Once the non-owner membership row is deleted (step 1), nothing references the profile, so `admin.deleteUser` cascades `auth.users → user_profiles` without hitting the RESTRICT. Clean.
3. **The hook injects `organization_id` for any membership regardless of role.** The fallback SELECT in `auth_hooks.custom_access_token` reads `organization_id, role::text FROM user_organization_roles WHERE user_id = … ORDER BY created_at LIMIT 1` with **no role filter** (`supabase/migrations/20260420100300_auth_helpers_and_jwt_hook.sql:93-100`). A `staff` membership therefore produces a JWT carrying `organization_id` — the G-1 assertion is valid for a non-owner probe user.

Because all three hold, the non-owner ephemeral membership tears down with simple leaf-to-root deletes and no trigger-disabling. Per the reviewer's resolved rule, **Variant 3 is selected.**

**Variant 3 mechanics (the buildable G-1 probe):**
- **One-time setup:** a single service-role `INSERT INTO organizations (name, slug, timezone)` creating a persistent **inert, memberless** verification org. Recognisable name (e.g. `[VERIFY] auth-config probe org — do not use`), recorded UUID stored in `docs/runbooks/verify-auth-config.md`. It is created by a direct INSERT, **not** via `create_organization_with_owner`, so it has no owner and no seeded lookup rows. Because no real user is ever a member, it is invisible to every RLS-scoped operator surface — it only appears in service-role/admin raw-table scans.
- **Per run:** (1) `admin.createUser({ email, password, email_confirm: true })` → ephemeral user + `user_profiles('Pending')` via the `on_auth_user_created` trigger; (2) service-role `INSERT INTO user_organization_roles (user_id, organization_id = <persistent org>, role = 'staff')`; (3) `signInWithPassword(<ephemeral creds>)` — the hook fires on issue and, because the membership already exists, the returned `access_token` already carries `organization_id` (no `refreshSession` needed); (4) decode the JWT payload (split on `.`, base64url-decode the middle segment — no JWT library required) and **assert `organization_id` is present and equals the persistent org**; (5) teardown: `DELETE` the membership (role `staff`, no trigger trip) then `admin.deleteUser(<ephemeral id>)`.
- **Safety nets for A.3:** wrap probe + teardown in `try/finally` so teardown always runs; a pre-run scan that finds and removes any orphaned membership on the known verification org (by the recognisable email convention) before creating a new one; loud breadcrumb logging of the ephemeral user id. Minor note: if `user_organization_roles` is in the audit-trigger set, the membership delete may write a benign `audit_log` row — harmless, arguably desirable as a probe-activity trace; A.3 should be aware but need not act on it.

**Engineering note (balanced, for reviewer awareness — not an override).** The same non-owner insight makes **Variant 2** (fully ephemeral, no persistent org) also light: a memberless, unseeded ephemeral org has no `BEFORE DELETE` trigger on `organizations` (only `validate_timezone` BEFORE INSERT/UPDATE and `touch_updated_at` BEFORE UPDATE exist in `identity_tables.sql`; **qualified** — A.3 should confirm no later migration added a `BEFORE DELETE` trigger or new RESTRICT FK to `organizations`), so it deletes cleanly once its single membership is removed. The V2-vs-V3 trade is now narrow and symmetric:
- **V3:** one documented inert standing org; orphan-on-failure is a stray membership on a *known* org (trivially spotted and cleaned).
- **V2:** zero standing footprint; orphan-on-failure is a stray empty org that *resembles a real (empty) tenant* until inspected.
Both are light and trigger-disable-free. V3 is recorded as chosen per the reviewer's rule and its standing artifact is inert and app-invisible; if the reviewer prefers strictly-zero standing footprint over a known-stable artifact, switching to V2 is a one-line change to this decision. Not overriding.

### Five verify-this-works questions — resolved

**Q1 — `admin.createUser({ email_confirm: true })` mints a usable pre-confirmed user: YES.**
`AdminUserAttributes.email_confirm?: boolean` (`node_modules/@supabase/auth-js/dist/module/lib/types.d.ts:429`); `createUser` remarks state "To confirm the user's email address … set `email_confirm` … default false" and give an explicit "Auto-confirm the user's email" example (`GoTrueAdminApi.d.ts:243-245, 299-305, 315`). The response carries `email_confirmed_at` when set. A pre-confirmed user can `signInWithPassword` immediately even though the project enforces `enable_confirmations`. **Consequence: the disposable account needs no real mailbox, so the Q8 test-domain question dissolves for the probe accounts.** Confidence: high from SDK; the actual round-trip is confirmed on the first A.3 run.

**Q2 — `create_organization_with_owner` succeeds for an Admin-created signed-in user: NOT APPLICABLE to the chosen variant.**
Variant 3 attaches the membership via a direct service-role INSERT and **bypasses the RPC entirely**, so this path is not exercised. The capability it would have relied on (an admin-created user can sign in and the hook fires for it) IS used and is covered by Q1. If a future variant re-introduces the RPC path, this question reactivates and needs a live check that `auth.uid()` resolves for the signed-in admin-created user and the "already belongs" guard does not false-trip — not verified here because the chosen design does not use it.

**Q3 — `admin.deleteUser` does NOT clean up a user holding an OWNER membership; the documented service-role org-cleanup pattern is required for an owner: CONFIRMED.**
For `OLD.role = 'owner'` as the last owner, `prevent_last_owner_delete()` raises (`identity_tables.sql:133-139`) — the membership cannot be deleted directly. The `ON DELETE RESTRICT` on `user_organization_roles.user_id → user_profiles` (`:114`) blocks `admin.deleteUser`'s `auth.users → user_profiles` cascade while the membership exists; the `ON DELETE RESTRICT` on `user_organization_roles.organization_id → organizations` (`:115`) blocks deleting the org while the membership exists; and the org owns five seeded lookup rows. So an owner teardown requires the documented pattern (disable `enforce_last_owner_invariant`, delete leaf→root, re-enable). **This is the finding that made Variant 1 heavy and drove the decision to a non-owner variant.** Confirmed explicitly from schema.

**Q4 — HIBP fires at front-door `signUp` and rejects; error shape: CONFIRMED (shape), live-confirmable (exact runtime behaviour).**
The SDK models a weak-password rejection as `AuthWeakPasswordError` carrying `reasons: WeakPasswordReasons[]` (`errors.d.ts:230-244`), where `WeakPasswordReasons = ["length", "characters", "pwned"]` (`types.d.ts:129`). `'pwned'` is the HIBP hit; a type guard `isAuthWeakPasswordError(error)` exists (`errors.d.ts:244`). **The G-3 probe is precise because of this:** choose a password that is length-valid (≥12, clearing `'length'`) and free of character-class problems (the project enforces no character classes per §12.1, clearing `'characters'`) — then the *only* reason it can be rejected is `'pwned'`. Assertion: `signUp` rejects with `AuthWeakPasswordError` whose `reasons.includes('pwned')` ⇒ HIBP on; `signUp` succeeds ⇒ HIBP off (the G-3 failure signal). Honest tails, none blocking: (a) that GoTrue returns this as a thrown error at `signUp` (vs the `weak_password` data field that `AuthResponsePassword` carries on the sign-in informational path) is high-confidence from the SDK type split but confirmed on the first A.3 run; (b) that a rejected `signUp` writes no `auth.users` row is the expected behaviour (password validated before insert) and A.3's failing-path teardown handles it defensively regardless; (c) the human-readable message is incidental — the stable contract is the error type + `reasons`.

**Q5 — `admin.createUser` bypasses HIBP/password policy: CONFIRMED by the SDK type model + API design; this is why G-3 probes the front door.**
`createUser` returns `UserResponse` with **no** `weak_password` field, whereas the front-door `signUp`/`signInWithPassword` return `AuthResponsePassword` which carries `weak_password?: WeakPassword | null` (`types.d.ts:175-179`). The SDK surfaces password-strength feedback only on the front-door paths, not the admin path; combined with `createUser` being a service-role-privileged endpoint, the admin path does not run the public password-strength middleware. **Consequence: G-3 must probe via front-door `signUp`, never `admin.createUser`.** Note this conclusion is robust even if a future GoTrue enforced HIBP on the admin path, because the front door is the surface real users actually hit — so the design does not depend on Q5's absolute truth, only on Q4 (front-door enforcement).

### Buildable status

**The design is buildable.** All five questions are resolved from SDK + schema. Two carry a "confirmed on the first A.3 run" tail that does **not** block the build, because the build's first probe is precisely what exercises them and the assertions are written against stable SDK contracts (`isAuthWeakPasswordError` + `reasons`, `email_confirm` attribute, the role-gated trigger predicate):
- Q4(a)/(b): exact signUp error-vs-field surface and no-row-on-reject — A.3 includes defensive failing-path cleanup regardless.
- Q5: whether admin createUser enforces HIBP — design does not depend on it (probes the front door).

The one item still genuinely open is the reviewer's confirmation of **Variant 3 vs the flagged Variant 2** — recorded as Variant 3 per the pre-committed rule, so A.3 can proceed on Variant 3 unless the reviewer switches. Nothing else blocks A.2 (operator sets dashboard values) or A.3 (build script + runbooks).

---

## Track A — dashboard-config verification: outcome (2026-05-21)

A.3 built `scripts/verify-auth-config.mjs` + `docs/runbooks/verify-auth-config.md` + `docs/runbooks/verify-cross-tenant-isolation.md` (Variant 3). The script was run against the live project in watched, operator-approved runs. Outcome per property:

- **G-1 (custom-access-token hook): GREEN — behaviourally verified.** A freshly-issued JWT for an ephemeral probe user carried `organization_id` + `user_role=staff`. The hook is enabled and injecting tenant scope; the catastrophic "hook disabled" case (premortem F-1 / R-1) is **ruled out**. Persistent inert verification org `483ca6b6-7d58-4618-b83e-22b8da9f857d` (memberless, app-invisible). Create-probe-destroy + teardown verified clean across runs (zero stray `verify-probe-*` users). This is the load-bearing property; it stands automated at the quarterly + on-migration cadence. **Closes G-1.**

- **G-4 (30-day session lifetime): deferred — Pro-gated.** Refresh-token max-lifetime configuration requires Supabase Pro; the project is on the free tier. Deferred-with-trigger: set and record the value on Pro upgrade, and at the latest before any paying clinical client (per CLAUDE.md Open gates). Documentation-only by design; not probed.

- **G-3 (HIBP) and G-7 (email confirmations): toggles set; behaviour pending one-off manual confirmation.** The operator set both dashboard toggles ON (2026-05-21). The automated front-door `signUp` probes are blocked on the free tier — `signUp` rejects throwaway recipient domains with `email_address_invalid` (stricter than the admin path: the **same** domain succeeded via `admin.createUser` in G-1 but failed via `signUp` in G-3), and it consumes a small rolling email rate limit (`over_email_send_rate_limit`). Per the approved decision (Option 1), G-3/G-7 are reclassified to documentation + one-off manual check (like G-4); procedures recorded in `verify-auth-config.md` "Free-tier status". **Honest status: toggles set, behaviour not yet verified** (the trust-nothing posture distinguishes "toggle set" from "behaviour confirmed"); the manual check is documented and pending operator execution. A cleaner unbuilt automation that sidesteps the email layer (G-7 via `email_confirm:false` + `signInWithPassword`→`email_not_confirmed`; G-3 via front-door `updateUser`) is noted there for future consideration.

**Net Track A:** G-1 closed (verified green, automated). G-3/G-7 toggles set with a documented manual verification pending. G-4 deferred (Pro-gated). Script, runbooks, and inert org in place. R-4 (manual cross-tenant procedure, `verify-cross-tenant-isolation.md`) is built but not yet run — a separate step, not part of this dashboard-config closure.


