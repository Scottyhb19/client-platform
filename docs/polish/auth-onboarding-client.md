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
