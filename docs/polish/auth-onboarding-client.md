# Auth and Onboarding (client) — gap list

**Polish-pass section:** 2 of the locked polish-pass order (foundation layer — client-side first contact).
**Active step:** 4 of 7. Audit + premortem + gap list written; awaiting reviewer approval in the claude.ai chat before any code is touched (step 5).
**Date opened:** 2026-05-28.
**Trust-nothing posture:** every "complete" claim was re-derived against the brief and the premortem failure modes. The 2026-05-15 diagnostic at `docs/diagnostic-auth-onboarding-tenancy.md` and the staff section closures (`docs/polish/auth-onboarding-staff.md`) were used as starting evidence, then re-verified line-by-line against the code at HEAD. Where the code wins the code is recorded; where the diagnostic still holds it is reaffirmed.

---

## Composite target brief — confirmed

- **Functional flow:** `docs/auth.md §5.3` (client invite + acceptance), `§5.4` (login), `§5.5` (password reset), `§5.7` (logout), `§5.8` (client archive). Authoritative for what client onboarding must do.
- **Quality bar:** CLAUDE.md design system and design philosophy. UX gaps traceable to §5.3–§5.8 or the design system are **Requirements**; UX improvements beyond them are **Recommendations** (labelled inline below).
- **Constraints:** master brief §7.1 (Privacy Act 1988, APPs, onshore-AU), §7.2 (retention), §7.4 (security); CLAUDE.md code standards (multi-tenant from commit one, RLS as security boundary, service-role server-only).
- **§12 resolutions, as they bind this section:**
  - **12.1 password policy:** 12-char min, no character classes, HIBP enabled. Enforced for clients at `src/app/welcome/_components/WelcomeForm.tsx:31-33` (client-side) and `src/app/welcome/actions.ts:31-33` (server-side); reset-password path enforces at `src/app/auth/reset-password/actions.ts:35`. HIBP enforcement at the `updateUser` path is a Supabase-behaviour question — see **C-7** below.
  - **12.2 email verification:** clients are pre-confirmed by `admin.generateLink({type: 'invite'})` at `src/app/(staff)/clients/new/actions.ts:164-167`, so the §5.3 path side-steps the §12.2 owner-side toggle. The retroactive concern (toggle drift in the dashboard) is the same dashboard-config concern as staff G-7 and is folded into the staff Track A workstream; no separate gap for clients.
  - **12.3 session duration:** 30-day refresh-token lifetime applies uniformly to all roles (Supabase dashboard setting; staff Track A G-4 documents). See **open question 1** below for whether to differentiate client session length.
  - **12.4 invite-link lifetime:** **8 hours** (operator decision 2026-05-28). Code already at 8h at `supabase/migrations/20260426100000_invite_tokens.sql:38`; the spec's "24h vs 7d" range is now settled in favour of the tighter end. The short window forces a fresh-invite habit during beta; the missing Resend-invite UI (**C-5**) is the operational compensation.
  - **12.5 MFA:** deferred to Phase 2 for clients. Absence is not a gap.
- **Scope decision 2026-05-28:** staff-side touchpoints that only matter because of clients are in scope for this section — specifically the missing Resend-invite UI on the client profile (**C-5**) and the missing session-revocation in `archiveClientAction` (**C-3**). These sit in staff-side files but are not staff-authentication concerns — neither touches staff sign-in, clinic creation, or staff identity. Both are client-onboarding-lifecycle steps (issuing or re-issuing a client's first credential; terminating a client's access), and this section owns that lifecycle end-to-end. They live here by correct ecosystem ownership, not because a closed staff section left them homeless.

---

## Audit — what was verified against the target

### §5.3 invite + acceptance — eight-step conformance scorecard

| §5.3 step | Target | Implementation | Status | Evidence |
|---|---|---|---|---|
| 1 (staff side) | Staff clicks "Invite client"; modal captures first name, last name, email, optional DOB, referral | Form at `/clients/new` collects these + optional `phone`, `category`, `referral_source`; the "send invite" checkbox is the trigger for the email path | ✓ | `src/app/(staff)/clients/new/page.tsx`, `src/app/(staff)/clients/new/actions.ts:27-265` |
| 2 (staff side) | Server action inserts `clients` row with RLS-scoped `organization_id` | `inviteClientAction` validates email shape, owner-as-client guard, cross-staff conflict; then RLS-scoped INSERT; 23505 duplicate handled | ✓ | `actions.ts:59-123` |
| 3 (staff side) | Service-role call to `admin.inviteUserByEmail` | Instead uses `admin.generateLink({type:'invite'})` → write `action_link` into `invite_tokens` table → send our own custom Resend email containing `/i/<token_id>` short URL. Anti-Gmail-prefetch design via migration `20260426100000_invite_tokens.sql`. Returning-client / orphan path falls back to `generateLink({type:'magiclink'})` | ✓ Conformant in spirit; the implementation supersedes the spec by adding the click-through gate and using a branded Resend template instead of Supabase's default | `actions.ts:141-261`, `src/lib/email/templates/client-invite.ts`, `src/app/i/[id]/page.tsx` |
| 4 (client side) | Client clicks link, Supabase verifies one-time token, creates `auth.users` row, redirects to `/welcome?client_id=...` | The link in the email points at `/i/<token_id>` (our gate). Gate renders a "One tap to continue" button (defeats prefetch). On real-human click, `window.location.assign(action_link)` fires the Supabase verify URL, which exchanges via `/auth/callback` and forwards to `/welcome?client_id=<id>` | ✓ | `src/app/i/[id]/page.tsx:73-87`, `src/app/i/[id]/_components/ContinueGate.tsx:16-35`, `src/app/auth/callback/route.ts:60-87` |
| 5 (client side) | Client sets a password at `/welcome` | `WelcomeForm` collects password + confirm; 12-char minimum enforced both client-side and server-side; uses `useActionState` to preserve form state across errors (matches staff G-14 convention) | ✓ | `src/app/welcome/page.tsx`, `src/app/welcome/_components/WelcomeForm.tsx`, `src/app/welcome/actions.ts:31-42` |
| 6 (DB) | Trigger on `auth.users` inserts `user_profiles` row | Same `handle_new_auth_user()` trigger as staff path; client profile starts with `('Pending','Pending')` and stays that way (the welcome flow does not collect first/last name — those came from the staff invite form already on the `clients` row, not on `user_profiles`) | ✓ Conformant with a subtle architectural quirk: the client's display name lives on `clients.first_name/last_name`, not on `user_profiles`. **Carry-forward observation:** if the platform ever surfaces `user_profiles.first_name` for a client (e.g. for cross-section components shared with staff), the name will read "Pending Pending". Today no client-facing surface reads it. Logged as **C-12** below. | `supabase/migrations/20260420100200_identity_tables.sql:89-106` |
| 7 (client side) | `client_accept_invite` RPC verifies email match, links `clients.user_id`, creates `user_organization_roles` 'client' row | RPC at `client_accept_invite(p_client_id uuid)`: SECURITY DEFINER, verifies `auth.uid()` not null, fetches caller email from `auth.users`, fetches `clients` row, verifies `clients.deleted_at IS NULL` ("This invitation has been revoked"), verifies `lower(client.email) == lower(caller_email)`, verifies `clients.user_id IS NULL OR user_id == caller_id` (idempotent re-accept), UPDATEs `clients.user_id` + `onboarded_at`, INSERTs role row with `ON CONFLICT DO NOTHING` | ✓ | `supabase/migrations/20260420102400_bootstrap_functions.sql:249-303` |
| 8 (client side) | Client calls `refreshSession()` to pick up `organization_id` + `user_role='client'` claims; redirected to `/portal` | Action calls `refreshSession()` then redirects to `/welcome/install`, which interstitials a PWA install for iOS/Android, an "open this on your phone" message for desktop, or auto-skips for already-standalone, and then lands at `/portal` | ✓ structurally. **F-1 / C-1 below** flags the failure-mode of an async refresh that doesn't write the new JWT back to the cookie — same shape as staff G-2. The intermediate `/welcome/install` step is not in §5.3 but is a defensible addition (PWA is the entire delivery posture); flagged as a positive deviation. | `src/app/welcome/actions.ts:64-85`, `src/app/welcome/install/_components/InstallScreen.tsx:22-127` |

**§5.3 verdict:** the eight-step flow is implemented end-to-end and the multi-tenant invariant holds. The implementation supersedes the spec at step 3 (custom branded email + click-through gate vs Supabase's default magic-link email) and step 8 (PWA install interstitial), both of which are defensible improvements. One real code gap: the unhandled `refreshSession()` failure at step 8 (**C-1**).

### §5.4 login conformance

`docs/auth.md §5.4 step 4`: *"Client inspects `user_role` claim and redirects: `staff|owner` → `/dashboard`, `client` → `/portal`."*

Code at `src/app/login/actions.ts:29` redirects to `safeNext(next)` where `next` defaults to `/dashboard` at `src/app/login/page.tsx:15`. **Non-conformant.** A client signing in via `/login` directly — e.g. after completing the password-reset terminal which hard-codes `redirect('/dashboard')` at `src/app/auth/reset-password/actions.ts:95` — lands at `/dashboard`, hits the staff layout's `requireRole(['owner','staff'])` (`src/app/(staff)/layout.tsx`), and bounces to `/unauthorized`. Becomes **C-4**.

### §5.5 password reset

Built per staff G-5 closure (commits `a045e53` + `1152df8`). Three-page flow:

- `/forgot-password` mints a `password_recovery_tickets` row (1h TTL; service-role insert, no RLS exposure), calls `resetPasswordForEmail`, redirects to a single non-enumerating "if an account exists" terminal regardless of email validity.
- `/auth/callback?next=/auth/reset-password&ticket=<id>` exchanges the recovery code AND forwards the ticket as a separate query param (Gate-2 wiring; the ticket survives the callback regardless of which Supabase flow path fires).
- `/auth/reset-password` requires session + ticket presence to render the form; the action atomically `consume_recovery_ticket(p_ticket_id)` BEFORE `updateUser({password})`. Consume binds the ticket's email to `auth.uid()`'s `auth.users` email inside one UPDATE statement — a session-foothold attacker without a ticket whose email matches their session is refused at the consume call. Single-use enforced server-side.

**No role gating on the reset flow.** Clients can use it identically. **Soft observation:** `docs/auth.md §5.5 step 2` says the redirectTo is `https://<host>/reset` — code uses `/auth/reset-password`. Documentation drift, carried to **P-D** documentation-sync flags below. The final redirect at `auth/reset-password/actions.ts:95` is `/dashboard` — same client-bounce problem as C-4; closing C-4's role-aware logic must cover this surface too.

### §5.7 logout

Staff `logout()` at `src/app/login/actions.ts:32-36` calls `supabase.auth.signOut()` and redirects to `/`. **Audit gap:** the client portal layout was traced but the `BottomNav` component was not deep-read — whether the client has any sign-out affordance is unverified. Becomes **C-8** below, with a "verify-this-works" caveat at the head.

### §5.8 client archive

`archiveClientAction` at `src/app/(staff)/clients/[id]/actions.ts:26-65` calls `soft_delete_client` RPC which sets `clients.deleted_at = now()` + `archived_at` + removes the `user_organization_roles` row (per `soft_delete_client` migration `20260429120000` per the project memory `soft-delete-rls-gotcha`). It does **NOT** call `supabase.auth.admin.signOut(user_id, 'global')`.

Doc §5.8 step 4 says "Optionally Supabase admin.signOut(user.id, 'global')" — the 2026-05-28 scope decision promotes "optional" to "required" for this section. Until then, an archived client retains portal access for ≤1h (access-token TTL), at which point RLS denies because the role row is gone but they could still read whatever they cached in-memory. Becomes **C-3**.

### Invite landing gate (`/i/[id]`)

- Service-role lookup via `createSupabaseServiceRoleClient()`; `invite_tokens` RLS denies ALL access to `authenticated` (four explicit deny policies in migration `20260426100000_invite_tokens.sql:67-78`).
- UUID-shape pre-check at `src/app/i/[id]/page.tsx:37` before any query.
- `consumed_at` reserved (migration line 39-42: "Reserved for a future 'burn on click' pass"); never written in code. Single-use enforced only by 8h expiry + Supabase's underlying token-exchange single-use on `action_link`. Becomes **C-11** (recommendation; the existing defence is sufficient but the reserved field is misleading reading).
- `ContinueGate` uses `window.location.assign(actionLink)` not `<a href>` — prefetcher-safe by design.

### Welcome / accept flow

- Welcome page short-circuits already-linked clients → `/portal` (idempotent re-entry).
- Welcome page "no user" redirect at `src/app/welcome/page.tsx:35` sends to `/login?error=Invite+link+expired` — misattributes any unauth state to invite expiry. Becomes **C-2**.
- WelcomeForm uses `useActionState` and `defaultValue` to preserve form state on validation errors (matches the staff G-14 convention; same pattern was applied here without a separate gap).
- `setPasswordAndAcceptAction` runs three steps: `updateUser({password})` → `client_accept_invite` RPC → `refreshSession()`. The third step's failure is unhandled (`actions.ts:78` calls `await ... refreshSession()` and discards the return). Becomes **C-1** (P0; same shape as staff G-2).
- Error messages from `client_accept_invite` are surfaced raw to the user: `Couldn't link your account: ${acceptErr.message}`. The five RPC failure modes ("Not authenticated", "Client record not found", "This invitation has been revoked", "Email mismatch between invite and authenticated user", "This invitation has already been accepted by another user") reach the user verbatim — some are humane, some are not. Becomes **C-13** (recommendation).

### PWA install interstitial

- iOS / Android / desktop / standalone branches all implemented; standalone auto-bounces to `/portal`.
- "Skip — open in browser" affordance always present (`InstallScreen.tsx:110-125`) — confirmed working as designed; never forces install.
- The `beforeinstallprompt` capture + `appinstalled` backstop both wired; covers the Samsung Internet quirk noted in the source comments.

### First-touch `/portal`

- `portal/layout.tsx` routing: owner/staff → `/dashboard`, non-client → `/unauthorized`, no clients row → `/welcome`. Correct for all three branches.
- `/portal/page.tsx` renders `DayScreen`; empty state and "first-day client" render identically. No first-run signpost. Becomes **C-9** (operator decision 2026-05-28 = build distinct first-run welcome card).

### Login

- LoginForm preserves email across errors via `useActionState` + `defaultValue={state.email}` (staff G-14 closure visible here).
- `ResendConfirmationButton` appears when `shownError === 'Email not confirmed' && state.email !== ''` — closes the "client somehow ends up at /login with an unconfirmed account" edge case.
- "Forgot password?" link points at `/forgot-password` (no longer the dead `/login` self-link the diagnostic flagged).
- Post-success redirect: see C-4 above.

### Resend-invite UI on staff client profile

Confirmed missing on 2026-05-28 re-audit. The diagnostic Section 2 finding still holds; nothing has been added. Five error strings in `inviteClientAction` (`src/app/(staff)/clients/new/actions.ts:184, 192, 217, 257`) tell the EP "You can resend from the client profile" — no such control exists at `src/app/(staff)/clients/[id]/_components/ClientProfile.tsx` (grep across the staff/clients tree returns zero matches for "Resend", "Re-send" excluding the false-positive comment about archived-email being "re-invited later"). Becomes **C-5**.

### Site-URL handling

Confirmed at three call sites: `getPublicOrigin()` is used in `signup/actions.ts`, `forgot-password/actions.ts:21`, AND `inviteClientAction` at line 148 (with an explicit comment naming the staff G-11 closure). The header-trust sibling concern (Section 4 of the diagnostic) is closed for the auth/onboarding code path. The remaining call site noted by the diagnostic — `src/app/portal/book/new/actions.ts:137` reading `NEXT_PUBLIC_APP_URL` — is **out of section** here (booking, not onboarding) and remains for a future booking polish.

---

## Premortem

### Forward-looking (friends-and-family beta scope)

Ranked by likelihood × impact. Infrastructure/security items weighted production-grade; UX/workflow items weighted friends-and-family.

| # | Failure mode | Likelihood × Impact | Closed by gap |
|---|---|---|---|
| **F-1** | `refreshSession()` failure in `setPasswordAndAcceptAction` leaves the client linked-but-JWT-stale. `client_accept_invite` succeeded — clients.user_id is set, role row exists — but the JWT they hold does NOT carry `user_role='client'`. They redirect to `/welcome/install` and then `/portal`; portal layout calls `rpc('user_role')` which reads the JWT claim, sees null, bounces to `/unauthorized`. No recovery affordance beyond logout + sign back in. Same shape as staff G-2. | Low × High | **C-1** |
| **F-2** | Welcome "no user" redirect copy ("Invite link expired") misattributes any unauth state — cleared cookies, expired callback session, direct visit, opened-old-tab — to invite expiry. EP is asked to resend an invite that wasn't actually expired; client is told the wrong thing. | Medium × Low | **C-2** |
| **F-3** | Archived client retains portal access for up to 1 hour (access-token TTL) because `archiveClientAction` doesn't call `admin.signOut(user_id, 'global')`. Window for a departing client to read their own clinical_notes / programs / sessions one last time. RLS shuts them out at next refresh, but the window is real. | Low × Medium | **C-3** |
| **F-4** | Client signs in via `/login` directly — typically through the password-reset terminal which hard-codes `/dashboard` redirect at `auth/reset-password/actions.ts:95` — lands on `/dashboard`, gets bounced to `/unauthorized`. Confusing dead-end. | Medium × Medium | **C-4** |
| **F-5** | Client's 8h invite token expires before they click. EP has no UI to resend. Only workarounds: archive the client and re-create (which requires re-entering name+email and re-issuing the email), or manual SQL. Operational pain compounded by the 8h decision. | High × Medium | **C-5** |
| **F-6** | `client_accept_invite` has no application-layer rate-limit per `docs/auth.md §7.2`. An attacker who guesses a `client_id` UUID + has a session matching the target's email could spam the RPC. The email-match gate at RPC line 278 means full attack requires both — narrow surface — but the §7.2 promise is unkept. | Low × Medium | **C-6** |
| **F-7** | A freshly-onboarded client installs the PWA, lands at `/portal`, sees an empty state identical to a returning client whose EP has paused. No sense of "what comes next." Disengages before the first session. | Medium × Medium | **C-9** |
| **F-8** | Client picks an 11-character password at `/welcome`, gets rejected, retries. Friction during the most fragile moment of their onboarding. The hint exists in the password field, but the email could have prepared them. | Medium × Low | **C-10** |
| **F-9** | `invite_tokens.consumed_at` is never written. If `/i/[id]` is rendered twice (browser refresh after a half-loaded gate, double-tap of the email link), nothing burns the token before Supabase's own single-use enforcement on token exchange. Supabase IS the single-use gate today; the existing defence is sufficient but the reserved field is misleading. | Low × Low | **C-11** |
| **F-10** | HIBP breach check at password-update time (welcome's `updateUser` AND reset-password's `updateUser`) requires Supabase to enforce HIBP at update, not only at signup. Staff Track A G-3's probe covers signup. Whether HIBP applies to updateUser is a Supabase-behaviour question that the client section depends on. | Medium × High | **C-7** (overlaps Track A) |
| **F-11** | `user_profiles` row for a client stays at `('Pending','Pending')` indefinitely because the welcome flow does not update it (the client's name lives on `clients.first_name/last_name`). Today no client-facing surface reads `user_profiles.first_name`; if one ever does (a shared component used by both staff and client portals), every client renders as "Pending". | Low × Low | **C-12** |
| **F-12** | `client_accept_invite` RPC's five raw error messages reach the user verbatim. "This invitation has already been accepted by another user" reads as accusatory; "Email mismatch between invite and authenticated user" reads as a system error rather than a "you might be signed in as the wrong account" affordance. | Low × Low | **C-13** |
| **F-13** | The client portal has no sign-out affordance visible without deep-tracing `BottomNav`. **Verify this works** before promoting; if absent, the client cannot sign out short of clearing cookies — a real bug. | Verify-then-rank | **C-8** (rank deferred to verification) |

### Retroactive (already-built sections that depend on client auth)

Hypothesis-driven, per the prompt scope. The dependent sections — every `/portal/*` page including `/portal/session`, `/portal/book`, `/portal/reports`, `/portal/you`, messaging — all sit on top of `portal/layout.tsx`'s `role === 'client'` check, which depends on `user_role` being present in the JWT, which depends on the Custom Access Token Hook being enabled.

**R-1 (inherits staff R-1):** the Custom Access Token Hook is the load-bearing dependency for both staff and client multi-tenant boundaries. The hook fires for all roles or for none. The staff Track A workstream's verification mechanism (script + runbooks at `docs/runbooks/verify-auth-config.md` and `docs/runbooks/verify-cross-tenant-isolation.md` per the revised A.1 design) covers both. **No new gap** — the client section inherits Track A's closure as its retroactive closure.

**R-2:** HIBP applies to `updateUser`, not only `signUp`. The welcome flow's `updateUser` is where a client picks their first real password, and the reset-password flow's `updateUser` is the recovery path. Staff Track A G-3 probes the signup path only. **Becomes C-7** — extend Track A's probe with an `updateUser` variant.

**R-3:** `client_accept_invite` is SECURITY DEFINER. If a future RLS change to `user_organization_roles` allows authenticated-context inserts, the RPC's `ON CONFLICT DO NOTHING` is the only guard against a client signing themselves into a role they didn't have. Today the RLS denies authenticated inserts per the diagnostic Section 3. No new gap; documented here as a constraint to remember for any future RLS change touching `user_organization_roles`.

**R-4 (inherits staff R-4):** the cross-tenant pgTAP test is deferred until a second human practitioner exists. The staff Track A manual procedure (`docs/runbooks/verify-cross-tenant-isolation.md`) is the interim tripwire; a client JWT's RLS scope is the same shape as a staff JWT's, so the manual procedure covers client paths trivially (the operator runs the same script signed in as `verify-b@...` regardless of role). **No new gap** — closure inherits.

**R-5:** the welcome flow's three-step partial-completion failure modes (step 1 succeeds, step 2 fails → client has a new password but no linked clients row; step 2 succeeds, step 3 fails → C-1) are not enumerated as separate gaps but are sub-cases of C-1. The fix for C-1 should handle both: detect "membership exists but JWT claim absent" AND "password set but membership absent." The latter manifests at next `/login` as a user who can sign in but lands on `/unauthorized` for lack of a role row.

---

## Gap list

Severity grouping: **P0** architectural and security · **P1** functional · **P2** polish. Each gap names the premortem failure mode(s) it closes, labels UX items as **Requirement** (traceable to §5.3–§5.8 or design system) or **Recommendation** (beyond them), and flags retroactive items that implicate completed sections.

### P0 — architectural and security

**C-1 — `refreshSession()` failure in `setPasswordAndAcceptAction` has no detection or recovery path.** Closes F-1 / R-5. **Mirror of staff G-2 for the client lifecycle.**

The action at `src/app/welcome/actions.ts:78` calls `await supabase.auth.refreshSession()` and discards the return. If it fails after `client_accept_invite` succeeded, the client now has a fresh password, a linked `clients.user_id`, and a `user_organization_roles` 'client' row, but a JWT that does NOT carry `user_role='client'`. They redirect through `/welcome/install` → `/portal`; portal layout's `rpc('user_role')` returns NULL → redirects to `/unauthorized`. No recovery affordance beyond logging out and signing back in (which they may not realise is the fix).

Closing this likely means: (i) after `client_accept_invite` succeeds, detect "membership row exists but JWT claim is absent" by reading `user_organization_roles` directly (not via the helper that reads the JWT) and, if found, surface a "Finishing setup..." state that auto-triggers `refreshSession()` once and a "Sign out and sign back in to finish" fallback link if it fails twice; (ii) cover the R-5 sub-case where step 1 (password set) succeeds but step 2 (membership) fails — currently the user can sign in next time but lands on `/unauthorized`. Make `/unauthorized` for a no-role-row user link to `/welcome?client_id=...` if a `clients` row exists with their email but no `user_id`. **Verify this works:** does Next.js 16's middleware refresh on the FIRST request after `/welcome/install` reliably re-issue a JWT through the hook? If so, the lockout window is bounded and the fix is narrower.

**Requirement** (traceable to §5.3 step 7 — `refreshSession()` is named in the flow as a necessary step, and its failure mode is not handled).

**C-2 — `/welcome` "no user" redirect misattributes any unauth state to invite expiry.** Closes F-2.

`src/app/welcome/page.tsx:35` redirects unauthenticated visitors to `/login?error=Invite+link+expired`. The user might have arrived from: cleared cookies between the gate and welcome, a tab reopened after a long lunch, a direct paste of `/welcome` into the URL bar, or — only sometimes — an actually-expired invite session. The "expired invite" copy sends the EP and client down the wrong recovery path (re-issuing an invite that wasn't actually broken).

Closing this: distinguish "expired invite-derived session" from "no session at all". The most honest copy is something like "Sign in to continue" with no implied diagnosis. If the URL has a `client_id`, the message can be more specific — "We couldn't read your invite session — ask your practitioner to resend the invite link" — because in that case the most likely cause IS a session loss. If there's no `client_id`, the redirect should be to `/login` plain (no `?error=` query) — the user just needs to sign in.

**Requirement** (traceable to design-system voice: "reason codes are factual, not dramatised").

**C-3 — `archiveClientAction` does not revoke active client sessions.** Closes F-3.

`src/app/(staff)/clients/[id]/actions.ts:50-65` calls `soft_delete_client` and revalidates paths. It does NOT call `supabase.auth.admin.signOut(user_id, 'global')`. An archived client retains portal access until their access-token TTL expires (≤1h), then RLS denies because the role row is gone.

Closing this: in `archiveClientAction`, fetch the client's `user_id` from the `clients` row BEFORE the `soft_delete_client` RPC runs (the RPC removes the role row but leaves `clients.user_id` populated for the retention window — verify this against the RPC body). After `soft_delete_client` succeeds, call `supabase.auth.admin.signOut(user_id, 'global')` via the service-role client. Soft-fail on the signOut (the archive already happened; logging an error to the server console is enough for the friends-and-family scope). The service-role client is already used elsewhere in the staff invite path — same surface, same posture per CLAUDE.md.

**Requirement** (per 2026-05-28 scope decision; doc §5.8 currently says "optionally", which closing C-3 promotes to required — see P-F documentation-sync flag).

### P1 — functional

**C-4 — `/login` post-success redirect is not role-aware.** Closes F-4.

`src/app/login/actions.ts:29` redirects to `safeNext(next)` where `next` defaults to `/dashboard` at `src/app/login/page.tsx:15`. A client signing in directly — either cold or as the terminal of `auth/reset-password/actions.ts:95` which also hard-codes `redirect('/dashboard')` — lands on `/dashboard`, hits the staff layout's `requireRole(['owner','staff'])` and bounces to `/unauthorized`. Same fix is needed in both files.

Closing this — operator decision 2026-05-28 = **server-side role-aware redirect**: in `login()` action, after `signInWithPassword` succeeds, call `supabase.rpc('user_role')` and redirect: `client` → `/portal`, `owner|staff` → the validated `safeNext(next)` or `/dashboard`. Same logic applied to `setNewPassword` in `auth/reset-password/actions.ts`. **Verify this works:** `user_role` RPC reads from the JWT claim, which depends on the Custom Access Token Hook (R-1). Behaviour when the hook is disabled: `user_role` returns NULL → pick a safer-on-failure default (`/login?error=...` and surface a meaningful message rather than silently bouncing).

**Requirement** (traceable to docs/auth.md §5.4 step 4 — role-based redirect is explicit in the spec).

**Verification note (2026-06-07).** `postAuthLanding` in `src/lib/auth/post-auth-landing.ts` is verified by exhaustive reading at landing because it is a pure total function over the `UserRole | null` domain — four cases (`'client'`, `'owner'`, `'staff'`, `null`), all branches reachable from the type, no I/O, no awaits, no side effects, with a single delegation to `safeNext` on the staff/owner branch. An automated unit test is deferred pending a TypeScript test runner being added to the repo (no `jest`, `vitest`, `node --test`, or equivalent is currently configured; the install + scripts + lint-config + CI wiring is scope outside C-4 and tracked separately). The five test cases to port when a runner lands: (1) `role = 'client'` with any `next` returns `/portal` and ignores `next` entirely; (2) `role = 'owner'` with `next = '/dashboard'` returns `/dashboard`; (3) `role = 'staff'` with `next = '/dashboard/reports'` returns `/dashboard/reports`; (4) `role = null` returns `/portal`; (5) `role = 'owner'` with a malicious `next` (protocol-relative `'//evil.com'` or absolute `'https://evil.com'`) returns `/dashboard` via `safeNext`'s fallback, proving the helper does not bypass open-redirect protection. The `role as UserRole | null` cast at both call sites (`src/app/login/actions.ts` and `src/app/auth/reset-password/actions.ts`) is sound only while the SQL `user_role()` function stays constrained to the `'owner' | 'staff' | 'client'` enum — widening that SQL function without widening `UserRole` in `src/lib/auth/require-role.ts` would silently mis-route any new role string through `postAuthLanding`'s null branch to `/portal` with no type error; any future change touching `user_role()`'s return domain must be paired with a `UserRole` widening in the same change.

**C-5 — No "Resend invite" UI on staff client profile.** Closes F-5.

Five error strings in `src/app/(staff)/clients/new/actions.ts:184, 192, 217, 257` tell the EP "You can resend from the client profile" — no such control exists at `src/app/(staff)/clients/[id]/_components/ClientProfile.tsx` (grep returns zero matches). With invite TTL fixed at 8 hours (operator decision 2026-05-28), the practical "client missed the window" rate is non-trivial during a friends-and-family beta where testers may not check email within a workday.

Closing this — surface a "Resend invite" button on `/clients/[id]` when both conditions hold: (a) `clients.user_id IS NULL` (not yet onboarded), and (b) `clients.invited_at IS NOT NULL` (the EP previously opted to send). Action extracts the `admin.generateLink → magiclink-fallback → invite_tokens insert → sendClientInviteEmail` block from `inviteClientAction` into a shared helper, then calls it. Update `clients.invited_at` on success (so the "Last invite sent" timestamp is fresh). Show a "Last invite sent: 9 days ago" hint above the button so the EP knows whether a resend is appropriate. Audit-log entry per resend (uses the existing `audit_log` table; no new table needed).

**Requirement** (per 2026-05-28 scope decision; gap visible to the EP from day one and compounded by the 8h TTL decision).

**C-6 — No application-layer rate limit on `client_accept_invite`.** Closes F-6.

`docs/auth.md §7.2` specifies "clientAcceptInvite — 10 failed per hour per IP" with enforcement via a `rate_limit_log` table. The table doesn't exist; no enforcement anywhere; the same gap applies to `staffInviteClient` and `sendCommunication` which are also unbuilt. The attack surface is narrow because the RPC's `lower(client.email) <> lower(caller_email)` gate at `supabase/migrations/20260420102400_bootstrap_functions.sql:278` means a successful brute-force requires both a session matching the target's email AND a guessed `client_id` UUID. Realistic threat: a leaked `client_id` from a chat-log screenshot or referrer leak.

Closing this — see **open question 2** below for whether to build `rate_limit_log` now (closes the §7.2 promise for all three operations at once, paves the way for `staffInviteClient` and `sendCommunication`) or defer to a "rate-limit infrastructure" sweep. The build is one migration + one helper function + the three call sites; not large, but bigger than this section if all three are bundled.

**Requirement** at the production-grade-security level (traceable to §7.2). Operator confirms scope.

**C-7 — HIBP breach-check coverage on `updateUser` paths.** Closes F-10 / R-2. **Overlaps staff Track A G-3.**

Staff Track A G-3's probe (designed in `docs/polish/auth-onboarding-staff.md §A.1 revised`) tests the signup path: `signUp({ email, password: <known-breached> })` expects rejection. The client section's two password-write surfaces are `supabase.auth.updateUser({password})` in `welcome/actions.ts:58` and `auth/reset-password/actions.ts:82`. Whether HIBP enforces against `updateUser` as well as `signUp` is a **Supabase behaviour question, not a code question** — needs verification once Track A's script exists.

Closing this: extend Track A's `scripts/verify-auth-config.ts` (or its successor) with an `updateUser` probe variant. Concrete shape: create-disposable-account via `admin.createUser` (pre-confirmed), sign-in, attempt `updateUser({password: <known-breached>})`, assert rejection, `admin.deleteUser`. If HIBP doesn't apply to `updateUser`, the gap is fundamentally unfixable on the application side and the runbook records "Supabase limitation; document the recovery-flow risk" with a recommendation to file a Supabase support ticket asking for `updateUser` to share the signup policy.

**Requirement** at the production-grade-security level. Operator decision required on whether to wait for Track A to land before opening this (likely yes — the script doesn't exist yet).

### P2 — polish

**C-8 — Verify and surface a sign-out affordance in the client portal.** Closes F-13 contingent on verification.

The staff layout has a sign-out path via `logout()` in `src/app/login/actions.ts:32-36`. The client portal's `BottomNav` was traced from `portal/layout.tsx:91` but not deep-read. **Verify this works:** does `BottomNav` (or any reachable portal surface) expose a sign-out control? If no, this is a real bug — a client cannot sign out short of clearing cookies. Probable fix: add a sign-out item to the BottomNav overflow menu, or to a `/portal/you` settings-equivalent screen, with the same `logout()` action wired.

**Requirement** if absent (clients must be able to sign out per §5.7 step 1). Recommendation if reachable today.

**C-9 — No distinct first-run portal welcome card.** Closes F-7.

A freshly-onboarded client lands at `/portal` after `/welcome/install` and sees the same empty state as a returning client whose EP has paused their program. No "Welcome to Odyssey" signpost, no expectation-setting for the first program.

Closing this — operator decision 2026-05-28 = **build distinct first-run welcome card**: in `src/app/portal/page.tsx`, when the client has zero sessions ever (NOT just "no active program") AND no active program, render a quiet card above the DayScreen with copy on the order of "Welcome to Odyssey, [first name]. Your practitioner will build your program. We'll let you know when it's ready." Disappears after the first session log OR first program publish (whichever fires first). Match staff G-12 precedent — no exclamation, Lucide icon, single tone, design-system voice.

**Recommendation** traceable to staff G-12 closure + design-system voice ("encouragement is earned"; the first-run card is signposting, not encouragement).

**C-10 — Invite email body doesn't tell the client about the 12-char password rule.** Closes F-8.

`src/lib/email/templates/client-invite.ts` body says "set up your account" but doesn't mention the password rule. Client lands at `/welcome`, picks an 11-char password, gets rejected, retries.

Closing this — one-line addition to both the HTML and plaintext bodies: "When you sign in, you'll set a password of at least 12 characters." Match the existing template's voice (quiet, factual). No exclamation, no "Pro tip:", no explanation of why 12.

**Recommendation** (no spec requirement; operator-friendly polish).

**C-11 — `invite_tokens.consumed_at` is reserved but never written.** Closes F-9.

Migration `20260426100000_invite_tokens.sql:39-42` notes the field is reserved for a future "burn on click" pass. Today Supabase's underlying token-exchange single-use enforcement is the actual gate (a previously-exchanged action_link returns an OTP error on second exchange). Defence is sufficient; the reserved field is misleading reading.

Closing this — two paths: (a) build the "burn on click" pass — write `consumed_at = now()` in `src/app/i/[id]/page.tsx` server-side BEFORE returning the page, so the second render of the same `/i/[id]` URL shows the "already consumed" error before any token exchange. Idempotency: if the page is rendered twice nearly simultaneously, the second write loses the race but the user sees the "consumed" error on whichever render's UPDATE returned zero rows — defensible. (b) Drop the column entirely in a migration and lean on existing defences. (a) is smaller and matches the column's documented intent. See **open question 3**.

**Recommendation** (no user-visible impact today; closes the misleading "reserved" field).

**C-12 — `user_profiles` row for clients stays at `('Pending','Pending')`.** Closes F-11.

The welcome flow does not update `user_profiles.first_name/last_name` — the client's display name lives on `clients.first_name/last_name` (collected via the staff invite form). Today no client-facing surface reads `user_profiles.first_name`; if a future change does (a shared component used by both portals), every client renders as "Pending Pending".

Closing this — in `setPasswordAndAcceptAction`, after `client_accept_invite` succeeds, UPDATE `user_profiles SET first_name = clients.first_name, last_name = clients.last_name WHERE user_id = auth.uid()`. The RPC could do it inside SECURITY DEFINER instead, which keeps the work atomic. Either way the source of truth becomes consistent.

**Recommendation** (no user-visible impact today; closes a latent rendering hazard).

**C-13 — `client_accept_invite` error messages reach the user raw.** Closes F-12.

The five RPC failure messages ("Not authenticated", "Client record not found", "This invitation has been revoked", "Email mismatch between invite and authenticated user", "This invitation has already been accepted by another user") surface verbatim via `Couldn't link your account: ${acceptErr.message}` at `welcome/actions.ts:69`. "Already accepted by another user" reads as accusatory; "Email mismatch" reads as a system error rather than a "you might be signed in as a different account — sign out and try the invite link again" affordance.

Closing this — map the five message patterns to user-facing copy in the action's catch branch. "Email mismatch" → "It looks like you're signed in as a different account than the one your practitioner invited. Sign out and tap the invite link again." "Already accepted by another user" → "This invite was already used by someone else. Ask your practitioner to send a fresh one." Etc. The RPC's own error strings stay as-is for server-side logs.

**Recommendation** (design-system voice — "factual, not dramatised, but humane").

---

## Open questions for the operator (resolve at gap-list approval or inline as C-x close)

These do not change the doc's structure or priorities; they pick implementation specifics. Each gets resolved either at the claude.ai reviewer pass or in the per-gap step-6 task.

1. **§12.3 client portal session duration.** The Supabase dashboard refresh-token-expiry setting (which Track A G-4 documents) applies uniformly to all roles. Master brief §4.2 contemplates a shorter session for clients (higher portal churn on shared devices). Confirm: 30 days uniform (matches staff, simpler operationally), or shorter for clients (14d? 7d?)?
2. **C-6 rate-limit on `client_accept_invite`.** Build `rate_limit_log` now and close the §7.2 promise across `client_accept_invite` + `staffInviteClient` + `sendCommunication` together? Or defer to a "rate-limit infrastructure" sweep after this section? The bundled build is one migration + one helper + three call sites. The deferred path keeps this section narrower but leaves the §7.2 promise open for longer.
3. **C-11 `consumed_at` "burn on click".** Build now (option (a) — write `consumed_at = now()` server-side in `/i/[id]`) or defer until friends-and-family beta surfaces a problem? Option (a) is small and matches the column's documented intent; the deferred path leaves Supabase's single-use enforcement as the only gate.
4. **C-7 HIBP probe extension to `updateUser`.** Wait for staff Track A's script to land first, then add the probe variant in a follow-up task? Or run a one-off probe sooner via a hand-written script that proves whether Supabase enforces HIBP at updateUser, independent of Track A's framework?
5. **Sequencing with staff Track A.** Track A (staff) is in motion. The client section's R-1 and C-7 piggyback on Track A. Confirm: this section can write its gap list and close P0/P1 code items independently of Track A's closure; Track A's closure is what closes R-1 + C-7 against this section's "complete" bar.
6. **C-8 verification.** I did not deep-trace `BottomNav`. Is sign-out reachable from the client portal today? If you can confirm one way or the other in the reviewer pass, C-8 either drops to a documentation note or promotes to a P1 requirement.

---

## Documentation-sync flags (non-blocking)

- **P-D:** `docs/auth.md §5.5 step 2` says reset redirectTo is `https://<host>/reset`. Code uses `/auth/reset-password`. Documentation drift, not a code gap. Update doc.
- **P-E:** `docs/auth.md §5.4 step 4` says client login redirects to `/portal` by role. Code defaults to `/dashboard`. Closing **C-4** brings code into conformance; the doc is correct as-is. No drift after C-4 lands.
- **P-F:** `docs/auth.md §5.8 step 4` says "Optionally Supabase admin.signOut(user.id, 'global')". Closing **C-3** promotes optional to required; doc should drop "optionally" when C-3 lands.
- **P-G:** `docs/auth.md §12.4` is still an open question in the doc. The 2026-05-28 operator decision (8h invite TTL) closes it. Update the doc to record the resolution (and the rationale: tight window forces fresh-invite habits during beta; C-5 is the operational compensation).
- **P-H:** `docs/auth.md §7.2` specifies `clientAcceptInvite (brute force on client_id)` as "10 failed per hour per IP". Closing **C-6** overrides the key to **per `auth.uid()`**. Rationale: the call site is post-authentication; the email-match gate inside `client_accept_invite` already requires the attacker to hold a session whose email matches the target client's, so the attacker already has a uid. Rotating uid requires a new `auth.users` row (subject to Supabase's per-IP signup throttle); rotating IP is cheaper. Per-uid throttles the more expensive dimension. Per-IP would also collaterally throttle friends-and-family testers behind shared carrier NAT. Update the §7.2 row to record the override and the rationale; the spec's noted limitations in §7.3 (botnet defeat) carry across unchanged.
- **P-I:** `docs/auth.md §7.2` specifies `sendCommunication (email/SMS)` as "100 per hour per org". Closing **C-6** lands the `rate_limit_log` infrastructure (table, RPCs, TS wrapper) that this limit would use, but does NOT close the §7.2 `sendCommunication` commitment — there is no live broadcast/reply send path to wrap, and the existing invite-send is already inside `staffInviteClient`'s perimeter (double-counting risk). The TS wrapper at `src/lib/rate-limit/index.ts` deliberately omits a `sendCommunication` export so a wrong wire-up cannot ship by accident; the generic `rate_limit_check_and_record` RPC is the integration point when a real broadcast/reply path lands. Update §7.2 to mark `sendCommunication` enforcement as **deferred-to-feature**, with the trigger being the first broadcast/reply send call site landing.

These are picked up in a future commit at the operator's convenience; they are not blocked by step-6 work on this section's code gaps.

---

## Out-of-scope per the confirmed target

Listing explicitly to avoid future re-litigation:

- **MFA for clients.** Phase 2 per `docs/auth.md §12.5` / §8.2.
- **Email change for clients.** Phase 2 per `docs/auth.md §5.6`.
- **"Sign out of all devices" UI.** Phase 2 per `docs/auth.md §5.7`.
- **Client-initiated account deletion.** Service-role only via incident-response per `docs/auth.md §5.8`.
- **Cross-tenant raw-table pgTAP test (R-4).** Deferred until a second human practitioner per the 2026-05-17 operator handover; staff Track A manual procedure is interim cover and covers client paths trivially.
- **Data-retention purge (7+ years).** Cross-cutting operational concern, not auth/onboarding. Carry to a future operational task per `docs/incident-response.md`.
- **SMS reminders / notifications for clients.** Deferred per CLAUDE.md polish-pass section 12 + Open gates SMS rule.
- **Phase 4 multi-org switching for clients.** Schema-ready, UI not in v1.
- **The `NEXT_PUBLIC_APP_URL` env-var inconsistency at `src/app/portal/book/new/actions.ts:137`.** Out of section — booking, not onboarding. Carry to the booking polish.

---

## Closing posture

- No code was changed in this task. Read-only audit + gap list only.
- No existing record was relabelled or vandalised. The diagnostic at `docs/diagnostic-auth-onboarding-tenancy.md` and the staff polish doc were used as starting evidence and re-verified line-by-line against the code; where the code wins the code is recorded.
- Step 5 of the polish-pass protocol (approval) happens in the claude.ai chat. Awaiting that approval before step 6 (addressing gaps in dependency order) is engaged.
- If the reviewer adds gaps or revises priorities, append a "Reviewer revisions" section below this line; the seven-step protocol re-engages from step 5.

---

## Step six fix sequence (to be approved with the rest)

Sketched for the reviewer's consideration; not started in this task. Two tracks, mirroring the staff structure.

### Track A (operator-facing, inherits staff Track A)

No new operator work. The staff Track A workstream (script + runbooks) closes R-1 and C-7 for both sections at once. When Track A closes, this section's "complete" bar drops R-1 and C-7 against the inherited closure.

### Track B (local code, sequenced)

Dependency-ordered. Each item closes in its own step-6 task; each returns here for review before the next is picked up.

1. **B.1 — C-1 (P0)**: `refreshSession()` failure recovery in welcome flow + R-5 sub-case at `/unauthorized`. Lead P0.
2. **B.2 — C-2 (P0)**: `/welcome` "no user" copy + redirect logic. Pairs with B.1 (same file).
3. **B.3 — C-3 (P0)**: archive-client session revocation. Standalone; can be parallel to B.1/B.2 if the operator wants a wider concurrent surface.
4. **B.4 — C-4 (P1)**: role-aware redirect in `login()` and `setNewPassword()`. Verify-this-works on `user_role` RPC behaviour when hook is disabled (R-1 interaction).
5. **B.5 — C-5 (P1)**: Resend-invite UI + shared invite helper extracted from `inviteClientAction`. Largest single piece of work in this section.
6. **B.6 — C-6 (P1)**: rate-limit on `client_accept_invite`. Scoped by open question 2 — either narrow (one RPC only) or wider (rate_limit_log table + three call sites).
7. **B.7 — C-7 (P1)**: HIBP `updateUser` probe extension. Blocked-by staff Track A. Sequenced last because it depends on Track A's framework.
8. **B.8 — C-8 (P2)**: verify + surface sign-out in portal. Cheap.
9. **B.9 — C-9 (P2)**: first-run portal welcome card.
10. **B.10 — C-10 (P2)**: email body password-rule line.
11. **B.11 — C-11 (P2)**: `consumed_at` burn-on-click (option (a) per open question 3).
12. **B.12 — C-12 (P2)**: `user_profiles` name sync inside `client_accept_invite` RPC.
13. **B.13 — C-13 (P2)**: humane error mapping in welcome action.

Documentation-sync flags (P-D / P-E / P-F / P-G) land alongside the gaps they document, not as separate Track B items.

Stopping here. No track or item is started in this task — this section is the sequencing, not the execution.

---

## Reviewer revisions (2026-05-29)

This section supersedes the body above where they conflict. The seven-step protocol re-engages from step 5 with these in force. Each superseded location is named explicitly.

### 1. Severity re-rankings (severity axis only; sequencing in item 5)

- **C-4 → P0.** Fires deterministically on every client password-reset: the reset terminal hard-codes `redirect('/dashboard')` at `src/app/auth/reset-password/actions.ts:95`, a Medium-likelihood path, and lands the client on the same `/unauthorized` dead-end as C-1's Low-likelihood `refreshSession()` failure. A deterministic break of the recovery path outranks a probabilistic one; severity matches C-1. The body's placement of C-4 under "### P1 — functional" is superseded — read C-4 as P0 architectural and security.
- **C-7 → P0, blocked-by staff Track A.** Severity and sequencing are separate axes. If Supabase does not enforce HIBP at `updateUser`, the §12.1 password-strength commitment carries a permanent hole on the client recovery path — production-grade-security severity. C-7 stays sequenced last in Track B because its probe depends on Track A's framework existing; the P0 label reflects severity, not readiness. The body's placement under "### P1 — functional" is superseded — read C-7 as P0, annotated blocked-by Track A.
- **C-8 → P1 Requirement, locked regardless of BottomNav verification.** The bar for this section is not "sign-out is reachable somewhere in the component tree" — it is "sign-out is a deliberate, discoverable, design-system-conformant affordance." A control buried in an overflow menu that took a deep-trace to find does not meet that bar even if it technically works. §5.7 step 1 requires the client to be able to sign out; this section requires it to be findable without instruction. Verification of `BottomNav` (traced from `portal/layout.tsx:91` but not deep-read) and any `/portal/you`-equivalent surface is still required, but it now governs only the scope of the fix (net-new affordance vs. promoting a buried one), not the severity. The body's placement under "### P2 — polish" and its "Requirement if absent / Recommendation if reachable today" framing are both superseded.

**Updated severity roster for this section.** P0: C-1, C-2, C-3, C-4, C-7. P1: C-5, C-6, C-8, C-14. P2: C-9, C-10, C-11, C-12, C-13. The "Severity grouping" line at the head of the Gap list and the three "### P0 / ### P1 / ### P2" section memberships are superseded by this roster.

### 2. C-6 resolution — build `rate_limit_log` now

**Operator decision 2026-05-29:** build `rate_limit_log` in this section and close the §7.2 commitment across all three named operations together — `client_accept_invite`, `staffInviteClient`, `sendCommunication`. Rationale: §7.2 has sat unenforced for all three since the doc was written; the build is one migration plus one helper plus three call sites (small); and friends-and-family beta is simultaneously when an unauthenticated rate-limit attack is least likely and when the build cost is smallest — both vectors favour building now rather than deferring to a later sweep that only grows. **Verify this works:** confirm the helper's IP-derivation source exposes a trustworthy per-client IP server-side before relying on per-IP limits. If the only available IP is a shared proxy or edge IP, a per-IP limit is meaningless and the limit key must change — per `auth.uid()` for the authenticated operations, per-email for the unauthenticated ones. Open question 2 is resolved by this decision.

### 3. New gap — C-14 (P1)

**C-14 — Anti-prefetch invite gate is unverified against a real mail-client prefetcher.** Closes F-14. P1 Requirement (reviewer pass 2026-05-29, wide scope).

The §5.3 step-3 and step-4 deviation builds an entire architectural defence — the `/i/[id]` gate rendering a "One tap to continue" button and firing `window.location.assign(action_link)` rather than an `<a href>` — specifically to stop link-prefetchers consuming the one-time invite token before the human clicks. The defence is plausible (button plus JS navigation is the standard mitigation) but the threat it defends against has never been verified: no recorded test proves a real prefetcher fails to consume the token. An unverified defence on the single most fragile point of client onboarding is a hopeful assertion, not a defensible design.

Closing this is verification-first. Send a real invite to a seeded mailbox on at least Gmail (the prefetcher named in the source comments) and one corporate-style scanner if reachable (Outlook Safe Links or equivalent — these are more aggressive consumers than Gmail in practice, so a Gmail-only pass is partial). Confirm the invite token is NOT consumed by delivery or scanning and IS consumed only on a real human tap. Record the result — mail client, date, outcome — in a runbook entry alongside the auth-config runbooks. This verification gates the section's "complete" bar. If the test passes, C-14 closes as a documented verification with no code change. If it fails, the gate design is inadequate and a contingent code fix opens — candidate mitigations: requiring an explicit POST rather than any GET to consume the token, or deferring token exchange to a server action triggered by the button and never reachable by a GET prefetch. That fix is sequenced as new work, not pre-built before the test result is known.

Requirement (traceable to §5.3 step 3 and step 4 — the deviation is load-bearing for the entire invite flow; an unverified load-bearing defence does not meet the section's bar).

Append this row to the forward-looking premortem table:

| # | Failure mode | Likelihood × Impact | Closed by gap |
|---|---|---|---|
| F-14 | The `/i/[id]` gate's anti-prefetch design (button plus `window.location.assign`, no `<a href>`) has never been verified against a live mail-client link-prefetcher. If a prefetcher (Gmail, Outlook Safe Links, corporate scanners) reaches the `action_link` despite the gate, it exchanges the one-time token before the human clicks; the client lands on an already-consumed invite and cannot onboard — onboarding silently broken at first contact. | Low–Medium × High | C-14 |

### 4. Open-question resolutions

- **OQ2 — resolved:** build `rate_limit_log` now, all three operations (item 2 above).
- **OQ5 — resolved, tightened:** the section may write its gap list independently of Track A, but C-1 and C-4 may NOT be closed before Track A's hook-verification probe lands. Both fixes assume the Custom Access Token Hook can populate `user_role` correctly; if the hook is the broken thing, C-1's recovery logic loops forever and C-4's `user_role` RPC returns NULL. Track A's verification is a hard pre-condition of B.1 and B.4, not a parallel track. R-1 and C-7 still inherit Track A's closure as before.
- **OQ6 — resolved:** C-8 is P1 regardless of verification (item 1 above). The BottomNav deep-read still happens; it sets fix-scope, not severity.

### 5. Track A / Track B sequencing override

Track A gains one operator task — "No new operator work" in the Step-six section is superseded.

- **A.2 — C-14 prefetcher verification.** Operator-run. Gates the section's "complete" bar alongside R-1 and C-7's inherited closures.

Track A hook-verification is now a hard pre-condition of Track B B.1 and B.4. Sequence the hook-verification probe to land before either is touched. Rationale: it preserves debugging signal — a C-1 or C-4 bug surfacing in beta is then known to be fix-logic, not hook-config.

**Track B label and scope updates:**

- **B.4 (C-4)** — now P0. Gated behind Track A hook-verification (above).
- **B.6 (C-6)** — scope is the wider build: one migration plus one helper plus three call sites (`rate_limit_log` across all three §7.2 operations), per item 2.
- **B.7 (C-7)** — now P0, still sequenced last (blocked-by Track A).
- **B.8 (C-8)** — now P1.
- **New B.14 (C-14)** — operator verification, see A.2. Runs early in execution despite its B-number: it is cheap and a failing result reshapes the invite flow, so its result should be known before late code work proceeds.

**Execution-order nudge:** move C-13 (humane error copy) ahead of C-11 and C-12 in execution order. C-13's accusatory error strings reach the client today; C-11 and C-12 have zero user-visible impact now.

### 6. Scope-decision reasoning correction

The body's original phrasing — that C-3 and C-5 live here because "they have nowhere else to live" — is not the reason and has been replaced in the Composite target brief. The correct reason is ecosystem ownership: both are client-onboarding-lifecycle steps implemented in staff-side files, and this section owns that lifecycle end-to-end. "Nowhere else to live" was the smell, not the rationale.

### 7. C-3 reclassified — closed as documented closure, no code (mechanism correction)

A read-only trace of `soft_delete_client` (in `supabase/migrations/20260429130000_soft_delete_rpcs_clients_and_program_exercises.sql`, NOT the `20260429120000` predecessor the body cites — the predecessor explicitly carves clients out of scope) established that the function performs exactly one DML statement: an `UPDATE clients SET deleted_at = now(), archived_at = now()`. It does NOT remove the `user_organization_roles` role row, does NOT touch `clients.user_id`, and does NOT touch any `auth.*` object. The body of this document is wrong on this mechanism in four places, all superseded here:

- The §5.8 client archive audit paragraph, which states the RPC "removes the `user_organization_roles` row." It does not.
- The F-3 premortem row, which states "RLS shuts them out at next refresh because the role row is gone." The role row is not removed, and the lockout is not at refresh.
- The C-3 gap entry, whose fix sequence and "≤1h window" residual are built on the role-row-removal premise.
- The severity roster in item 1 above, which lists C-3 in the P0 set.

**Corrected mechanism.** Data-access denial for an archived client is immediate at archive commit, not at token TTL expiry. Every client-readable RLS policy carries `AND deleted_at IS NULL` as a top-level conjunct, and the client-branch policies gate through `client_id IN (SELECT id FROM clients WHERE user_id = auth.uid() AND deleted_at IS NULL)`. The instant the UPDATE commits, every subsequent SELECT, RPC, and realtime delivery for that client returns zero rows — including queries by the row's own owner via `user_id = auth.uid()`. The role row's presence is irrelevant to this gate: `public.user_role()` reads the JWT claim, not the table, so the role row affects nothing until the next token issuance regardless.

**Consequence for C-3.** The residual the gap was opened to close — a window of authenticated read access to clinical data after archive — does not exist. What remains after archive is only content already rendered into the client's browser DOM and held in component memory before the commit; no server-side session revocation (`signOut('global')`, an `auth.sessions` delete, a ban, or a password scramble) can reclaim already-rendered client-side state. Server-side revocation therefore closes no real residual.

**C-3 is closed as a documented closure with no code change.** The application is correct as built; the audit that opened C-3 as a P0 misread the archive mechanism. C-3 is removed from the P0 set. The corrected roster is: P0 — C-1, C-2, C-4, C-7. P1 — C-5, C-6, C-8, C-14. P2 — C-9, C-10, C-11, C-12, C-13. The Track B sequence item B.3 (C-3) is struck; the early unblocked code item is now C-6 (sequenced before or with C-5, per the SHARED SURFACE finding), with B.1 and B.4 still gated behind Track A hook-verification.

**Residual cosmetic note, not a gap.** With data access closed at commit, a longer access-token TTL only means a stale archived tab keeps displaying already-rendered content, and keeps a realtime socket open delivering empty payloads, until the token expires. This is cosmetic, not a data exposure, and is explicitly accepted for all scopes. It is noted only because it is the same lever as open question 1 (client session duration), which remains separately open.

**Documentation-sync flags raised by this correction (non-blocking):** the §5.8 body paragraph, the F-3 row, and the C-3 entry should be corrected in place in a future doc-hygiene pass to name the real mechanism, so a reader who skips the revisions section is not misled; the migration citation `20260429120000` should be corrected to `20260429130000` wherever it appears. These join the existing P-D through P-H sync flags; they are non-blocking because this revisions entry is authoritative in the interim.

---

## Reviewer revisions (2026-06-07)

Reviewer-revision (2026-06-07): C-5 audit mechanism correction. The body's "Audit-log entry per resend (uses the existing audit_log table; no new table needed)" specifies an impossible mechanism. audit_log denies INSERT to authenticated (RLS WITH CHECK (false)) and revokes INSERT/UPDATE/DELETE from PUBLIC/authenticated/anon (migration 20260420102300); writes are trigger-driven only, via log_audit_event running SECURITY DEFINER as audit_writer. Correct mechanism: the resend helper's UPDATE clients SET invited_at = now() on success fires the existing audit_clients AFTER-UPDATE trigger, which lands an audit_log row capturing the invited_at change (verified 2026-06-07: log_audit_event inserts unconditionally on every UPDATE, no column allowlist or diff-shape gate) — no application insert. The requirement stands; the means is the timestamp UPDATE. Actor caveat: the row lands with actor_user_id IS NULL, because nothing sets the request.actor_user_id GUC the trigger reads — a pre-existing system-wide condition across all server-action audit writes, not a C-5 regression, out of scope here. Practitioner identity for a resend is captured in the [resend-invite] server log line, mirroring archiveClientAction's [archive] precedent.

---

## C-5 closed (2026-06-07) — Resend-invite UI, closes F-5

Shipped across six commits (3a99429 -> 671a265 -> b02a965 -> 22995ef -> 144b654 -> 69c2f71, anchored on b850316): doc correction of the impossible audit-log guidance (1); hoist of timeAgo/formatShortDate to src/lib/format (2); extraction of sendInviteForClient from inviteClientAction, behavior-preserving (3); invited_at refresh on send success, which fires the audit_clients trigger as the audit mechanism (4); resendInviteAction, authorize-then-delegate with an RLS-scoped ownership read plus a retained cross-tenant backstop (5); and the profile UI -- hint + ghost button, shown only when user_id IS NULL AND invited_at IS NOT NULL (6).

**Verified (operator-run, 2026-06-07).** Browser checks were run by the operator against the live pre-launch project; Claude Code was auth-blocked at /login in the preview and did not drive them. Confirmed: button shows on an invited-not-onboarded client, hidden on onboarded and never-invited clients; a click sent a real invite email with a working portal link, swapped to the confirmation line, refreshed invited_at to "today" on reload, and landed an audit_log UPDATE row (changed_fields included invited_at; actor_user_id null per the documented caveat).

**Failure modes mitigated.** The five inviteClientAction error strings promising a resend control that did not exist are now true. A resend routes through the same staff_invite:<uid> rate-limit gate as the new-client send (shared 20/hr budget, by construction via the extracted helper). The resend endpoint re-enforces its visibility preconditions server-side and is RLS-gated plus org-asserted against cross-tenant misuse.

**Accepted, not mitigated.** (a) A successful new-client invite writes invited_at twice (INSERT + helper UPDATE), producing two audit rows -- harmless, and keeping the INSERT write is what leaves the resend button able to recover a failed first send. (b) The invited_at refresh soft-fails: if the post-send UPDATE errors, the send is not reported as failed (avoids prompting a duplicate email), at the cost of a stale "last sent" timestamp and, on the resend path, no audit row for that send -- captured in the [resend-invite] server log. (c) audit_log.actor_user_id is null for these rows because no request.actor_user_id GUC is set -- a pre-existing system-wide condition, not a C-5 regression.

**Triggered doc-hygiene generated this session (non-blocking, not swept).** (i) The rate-limit comment now inside src/lib/clients/invite.ts still reads "so when C-5 extracts this block..." -- self-referential after the extraction it describes. (ii) archiveClientAction's if (target.deleted_at) idempotent-redirect branch is dead code under the "select clients in own org" RLS policy (the deleted_at IS NULL conjunct null-filters the read before the branch) -- same reason the resend action omits its own deleted_at gate. (iii) The audit changed_fields on the resend UPDATE reads ["updated_at","version","invited_at"], not invited_at alone -- updated_at/version are bumped by a pre-existing BEFORE UPDATE trigger on clients, incidental to C-5. These join the existing P-D through P-I sync flags; none blocks the close.

---

**Sign-off -- C-5 (2026-06-07).** Reviewed and accepted by the operator via claude.ai project chat. Code complete across seven commits (3a99429 ... 3e8bcfb, anchored b850316), operator-run browser verification confirmed end to end. Accepted-not-mitigated items (double audit row on new-client send, soft-fail timestamp refresh, null actor_user_id) reviewed and accepted as documented. Three doc-hygiene flags logged as non-blocking for a future sweep. C-5 formally closed; the Auth-and-Onboarding-client section remains open (C-1, C-2, C-4, C-6, C-7, C-8, C-9 through C-14 per the corrected roster).

---

## R-4 interim tripwire exercised (2026-06-07) — forward-note

**What ran.** The manual cross-tenant isolation procedure at `docs/runbooks/verify-cross-tenant-isolation.md` was executed end-to-end against the live pre-launch project for the first time since it was built. Two ephemeral orgs were self-signed-up through the localhost front door (`verify-xtenant-a`, `verify-xtenant-b`); Org A was seeded with one client + one clinical note + one program, Org B with one client. Impersonating Org B's owner via `set_config('request.jwt.claims', ...)` + `SET LOCAL ROLE authenticated`, read and write isolation were probed across the eight core tenant tables. **Result: all checks pass** — Org B saw only its own rows, the three targeted Org-A row-id lookups returned zero, the cross-tenant UPDATE affected 0 rows, and the cross-tenant INSERT was refused with `42501` (RLS violation). Both verify orgs were torn down clean in the same session. The authoritative record (with the SQL-deviation and teardown notes) is the runbook's Run log.

**Why it matters here.** This doc's retroactive **R-4** entry treats client-path cross-tenant isolation as covered by the staff Track A manual procedure as the interim tripwire, with the automated pgTAP test deferred until a second human practitioner exists. That interim tripwire has now been exercised once, passing — a client JWT's RLS scope is the same shape probed here, so the client `/portal/*` data paths inherit this evidence. The boundary the entire client section sits on (`portal/layout.tsx`'s `role === 'client'` gate → `organization_id` claim → RLS) is now independently verified by hand, not merely asserted.

**Scope — what this does and does not change.**
- **Does:** exercises R-4's compensating control; supersedes the staff section sign-off's statement (2026-05-27) that the procedure "is built but has not yet been run, so the multi-tenant boundary's independent verification is pending rather than complete." That verification is no longer pending. The staff section remains **formally closed** — this is a factual operational update recorded in the active (client) section per operator instruction, not a reopening of the staff sign-off.
- **Does not:** lift the R-4 deferral. The automated pgTAP regression test is still deferred. R-4 remains "no new gap — closure inherits" for this section. Re-run the manual procedure on every migration touching RLS, the JWT hook, or the auth helpers until the automated test lands.

**Feasibility observation (not a commitment).** The run used `set_config('request.jwt.claims', ...)` impersonation inside a `BEGIN/ROLLBACK` — which is exactly the pgTAP technique. The automated R-4 test is therefore demonstrably buildable today without a second human practitioner; the "second practitioner" trigger was a convenience assumption, not a hard dependency. If the operator wants R-4 closed properly rather than re-run by hand each RLS migration, that is now a low-friction option to schedule.

---

## R-4 closed (2026-06-07) — automated cross-tenant pgTAP test landed

Following the manual tripwire run recorded in the forward-note above, the operator elected to close R-4 properly the same day. The automated deliverable was built and verified: `supabase/tests/database/17_cross_tenant_isolation.sql`. Eight assertions, ordered critical-first — read isolation on `clients`, `clinical_notes`, `programs` (cross-tenant SELECT returns zero); write isolation on `clients` (cross-tenant UPDATE affects 0 rows; cross-tenant INSERT carrying the foreign `organization_id` raises `42501`); and three anti-trivial controls proving the probe sessions can see their own rows and that the org_a fixtures exist (so the zeros are isolation, not absent fixtures). **Run green 8/8 against the live project** via `BEGIN … ROLLBACK`, the same prod-run discipline as tests 15/16 (no non-prod target exists — go-live gate §5). It simulates two orgs + two staff via the existing `_test_set_jwt` JWT-spoofing helper, so the "second practitioner account" the deferral assumed was never actually required.

**R-4 status:** closed, to the same standard as the rest of the pgTAP suite (runs via SQL editor against prod until a non-prod CI target lands). The retroactive item's deferral is lifted. Per-migration tripwire is now the automated test; the manual runbook is downgraded to a quarterly broader-surface check (it covers all eight core tables, the automated test covers the regression-prone core). Runbook retirement clause and go-live checklist §6 updated in place.

**Coverage honestly stated — accepted, not mitigated.** The automated test checks read isolation on three core tables and write isolation on one (`clients`) as representative of the shared `organization_id = user_organization_id()` policy shape; it does not assert write isolation on all eight tables. The 2026-06-07 manual run did cover all eight for read+write. Expanding the automated test to eight-table write coverage is a low-value follow-up, not a gate.

**Documentation-sync flag (non-blocking).** The staff polish doc (`docs/polish/auth-onboarding-staff.md`) is formally signed off; its sign-off lists R-4 as deferred "until a second practitioner account exists" and the manual procedure as "built but has not yet been run." Both are now superseded by this closure. Per the section sign-off ritual the closed staff doc is not rewritten here — flagged for the operator to surface at the next claude.ai review so the staff record can be annotated. The go-live checklist §6 and the runbook retirement clause are not sign-off-frozen and were updated in place.

---

## C-1 closed (2026-06-08) — Client onboarding session-recovery, closes F-1 / R-5

Shipped in one commit (8c1c93f): a mirror of staff G-2 for the client invite-accept path. When setPasswordAndAcceptAction's post-RPC refreshSession() fails, the user_organization_roles membership row exists but the JWT carries no user_role claim. The welcome action now wraps refreshSession() in a thin try/catch with the redirect to /welcome/install left outside the try (so the NEXT_REDIRECT throw is not swallowed) (1); /welcome/install becomes the recovery host, reading user_role() + the membership row + the clients row in parallel and branching -- membership && !role renders FinishSetup, !membership redirects to /welcome (2); FinishSetup makes exactly one browser-side refreshSession() attempt, guarded by a 30s sessionStorage timestamp keyed odyssey_c1_recovery_at (distinct from staff G-2's odyssey_g2_recovery_at) against a re-bounce loop, with a real sign-out escape wired to the existing logout action on failure (3); and an R-5 operator runbook for the membership-absent sub-case, indexed in the runbooks README (4).

**Verified by exhaustive reading + type-check; runtime verification deferred.** All five artifacts were read verbatim and confirmed against the schema: user_role() reads the JWT claim and not the table (auth_helpers_and_jwt_hook.sql), so a claimless pre-membership JWT returns NULL while the membership row exists -- the exact state branch (b) keys on; the redirect sits outside the try/catch; the sessionStorage guard wraps the refresh attempt; the failure branch calls the real logout action. tsc --noEmit passed clean. Runtime browser verification of the branch (b) recovery state could NOT be performed: the stuck state (membership row present, JWT claimless) cannot be faithfully reproduced against the live project, because every hook-issued JWT attaches the user_role claim once the membership row exists, and a dashboard session-revoke yields a fresh-and-correct JWT on next sign-in rather than a claimless one. The only faithful reproduction requires either a deliberate code break or destructive DML against prod identity tables, neither acceptable against the live pre-launch project. Runtime verification of branch (b) is the first task to run once a non-prod Supabase target exists; that same constraint blocks runtime verification of every future auth failure-mode flow. The happy path (branch a) and the routing reads are inspection-confirmed against verbatim source.

**Failure modes mitigated.** A welcome-flow refreshSession() failure that previously left the client on a claimless JWT with no recovery now routes to FinishSetup, which self-heals via a single browser-side refresh on success and offers a working sign-out escape on failure -- converting an indefinite soft-lockout into a bounded, recoverable state. The redirect-outside-try placement prevents the catch from swallowing NEXT_REDIRECT and silently killing navigation. The 30s sessionStorage timestamp prevents a hard-failed refresh from spinning into a /portal-bounce loop.

**Accepted, not mitigated.** (a) Branch (c) collapses two distinct states into one terminus -- the R-5 stuck client (client_accept_invite RPC failed, no membership row) and a random non-invitee who navigated directly to /welcome/install both land on /welcome's "Something's missing" copy. This is deliberate, not an oversight: the recovery action is identical for both (ask the practitioner to resend), so distinguishing them would cost a branch and buy nothing. (b) FinishSetup has an infinite-hang sliver: seconds_to_reset aside, if the browser-side refreshSession() neither resolves nor rejects, the component sits on "Finishing setup" with no timeout flip to the failed state. The Supabase client carries its own network timeout so a true infinite hang is remote; a setTimeout flip to 'failed' after ~10s would close it but is out of C-1 scope. Known and recorded. (c) The clients-row read in /welcome/install is unused in branches (b) and (c) -- one wasted query in the recovery branch for happy-path flow simplicity; a conditional read would save it but the branching cost was not judged worth it at this scope.

**Section open set, corrected at this closure.** With C-1, C-4, and C-6 now closed (this batch), and C-3 and C-5 already closed, the honest open set for the Auth-and-Onboarding-client section is: C-2, C-7, C-8, C-9, C-10, C-11, C-12, C-13, C-14 (per the corrected roster; C-7 remains blocked-by Track A). This supersedes the open-set clause in the C-5 sign-off above (2026-06-07, line ~449), which predates these three shipments and is left in place as the historical record per the doc's supersede-by-append convention.

---

## C-4 closed (2026-06-07) — Role-aware post-auth landing, closes F-4

Shipped in one commit (e9ab04f): introduces postAuthLanding(role, next) as a pure total function in src/lib/auth/post-auth-landing.ts over the UserRole-or-null domain -- client and null route to /portal, owner|staff route to safeNext(next, '/dashboard') (1); the helper owns the safeNext call so open-redirect rejection is centralized (2); wired into the login action and the reset-password action (3). The null -> /portal choice is deliberate and documented: a claimless client routed to /portal is self-corrected by the portal layout's own re-check, whereas /dashboard would dead-end them. Re-ranked to P0 per the 2026-05-29 reviewer revision.

**Verified -- operator-run browser (2026-06-08), partial; remainder by exhaustive reading.** Operator-run browser checks against the live pre-launch project confirmed the two core landing paths end to end: a client login lands on /portal, and a staff login lands on /dashboard. The remaining paths are reading-verified, not runtime: safeNext's rejection of a hostile or off-site next target (the default no-next landing was exercised, but a crafted malicious next was not driven through the browser -- this is the security-relevant half and remains inspection-confirmed only); the claimless-client self-correction through /portal; and the reset-password surface landing. The reading basis is recorded at the **Verification note (2026-06-07)** above (line ~189): postAuthLanding is a pure total function, an automated unit test is deferred pending a TypeScript test runner the project lacks, and the five port-when-ready cases plus the UserRole-widening hazard are recorded there.

**Failure modes mitigated.** A claimless or freshly-onboarded client is no longer dead-ended at /dashboard; the role-aware helper routes them to /portal where the layout self-corrects. Open-redirect via a crafted next param is gated through the centralized safeNext fallback (reading-verified). Staff and owner reach /dashboard (or a safe next) directly rather than transiting a client surface.

**Accepted, not mitigated.** (a) The safeNext open-redirect rejection is verified by reading only -- a one-line ?next=https://evil.com login attempt would promote it to runtime-verified and is the recommended belt-and-braces check, deferred as low-likelihood and reading-clear. (b) Automated unit tests for the five postAuthLanding cases are deferred pending a TypeScript test runner; the cases are recorded at line ~189 to be ported when the runner lands. (c) The UserRole | null cast is sound against the current three-value SQL enum (require-role.ts) but a future widening of the enum without widening the helper's domain is a recorded hazard, not a present defect.

---

## C-6 closed (2026-06-08) — Invite rate limiting, closes §7.2 for two of three named operations

Shipped across two commits (6d6fa41 -> b850316): the rate_limit_log table, three SECURITY DEFINER RPCs (rate_limit_check_and_record, rate_limit_check_failures, rate_limit_record_failure), an hourly pg_cron cleanup sweep, and the two-gate wiring (1); the staff gate checkAndRecordStaffInvite (20/hr, key staff_invite:<uid>, check-and-record -- writes an attempt row per admit) wired into sendInviteForClient ahead of generateLink/token-insert/email (2); the client gate checkAcceptInvite (10/hr, key accept_invite:<uid>, read-only check whose counter moves only when recordFailure() fires on a client_accept_invite error) wired into the welcome action ahead of the accept RPC (3); the follow-up b850316 regenerated src/types/database.ts so the three RPCs are typed from the live schema and removed the temporary cast (4). The two gates carry deliberately opposite failure modes on infrastructure error, called out in code: the staff gate FAILS OPEN (rate-limit infra error admits the invite) and the accept gate FAILS CLOSED (infra error refuses with the same generic message as a real limit hit, so a probing attacker cannot distinguish limit-hit from infra-down from email-mismatch).

**Verified -- operator-run via SQL round-trip in rolled-back transactions (2026-06-08); wiring and infra-error branches by reading.** The limiter logic was exercised against the live project via supabase db query --linked (Management API admin connection; the web SQL editor is not drivable from the handover environment), each test a self-contained BEGIN...ROLLBACK whose final pre-ROLLBACK SELECT is the observation, with a separate post-hoc count(*) proving non-persistence. The harness itself was validated before touching rate_limit_log: BEGIN...ROLLBACK is honoured end-to-end (a temp table created in-transaction was gone after rollback), the endpoint returns only the last statement's result set, and a trailing ROLLBACK does not suppress the preceding SELECT. Confirmed: the accept gate (fail-closed) refuses the 11th attempt after 10 recorded failures while a zero-history key passes; the staff gate (fail-open) admits the 20th call and refuses the 21st once the window holds 20; the sliding-window reset arithmetic returns a correct partial value (a 59-minute-old row at p_max=1 yields seconds_to_reset = 60). Every test key returned count 0 after rollback, and a final %VERIFY% / %vprobe% sweep returned 0 -- nothing persisted. The cleanup cron is live: migration 20260604120100 shows applied remotely and cron.job carries rate-limit-log-cleanup-hourly (jobid 2, schedule 0 * * * *), so rate_limit_log is bounded -- no unbounded-growth defect. NOT runtime-verified, by reading only: the fail-open and fail-closed infrastructure-error branches (the if (error || !data) paths), which require an induced RPC failure to exercise; and the call-site wiring (gate-sits-before-side-effect), which was confirmed by reading the two call sites (invite.ts:21 ahead of the email at :132; welcome/actions.ts:77 ahead of client_accept_invite at :86) rather than driven end to end through the app -- driving the gates through the call sites would fire real emails, real password-writes, and real accept attempts, so the side-effect-free SQL path was used instead.

**Failure modes mitigated.** Invite-acceptance brute-forcing is capped at 10 failures/hr per uid (fail-closed, so an infra outage does not open the gate). Staff invite-spam is capped at 20/hr per uid (fail-open, so an infra outage does not block legitimate staff sends -- the deliberate availability-over-strictness choice for an authenticated-staff surface). The accept gate's generic refusal message is identical across limit-hit, infra-down, and email-mismatch, denying a prober a distinguishing signal.

**Accepted, not mitigated.** (a) The infrastructure-error branches (fail-open admit on staff-gate RPC error; fail-closed refuse on accept-gate RPC error) are verified by reading the four lines that decide each, not by an induced runtime failure -- promoting them to runtime would need a simulated RPC error, a candidate for the non-prod target alongside C-1. (b) The call-site wiring is reading-verified, not driven end to end, because exercising the gates through the app fires real side effects; the SQL round-trip verified the limiter logic in isolation while the wiring was confirmed by inspection. (c) sendCommunication is infra-ready but deliberately not wired (the third of the three §7.2-named operations), tracked separately as P-I. (d) Test-design note for reproducibility: the reset-arithmetic assertion only returns a non-zero seconds_to_reset on the refusal branch (cur >= p_max), so it must be run with p_max set low enough that the pre-aged row meets the cap (p_max = 1 for a single 59-minute-old row); run at the live p_max of 20 with one row, the call is admitted and returns 0, which is correct behaviour, not a failure.

---

## C-2 closed (2026-06-09) — Honest unauthenticated-state copy, closes F-2

Shipped in two edits to the welcome surface. (1) `src/app/welcome/page.tsx`: the single unauthenticated redirect — `redirect('/login?error=Invite+link+expired')`, which asserted invite expiry for *any* no-session state (cleared cookies, an old email tab, a direct paste, as well as a genuinely lapsed invite session) — is replaced by a two-branch handler keyed on `client_id` (read before the `getUser()` check, so it is in scope at the branch point). No `client_id` → `redirect('/login')` plain, no `?error=` (no invite context; they just need to sign in). `client_id` present → an in-page `AuthShell` card ("You're signed out." / "We couldn't read your invite session. Ask your practitioner to resend the invite link.") with a secondary "Already set up? Sign in" link, mirroring the existing authed-but-no-`client_id` "Something's missing." branch. (2) `src/app/welcome/actions.ts`: the post-submit `!user` branch copy moves from "Your invite link expired. Ask your EP to resend it." to "We couldn't confirm your session. Ask your practitioner to resend the invite link." — dropping the false-expiry claim and the "EP" jargon.

Separation-of-knowledge is the correctness argument: only the invite gate at `/i/[id]` knows expiry (it reads `invite_tokens.expires_at` and legitimately says "expired after 8 hours" at `i/[id]/page.tsx:101`); `/welcome` can observe only the absence of a session, so it now states only that. Aligns with the design-system voice rule "reason codes are factual, not dramatised."

Operator decisions (2026-06-09): in-page message (not a `/login` redirect) for the `client_id`-present case; align both the page and the action surfaces.

**Verified — `tsc --noEmit` clean + both runtime states driven through the preview server (2026-06-09).** C-2 is the *unauthenticated* path, so no login or JWT-break is needed and the C-1 auth-block does not apply — a fresh preview session reproduces both states directly. State 1 (`/welcome?client_id=<uuid>`, no session): the accessibility snapshot confirmed the in-page card — eyebrow "WELCOME", heading "You're signed out.", subtitle "We couldn't read your invite session. Ask your practitioner to resend the invite link.", and the "Already set up? / Sign in" link; no console errors. State 2 (bare `/welcome`, no session): `window.location` resolved to `/login` with an empty query string (no `?error=`), and the `/login` snapshot showed no error banner — the misattributed "Invite link expired" alert is gone. The change is server-render copy + redirect-target only, no DB, no schema, fully reversible. (Screenshot-image capture timed out on a renderer hiccup; the accessibility snapshot is the authoritative text/structure check per the preview tooling and was clean on both states.)

**Failure modes mitigated.** F-2 — the misattribution is gone. An EP is no longer prompted to re-issue an invite that was never expired; a client who lost their invite-derived session is kept in context with the correct recovery (ask the practitioner to resend) rather than bounced to a "sign in" they may have no password for.

**Accepted, not mitigated.** (a) The in-page card does not distinguish a brand-new invitee (no password yet) from an already-onboarded client who happens to have lost their session. `/welcome` is reached only from an invite email, so the new-invitee case dominates that URL and gets the correct recovery; the "Already set up? Sign in" secondary link is a no-cost escape for the rare onboarded case, without a server round-trip or a guess. Collapsing the two is deliberate. (b) The post-submit action copy treats a session lost between page-render and submit identically to any other no-session; that narrow case is *more* plausibly a real expiry, but asserting expiry there would reintroduce the same guess C-2 removes, so the cause-neutral wording stands.

**Discovered, out of scope, NOT swept (non-blocking).** A grep sweep for "EP" in client-facing copy surfaced a platform-wide split: the client portal addresses the practitioner as "your EP" in ~11 user-visible strings (`portal/program/page.tsx:25`, `portal/reports/page.tsx:53/73/78`, `portal/reports/_components/DataView.tsx:35`, `portal/session/[dayId]/page.tsx:136`, `portal/session/[dayId]/_components/Logger.tsx:712` placeholder, `portal/_components/DayScreen.tsx:432`, `portal/book/actions.ts:36`, `portal/book/new/actions.ts:148`, `portal/book/new/page.tsx:75/160`, `portal/book/new/_components/StepReview.tsx:86`), while the onboarding/auth flow uses "practitioner." Whether "your EP" (familiar AU allied-health vernacular) or "your practitioner" is the canonical client-facing term is an unresolved voice decision, not a C-2 defect — flagged for a dedicated voice pass or the Client-portal polish section (order item 7). C-2 touched only the onboarding surfaces, which now read consistently as "practitioner" internally. This joins the existing P-D through P-I sync flags.

**Section open set, corrected at this closure.** With C-2 now closed (code), the open set for the Auth-and-Onboarding-client section is: C-7 (blocked-by Track A), C-8, C-9, C-10, C-11, C-12, C-13, C-14. This supersedes the open-set clause in the C-1 closure (2026-06-08) per the doc's supersede-by-append convention.

---

**Sign-off — C-2 (2026-06-09).** Reviewed via the claude.ai project chat; reviewer model Claude Opus 4.8 (1M context). **Decision: Closed.** The closing commit was reviewed as presented — including the two operator decisions (in-page card rather than a `/login` redirect for the `client_id`-present case; aligning the post-submit server-action twin beyond the gap's named page-load line), the deliberate deviation from the gap's literal "redirect to `/login`" wording, and the two accepted-not-mitigated items — and accepted in full. Completeness against the C-2 gap definition and closure of premortem failure mode F-2 were confirmed. Nothing within C-2 is deferred. The "your EP" vs "practitioner" portal voice split was confirmed out of C-2 scope and remains a non-blocking flag for a future voice pass or the Client-portal polish section (order item 7), not promoted to a tracked gap at this close. C-2 formally closed; the Auth-and-Onboarding-client section remains open — open set: C-7 (blocked-by Track A), C-8, C-9, C-10, C-11, C-12, C-13, C-14.

---

## C-8 closed (2026-06-09) — Portal sign-out: affordance verified + soft confirm added, closes F-13

Two parts: a verification (the gap's premise was outdated) and an operator-requested enhancement.

**Audit finding — the affordance already met the bar.** C-8 was opened on the hypothesis that the portal might have no sign-out reachable "without deep-tracing `BottomNav` — a real bug if absent." The deep-trace settled it: `src/app/portal/_components/BottomNav.tsx:25` carries a permanent first-class "You" tab → `/portal/you`, a real account screen that ends in a "Sign out" button wired to the same `logout()` server action staff use (`src/app/portal/you/page.tsx`). Sign-out is therefore discoverable (the conventional account-tab → sign-out pattern, findable without instruction), deliberate, and design-system-conformant — and the original neutral (non-red) treatment was the correct choice, since the design system reserves red for clinical-flag banners. Against the reviewer's locked P1 bar (deliberate, discoverable, conformant, findable-without-instruction) it already cleared, so C-8 needed no net-new affordance. Where the code already won, the code is recorded.

**Enhancement (operator request 2026-06-09).** A soft confirmation before sign-out, so a stray tap on a shared/family device can't end a client's session. Tapping "Sign out" now opens a centred confirm dialog — "Are you sure you want to sign out?" with a red "Yes, sign out" and a "No" — mirroring the portal's existing `ConfirmOverlay` (`src/app/portal/_components/DayScreen.tsx:569`): a `.portal-card` on a plain dimmed (un-blurred) backdrop, two stacked CTAs. The red is the `--color-alert` token via a new reusable `.portal-btn-danger` class in `globals.css` (no hardcoded hex; the same token the booking-cancel control uses). `logout()` stays a server action submitted by a `<form>`, so sign-out still works without JS and runs the identical staff path; "No" is `type="button"` and the backdrop dismisses. Shipped as new `src/app/portal/you/_components/SignOutButton.tsx` + the `.portal-btn-danger` class + a one-line swap in `you/page.tsx`. The original trigger button's appearance is unchanged.

**Design-call recorded.** Claude Code initially recommended *against* a confirmation (the design philosophy avoids friction; an accidental sign-out costs only a re-login). The operator overrode this for shared/family-device safety. Recorded as a deliberate, operator-chosen tradeoff, not an oversight.

**Verified.** `tsc --noEmit` clean; the Next dev server compiled the route + new component with zero errors (smoke-tested by hitting `/portal/you`, which compiles the module graph before the layout's unauth redirect fires); all referenced tokens confirmed present in `globals.css`. Operator-run visual assessment in an incognito tab with a client login confirmed the full flow end-to-end ("works perfectly"): trigger unchanged, dialog copy + red confirm + No, backdrop/No dismiss, and Yes actually signs out. Claude Code is auth-blocked at `/login` in the preview (the portal sits behind the client-auth gate), so the visual confirmation was operator-run by design.

**Accepted / deferred (non-blocking).**
- (a) **Error-branch micro-gap.** `/portal/you`'s defensive `!client` branch (`you/page.tsx:43`) tells the user "Try signing out and back in" but renders no sign-out button. The branch is near-unreachable (the portal layout guarantees a linked client row before the page renders), so the value is low. Deferred. Re-trigger: a `/portal/you` polish pass, or any change that makes the branch reachable. Fix is to render `<SignOutButton />` there or soften the copy.
- (b) **`ConfirmOverlay` duplication.** The centred-confirm-overlay pattern now exists twice — `DayScreen`'s `ConfirmOverlay` (`DayScreen.tsx:569`, whose own comment anticipates promotion "when a second consumer appears") and `SignOutButton`'s inline dialog. Kept separate to keep this change tight and avoid regressing the DayScreen flow. Re-trigger: extract a shared `ConfirmOverlay` (with a `confirmVariant: 'primary' | 'danger'` prop) when the operator wants the de-dup, or when a third consumer lands.
- (c) **Button order.** "Yes, sign out" (red) on top, "No" below — matching the DayScreen precedent; operator approved this order after the visual assessment.

**Section open set, corrected at this closure.** With C-8 closed, the open set is: C-7 (blocked-by Track A), C-9, C-10, C-11, C-12, C-13, C-14.

---

**Sign-off — C-8 (2026-06-09).** Reviewed via the claude.ai project chat; reviewer model Claude Opus 4.8 (1M context). **Decision: Closed.** The operator confirmed the flow end-to-end in an incognito client session ("works perfectly") and the reviewer accepted the closure. The two non-blocking follow-ups recorded above — the `!client` error-branch sign-out affordance and the `ConfirmOverlay` extraction — are carried forward with their re-triggers, not promoted to tracked gaps. C-8 formally closed; the Auth-and-Onboarding-client section remains open — open set: C-7 (blocked-by Track A), C-9, C-10, C-11, C-12, C-13, C-14.

---

## C-7 closed (2026-06-10) — HIBP-on-updateUser probe built + run; finding: HIBP is plan-gated off on the free tier, closes F-10 / R-2 as a documented plan limitation

**What shipped.** A `G-3u` probe added to `scripts/verify-auth-config.mjs` (the Track A script C-7 was blocked on), mirroring `checkG3`'s structure: admin-create a pre-confirmed ephemeral user (no mail) → sign in on the anon front-door client → attempt `updateUser({ password: <known-breached> })` — the exact call clients make at `src/app/welcome/actions.ts:67` and `src/app/auth/reset-password/actions.ts:84` — → map rejection/acceptance to GREEN/RED/CND → tear down on all exit paths, with the run-prefix sweep as backstop. Wired into `main()` after `checkG3`; script header self-documentation updated. **No application code changed**, per the C-7 contract (verification task, not an app-code change).

**What the verification found.** The first run returned **RED — `updateUser` accepted the known-breached password.** RED had three candidate explanations, and each was run down rather than assumed: (i) *corpus false-negative* — eliminated: `password12345` confirmed in the HIBP corpus via the k-anonymity range API, 181,374 breach occurrences (only the 5-char SHA-1 prefix leaves the machine); (ii) *dashboard toggle drift* — a one-off front-door `signUp` toggle probe at the MX-bearing `mail.odysseyhq.com.au` domain was blocked by `over_email_send_rate_limit` before password validation (inconclusive; no user created, no mail sent; probe deleted after use), so the live config was read directly via the Supabase Management API using the CLI's stored token (read-only GET; token never logged): `password_hibp_enabled = false`; (iii) *restore the documented ON state and re-test* — the PATCH was **refused by the platform**: *"Configuring leaked password protection via HaveIBeenPwned.org is available on Pro Plans and up."* That is the root cause. **HIBP is a Pro-plan feature; on this project's free tier it is off and cannot be enabled at all** — in the dashboard or via API. The RED is the expected steady state: not drift, not an updateUser exemption. The runbook's 2026-05-21 "HIBP toggle confirmed ON" entry is corrected in place — it cannot have reflected live enforcement.

**What this means for C-7's question.** The question — does HIBP fire on `updateUser`, or only on `signUp` — is **unanswerable on the current plan**, because HIBP fires nowhere. C-7 closes as a **documented plan limitation**, a third outcome neither handover branch anticipated (GREEN assumed toggle-on-and-enforced; RED assumed toggle-on-but-updateUser-exempt). **No Supabase support ticket is filed** — the handover's RED instruction assumed the toggle was on; ticketing a platform for behaving as priced would be wrong. The probe artifact is permanent and the close is self-arming: on Pro upgrade, enable the HIBP toggle and run `node scripts/verify-auth-config.mjs` — G-3u then delivers the original GREEN (verified, no code) or RED (real platform hole → ticket) answer. The script's G-3u RED detail and the runbook's plan-gate section both encode this so a future RED cannot be misread.

**Collateral finding, fixed in the same pass.** GoTrue `password_min_length` was **6** — the GoTrue default; it had never been configured (the `minimum_password_length = 12` in `supabase/config.toml:47` applies to local dev and `config push`, which has never been run). Restored to **12** via Management API PATCH, confirmed by re-read. Exposure honestly stated: both client password surfaces enforce 12 server-side at the app layer (`welcome/actions.ts:31-33`, `reset-password/actions.ts:35`), so no user-reachable surface in this section accepted shorter — but the GoTrue backstop beneath the app layer sat at 6 until 2026-06-10, and §12.1's defence-in-depth premise assumed 12 at both layers.

**Verified.** Formal run recorded in the runbook Run log (2026-06-10): G-1 GREEN (hook injecting `organization_id`; also confirmed at the config level — hook enabled, URI matches), G-3 CND (free-tier signUp blockers, per design), **G-3u RED (expected steady state per the plan-gate)**, G-7 CND (script) with the underlying setting confirmed ON via the Management API read (`mailer_autoconfirm = false` — this also resolves the runbook's pending G-7 manual toggle confirmation), G-4 DOC with rotation settings confirmed via the same read (rotation on, 10 s reuse interval; max-lifetime still Pro-gated/deferred). Orphan scan and teardown sweep clean on every run, including the rate-limited one-off (0 users created, 0 orphaned).

**Failure modes: documented, not mitigated.** F-10 / R-2 close as *documented*, not closed-by-control: until a Pro upgrade there is **no breach-checking on any password path** — signUp, welcome `updateUser`, or recovery `updateUser`. The control in force is the 12-char minimum (app layer + GoTrue backstop, now actually 12), which thins but does not eliminate the breached-password space — `password12345` itself is 13 chars and breached. The residual — a friends-and-family beta user choosing a long breached password — is accepted at beta scope. **Re-trigger:** a Supabase Pro upgrade, and at the latest the Open-gates hard rule — no paying clinical client onboards without the external security review, and a HIBP-capable plan joins that gate posture alongside the already-Pro-gated G-4 refresh-token lifetime (same trigger, same documentation pattern).

**Accepted, not mitigated.** (a) The probe drives `updateUser` from a *password* session; the app's real calls run under *invite* (welcome) and *recovery* (reset) sessions. HIBP is a password-strength check at GoTrue's update endpoint and is not known to vary by session type, so the probe is representative — but if Supabase ever gated HIBP by session AAL, the probe would not catch that edge. Stated here and in the runbook rather than overclaimed. (b) G-3's signUp probe remains CND-stuck on the free tier; G-3u plus the Management API config read are the working coverage. (c) The restored `password_min_length = 12` is confirmed by config read-back, not by a behavioural probe (no automated min-length check exists in the script; adding one was not opened here). (d) The Management API write capability (CLI token → PATCH) was used once, to restore a documented target value, and is recorded in the runbook with a read-only-by-default posture — it is a capability to use deliberately, not ambient authority.

**Documentation-sync flag (non-blocking, joins P-D…P-I).** `docs/auth.md §12.1` and this doc's composite-brief line both state "HIBP enabled" as the in-force password policy. Both need the plan-gate annotation: HIBP is deferred-to-Pro with the re-trigger above; the in-force policy is 12-char minimum, no character classes, no breach check. This closing note is the authoritative correction in the interim per the supersede-by-append convention.

**Section open set, corrected at this closure.** With C-7 closed, the open set for the Auth-and-Onboarding-client section is: **C-9, C-10, C-11, C-12, C-13, C-14.** This supersedes the open-set clause in the C-8 sign-off above per the doc's supersede-by-append convention.

---

**Sign-off — C-7 (2026-06-10).** Reviewed via the claude.ai project chat; reviewer model Claude Opus 4.8 (1M context). **Decision: Closed with deferred items.** The reviewer accepted the closing commit — the `G-3u` probe as a permanent Track A artifact, the three-way evidence chain that ruled out a corpus false-negative and dashboard toggle-drift before landing on the plan-gate root cause, the decision not to file a Supabase support ticket for behaviour that is correct-as-priced on the free tier, and the collateral `password_min_length` 6→12 restoration — and confirmed completeness against the C-7 gap definition and premortem failure modes F-10 / R-2. The close is accepted as a documented plan limitation, conditional on the Pro-plan-gated deferred items below being recorded with their re-triggers.

**Deferred items (Supabase Pro-plan-gated).**

1. **The definitive HIBP-on-`updateUser` verification.** C-7's underlying question — does HIBP fire on the `updateUser` path (welcome + recovery, the paths every client uses) or only on `signUp` — is unanswerable while HIBP cannot be enabled at all. The G-3u probe is built, permanent, and self-arming. **Re-trigger:** the day the project moves to Supabase Pro and the dashboard HIBP toggle is enabled, run `node scripts/verify-auth-config.mjs` and read the G-3u line — GREEN closes the question as verified-no-code; RED *on Pro with the toggle on and a corpus-confirmed password* is the real platform hole and the support-ticket case (file a ticket asking that `updateUser` share the `signUp` leaked-password policy, and document the residual recovery-path risk here).

2. **HIBP breach-checking itself, on every password path.** Until the Pro upgrade there is no leaked-password check on `signUp`, welcome `updateUser`, or recovery `updateUser`. The in-force control is the 12-char minimum (app layer plus the now-restored GoTrue backstop), which thins but does not eliminate the breached-password space. The residual — a friends-and-family beta user choosing a long breached password — is accepted at beta scope. **Re-trigger:** Supabase Pro upgrade, and at the latest the Open-gates hard rule — a HIBP-capable plan joins the pre-paying-client gate posture.

3. **G-4 refresh-token max-lifetime** (30-day target) remains Pro-gated and DOC-only as previously recorded; surfaced here only to consolidate the single Pro-plan gate list, not newly opened under C-7. **Re-trigger:** the same Pro upgrade — set and record the value when the project moves to Pro.

The §12.1 documentation-sync flag (HIBP shown as in-force in `docs/auth.md §12.1` and this doc's composite brief; actually deferred-to-Pro) is non-blocking and carried with the existing P-D…P-I sync flags, with the C-7 closing note as the authoritative interim correction. C-7 formally closed with deferred items; the Auth-and-Onboarding-client section remains open — open set: C-9, C-10, C-11, C-12, C-13, C-14.

---

## Incident closed (2026-06-10) — production /login 500 on a malformed auth cookie; proxy session read hardened

Not a C-item: a production incident surfaced during C-14 verification, fixed and verified same-day. Recorded here because the fix lands on this section's auth surface (`src/lib/supabase/middleware.ts`) and the failure mode — a client's first contact dying on a server error — is exactly this section's territory.

**What was observed.** `https://odysseyhq.com.au/login` returned a server error page ("ERROR 1236160913") in the operator's normal Chrome profile while incognito and a cold `curl` returned 200 with the real app. Production-only in appearance; blocked the friends-and-family beta.

**Diagnosis chain (evidence, not hypothesis).** The /login render path has exactly one cookie-sensitive server step: `src/proxy.ts` → `updateSession()` → `supabase.auth.getUser()`. The failure was reproduced on production with a crafted cookie — `sb-azjllcsffixswiigjqhj-auth-token=base64-AAAAgarbage` → 500; cold → 200 — and then identically on the local dev server, where the stack named the throw: `Error: Invalid UTF-8 sequence` from `@supabase/ssr`'s cookie decode (`stringFromBase64URL`), escaping through the unguarded `getUser()`. "Local works, production broken" was never an environment difference — the local browser simply didn't carry the poison cookie. The bare-500 body ("Internal Server Error") is the proxy-level failure; the styled digest page the operator saw is how the Next 16 client router presents that same failed response during a soft navigation. Vercel runtime logs were not reachable from this machine (no CLI auth), so the digest was never needed — the deterministic repro superseded it.

**Root cause, fully stated.** `@supabase/ssr@0.7.0`'s cookie `getItem` throws (rather than returning "no session") when a `base64-`-prefixed cookie payload fails base64url or strict-UTF-8 decoding — e.g. a truncated value, a lost chunk of a chunked session cookie, or a `%`-mangled character. Two distinct blast radii: (1) the throw escapes the awaited `getUser()` in `updateSession`, 500-ing every proxied route for that browser until the user manually clears cookies; and (2) — found during verification, worse than the original report — merely *constructing* a Supabase client over a poisoned cookie jar spawns detached promise chains inside supabase-js (`_initialize` / `_emitInitialSession`) that re-read the cookie and reject where no try/catch can reach (`unhandledRejection` at process level), even on requests whose HTTP response is 200. A catch around `getUser()` alone is therefore an incomplete fix.

**The fix (commit `c301832`), two layers in `src/lib/supabase/middleware.ts`.** *Layer 1 — sanitize before the library sees the jar:* every `sb-*` cookie is validated exactly as `@supabase/ssr` will decode it (chunks joined in order, base64url alphabet, strict UTF-8 via `TextDecoder(fatal)`; plus a JSON-object check scoped to the `…-auth-token` session cookie only, so PKCE `…-code-verifier` cookies — legitimately plain strings — can never be false-positived). Unreadable cookies are purged from the forwarded request (Server Components on the same request never re-parse them) and expired in the browser via `Set-Cookie`, so a poisoned browser self-heals on its next request. The purge survives both the `setAll` response re-creation and the protected-route redirect. *Layer 2 — belt-and-braces:* `getUser()` wrapped in try/catch; an unanticipated throw is treated as signed out plus purge rather than a 500.

**Design calls and accepted residuals.** (a) Purge-on-unreadable means that browser is signed out — chosen over any attempt at recovery because an undecodable session has nothing to recover, and the alternative steady-state was 500-forever. (b) The validator is marginally stricter than the library (it rejects whitespace the lib would skip); worst case is one forced re-login on a cookie shape browsers do not actually send. (c) Expired-but-well-formed sessions are *not* purged — refresh/error behaviour there is unchanged from before the incident. (d) The specific origin of the poison cookie in the operator's browser was not recovered — the live cookie value was never read out (deliberately; it is a credential), and the class-level fix makes per-cookie forensics moot. Accepted. (e) Dev/prod parity preserved: the sanitizer changes no happy-path behaviour anywhere; localhost and production run the identical code.

**Verified.** `scripts/proxy-poison-cookie-verify.mjs` (committed alongside the fix) runs a 13-check matrix: cold, garbage, lost-chunk, and bad-UTF-8 cookies each → 200 on /login with purge headers where required; poison on /dashboard → 307 to /login with the purge carried across; a code-verifier cookie untouched; and a real minted session (throwaway confirmed auth user, password grant, cookie encoded exactly as `@supabase/ssr` writes it, hard-deleted in `finally` — c14-probe hygiene) authenticates without being purged. Green three times: dev server, local production build (`next build` + `next start`), and live production post-deploy. Server logs checked after each run: zero parse errors and zero unhandledRejections (the pre-fix prod-mode log showed both — log cleanliness was added as an acceptance criterion precisely because the HTTP matrix alone passed while the process was still throwing in the background). `tsc --noEmit` and `next build` clean. Live flip observed: poison probe 500 → 200 roughly 80 seconds after push.

**Honest limitation.** No Vercel preview deployment was used as the pre-promotion gate — no Vercel CLI or GitHub CLI auth exists on this machine, and preview URLs are not discoverable without them. The gate was the local production build plus the live poison probe immediately after deploy, with the full matrix re-run against production as confirmation. The operator's previously-failing browser should self-heal on first reload of /login (the purge header clears the poison); if it still errors there after a hard reload, that is new information and should be reported.

**Section impact.** C-14 and its scripts are untouched; the open set is unchanged: C-9, C-10, C-11, C-12, C-13, C-14. This entry is the incident record; no gap-list renumbering.

---

## C-14 closed with deferred items (2026-06-10) — Anti-prefetch invite gate: un-breached on Gmail, F-14 did NOT reproduce; gate design weakness + beta blocker deferred, no code change this pass

**What was tested and how.** C-14 is verification, not code — the question was whether the `/i/[id]` click-through gate actually stops a real mail-client link-prefetcher from consuming the one-time invite token before the human taps, or whether the defence was a hopeful assertion never tested against a live prefetcher. Two new scripts drive it, **no application code changed**: `scripts/c14-prefetch-probe.mjs` (Phase A detector baseline) and `scripts/c14-prefetch-test.mjs` (live `send`/`check`/`teardown`). The runbook is `docs/runbooks/verify-invite-prefetch.md` (indexed in the runbooks README). Run operator-collaboratively 2026-06-10 against the live pre-launch project and a real Gmail inbox: Claude Code seeded / observed / tore down via service-role; the operator owned the mailbox, the wait, and the taps — the parts only a human with a real inbox can perform.

Phase A first built the measuring instrument. A bare `generateLink({type:'invite'})` action_link, GET'd once with **no redirect followed**, flipped `auth.users.email_confirmed_at` from `null` to a timestamp (Supabase returned `303`, not followed). So (a) the detector is `email_confirmed_at`, and (b) the threat is real and mechanical — *any* GET of the action_link consumes the token at Supabase's `/verify`, before any redirect. The throwaway probe user was deleted in-run.

Phase B sent two parallel emails to one Gmail inbox (distinct `+alias` identities, both fresh `type:invite`): **B1 control** carried the raw action_link directly with **no gate** (the pre-gate failure mode the gate was built to defeat); **B2 gated** carried the **real production gate URL** `https://odysseyhq.com.au/i/<token>`, backed by a seeded test client + `invite_tokens` row, so Gmail scanned the actual production gate page. The operator confirmed both delivered, opened both, and tapped neither for ~22 minutes.

**What the verification found.** Across baseline (00:12Z), post-delivery (00:24Z), and post-open (00:29Z) checks, **both tokens stayed `null` — not consumed.** Neither Gmail's delivery-time scanning nor the operator opening the messages fetched the action_link, gated or raw. The operator then tapped both: the control consumed at 00:34:26Z, the gated link (via the gate's "Continue to your portal" button) at 00:36:30Z — proving both links were live the whole time, so the "not consumed" reading was the scanner *declining to fetch*, not a dead link. The production gate page rendered correctly ("One tap, Prefetch." — greeting the seeded client by name). Teardown clean (0 rows remaining). `invite_tokens.consumed_at` stayed `null` throughout, re-confirming the app never writes it (consistent with C-11).

**Verdict (reviewer sign-off, 2026-06-10) — Closed with deferred items.** In-scope Gmail verification is complete. Phase A pinned the detector empirically: `auth.users.email_confirmed_at` flips `null → timestamp` on any GET of the Supabase action_link, and a bare GET (no redirect followed) is enough to consume. Phase B: the gated production URL and an ungated control were both sent to one Gmail inbox; both tokens survived delivery and open, consumed only on the operator's taps. **Correction to earlier framing — F-14 did NOT reproduce on Gmail.** Because the ungated control also survived, Gmail's deliver-and-open pipeline does not prefetch-consume the token under these conditions. The gate is therefore **un-breached but was never exercised as an active control**: no prefetcher fired against it, so it cannot be claimed to have defeated one. "Not reproduced," not "mitigated."

**Deferred items, tracked:**

1. **DESIGN WEAKNESS, not an untested surface.** The raw action_link is present in the gate page HTML body, so a body-parsing scanner (Microsoft Safe Links, Proofpoint) can reach it without ever touching the visible gate button. Against that scanner class the current gate is structurally near-cosmetic by construction. **Real fix:** hold the token server-side and mint the action_link only on an explicit human POST from the gate page. **Deferred to before any paying clinical client.**
2. **Enterprise Safe Links untested.** No M365 business tenant available this pass (free outlook.com lacks enterprise Safe Links); Gmail-only by operator choice. **Re-trigger:** re-run the runbook with an enterprise mailbox before paying clients.
3. **BETA BLOCKER — post-tap auth redirect lands on `localhost:3000`** (Supabase Site URL = localhost / prod callback not allow-listed). Happy-path onboarding has never completed on production — only on localhost. No client can onboard in prod until this is fixed. **Must close before beta.** Config-only; tracked as a blocker, not background.

**Accepted, not mitigated.** (a) **Point-in-time, Gmail-only.** Holds for Gmail on the test date; Gmail can change scanner behaviour. (The embedded-action_link bypass this item previously also noted is reclassified as a structural design weakness and tracked at **Deferred item (1)** in the verdict above — tracked there, not accepted here.) (b) **Corporate scanners untested**, per F-14 above. (c) **The send used scripts, not the staff "Invite client" UI** — at test time production `/login` was 500-ing (since fixed, see below), so the operator could not send from the production UI; the scripts reproduce the real send faithfully on every dimension under test — same `generateLink` path, same `invite_tokens` row, same real Resend delivery, and crucially the same **real production gate page** Gmail scanned — differing only in the email-template wrapper, which does not affect link-prefetch behaviour. (d) **Happy-path completion was not observed end-to-end on production** because of the redirect misconfig (below): the tap consumed the token correctly at `/verify`, but the post-consumption redirect targeted `localhost`, so the operator did not reach a working `/welcome` on production. Onboarding completion *does* work on localhost (the operator's normal flow); the production gap is config, not gate.

**Discovered during C-14 — production-config, neither a gate defect.** (i) **Production `/login` 500 on a malformed auth cookie — out of scope and FIXED same-day** (commit `c301832`; see the "Incident closed (2026-06-10)" entry above). (ii) **Post-tap auth redirect → `localhost:3000`** is **not** out of scope and **not** a background task — it is the gating **beta blocker**, tracked in full as **Deferred item (3)** in the verdict above (the Supabase **Site URL is `localhost:3000`** and/or the production callback is not in the **Redirect URLs** allow-list; tapping the gate button consumed the token but redirected to `http://localhost:3000/#access_token=…` instead of the production callback; config-only fix). No client can onboard on production until it closes.

**Section open set, corrected at this closure.** C-14 was the **last P1 / Requirement** gating the section's "complete" bar. With it closed, the open set is **C-9, C-10, C-11, C-12, C-13 — all P2 polish.** This supersedes the open-set clauses in the C-7 closure and the incident-record entry above, per the doc's supersede-by-append convention. The Requirement-level bar for Auth-and-Onboarding (client) is met; only P2 polish remains.

---

**Sign-off — C-14 (2026-06-10).** Reviewed via the claude.ai project chat; reviewer model Claude Opus 4.8 (1M context). **Decision: Closed with deferred items.** The reviewer accepted the Gmail verification and corrected the framing: **F-14 did not reproduce on Gmail** — because the ungated control also survived delivery + open, Gmail's pipeline does not prefetch-consume the token under these conditions, so the gate is un-breached but was never exercised as an active control ("not reproduced," not "mitigated"). The closing note's verdict paragraph was replaced with the reviewer's text, and two companion edits were applied for internal consistency at the reviewer's instruction: accepted-item (a)'s embedded-action_link clause was reclassified to Deferred item (1); discovered-item (ii) was elevated from "background task" to the Deferred item (3) beta blocker.

**Deferred items (rationale + re-trigger):**

1. **Gate design weakness — contingent code fix, deferred.** The action_link sits in the gate page HTML, so a body-parsing scanner (Safe Links, Proofpoint) can reach it without the visible button — the gate is structurally near-cosmetic against that class. Fix: hold the token server-side and mint the action_link only on an explicit human POST from the gate page. **Re-trigger:** before any paying clinical client onboards (per CLAUDE.md Open gates).
2. **Enterprise Safe Links untested.** No M365 business tenant this pass; free outlook.com lacks enterprise Safe Links. **Re-trigger:** re-run `docs/runbooks/verify-invite-prefetch.md` with an enterprise mailbox before paying clients.
3. **Beta blocker — production auth redirect → `localhost:3000`.** Onboarding has never completed on production (Supabase Site URL = localhost / prod callback not allow-listed). Config-only. **Re-trigger / gate:** must close before the friends-and-family beta opens.

C-14 formally closed with deferred items; the Auth-and-Onboarding-client section remains open — open set: C-9, C-10, C-11, C-12, C-13 (all P2 polish).

---

## C-14 Deferred item (3) resolved (2026-06-10) — production auth redirect now targets production

The beta blocker named in the C-14 sign-off (Deferred item 3) is closed. The operator set the Supabase **Site URL** to `https://odysseyhq.com.au` and added `https://odysseyhq.com.au/**` to the **Redirect URLs** allow-list (keeping `http://localhost:3000/**` for local dev). Verified by `scripts/c14-prefetch-probe.mjs` (enhanced this pass to print the `/verify` redirect target): a fresh `type:invite` action_link whose `redirect_to` is the production callback now 303-redirects to `https://odysseyhq.com.au/auth/callback?…#…`, where before the change it fell back to `http://localhost:3000/#…`. Throwaway probe user torn down clean; the background-task chip is cleared.

**Production onboarding smoke-test — DONE, verified end-to-end (2026-06-10).** A real client was onboarded on production for the first time: the operator signed into the production staff app, added a client (`scottyhb19+smoke1@…`) with an invite, tapped it in a clean session, set a password at `/welcome`, and reached the client portal — all on `https://odysseyhq.com.au`, never localhost. Corroborated from the backend before teardown via `scripts/c14-prefetch-test.mjs check`: `email_confirmed_at` set (invite consumed by the human tap), `clients.user_id` LINKED + `onboarded_at` set (`client_accept_invite` ran), and a `user_organization_roles` `client` row present. The test client was hard-deleted clean — the teardown was extended this pass to clear the `user_organization_roles` + `user_profiles` rows a completed onboarding leaves, which otherwise FK-block `admin.deleteUser`. All three production prerequisites are confirmed in place: the auth-redirect fix (above), the poison-cookie fix (`c301832`), and the `NEXT_PUBLIC_SITE_URL`/`safeNext` owner-staff-sign-in fix (`c7750be`, second incident entry below). Production onboarding is beta-ready on the happy path.

---

## Incident closed (2026-06-10, second) — owner/staff sign-in 500 on production: `NEXT_PUBLIC_SITE_URL` absent in Vercel; `safeNext` decoupled from the env, `/api/health` gains a config check

The operator re-reported the digest error (`ERROR 1236160913`) after the poison-cookie fix — this time from a **fresh incognito window**: `/login` rendered, submitting credentials produced the error, and after that every page except `/login` failed. That observation falsified the assumption that the poison cookie was the cause of the *digest* the operator had been seeing. Both incidents are real, distinct bugs: the poison-cookie 500 was reproduced empirically pre-fix and is closed (`c301832`); the digest belongs to this one.

**Root cause.** `NEXT_PUBLIC_SITE_URL` is set in `.env.local` but was never set in the Vercel environment. `getPublicOrigin()` fails loud by design (G-11), and `safeNext()` resolved its URL round-trip against it — so the throw fired on every **owner/staff** sign-in (`login` action → `postAuthLanding` → `safeNext('/dashboard')`), every `/auth/callback` hit, forgot-password, signup, resend-confirmation, and invite sends. Clients and role-less users route to `/portal` without touching `safeNext`, which is exactly why the first incident's verification matrix — built on a role-less minted session — passed while the operator's owner login died. Localhost always worked because `.env.local` carries the var. The go-live checklist (line 50) predicted this verbatim ("login, confirmation, and recovery all break entirely — confirm it is set in production before launch"); the confirmation step never happened.

**Evidence chain.** (1) Unauthenticated probe of the forgot-password action on production (no-JS `$ACTION_ID` form POST, RFC-reserved address) → 500; its first statement is `getPublicOrigin()`. (2) `GET /auth/callback?code=junk&next=%2Fdashboard` on production → 500; its first cookie-independent call is `safeNext()`. (3) Post-fix, production's own `/api/health` reports `missing_env: ["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_APP_URL"]` — the deployment states the cause itself. (4) A local production build with the two vars stripped from the env reproduced the full failure signature, and the fix flipped it.

**The fix (commit `c7750be`).** *(a)* `safeNext` now resolves the relative-path round-trip against a fixed RFC 2606 sentinel origin (`https://safe-next-validation.invalid`). For deciding whether a relative path smuggles a host, the base origin's value is mathematically irrelevant — any valid base yields the same verdict — so the check needs no environment configuration and **its strength is unchanged** (all four layers intact; this is not a degrade-to-permissive change). Sign-in availability no longer depends on an env var that only email-link minting genuinely consumes; the G-11 fail-loud posture continues to apply at the true origin consumers (signup, forgot-password, resend-confirmation, invite, `set-session`). *(b)* `/api/health` now reports required-env status via `src/lib/env/required-env.ts` — names only, never values — so this entire class of failure is a one-curl post-deploy diagnosis instead of a user-facing 500. *(c)* The verification gap is closed structurally: new `scripts/staff-login-path-verify.mjs` walks a real **staff** session (throwaway user + temporary `role='staff'` membership, hard-deleted in `finally`; never `owner`, so the last-owner invariant is untouchable) through `/` → `/dashboard` and joins the standing matrix alongside the poison-cookie script.

**Verified.** Local production build, vars present: health 200/config ok; poison matrix 13/13; staff path 4/4. Local production build, vars stripped (production-identical condition): health 503 listing exactly the two names; `/auth/callback?code=junk` → 307 to `/login` with a real error message (this exact request was 500 on production); forgot-password → 500 (**fail-loud preserved by design**); staff path 4/4. Live production post-deploy: callback probe flipped 500 → 307 (~80 s after push); staff path 4/4 — a real staff session lands on a fully rendered `/dashboard`; poison matrix 13/13 regression clean. `.env.local` was restored byte-exact (hash-verified) after the falsification build.

**Operator actions required (sign-in works without them; email/onboarding flows do not).** In Vercel → Project → Settings → Environment Variables, add `NEXT_PUBLIC_SITE_URL = https://odysseyhq.com.au` and `NEXT_PUBLIC_APP_URL = https://odysseyhq.com.au` (Flag E: same value under both keys until reconciled), then redeploy and confirm `/api/health` flips to `"config":"ok"`. Until then, forgot-password, signup, resend-confirmation, invite sends, and `/auth/set-session` continue to 500 by design — which means the production onboarding smoke-test recorded above **will fail at the set-session step until the vars are in**. Set the vars first, then run the smoke test.

**Honesty note on the first incident's closure.** Its entry claimed the operator's browser "should self-heal on first reload" — true for the poison-cookie failure mode, but the digest the operator was seeing was this incident, which a reload could not fix. The first fix stands on its own evidence (pre-fix poison probes 500'd production; post-fix they don't), but the causal attribution to the operator's symptom was wrong, and the verification matrix that cleared it had a branch-coverage hole this incident's harness now closes. Recorded so the lesson survives: **a matrix that never exercises each role branch can pass while the operator's exact path is broken.**

**Section impact.** No C-item changes; open set unchanged: C-9, C-10, C-11, C-12, C-13 (all P2 polish). This entry also rides with the operator-session's "C-14 Deferred item (3) resolved" note above, which was sitting uncommitted in the working tree when this entry was appended — committed together to keep the doc linear.

**Operator actions completed + verified (2026-06-10, same day).** The operator set `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_APP_URL` in Vercel and redeployed. Production verified in the final configuration: `/api/health` 200 with `db: ok, config: ok`; the forgot-password action flipped 500 → 303 to `?info=sent` (reset links now mint with the production origin); `/auth/callback` junk-code probe 307; staff login-path harness 4/4; poison-cookie matrix 13/13. Both 2026-06-10 incidents are closed with no residual operator actions. The one remaining pre-beta confirmation is the end-to-end production onboarding smoke-test recorded under the C-14 item-3 resolution note above — all of its prerequisites are now in place.

---

## C-9 closed (2026-06-10) — First-run portal welcome card, closes F-7

**What shipped (commit `713c89c`).** A client with no client-visible program and no sessions ever now lands on a quiet welcome card in the `/portal` day-card slot — Lucide `ClipboardList` (28px, 2px stroke, muted token), solid `.portal-empty` border, title "Welcome to Odyssey.", body "Your practitioner is building your program. It'll appear right here when it's ready." — instead of the rest-day card. The `firstRun` condition is computed server-side in `portal/page.tsx`: two head-count queries (programs of any client-visible status; sessions ever), run only when there is no active program, so a programmed client never pays for them; any query error fails closed to the rest-day card rather than risk welcoming a veteran client. `DayScreen`'s empty-card slot is now a three-way split: session card / first-run welcome / rest day.

**Pre-build recon found the state worse than the gap described.** The audit said a fresh client sees "the same empty state" as a paused client; what they actually saw was "Rest day — Nothing scheduled. Recovery is part of the plan — hydrate, walk, sleep." — factually false copy for a client with no program and no plan. F-7's likelihood was understated.

**Three deliberate deviations from the gap's literal wording, each operator-approved 2026-06-10 before build:**

1. **Copy drops "We'll let you know when it's ready."** No notification of any kind fires on program publish (verified by grep across the staff program actions — no send/notify call exists; messaging is polish section 10, email templates section 12). The draft line was a promise the platform cannot keep; the shipped copy promises only what the portal observably does. The card also omits the client's first name — the greeting line directly above already carries it.
2. **Placement is swap-in-place of the empty-card slot, not "above the DayScreen."** Rendering the card above the screen would have left "Rest day" visible beneath it — two cards asserting contradictory realities. Same documented-deviation pattern the reviewer accepted on C-2.
3. **Condition is "no client-visible program ever," not the gap's "no active program."** The programs RLS client branch exposes `status IN ('active','archived')`, so the first publish retires the card permanently with zero stored dismissal state — an archived program keeps it retired, satisfying the gap's "disappears after first publish OR first log, whichever fires first" without persistence. An EP-side draft stays invisible to the client, which keeps the card up and its copy literally true.

**Verified.** `tsc --noEmit` clean; full production `next build` clean with `/portal` compiling. Operator-run browser checks: welcome card confirmed on localhost with a first-run-shaped client, then — after `git push` deployed `713c89c` — confirmed **end-to-end on production** with the re-created Smoke Test client (linked, 0 programs, 0 sessions; data shape verified via a one-off read-only service-role diagnostic, deleted in-session after use). One false alarm recorded honestly: the operator's first check ran against production *before* the deploy and showed the old rest-day branch; the data diagnostic and localhost check cleared the logic before the push, and the operator confirmed the mix-up. The rest-day card is structurally unchanged for programmed clients — `firstRun` can only be true when no program exists, so the discriminator cannot leak.

**Failure modes mitigated.** F-7 — a freshly-onboarded client no longer meets a false "Rest day" as their day-one experience; the card sets the correct expectation in design-system voice (signposting, not encouragement).

**Accepted, not mitigated.** (a) On a transient query error, a true first-run client sees the rest-day card for that load — fail-closed was chosen over any chance of mis-welcoming a veteran. (b) A returning client whose program was archived (zero sessions) still sees "Rest day — recovery is part of the plan" daily, which is slightly off for a paused client — pre-existing, out of C-9 scope, belongs to the Client portal polish (order item 7). (c) The two head-count queries also run for that archived-program client on every `/portal` load (their `firstRun` always computes false) — two indexed `count` head requests, accepted. (d) The Smoke Test client (`scottyhb19+smoke1@…`) remains in the live project for teardown at the operator's convenience once sign-off lands.

**Section open set, corrected at this closure.** With C-9 closed, the open set is: **C-10, C-11, C-12, C-13** (remaining execution order per the 2026-05-29 reviewer nudge: C-10 → C-13 → C-11 → C-12). This supersedes the open-set clause in the C-14 sign-off above per the doc's supersede-by-append convention.

---

## C-10 closed (2026-06-10) — Password rule stated in invite email + welcome form, closes F-8

**What shipped (commit `97a1676`).** Two surfaces, both copy/markup only — no schema, no actions, no new components:

1. **Invite email (the gap as written).** One factual line added to both bodies of `src/lib/email/templates/client-invite.ts` — HTML: "When you first sign in, you&rsquo;ll set a password of at least 12 characters." appended to the existing muted set-up paragraph; plaintext: "When you first sign in, you will set a password of at least 12 characters." as its own line (each body keeps its established register — the HTML uses contractions, the plaintext does not). One template serves both the fresh-invite and magiclink-fallback send paths (shared via `sendInviteForClient` since C-5), both paths land at `/welcome` where `setPasswordAndAcceptAction` always sets a password, and the resend control only targets not-yet-onboarded clients — so the line is accurate for every possible recipient with no per-path conditional copy. The line claims exactly what is enforced (12-character minimum, per the C-7 closure: no HIBP on the free tier, no character classes) and nothing more.

2. **Welcome form hint (scope addition, operator-approved 2026-06-10).** Recon falsified F-8's stated premise — "the hint exists in the password field" was untrue at HEAD: `WelcomeForm`'s password field carried no hint, no `minLength`, nothing; the rule was discoverable only by failing it server-side. The `Field` component gains optional `hint` + `minLength` props; the password field now shows "At least 12 characters." (muted, `.74rem`, hidden while the field's error is showing since both state the same rule) and `minLength={12}`, so a compliant browser catches a short password before a server round-trip. The email line alone would not have closed F-8 — the friction moment is at the form, and most recipients will have closed the email by then.

**Verified.** `tsc --noEmit` clean; full production `next build` clean. The template is a pure function whose two bodies were edited in parallel and read back; the real-send path was proven end-to-end by C-5 and the C-14/smoke-test sends and is untouched by a copy-only change. The form hint renders only in the session-gated branch of `/welcome`, which Claude Code cannot reach in the preview (standing auth-block, per C-1/C-8 precedent) — the hint markup and the error-supersedes-hint conditional are reading-verified. **Re-trigger for the runtime eyeball:** the operator's next test onboarding (a fresh invite send also shows the email line live, on both the HTML and plaintext renderings).

**Failure modes mitigated.** F-8 — the rule is now visible at preparation time (email) and at the moment of choice (form field), with a browser-native pre-submit check beneath both. The blind-pick-then-reject loop the premortem described requires ignoring three layers before reaching the server error.

**Accepted, not mitigated.** (a) `minLength` is a convenience layer only — browsers enforce it only on user-typed values, and an autofilled sub-12 password bypasses it; the server action remains the gate, unchanged. (b) The hint copy ("At least 12 characters.") and the server error ("At least 12 characters, please.") differ by one word — deliberate; the error is the action's existing voice and was not touched. (c) No runtime browser verification of the authed form state this pass, per the standing auth-block — recorded above with its re-trigger.

**Section open set, corrected at this closure.** With C-10 closed, the open set is: **C-11, C-12, C-13** (remaining execution order per the 2026-05-29 reviewer nudge: C-13 → C-11 → C-12). This supersedes the open-set clause in the C-9 closure above per the doc's supersede-by-append convention.

---

## Reviewer-verification addendum (2026-06-10) — C-9/C-10 sign-off tasks

Three verification tasks run read-only at the reviewer's request before C-9/C-10 sign-off.

**1. Password-rule duplication census (tracked staleness note).** The 12-character minimum is hardcoded at sixteen independent in-repo literals across eight files, with no shared constant: welcome action check + error copy (`src/app/welcome/actions.ts:37-38`); welcome form `minLength` + hint (`src/app/welcome/_components/WelcomeForm.tsx:42-43`); invite email HTML + plaintext (`src/lib/email/templates/client-invite.ts:80,128`); reset action check + error (`src/app/auth/reset-password/actions.ts:37-38`); reset page `minLength` ×2 + hint (`src/app/auth/reset-password/page.tsx:73,77,94`); signup action check + error (`src/app/signup/actions.ts:23-24`); signup form `minLength` + hint (`src/app/signup/_components/SignupForm.tsx:71,75`); and the local-dev mirror `supabase/config.toml:47`. The seventeenth touch point is out-of-repo: the live GoTrue `password_min_length` — the C-7 enforcement point, set via Management API, represented in no repo file. **Coupling, named: changing the password policy requires seventeen synchronized edits across these surfaces, or they silently contradict each other.** Refactoring to a shared constant is deliberately out of scope at current scale; this note is the tracker. Re-trigger: any change to the password policy — including the C-7 Pro-upgrade re-trigger, which revisits password policy anyway.

**2. C-9 "two indexed count head requests" — verified, claim stands.** Both `firstRun` queries filter `client_id` + `deleted_at IS NULL`. Programs are covered by `programs_client_status_idx (client_id, status) WHERE deleted_at IS NULL` (migration `20260420101800_programs.sql`); sessions by `sessions_client_completed_idx (client_id, completed_at DESC) WHERE deleted_at IS NULL` (migration `20260420101900_session_logging.sql`). Each partial index's predicate exactly matches the query's filter with `client_id` leading. Deferral (c) of the C-9 closure is accurate as written; no edit.

**3. C-10 resend-accuracy guard — verified enforced, claim stands.** The "only not-yet-onboarded clients can receive this email" claim is code-enforced, not intent-only: `resendInviteAction` re-checks server-side and refuses when `user_id` is set (`src/app/(staff)/clients/[id]/actions.ts:116-118`) and when no invite was ever sent (`:120-122`), independently of the UI visibility condition (`src/app/(staff)/clients/[id]/page.tsx:241`). The magiclink-fallback recipient (existing auth user, unlinked clients row) also always sets a password at `/welcome` (`src/app/welcome/actions.ts:67`), so the email line holds on that path too. No edit.

---

**Sign-off — C-9 and C-10 (2026-06-10).** Reviewed via the claude.ai project chat; reviewer model Claude Opus 4.8 (1M context). **Decision: both Closed.** The reviewer accepted both closing commits as presented — including C-9's three operator-approved deviations from the gap's literal wording (the dropped notification promise, the swap-in-place placement, and the no-program-ever condition) and C-10's operator-approved scope addition (the welcome-form hint correcting F-8's falsified premise). Acceptance was conditioned on three verification tasks, run read-only and recorded in the Reviewer-verification addendum above: the password-rule duplication census (tracked as a staleness note — seventeen synchronized touch points; refactor deliberately out of scope), the C-9 indexed-count claim (verified against both partial indexes; doc stands as written), and the C-10 resend-accuracy guard (verified code-enforced server-side; doc stands as written). C-9 and C-10 formally closed; the section remains open per the open sets recorded at each closure.

---

## C-13 closed (2026-06-10) — Humane mapping for `client_accept_invite` errors, closes F-12

**What shipped (commit `04fa578`).** One file, action-side only — no migration, no schema, the RPC body untouched. A module-local pure mapper (`mapAcceptInviteError`, `src/app/welcome/actions.ts`) replaces the verbatim pass-through `` Couldn't link your account: ${acceptErr.message} `` with recovery-oriented copy in the established client-facing voice ("practitioner" per C-2; factual, no drama). The raw RPC message now lands in the server log via a `[welcome-accept]` line — which the gap required ("the RPC's own error strings stay as-is for server-side logs") and which previously did not happen anywhere: the raw string went to the user and to no log at all.

**The mapping (raw → user-facing):** email mismatch → "It looks like you're signed in as a different account than the one your practitioner invited. Sign out, then tap the invite link again." · already accepted by another user → "This invite was already used by another account. Ask your practitioner to send a fresh one." · revoked → "This invitation is no longer active. Check with your practitioner." · client record not found → "We couldn't find your invite. Ask your practitioner to send a fresh one." · not authenticated → the C-2 session copy ("We couldn't confirm your session. Ask your practitioner to resend the invite link.") — same cause class, same recovery. Anything unrecognised falls back to "Something went wrong linking your account. Ask your practitioner to resend the invite link."

**Recon corrections to the gap record.** (i) The RPC has **six** raise points, not the five the gap list names — the missed sixth is `'Caller has no email on auth.users'` (`20260420102400_bootstrap_functions.sql:266`), pathological for invite-created users and absorbed by the fallback. (ii) The surfacing line had moved from the gap's cited `welcome/actions.ts:69` to `:98` (C-6's rate-limit wiring shifted the region); the gap's substance was unchanged.

**C-6 constraints respected, by construction.** `rl.recordFailure()` stays first in the error branch (failed-only rate-limit semantics); the generic over-limit refusal ("Too many attempts. Try again later.") is untouched; and the mapping does not widen information disclosure — a sub-limit prober already received the raw distinguishing strings verbatim, so mapped copies conveying no more than the originals are neutral-or-better against the C-6 anti-probing posture.

**Verified.** `tsc --noEmit` clean; full production `next build` clean (also confirming the non-exported sync helper is legal in the `'use server'` module). The mapper is a pure total function over strings — ordered lowercase-substring matching, read back against the six raise strings in the migration; an RPC reword degrades to the generic fallback rather than leaking internals. Runtime reproduction of the error states is blocked by the same constraint C-1 recorded (each requires a deliberately mismatched, revoked, or deleted identity state against the live pre-launch project); the six input cases plus the fallback are the port-when-ready unit tests for when a TypeScript test runner lands (same deferral as the C-4 `postAuthLanding` cases).

**Failure modes mitigated.** F-12 — "already been accepted by another user" no longer reads as an accusation, and "email mismatch" now tells the user the one thing they can actually do (sign out, tap the link again) instead of presenting as a system fault.

**Accepted, not mitigated.** (a) Substring matching is coupled to the RPC's message wording — a reword silently downgrades that case to the generic fallback. Deliberate: the fallback is safe and humane, and the coupling direction (reword → vaguer, never → leak) is the right failure mode. (b) No runtime browser verification of the mapped states this pass, per the standing auth-block; recorded with the port-when-ready cases above. (c) The two pathological raises are deliberately not given bespoke copy — the fallback's "resend" recovery is correct for both.

**Section open set, corrected at this closure.** With C-13 closed, the open set is: **C-11, C-12** (execution order: C-11 → C-12). This supersedes the open-set clause in the C-10 closure above per the doc's supersede-by-append convention.

---

## C-13 reviewer follow-up (2026-06-10) — sign-out escape in the account-mismatch state

During the C-13 sign-off review, the reviewer traced the mismatch copy's instruction ("Sign out, then tap the invite link again") into the rendered state and found **no sign-out affordance existed on `/welcome`** — `AuthShell` is purely presentational (its only interactive element is the brand-logo link), `WelcomeForm` was password fields only, and the route has no layout of its own. The copy pointed at a control the page did not provide; the most common real-world trigger (tapping an invite while signed into a different account on a shared device) dead-ended.

**Fix shipped at the reviewer's direction (commit `7a4b772`), three files.** `WelcomeState` gains an optional `recovery?: 'sign-out'` discriminant; `mapAcceptInviteError` returns `{ copy, recovery? }` with only the email-mismatch branch setting `recovery` (one source of truth at mapping time — no duplicated substring check at the call site); `WelcomeForm` renders a sibling `<form action={logout}>` "Sign out" escape — `btn outline`, the defined secondary class at `globals.css:315-323`, mirroring FinishSetup's proven pattern — only when `state.recovery === 'sign-out'`. All six copy strings are byte-identical; the other four cases and the fallback deliberately get no button (their recovery runs through the practitioner, not a re-auth). The `[welcome-accept]` log line is untouched.

**Verified.** `tsc --noEmit` exit 0; full production `next build` exit 0 (header and route table pasted to the reviewer); `btn outline` confirmed real with the staff-dashboard precedent before commit. The diff was reviewer-signed-off pre-commit. Process note for the record: the reviewer's canonical commit message arrived with the `Co-Authored-By` angle brackets stripped in paste; the mandated pre-commit trailer check caught it, the commit was held, and it landed only after the operator confirmed the bracketed correction — the committed trailer reads `Claude Opus 4.8 (1M context) <noreply@anthropic.com>` verbatim.

---

## C-11 closed (2026-06-10) — Burn-on-click via POST claim; gap's drafted mechanism rejected as unsafe, closes F-9

**What shipped (commit `affbb3b`).** The gate button at `/i/[id]` now POSTs to a new server action (`continueInviteAction`, `src/app/i/[id]/actions.ts`) that atomically claims the token — `UPDATE invite_tokens SET consumed_at = now() WHERE id = ? AND consumed_at IS NULL AND expires_at > now() RETURNING action_link` via service role — and redirects to the Supabase verify URL server-side. `consumed_at` gains its writer; the page's already-built-but-dead "already been used" shell (`i/[id]/page.tsx:52`) becomes live code; the two partial indexes' `WHERE consumed_at IS NULL` predicates become meaningful.

**The gap's option (a) was rejected, not built — recon finding.** Option (a) ("write `consumed_at` server-side before returning the page") was drafted 2026-05-28, before C-14 established that body-parsing scanner classes (Safe Links/Proofpoint — C-14 deferred items 1–2) fetch URLs from email bodies. Burn-on-*render* would let a scanner's GET consume the token during delivery scanning and brick the invite for the human — recreating F-14 at our own layer, against exactly the inboxes C-14 flagged. The shipped mechanism preserves the gate's design premise: **a GET burns nothing; only the human's POST consumes, and scanners do not execute POSTs.** Open question 3 is resolved by this build (option (a) in spirit — the column's documented "burn on click" intent — with the mechanism corrected to an actual click).

**Bonus closure: the load-bearing half of C-14 deferred item (1), early.** The `action_link` no longer appears in the gate page's HTML, JS bundle, or even the render path's SELECT (`page.tsx` now selects only id/org/client/expires/consumed; the secret is read solely inside the POST action). The C-14 design weakness — "the raw action_link is present in the gate page HTML body, so a body-parsing scanner can reach it without ever touching the visible gate button" — is structurally closed. The residual of item (1), minting the link at POST time rather than at send time, remains deferred to the pre-paying-client gate as signed off (the pre-minted link now lives only in the DB, which is not a scanner-readable surface).

**Grace window (operator-approved recommendation).** A claim that loses because the token was consumed within the last 2 minutes still redirects to the `action_link` — forgiving double-taps and dropped-redirect retries by the human holding the link. Scanners gain nothing (no POSTs); a genuinely-exchanged link is still refused downstream by Supabase's own single-use gate, which remains the backstop. Beyond grace, the action bounces to `/i/<id>`, whose existing branches render the right shell. Progressive-enhancement side-effect: the form + submit button works without JavaScript; the previous `onClick`-only `window.location.assign` button did not.

**Verified — full runtime matrix driven end-to-end (the first C-item in this section fully drivable by Claude Code: the gate is public by design).** Method: seeded sentinel tokens whose `action_link` points at a local sentinel URL (`scripts/c11-burn-verify.mjs`, committed alongside — seed/check/age/teardown subcommands; sentinel-substring-scoped writes so teardown can touch nothing real). Results, all against the dev server: (1) GET of the gate → 200, button renders, **`c11-burn-target` absent from the served HTML** (the C-14-weakness closure observed directly), `consumed_at` still null after render; (2) submit → `consumed_at` set and the browser landed on the sentinel target URL (claim + redirect proven); (3) re-render of the used link → "already been used" shell, no button; (4) within-grace stale-tab submit (token aged 1 min via script while the gate tab stayed open) → still reached the target; (5) beyond-grace submit (aged 10 min) → bounced to the consumed shell; (6) expired seed → expired shell, no button; bad-uuid → not-found shell. Zero server errors across the matrix; teardown deleted all 4 sentinel rows with a 0-remaining read-back. `tsc --noEmit` exit 0; production `next build` exit 0. One honest method note: submits were driven via `form.requestSubmit()` — the DOM's native submit-as-if-by-button API, exercising the identical React server-action path as a tap — because the preview harness's synthetic `click()` did not dispatch a submitting click; a human finger does.

**Failure modes mitigated.** F-9 — `consumed_at` is no longer a misleading reserved field; the single-use story now has three layers (our burn → Supabase exchange single-use → 8h expiry) instead of two, and the second-render UX states the truth ("already been used") instead of re-offering a dead button.

**Accepted, not mitigated.** (a) Burned-but-never-exchanged: if the claim wins but the browser never completes the hop to Supabase *and* the user retries only after the 2-minute grace lapses, the token reads consumed though never exchanged — recovery is the C-5 resend button, which the consumed shell's copy already points at. (b) The grace window means a second device that obtains the gate URL within 2 minutes of the first tap could also reach the action_link — accepted: both devices hold the emailed link legitimately, and Supabase's exchange single-use still admits only one. (c) No purge job for expired `invite_tokens` rows exists (the migration comment anticipated one; the C-6 cron sweeps only `rate_limit_log`) — flagged for a future ops sweep, deliberately not bundled here. (d) The unauthenticated POST endpoint carries no rate limit, matching the unauthenticated GET it replaces — parity, not regression; an unauth rate-limit sweep is a separate concern.

**Section open set, corrected at this closure.** With C-11 closed, the open set is: **C-12** — the final item. This supersedes the open-set clause in the C-13 closure above per the doc's supersede-by-append convention.

**Operator-tap verification (2026-06-11) — the human-finger claim converted from reasoned to observed.** At the reviewer's request, the operator performed the full burn-on-click loop by hand against the dev server using the committed harness: seeded a sentinel token (`consumed_at: null` confirmed pre-tap); opened the gate in a browser and confirmed via view-source that `c11-burn-target` does not appear in the served HTML (the C-14-weakness closure observed directly); **tapped the button with a real click** — the browser landed on the sentinel target URL (the deliberate-404 proof of claim-and-redirect); `consumed_at` confirmed set post-tap; a second visit to the gate URL rendered "This invite link has already been used…" with no button; teardown deleted 1 sentinel row with a 0-remaining read-back. Every step matched its expected line. The closing note's method caveat (submits driven via `requestSubmit()` because the preview harness's synthetic click does not dispatch a submitting click) is now superseded by direct observation: a real human click submits the form and completes the loop end-to-end.

---

**Sign-off — C-13 (2026-06-11).** Reviewed via the claude.ai project chat; reviewer model Claude Opus 4.8 (1M context). **Decision: Closed.** The closing commit (`04fa578`) was reviewed in full, including the six-not-five raise-point correction and the C-6 constraints. The reviewer's own deep-trace of the mismatch copy's actionability produced the sign-out-escape follow-up, which was reviewer-designed, reviewer-signed-off at the diff, and committed as `7a4b772` with the reviewer's canonical message — the committed `Co-Authored-By` trailer confirmed intact with angle brackets (`Claude Opus 4.8 (1M context) <noreply@anthropic.com>`) after the pre-commit check caught the paste-stripped brackets. C-13 formally closed, inclusive of the follow-up.

---

**Sign-off — C-11 (2026-06-11).** Reviewed via the claude.ai project chat; reviewer model Claude Opus 4.8 (1M context). **Decision: Closed.** The reviewer accepted the closing commit — the rejection of the gap's drafted burn-on-render mechanism as unsafe post-C-14, the POST-claim-redirect design, the 2-minute grace window, the early closure of C-14 deferred item (1)'s load-bearing half, and the four accepted-not-mitigated items including the flagged-not-bundled `invite_tokens` purge job — conditional on one verification: that the machine-driven `requestSubmit()` evidence be matched by a real human tap. The operator performed that tap 2026-06-11 (record above); every step matched its expected line. C-11 formally closed; the Auth-and-Onboarding-client section remains open — open set: **C-12**, the final item.

---

## C-12 closed (2026-06-11) — `client_accept_invite` syncs profile names, closes F-11. The section's final gap.

**What shipped (commit `792323c`).** Migration `20260611090000_c12_client_accept_invite_profile_sync.sql` — a plain `CREATE OR REPLACE` of `client_accept_invite` (signature unchanged, grants persist) adding one UPDATE inside the SECURITY DEFINER transaction: after linking, `user_profiles.first_name/last_name` are overwritten from the clients row, replacing the `('Pending','Pending')` placeholders `handle_new_auth_user()` stamps. Plus pgTAP test `18_c12_client_pending_round_trip.sql`, the client-path twin of the staff test 15. No application code changed; types regen was a no-op.

**Decisions, as approved 2026-06-11.** (1) **RPC-side, not app-side** — RLS's "update own profile" policy would have permitted an app-side UPDATE with no migration, but a post-RPC app step can fail independently and strand the placeholder permanently (the welcome page short-circuits linked clients away from any retry — a miniature of the C-1 partial-completion class). Inside the RPC the sync is atomic with the linking: both or neither. This also restores architectural symmetry — the staff path has synced names inside its own bootstrap RPC since G-13. (2) **Unconditional sync** — `clients.*` is the canonical staff-maintained name source, and on the returning-client path the freshest staff-entered name should win. **Recorded constraint (migration header + here): if client profile self-editing ever ships (Phase 2), this UPDATE must gain a guard in the same change, or a re-invoked accept clobbers self-edits.** (3) Permanent pgTAP coverage per the G-13 precedent.

**Recon facts that shaped the build.** The F-11 claim "no client-facing surface reads `user_profiles`" re-verified at HEAD with one nuance: the booking-confirmation email reads a profile inside a client flow, but it is the *staff member's* profile (`portal/book/new/actions.ts:124-128`) — no surface reads a client's own row. `clients.first_name/last_name` carry the *identical* `length(trim()) BETWEEN 1 AND 100` CHECKs as `user_profiles`, so the sync can never violate the profile constraints. `user_profiles` carries no audit trigger and no `organization_id` — no audit side-effects.

**Verified — four layers.** (1) `supabase db push` applied (local = remote `20260611090000`); types regen no-op as expected for a function-body change. (2) Rolled-back live round-trip probe via `supabase db query --linked` (`BEGIN…ROLLBACK`, C-6 harness discipline): ephemeral auth user started `Pending Pending`, accepted an ephemeral invite, came out with the clients row's names and `clients.user_id` linked; post-probe persistence check returned 0 rows. (3) **Operator-run pgTAP test 18 green 5-ok** in the Supabase SQL editor against the live project, full-file single run. (4) **Operator-run end-to-end on production:** a fresh test client was invited, onboarded, and signed in to the portal post-migration; the backend read shows their `user_profiles` row carrying real names (onboarded 2026-06-10 22:30 UTC), while the two pre-migration client rows still show the legacy placeholders — the contrast proving the new RPC body is the writer.

**Failure modes mitigated.** F-11 — a client's profile row now mirrors their canonical name from the moment of acceptance; the latent "Pending Pending" rendering hazard for any future shared component is closed for every client onboarded from this migration forward. The `handle_new_auth_user()` comment's promise ("placeholders are overwritten by the application") is now true on both the staff and client paths.

**Accepted, not mitigated.** (a) **No backfill** for clients onboarded pre-migration — they keep `('Pending','Pending')` (observed live: two legacy rows). Harmless under the same no-reader rationale that kept F-11 at Low×Low; if a profile-reading surface ever ships, the backfill is a one-line service-role UPDATE joined through `clients.user_id`. (b) The unconditional-overwrite Phase-2 constraint, recorded above. (c) Test 18 inherits the suite's run-discipline (SQL-editor, live project, BEGIN/ROLLBACK) until a non-prod target exists.

**Section open set, corrected at this closure: EMPTY.** C-12 was the final open gap. All gaps in the corrected roster — C-1, C-2, C-4 through C-14, with C-3 closed as a documented closure — are now individually closed, C-1 through C-11 and C-13/C-14 with recorded reviewer sign-offs. What remains for the section is the ritual itself: the section-level Closing commit per the polish-pass protocol (gap-list summary, acceptance-test record, deferred items with re-triggers, premortem disposition), then the operator's claude.ai sign-off to formally close Auth and Onboarding (client).

---

# Closing commit — Auth and Onboarding (client)

**Date:** 2026-06-11. **Scope:** polish-pass section 2 of the locked order, opened 2026-05-28. Every gap in the corrected roster is individually closed above with per-item closing notes; this is the section-level synthesis required by the CLAUDE.md ritual. C-12 is the one item without an individual reviewer sign-off — its review is deliberately bundled into this section-level pass (its full closing note and four-layer verification record are directly above).

## 1. What was changed, in plain language

The client's entire first-contact journey — invite email, click-through gate, password creation, account linking, first portal screen, and every failure path between them — was taken from "working" to verified, recoverable, and honest:

- **Recovery paths now exist where dead-ends were.** A failed session-refresh after acceptance self-heals or offers a sign-out escape instead of soft-locking the client (**C-1**, mirroring staff G-2, plus the R-5 operator runbook). A client signing in directly or finishing a password reset lands on `/portal`, not a staff dead-end (**C-4**). The account-mismatch error now renders the sign-out control its own copy instructs (**C-13 reviewer follow-up**).
- **Copy stopped guessing and stopped wounding.** The welcome surface no longer asserts "invite expired" for states it cannot diagnose (**C-2**); the six database error strings no longer reach clients raw — each maps to recovery-oriented copy while the raw string goes to the server log (**C-13**, which also found a sixth raise point the gap list missed).
- **The EP got the controls the system already promised.** A "Resend invite" button on the client profile, shown only when meaningful, audit-trailed via the existing trigger (**C-5**) — the operational compensation for the 8-hour invite TTL.
- **Abuse limits moved from spec to enforcement.** `rate_limit_log` + SECURITY DEFINER limiters now gate invite sends (20/hr, fail-open) and invite acceptance (10 failures/hr, fail-closed), closing the `docs/auth.md §7.2` promise for two of its three named operations (**C-6**; the third is infra-ready, deferred-to-feature per P-I).
- **Password policy became visible and real.** The invite email and the welcome form both state the 12-character rule before the client can trip on it (**C-10**, whose recon falsified the gap's "hint exists" premise); the GoTrue backstop was restored from 6 to 12 during **C-7**, whose probe also established that HIBP breach-checking is plan-gated off on the free tier — documented with a self-arming re-test rather than pretended at.
- **The invite link's single-use story gained a real first layer.** The gate button now POSTs to a server action that atomically burns `consumed_at` and redirects server-side; the secret link left the page HTML entirely, closing the load-bearing half of C-14's deferred design weakness early (**C-11** — the gap's drafted burn-on-render mechanism was rejected as unsafe post-C-14). The anti-prefetch gate itself was verified against live Gmail (**C-14**: F-14 did not reproduce; un-breached, not exercised).
- **Day one looks intentional.** A first-run client sees a quiet welcome card instead of a false "Rest day" (**C-9**); their auth-side profile carries their real name instead of "Pending Pending" from the moment of acceptance (**C-12**, atomic inside the accept RPC, the client twin of staff G-13). Portal sign-out was verified discoverable and gained an operator-requested confirm dialog (**C-8**).
- **Production became real during this section, not after it.** Two same-day incidents found during C-14 verification were diagnosed to root cause and fixed (`c301832` poison-cookie 500; `c7750be` missing `NEXT_PUBLIC_SITE_URL` breaking owner/staff sign-in — `safeNext` decoupled from env, `/api/health` now reports config), the Supabase Site URL/redirect misconfiguration was corrected, and the first real client onboarding ever completed on production was performed and corroborated from the backend. **C-3** closed with no code: the audit's premise was wrong — archived clients lose data access at commit via RLS, not at token expiry. Retroactively, **R-4** was closed outright (automated cross-tenant pgTAP test, 8/8 green) after the manual tripwire's first full passing run.

## 2. Acceptance tests run, and results

The section has no single push-button suite; its acceptance record is the union of the standing harnesses and operator-run verifications, all green at close:

- **pgTAP (live project, BEGIN/ROLLBACK discipline):** test 17 cross-tenant isolation 8/8; test 18 client pending-name round trip 5/5 (operator-run 2026-06-11); test 15 staff twin remains the precedent it mirrors.
- **Script harnesses (all committed, re-runnable):** `verify-auth-config.mjs` formal run 2026-06-10 — G-1 GREEN (JWT hook injecting claims), G-3u RED-as-expected (HIBP plan-gate, documented), G-7 confirmed via Management API read, G-4 DOC; `proxy-poison-cookie-verify.mjs` 13/13 on dev, local production build, and live production; `staff-login-path-verify.mjs` 4/4 on live production; `c11-burn-verify.mjs` six-state matrix green; C-14 prefetch scripts (Gmail live test, detector pinned empirically).
- **Operator-run browser verification per item:** C-2 both unauth states; C-5 resend end-to-end with real email; C-8 sign-out flow ("works perfectly"); C-9 welcome card on localhost then end-to-end on production; C-11 full human-tap loop, every step matching its expected line; C-12 production onboarding with backend corroboration (fresh client's profile synced; pre-migration clients still placeholder — the contrast proving the writer).
- **The section's defining acceptance test — a real client onboarded on production end-to-end** (invite → gate tap → password → linked → portal), performed 2026-06-10 and re-proven 2026-06-11 through the C-12-updated path.
- `tsc --noEmit` and full production `next build` green at every shipment; every schema change followed migration → `db push` → types regen → verify.

## 3. Deliberately deferred, with re-activation triggers

**Pro-plan gate (one lever, three items):** HIBP breach-checking on all password paths, the definitive HIBP-on-`updateUser` answer (G-3u probe is built and self-arming), and the G-4 refresh-token max-lifetime — **re-trigger: Supabase Pro upgrade; at the latest, the Open-gates hard rule before any paying clinical client.**

**Pre-paying-client gate:** minting the invite `action_link` at POST time rather than send time (the residual of C-14 deferred item 1 after C-11 removed the embedded-link half); enterprise Safe Links/M365 re-run of `docs/runbooks/verify-invite-prefetch.md` — **re-trigger: before any paying clinical client onboards.**

**Feature-triggered:** `sendCommunication` rate limit wiring (infra-ready; **re-trigger:** first broadcast/reply send path, per P-I); the `client_accept_invite` profile-sync guard (**re-trigger: client profile self-editing shipping — same change, non-negotiable, recorded in the migration header**); backfill of legacy "Pending" profiles (**re-trigger:** any surface reading a client's `user_profiles` name); `/portal/you` error-branch sign-out + shared `ConfirmOverlay` extraction (**re-triggers recorded in the C-8 closure**).

**Tooling-triggered:** unit-test ports for `postAuthLanding` (five cases, C-4 note) and the C-13 error mapper (seven cases) — **re-trigger: a TypeScript test runner landing in the repo.** Runtime verification of C-1's branch-(b) recovery and C-6's infra-error branches — **re-trigger: a non-production Supabase target.**

**Operational, non-blocking:** the `invite_tokens` purge job (flagged at C-11); the doc-hygiene sweep of sync flags P-D…P-I plus the later additions (C-3 mechanism corrections in the body, §12.1 HIBP plan-gate annotation, the "EP vs practitioner" portal voice split → Client-portal polish, stale comments flagged at C-5/C-2); teardown of the live test clients at operator convenience. **Open question 1 (client session duration: 30-day uniform vs shorter) was never formally resolved** — current state is 30-day uniform; the levers to change it are Pro-gated alongside G-4. Carried as an open decision, not a gap.

## 4. Premortem disposition — mitigated vs accepted

**Mitigated:** F-1 (C-1 bounded recovery), F-2 (C-2), F-4 (C-4), F-5 (C-5), F-6 (C-6; fail-closed accept gate), F-7 (C-9), F-8 (C-10, premise corrected — no hint existed), F-9 (C-11; single-use now three layers and burn-on-render explicitly rejected), F-11 (C-12, forward from migration), F-12 (C-13 + sign-out escape follow-up).

**Resolved as false premise:** F-3 — the archived-client access window does not exist; data denial is immediate at archive commit via RLS (C-3 documented closure; the stale-tab cosmetic residual is accepted for all scopes). F-13 — the portal sign-out affordance already existed and met the bar (C-8; the confirm dialog was an operator enhancement, not a fix).

**Accepted, with rationale:** F-10 — no breach-checking on any password path until the Pro upgrade; the in-force control is the 12-character minimum at both app and GoTrue layers; residual (a beta user choosing a long breached password) accepted at friends-and-family scope with the re-trigger above. F-14 — did not reproduce on live Gmail (control and gated tokens both survived delivery + open); the gate is un-breached but was never exercised as an active control, and the enterprise scanner class remains untested behind its pre-paying-client re-trigger. Item-level accepted residuals (C-1's FinishSetup hang sliver, C-6's reading-verified error branches, C-9's fail-closed query error, C-11's burned-but-never-exchanged beyond grace and unauthenticated-POST parity, C-12's legacy placeholders, the seventeen-touch-point password-rule coupling) are recorded in their closing notes and stand as written.

---

*Per the ritual: Claude Code's job ends here. The section closes when this Closing commit is reviewed in the operator's claude.ai project chat and the sign-off is recorded below under a "Sign-off" heading. On a Closed decision, CLAUDE.md's "Active section" line advances to polish-pass order item 3 — Client profile and clinical notes.*

---

## Sign-off

**Date:** 2026-06-11
**Reviewer:** claude.ai project chat; reviewer model Claude Opus 4.8 (1M context)
**Decision:** Closed.

The reviewer green-lit the section Closing commit with three non-blocking, beta-gating actions, all verified by recon and executed at close:

1. **Re-triggers moved to live gate files.** Recon confirmed the reviewer's claim was half-true: the Pro-plan lever (HIBP, G-4) was already in `go-live-checklist.md` §1 — gated *before first real data*, stronger than this doc stated — but the two pre-paying-client riders existed only here. Fixed: §8 gained the mint-at-POST and enterprise-Safe-Links rows, §7 now names the self-arming G-3u answer as part of the cutover re-run, §1 carries the OQ1 session-duration decision at its actionable moment, and CLAUDE.md Open gates gained a Technical gate index paragraph pointing at the checklist — every rider is now reachable from the master contract.
2. **The post-deploy health check became a standing ritual.** New runbook `runbooks/deploy-the-app.md` (pre-push build gate → push → `/api/health` curl on every deploy → role-branch + poison-cookie harnesses after auth-surface changes), indexed in the runbooks README and closing its long-standing suggested-runbook #8. The checklist's §3 env-var row is annotated confirmed-in-production with the runbook as its continuous check.
3. **Test data purged.** The operator archived every non-keeper; all 15 archived client rows were then hard-deleted with their dependents (6 appointments, 2 programs and their trees, 6 invite tokens via cascade) and both linked test auth users, in one FK-ordered transaction with a pre-run safety check proving no doomed auth user was shared with a kept row. Post-purge state, verified live: **4 clients remain — David Browning, Isaac Fong (seed), Scott Browning, Wendy Browning — 0 archived rows, 0 test auth users.**

The named-not-actioned thread — **open question 1, client session duration** — is recorded at `go-live-checklist.md` §1 to be decided deliberately at Pro cutover, in the same dashboard visit as G-4.

**Auth and Onboarding (client) is formally closed.** CLAUDE.md's Active section advances to polish-pass order item 3 — Client profile and clinical notes.

---

## Deferred-item closures (post-sign-off)

### `client_accept_invite` anon-EXECUTE — verified and revoked, 2026-07-02

The platform-wide §4 sweep (`docs/go-live-checklist.md`) held this function open pending one question: **is it ever called pre-authentication?** (A blind revoke could have broken the invite-accept flow.) Verification, 2026-07-02, by code enumeration:

- The **sole runtime caller** is `setPasswordAndAcceptAction` (`src/app/welcome/actions.ts`), which runs **after** the magic-link callback has established a session — it calls `auth.getUser()` and `updateUser()` (both session-requiring) *before* the RPC. Every other repo reference (`FinishSetup.tsx`, `src/lib/clients/invite.ts`, staff `actions.ts`, rate-limit lib) is a comment.
- The RPC body itself raises `Not authenticated` when `auth.uid()` is null (in-body guard, the load-bearing protection during the open window).

**Answer: never pre-auth → anon revoke safe.** Migration `20260702130000` revoked anon EXECUTE (authenticated retained — the welcome flow's role), alongside the rest of the §4 candidate bucket (`create_organization_with_owner`, `staff_create_client_invite`, and the audit-infra internals to definer-only). pgTAP `52_onboarding_audit_rpc_grants.sql` (14/14 on live, 2026-07-02) is the regression tripwire; pgTAP `51` re-ran green post-revoke, proving audited authenticated writes (the `log_audit_event` → `audit_resolve_org_id` chain) are unaffected. With this, the §4 sweep's candidate bucket is **fully discharged** — no open anon-EXECUTE items remain anywhere in the sweep.

---

## C-14 deferred item 1 closure — invite link minted at POST (2026-07-21)

**Status: BUILT on staging (pending prod apply at the next deploy sitting + the sign-off ritual).** The residual left after C-11's burn-on-click (the pre-minted link living in the DB from send time) is closed: pulled forward from the paying-client gate as Step 4 of the 2026-07-21 internal work sequence.

**What shipped** (migration `20260721150000_invite_link_mint_at_post.sql` — `invite_tokens.action_link` now nullable; `src/lib/clients/invite.ts`, `src/lib/clients/invite-link.ts` (new — the extracted mint + already-registered fallback), `src/app/i/[id]/actions.ts`, `page.tsx`):

- **Send** stores the token row with `action_link` NULL and emails only the `/i/<id>` gate URL. No live OTP link exists anywhere between send and tap. `getPublicOrigin()` stays at send (G-11 fail-loud in front of the EP).
- **The human's POST mints.** `continueInviteAction`'s winning atomic claim now calls `mintAcceptLink` (invite → magiclink fallback, logic unchanged, moved to `invite-link.ts`), stores the minted link on the row (preserving the C-11 double-tap grace window), and redirects. The OTP's TTL starts at the tap, not at send — a slow inbox can no longer burn it.
- **Mint failure un-claims** (`consumed_at` → NULL) and bounces to the gate with a gentle retry alert — safe to re-open because scanners never POST (the C-11 premise), and gate expiry still applies.
- **Deploy-skew safe, no shim:** a claim that finds a stored `action_link` (a row written by the old code) redirects it directly; only null-link rows mint.
- **Grace-window note:** a double-tap landing before the winner's mint completes falls through to the bounce (the winner's redirect is already in flight) — disclosed, not hidden.

**Verified live on staging (2026-07-21):** a NULL-link token for a seeded synthetic client → gate rendered → tap minted + redirected through staging GoTrue → landed authenticated on `/welcome` set-password; row shows consumed + staging-minted link stored; re-visiting the gate renders the "already been used" shell (burn semantics intact). `tsc` green; types regenerated. `scripts/c11-burn-verify.mjs` seeds sentinel-link rows and therefore exercises the legacy stored-link path — still valid for the burn/grace machinery it asserts.

**What this does to the C-14 scanner-class weakness:** with no link in the HTML (C-11) and now no link minted before the human acts, a body-parsing scanner has nothing to reach at any point. The **enterprise Safe Links/M365 behavioural re-run** remains the outstanding confirmation (checklist §8) — it needs an M365 mailbox and stays at the paying-client gate.
