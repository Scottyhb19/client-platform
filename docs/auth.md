# Authentication Design

**Project:** Client Platform — EP clinical + programming SaaS
**Version:** 0.1 (Gate 2 — awaiting IT-advisor review)
**Date:** 2026-04-20
**Status:** Design document. No auth code is written yet.

---

## 0. How to read this document

This document specifies how the platform authenticates users and how authenticated identity propagates into the database layer. It is the document that fixes the security model — if this is wrong, RLS cannot protect data.

Sections:
1. Non-negotiables
2. Identity provider
3. User types and the lifecycle of each
4. Session and JWT model
5. Flows (signup, invite, login, reset, logout, account deletion)
6. Multi-organization support (Phase 4 architecture note)
7. Rate limiting
8. MFA and high-privilege actions
9. Server-side role enforcement in Next.js
10. Forbidden patterns
11. Monitoring
12. Open questions

---

## 1. Non-negotiables

Fixed inputs, not decisions this document makes:

- **Supabase Auth** is the identity provider. We do not build password hashing, reset tokens, email verification, or OAuth. Supabase handles it.
- **Email + password** for v1. Magic link and SSO deferred.
- **Single active session per user at a time is NOT enforced.** Multi-device use is supported (EP on a desktop in the clinic + phone on the go).
- **JWT-signed sessions** with a custom claim carrying `organization_id` and `user_role` (see `/docs/schema.md` §5.5).
- **No password, no token, and no secret ever appears in git, in a URL, or in a client-side log.**
- **Service role key is server-only.** Never shipped to the browser. Any code that imports `SUPABASE_SERVICE_ROLE_KEY` lives under `app/api/` or inside a server action marked `'use server'`.

Everything below follows from these.

---

## 2. Identity provider — Supabase Auth

### 2.1 What Supabase Auth provides

- `auth.users` table — canonical identity. One row per human.
- Password hashing, reset flows, email verification.
- Session JWTs signed with the project's JWT secret.
- Admin APIs for inviting users, deleting users, listing users.
- Rate limiting on signup, signin, password-reset endpoints.
- Custom Access Token Hook — a Postgres function that runs at every JWT issue to inject custom claims.

### 2.2 What we build on top

- `public.user_profiles` — 1:1 mirror of `auth.users(id)` with profile fields (first name, last name, phone, avatar). FK target for business tables so that auth-user deletions do not cascade into our domain.
- `public.user_organization_roles` — membership join (who belongs to which org, with what role).
- Signup, invite, and role-management server actions — our domain code around Supabase's auth primitives.
- The Custom Access Token Hook function (`auth_hooks.custom_access_token`) — injects `organization_id` and `user_role` into every JWT.

### 2.3 What we do NOT build

- Password hashing.
- Email verification flow.
- Password reset token generation or email dispatch.
- OAuth or SSO integration (deferred — Phase 4 if demand emerges).
- CAPTCHA (Supabase's built-in rate limiting is sufficient for v1).

---

## 3. User types

Three logical user types, all mapped onto `auth.users`:

| Type | How created | Roles they hold | Capabilities |
|---|---|---|---|
| **Owner** | Self-signup via `/signup` | `owner` in exactly one org | All staff capabilities + invite staff + hard-delete organization |
| **Staff (non-owner)** | Invited by owner | `staff` in exactly one org (v1) | All clinical + programming actions within that org |
| **Client** | Invited by staff/owner | `client` in exactly one org (v1) | Own portal access — see own program, log sessions, book appointments |

In v1 every user belongs to exactly one organization. The schema supports multi-org membership for Phase 4; see §6.

Distinction between `owner` and `staff` is enforced by RLS and server-action checks. The roles are stored in `public.user_organization_roles.role`.

---

## 4. Session and JWT model

### 4.1 JWT contents

Every Supabase-issued access token carries:

| Claim | Source | Purpose |
|---|---|---|
| `sub` | `auth.users.id` | Identity (read as `auth.uid()` in RLS) |
| `email` | `auth.users.email` | Display + verification |
| `aud` | Supabase default | Audience guard |
| `exp` | Supabase default (1 hour) | Expiration |
| `iat`, `iss` | Supabase default | Standard |
| `role` | Supabase Auth role (`authenticated`, `anon`) | Postgres role selection |
| **`organization_id`** | Custom hook | Tenant scoping for RLS |
| **`user_role`** | Custom hook | Role gating (owner / staff / client) |

The two bolded claims are injected by our Custom Access Token Hook (`auth_hooks.custom_access_token`, full DDL in `/docs/schema.md` §5.5). Without them, every RLS policy fails closed — the system is safely inoperable rather than unsafely permissive.

### 4.2 Session lifetime

| Parameter | Value | Rationale |
|---|---|---|
| Access token lifetime | 1 hour | Default; short enough that a revoked membership takes effect within an hour |
| Refresh token lifetime | 30 days (rolling) | Staff on a clinic desktop want to not re-auth daily; clinical sensitivity balanced with ergonomics |
| Idle timeout (frontend) | 30 minutes for staff, 24 hours for clients | Staff portal auto-locks after inactivity; client portal tolerates longer idles because it is single-purpose and read-only-by-default |
| Absolute session cap | 30 days | After 30 days, even with activity, re-auth is required. Covers stolen-refresh-token risk. |

### 4.3 Refresh strategy

Supabase's client SDK handles refresh automatically:
1. On app load, `supabase.auth.getSession()` returns the current session if valid.
2. When the access token is within 60 seconds of expiry, the SDK silently uses the refresh token to get a new access token.
3. When the refresh token expires (30 days), the user is redirected to `/login`.

We do NOT implement our own refresh logic. We trust the SDK.

**Re-issuing a JWT when membership changes.** When staff invites a new client or the client accepts an invite, the server action calls `supabase.auth.admin.generateLink()` or similar to prompt the client's next JWT refresh. In practice, the next automatic refresh (within the next hour) picks up the new `organization_id` claim from the hook.

For edge cases where a user needs their claims updated *immediately* (e.g., after a role change), we call `supabase.auth.refreshSession()` client-side, which forces a refresh and re-runs the hook.

### 4.4 JWT verification

Every API route and server action verifies the JWT:

```ts
// app/api/**/route.ts — pattern
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  // RLS enforces the rest; the query builder uses the user's JWT automatically
}
```

`supabase.auth.getUser()` re-verifies the JWT signature against the auth server rather than trusting the cookie blindly. This is important because `supabase.auth.getSession()` does not re-verify; it reads from the cookie. For any code path that depends on the identity, use `getUser()`.

---

## 5. Flows

### 5.1 EP (owner) signup

Entry point: `/signup`.

1. User enters email + password + organization name + timezone.
2. Client calls `supabase.auth.signUp({ email, password })`.
3. Supabase creates `auth.users` row, sends a verification email.
4. Database trigger on `auth.users` inserts a corresponding `user_profiles` row (first name / last name captured separately in step 6).
5. User is signed in with a JWT that has NO `organization_id` yet — the hook returns no org because none exists for this user.
6. User lands on `/onboarding/org`, enters organization name and first/last name.
7. Client calls server action `createOrganizationWithOwner({ orgName, timezone, firstName, lastName })`.
8. Server action uses the service role to transactionally:
   - `INSERT INTO organizations (name, timezone)` returning id.
   - `INSERT INTO user_organization_roles (user_id, organization_id, role) VALUES (auth.uid(), <id>, 'owner')`.
   - `UPDATE user_profiles SET first_name = ..., last_name = ...`.
   - Seed default `movement_patterns`, `section_titles`, `client_categories`, `exercise_metric_units`, `vald_device_types` for this org.
9. Server action returns success; client calls `supabase.auth.refreshSession()` to pick up new claims.
10. User redirected to `/dashboard`.

**Why service role in step 8:** no `user_organization_roles` row exists yet, so RLS would deny the INSERT. The service role bypass is justified here: it is running inside a tightly-scoped server action that only does the bootstrap, cannot be called by arbitrary clients, and logs to `audit_log` before committing.

**Failure modes:**
- Verification email not delivered → Supabase resend flow.
- Organization name conflict (slug collision) → surface a 409 with a suggested alternative.
- Partial bootstrap (e.g., seeding fails after org is created) → transaction rolls back; the org is not created.

### 5.2 Staff invite (Phase 4 — deferred)

Not built in v1. Schema supports it via `user_organization_roles.role = 'staff'`. When built, it mirrors §5.3 except the role is `staff` and there is no `clients` row involved.

### 5.3 Client invite and acceptance

**Staff side (invite):**
1. Staff on `/clients` clicks "Invite client".
2. Modal captures first name, last name, email, DOB (optional), referral source.
3. Client calls server action `staffInviteClient({ email, firstName, lastName, ... })`.
4. Server action, as the authenticated staff user, uses normal RLS-scoped queries to:
   - `INSERT INTO clients (organization_id, email, first_name, ...) VALUES (...) RETURNING id` — allowed because RLS lets staff insert clients in their org.
   - Record `clients.invited_at = now()`.
5. Server action then uses the service role to call Supabase Auth admin API:
   - `supabase.auth.admin.inviteUserByEmail(email, { redirectTo: 'https://<host>/welcome?client_id=<id>' })`.
6. Supabase sends the invite email with a magic link.
7. Staff sees the client appear in the list with status "Invited".

**Client side (acceptance):**
1. Client receives an email: *"[EP name] has invited you to their practice. Click here to set up your account."*
2. Client clicks the link — Supabase verifies the one-time token, creates the `auth.users` row (the row did NOT exist before this moment), redirects to `/welcome?client_id=...`.
3. Client sets a password at `/welcome`.
4. Database trigger on `auth.users` inserts a `user_profiles` row.
5. Client calls server action `clientAcceptInvite({ clientId })`.
6. Server action (as service role):
   - Verify `auth.users.email === clients.email AND clients.organization_id = <from URL>`.
   - `UPDATE clients SET user_id = auth.uid(), onboarded_at = now() WHERE id = <clientId>`.
   - `INSERT INTO user_organization_roles (user_id, organization_id, role) VALUES (auth.uid(), <org>, 'client')`.
7. Client calls `supabase.auth.refreshSession()` — the hook now returns `organization_id` and `user_role='client'`.
8. Client redirected to `/portal`.

**Why service role in step 6:** the client does not yet have a `user_organization_roles` row, so RLS would deny them SELECTing their own `clients` row. The service role bypass is justified — it is a one-time linkage operation with a strict precondition (email match + organization match).

**Failure modes:**
- Email mismatch between invite and signup → abort; manual staff intervention.
- Client accepts invite after staff archives them → `clients.deleted_at` is set; server action refuses with "This invite is no longer valid."
- Invite link expired (Supabase default 24 hours) → staff resends via `/clients/:id` → "Resend invite".

### 5.4 Login

1. User on `/login` enters email + password.
2. Client calls `supabase.auth.signInWithPassword({ email, password })`.
3. Supabase verifies, issues JWT through the custom hook.
4. Client inspects `user_role` claim and redirects: `staff|owner` → `/dashboard`, `client` → `/portal`.

No custom server-side work on the login path. Supabase's rate limits (§7) are in effect.

### 5.5 Password reset

1. User on `/login` clicks "Forgot password".
2. Enters email, client calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: 'https://<host>/reset' })`.
3. Supabase sends a reset email with a one-time token.
4. User clicks link → lands on `/reset` with token in URL hash.
5. User enters new password; client calls `supabase.auth.updateUser({ password })` (authenticated by the one-time token).
6. Supabase updates the password hash, invalidates all existing refresh tokens, issues a fresh session.
7. User redirected to their role-appropriate home.

**No custom code needed.** Supabase handles tokenization, email, and hash rotation.

**Revocation side effect:** changing the password invalidates all refresh tokens — any other active sessions (other devices) are logged out at next access-token refresh (within 1 hour). This is the correct default.

### 5.6 Email change

Deferred to Phase 2. When added, it will use `supabase.auth.updateUser({ email })` with Supabase's built-in two-side verification (old address is notified; new address must confirm).

### 5.7 Logout

1. User clicks "Sign out".
2. Client calls `supabase.auth.signOut()`.
3. Supabase clears the session cookie and revokes the refresh token server-side.
4. User redirected to `/login`.

Logging out on one device does NOT log out other devices (by default). A "Sign out of all devices" button (deferred to Phase 2) would call `supabase.auth.admin.signOut(user.id, 'global')` via a server action.

### 5.8 Account deactivation

**Owner deactivating themselves.** Not permitted via UI in v1 — would orphan the organization. Must contact support (i.e., the operator). Enforced by UI gating; at the DB level, the `user_organization_roles` DELETE policy prevents removing the last `owner` row.

**Staff leaving a practice.** Owner clicks "Remove staff" on the user-management screen. Server action DELETES `user_organization_roles (user_id, organization_id)`. The `auth.users` row remains (Supabase-side) because the person may have memberships in other orgs (Phase 4). In v1 this means the person still has a Supabase account with no membership — they can log in but will see no organizations. That is acceptable.

**Client departing.** Staff clicks "Archive client". Server action:
- `UPDATE clients SET deleted_at = now(), last_activity_at = <computed>`.
- `DELETE FROM user_organization_roles WHERE user_id = clients.user_id AND organization_id = <org>`.
- Optionally Supabase `admin.signOut(user.id, 'global')` to end any live sessions.

Clinical record retained for the retention window.

**Full auth account deletion.** Only via a service-role admin procedure. Triggered by the 7-year retention purge (clients) or by support request. Documented in `/docs/incident-response.md`.

---

## 6. Multi-organization support (Phase 4 architecture note)

In v1, `user_organization_roles` has a unique constraint `(user_id, organization_id)` and the application asserts each user belongs to exactly one org. In Phase 4, the same table supports multi-membership trivially — no schema change.

The JWT carries exactly ONE `organization_id` at a time. "Switching org" (Phase 4) is a session-switch operation:

1. User on a role-picker UI selects the target org.
2. Client calls server action `switchActiveOrganization({ orgId })`.
3. Server action verifies the user has a `user_organization_roles` row for that org.
4. Server action sets a session metadata flag (Supabase's `raw_app_meta_data.active_organization_id`) on the user.
5. Custom access token hook reads `raw_app_meta_data.active_organization_id` preferentially over the default (first) membership.
6. Client calls `supabase.auth.refreshSession()` — the new JWT carries the new org.
7. RLS now operates within the new tenant scope.

**Do not encode the org switch in URL state.** A lost or malformed URL parameter must never change tenant scope — the scope lives in a signed, server-controlled claim.

> **Reversibility (multi-org → single-org): irrelevant.** The multi-org model is strictly more general; v1 chooses to not expose a UI for it.

---

## 7. Rate limiting

### 7.1 Supabase built-in limits

Supabase applies the following per-project rate limits to auth endpoints (configurable in the dashboard):

| Endpoint | Default | Our setting |
|---|---|---|
| Sign up | 30 per hour per IP | Keep default — v1 traffic is tiny |
| Sign in | 30 per hour per IP | Keep default |
| Password reset | 4 per hour per email | Keep default — matches industry norm |
| Magic link | 4 per hour per email | N/A in v1 (magic link not used) |
| Token refresh | 150 per 5 minutes per user | Keep default |
| Invite (admin API) | 10 per hour per IP | Keep default |

### 7.2 Application-level limits

We add our own limits on:

| Operation | Limit | Enforcement |
|---|---|---|
| `staffInviteClient` | 20 per hour per user | Server action checks a `rate_limit_log` table |
| `sendCommunication` (email/SMS) | 100 per hour per org | Server action + provider hard limit as backstop |
| `clientAcceptInvite` (brute force on client_id) | 10 failed per hour per IP | Server action |

Limits are tracked in a small `rate_limit_log(key, window_start, count)` table, not in Redis (see `/docs/schema.md` "No external cache layer in v1"). If the table grows, we partition by `window_start` monthly; Redis is considered only when Postgres can no longer cope.

### 7.3 What rate limits achieve and what they do not

Rate limits protect against:
- Password-guessing brute force.
- Abuse of the invite endpoint to spam client email addresses.
- Accidental infinite loops in the application.

Rate limits do NOT protect against:
- Credential stuffing from a botnet with thousands of IPs. (MFA is the counter — see §8.)
- Account takeover after credentials are phished. (MFA.)
- Insider abuse by a legitimate staff user. (Audit log + role separation.)

---

## 8. MFA and high-privilege actions

### 8.1 MFA posture in v1

- **Not required** for v1 because the solo-EP operator IS the admin; adding MFA friction for one user ships less value than shipping MFA when a real scale audience exists.
- **Available** via Supabase Auth's TOTP support. Any user can enable it from their profile settings.
- **Recommended** for owner accounts (in-app nudge on dashboard).

### 8.2 MFA plan for Phase 2

- `owner` role: MFA becomes required (enforced at login).
- `staff` role: MFA strongly recommended, not required.
- `client` role: MFA optional.

### 8.3 High-privilege actions (step-up auth)

Actions that trigger a step-up prompt (password re-entry, then MFA if enabled):
- Deleting the organization (owner only).
- Hard-deleting a client record.
- Bulk-exporting PHI (Phase 2).
- Changing one's own email.
- Disabling MFA.

Implementation: server actions for these operations check a `last_password_verified_at` timestamp stored in the user's session metadata. If older than 10 minutes, the action returns a 401 with a step-up challenge; the UI re-prompts for password, sets the timestamp, and retries.

---

## 9. Server-side role enforcement in Next.js

RLS is the security boundary, but we add a thin application-layer check for early UX feedback (fast failure with a clear message, rather than a cryptic empty result set from RLS).

### 9.1 Pattern

```ts
// lib/auth/require-role.ts
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { UserRole } from '@/types/db'

export async function requireRole(allowed: UserRole[]) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const role = user.app_metadata?.user_role as UserRole | undefined
  if (!role || !allowed.includes(role)) redirect('/unauthorized')

  return { user, role }
}
```

Every staff route calls `await requireRole(['owner', 'staff'])` at the top of its Server Component. Every client route calls `await requireRole(['client'])`. The middleware does NOT make this check (middleware is too blunt an instrument; it runs before data fetching and has limited context).

### 9.2 What this check does NOT guarantee

It catches the wrong-role case with a nice UX. It does NOT protect data — a compromised JWT or a bug that bypasses the check is still stopped by RLS. The check is a UX fence, not a wall.

### 9.3 Middleware

Only responsibility: redirect unauthenticated requests for protected routes to `/login`. It does NOT inspect roles. It does NOT inspect organization membership. That logic lives in Server Components / server actions.

```ts
// middleware.ts
export async function middleware(req: NextRequest) {
  const { supabase, response } = createMiddlewareClient(req)
  const { data: { user } } = await supabase.auth.getUser()

  const isProtected = req.nextUrl.pathname.startsWith('/dashboard')
                   || req.nextUrl.pathname.startsWith('/portal')
                   || req.nextUrl.pathname.startsWith('/api')

  if (isProtected && !user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  return response
}
```

---

## 10. Forbidden patterns

Patterns we never use. Each is listed with the reason, so the next engineer does not re-invent them.

| Forbidden | Why | Use instead |
|---|---|---|
| `organization_id` in URL path or query string | A URL parameter is user-controllable; routing tenants by URL makes the org boundary arbitrary | Derive from JWT claim (`auth.user_organization_id()`) |
| `user_role` read from request body | Same — user-controlled | Derive from JWT claim |
| Supabase service role key in any client-side bundle | Full RLS bypass from a browser is game over | Service role only in server actions / route handlers |
| Manual JWT parsing in application code (`jsonwebtoken`, `jose`) | Verification easy to get wrong; we already have `supabase.auth.getUser()` | Always use `supabase.auth.getUser()` |
| Trust `supabase.auth.getSession()` for identity decisions | `getSession()` reads the cookie without re-verification | `supabase.auth.getUser()` re-verifies against the auth server |
| Persisting a refresh token in localStorage | Vulnerable to XSS | HTTP-only cookies (Supabase default) |
| Custom password-strength rules bolted onto Supabase | Divergence from Supabase's flow means bugs | Supabase password policy configuration only |
| Writing our own "remember me" logic | Supabase refresh tokens do this | Use the SDK |
| Querying `auth.users` from application code | Auth schema is Supabase's; we never reach into it | Query `public.user_profiles` |
| Storing PHI in user_metadata or app_metadata | Supabase sometimes exposes these to the client | PHI lives in RLS-protected tables |

---

## 11. Monitoring

Metrics we emit from the auth path, to Sentry and to structured logs:

| Event | Fields | Alert |
|---|---|---|
| `auth.signup.success` | `user_id`, `organization_id` | — |
| `auth.signup.failure` | `reason` | >10/hour triggers investigation |
| `auth.login.success` | `user_id`, `role` | — |
| `auth.login.failure` | `email`, `reason` | >50/hour/IP triggers account lock |
| `auth.password_reset.requested` | `email` | — |
| `auth.password_reset.completed` | `user_id` | — |
| `auth.invite.sent` | `inviter_user_id`, `invitee_email`, `organization_id` | — |
| `auth.invite.accepted` | `user_id`, `client_id` | — |
| `auth.jwt.hook_failure` | `user_id`, `error` | Page immediately — every subsequent login would fail |
| `auth.cross_tenant_access_attempt` | `user_id`, `attempted_org`, `actual_org` | Page immediately — RLS violation or bug |

`auth.jwt.hook_failure` and `auth.cross_tenant_access_attempt` are S0 alerts. See `/docs/slos.md` and `/docs/incident-response.md`.

---

## 12. Open questions

### 12.1 Password policy

Supabase offers: minimum length, character-class requirements, breach check against Have I Been Pwned. What do we enforce?

**Recommendation:** minimum 12 characters, no character-class requirements (NIST 800-63B guidance), breach check enabled. Lean, modern, user-friendly. **Confirm or adjust.**

### 12.2 Email verification required before first login?

Supabase offers "require email confirmation before login" as a toggle. If on, an unverified user cannot log in at all.

**Recommendation:** ON for owners (self-signup), OFF for clients (staff-invited, email is verified implicitly by the magic-link click). Implementation: verification is enforced by the signup flow for self-signup; clients skip it by design. **Confirm.**

### 12.3 Session duration for client portal

30-day refresh tokens apply uniformly across user types today. Some platforms shorten client sessions (higher churn, less sticky logins on shared devices). **Confirm: same 30-day window for all roles, or shorter for clients?**

### 12.4 Invite link lifetime

Supabase defaults invite links to 24 hours. Clinical scheduling realities sometimes mean a client receives the invite on holiday. **Confirm default, or extend to 7 days?** If extended, we document the trade-off (longer window = larger exposure to stolen email).

### 12.5 MFA rollout

v1 skips MFA. Phase 2 requires it for owners. **Confirm timing: require MFA for owner at Phase 2 launch, or keep optional indefinitely until a specific incident forces the issue?**

---

## 13. Cross-references

- Data model / RLS: `/docs/schema.md`
- Per-table policies with SQL: `/docs/rls-policies.md`
- Availability SLOs (including login success rate): `/docs/slos.md`
- Breach response (compromised credentials, token theft): `/docs/incident-response.md`
