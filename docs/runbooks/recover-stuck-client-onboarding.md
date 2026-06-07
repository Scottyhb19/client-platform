# Runbook — Recover a stuck client onboarding

> Closes the R-5 sub-case from `docs/polish/auth-onboarding-client.md` C-1. The primary C-1 recovery (refreshSession failure during onboarding, while the client is still in the welcome flow) is handled in-flow by `src/app/welcome/install/page.tsx`'s membership-without-claim branch + `src/app/welcome/install/_components/FinishSetup.tsx`. This runbook covers the cases where that in-flow recovery never ran (welcome step 2 RPC failed, so no membership row was ever created) or was bypassed (closed tab, dead session) and the client now reports they cannot reach the portal.

**Purpose:** Identify which of two stuck sub-states a reporting client is in and clear it.

| Sub-state | What happened | Recovery |
|---|---|---|
| (a) | Welcome step 1 (set password) succeeded but step 2 (`client_accept_invite` RPC) failed. No `user_organization_roles` row was ever created; `clients.user_id` is still NULL. | Resend the invite via the staff `/clients/[id]` profile (C-5); the client re-traverses the welcome flow. |
| (b) | Membership row exists, but the client's JWT does not carry the `user_role` claim and the in-flow FinishSetup recovery never ran (closed tab) or both refresh attempts failed. | Force-revoke the client's sessions (Supabase dashboard); their next sign-in issues a fresh JWT through the Custom Access Token Hook. |

**Prerequisites**

- Supabase SQL Editor access (project owner) — to read `auth.users` and `public.user_organization_roles`.
- Supabase dashboard admin access (Authentication → Users) — to force-revoke a stale session for sub-state (b).
- Staff app access — to use the `/clients/[id]` "Resend invite" control for sub-state (a).
- The client's reported email.

**Steps**

1. **Confirm the symptom.** Client signed in to the portal and saw "Not authorized" (`/unauthorized`) instead of their portal home. Take a screenshot or URL confirmation before diagnosing — the same UX is also produced by a staff/owner mistakenly visiting `/portal` and by an archived client whose `clients.deleted_at` is set, neither of which is in scope for this runbook.

2. **Look up the auth user.** In the Supabase SQL Editor:
   ```sql
   SELECT id, email, created_at
   FROM auth.users
   WHERE lower(email) = lower('<client_email>');
   ```
   Expect exactly one row. If zero rows, the client never accepted any invite at all — escalate to the standard invite-send path (create the clients row + send the invite from `/clients/new` if not already done); this runbook does not apply.

3. **Check the membership row** using the `user_id` from step 2:
   ```sql
   SELECT user_id, organization_id, role
   FROM public.user_organization_roles
   WHERE user_id = '<user_id_from_step_2>';
   ```
   - **Zero rows → sub-state (a).** The membership row was never created. Welcome step 2 failed. Go to step 5.
   - **One row with `role = 'client'` → sub-state (b).** Membership exists; the JWT is stale. Go to step 6.
   - **Any other shape** (multiple rows, role other than `client`, etc.) → escalate and stop. Do not attempt recovery.

4. **Cross-check the clients row** (defensive — confirms the sub-state classification):
   ```sql
   SELECT id, organization_id, email, user_id, onboarded_at
   FROM public.clients
   WHERE lower(email) = lower('<client_email>')
     AND deleted_at IS NULL;
   ```
   Expect exactly one row. In sub-state (a), `user_id` should be NULL and `onboarded_at` should be NULL. In sub-state (b), `user_id` should equal the auth user's id from step 2 and `onboarded_at` should be populated. A mismatch — e.g. step 3 returned zero membership rows but step 4 shows `user_id` set — means an inconsistent state. Escalate and stop; do not attempt recovery on inconsistent state.

5. **Recovery for sub-state (a) — resend the invite.** In the staff app, navigate to `/clients/<client_id>` (the `clients.id` from step 4). Tap the **Resend invite** control (the C-5 button; visible because `clients.user_id IS NULL AND clients.invited_at IS NOT NULL` both hold). A fresh `/i/<token>` link emails the client. They re-traverse the welcome flow; on the second attempt the full `setPasswordAndAcceptAction` runs end-to-end. The RPC is idempotent on retry-by-same-user (the `client_accept_invite` guard at `supabase/migrations/20260420102400_bootstrap_functions.sql:282–284` does not fire when the caller's `auth.uid()` equals the existing `clients.user_id`; the membership INSERT carries `ON CONFLICT (user_id, organization_id) DO NOTHING`). Skip to step 7.

6. **Recovery for sub-state (b) — force a fresh JWT.** Two paths, either works:
   - **Operator-side (preferred).** Supabase dashboard → Authentication → Users → find the user by email → use the user-detail panel to sign the user out (the dashboard surface for `admin.signOut(user_id, 'global')`). The client's existing sessions are server-side-revoked; the next sign-in issues a fresh JWT through the Custom Access Token Hook and the role claim lands.
   - **Client-side (fallback).** Tell the client to clear cookies for the site (or open the portal in a fresh incognito/private window) and sign in again. Same end result — the next sign-in carries a JWT freshly issued through the hook.

7. **Confirm recovery.** Have the client sign in again. They should land on `/portal` directly (C-4 role-aware redirect). Re-run step 3's query to confirm the membership row is in place and `role = 'client'`.

**Verification (what healthy looks like)**

- `SELECT user_id, role FROM public.user_organization_roles WHERE user_id = '<user_id>'` returns one row with `role = 'client'`.
- `SELECT user_id, onboarded_at FROM public.clients WHERE lower(email) = lower('<client_email>') AND deleted_at IS NULL` returns one row with `user_id` matching the auth user and `onboarded_at` populated.
- The client confirms they reach `/portal` and see their portal home, not `/unauthorized`.

**Remediation when recovery fails (escalation)**

If step 5 (resend → re-traverse) lands the client on `/unauthorized` again after a clean second attempt, OR if step 6 (forced sign-out) yields the same lockout on the client's next sign-in, the JWT custom-access-token hook is suspect. Run `node scripts/verify-auth-config.mjs` and re-confirm G-1 GREEN per [`verify-auth-config.md`](verify-auth-config.md). Repeated failures across multiple clients within a short window strongly suggest the hook is disabled — treat as a production incident, not a per-client recovery.

**Rollback**

N/A — both recovery paths are forward-progressing. Sub-state (a)'s resend creates a fresh invite token via the C-5 helper and refreshes `clients.invited_at`; it does not delete or invalidate the previous invite token explicitly (the previous one expires naturally on its 8h TTL or is superseded on next click). Sub-state (b)'s forced sign-out invalidates existing sessions only; the user's account, password, and onboarding state are unchanged.
