# Runbook — Verify the invite anti-prefetch gate

> Mechanism and design cited from `docs/polish/auth-onboarding-client.md` (gap **C-14**, reviewer revisions 2026-05-29 items 3 + 5; premortem **F-14**) and `supabase/migrations/20260426100000_invite_tokens.sql`. Scripts: `scripts/c14-prefetch-probe.mjs` (detector baseline) and `scripts/c14-prefetch-test.mjs` (live send/check/teardown). This is an **operator-run** verification, because only a real mailbox plus a real human tap can exercise a real link-prefetcher — neither can be faked from code.

**Purpose:** Confirm the `/i/[id]` click-through gate actually stops a real mail-client link-prefetcher from consuming the one-time Supabase invite token *before* the human taps. The gate is the §5.3 step-3/step-4 deviation: the invite email points at `/i/<token_id>` on our domain (a page with a "Continue to your portal" button that fires `window.location.assign(action_link)` on a real click — never an `<a href>`, never an auto-redirect), so a prefetcher that GETs the gate page sees no redirect and stops, leaving the one-time `action_link` un-fetched. The defence had never been tested against a live prefetcher; an unverified load-bearing defence on the most fragile point of client onboarding does not meet the section bar.

**The threat, precisely (why a bare GET matters).** The Supabase `action_link` is a one-time `…/auth/v1/verify?token=…` URL. A **bare GET of it consumes the token and confirms the user server-side at `/verify`, before any redirect is followed** (proven by the baseline probe below). So the gate's whole job is to ensure a scanner never GETs the `action_link` — it must only ever see the gate page, which reads but never consumes. The residual the test probes: the `action_link` *is* present in the gate page's server-rendered HTML (it is a prop to the `'use client'` `ContinueGate`), so a scanner that parses the page body and fetches embedded URLs *could* reach it. The test answers whether real scanners actually do.

**The detector.** Consumption is **not** tracked in `invite_tokens` (`consumed_at` is never written — see C-11). It is observable in the Supabase auth schema: `auth.users.email_confirmed_at` flips `null → timestamp` the moment the `action_link` is fetched by anyone. So:

- `null` after delivery + open, before any human tap ⇒ **NOT consumed** (gate holds).
- `timestamp` before any human tap ⇒ **CONSUMED** (the prefetcher won — gate inadequate).

**Prerequisites**

- `.env.local` at the repo root with `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and `EMAIL_FROM`. The scripts read these directly; neither the service-role key nor the Resend key is ever logged.
- Node (the repo's pinned version). Plain ESM — no extra tooling.
- Run from the **repository root**. **Operator's machine only** — never CI, never an HTTP endpoint.
- A **real inbox you control** for the receiving mailbox. Gmail `+alias` addresses work and deliver to the same inbox as distinct identities (so a fresh `+alias` is a clean `type:invite`, not the magic-link fallback). **Use a fresh, never-before-used alias each run** so the send does not fall back to magic-link.
- A **publicly-reachable gate URL**. The scripts hardcode the production origin `https://odysseyhq.com.au` for the gate URL, so production must be serving the `/i/[id]` route (it is — the route is public, cookie-free, and renders without the broken `/login` path). Local-only setups cannot run this test (a `localhost` gate URL is unreachable by a mail scanner).

**Steps**

1. **Baseline the detector** (establishes which auth field flips and proves a bare GET consumes — creates + deletes one throwaway `@example.com` user, sends no mail):
   ```
   node scripts/c14-prefetch-probe.mjs
   ```
   Confirm it reports `consumption trigger: BARE GET (no redirect follow)` and `detector field: email_confirmed_at`.
2. **Send** the two parallel test emails to your inbox (pass your real org id; the live project carries leftover test orgs that defeat auto-resolve):
   ```
   node scripts/c14-prefetch-test.mjs send <organization_id>
   ```
   `B1 CONTROL` (`+…ctl` alias) carries the **raw action_link, no gate** — the pre-gate failure mode, testing whether the scanner consumes that URL at all. `B2 GATED` (the real alias) carries the **production gate URL**, testing the gate itself.
3. **Baseline check** immediately:
   ```
   node scripts/c14-prefetch-test.mjs check
   ```
   Both must read `NOT consumed`.
4. **Operator — receive, wait, open, do not tap.** Confirm both emails arrived (inbox **and spam**). Leave them ~10–15 min for delivery-time scanning. Then **open both** (view/scroll) for the on-open scan path. **Tap neither link.**
5. **Post-scan check:**
   ```
   node scripts/c14-prefetch-test.mjs check
   ```
   Read the verdict matrix below.
6. **Operator — tap both, to prove the links were live.** Control: tap its link (goes straight through). Gated: tap its link → the gate page → **tap the "Continue to your portal" button**. (You may land on an error page post-tap — that is the separate production redirect/login config issue, not the gate; the token still consumes at `/verify`.)
7. **Post-tap check** — both should now read `CONSUMED`, proving both links were live the whole time (so the step-5 "NOT consumed" was the scanner declining to fetch, not a dead link).
8. **Teardown** (hard-deletes both auth users + the test client + invite_tokens; verifies clean):
   ```
   node scripts/c14-prefetch-test.mjs teardown
   ```

**Verdict matrix (read at step 5, before any human tap)**

| B1 control (raw link) | B2 gated (real invite) | Meaning |
|---|---|---|
| consumed | **NOT consumed** | Strongest pass — the scanner consumes a raw verify link, the gate defeats it. |
| **NOT consumed** | **NOT consumed** | Pass — the scanner does not fetch-consume this URL shape at all; the gate is not breached (and was not the active ingredient for this client). |
| — | **consumed** | **Fail** — the scanner reached the `action_link` behind the gate. The gate is inadequate; a contingent code fix opens (require POST-not-GET to consume; or move token exchange into a button-triggered server action unreachable by a GET). |

**Honest caveats (carry into any close).**

- **Point-in-time.** A result is for the specific mail clients tested on the test date. Gmail/Outlook can change scanner behaviour; this is not a permanent "prefetch-proof" guarantee.
- **The `action_link` is in the gate HTML**, so the gate is *theoretically* bypassable by a body-parsing scanner. The test shows whether the real clients tested *do* — not that none ever *could*.
- **Detector is on the invite path.** Keep each run on a fresh `+alias` so the magic-link fallback does not change the observable.
- **Corporate/enterprise scanners are the more aggressive consumers.** Outlook Safe Links (Microsoft Defender for Office 365) is *not* present on a free outlook.com account — it needs an M365 business tenant. A Gmail-only pass is **partial**; enterprise Safe Links is the named untested surface.

**Cadence**

- **Before onboarding any paying clinical client** (per CLAUDE.md Open gates): (1) re-run including at least one enterprise-Safe-Links mailbox; **and** (2) implement the server-side token-mint hardening — hold the token server-side and mint the `action_link` only on an explicit human POST from the gate page. Per the C-14 sign-off (2026-06-10, Deferred item 1), the current gate is structurally near-cosmetic against a body-parsing scanner (Safe Links, Proofpoint) *by construction*, because the `action_link` is present in the gate page HTML — so the POST hardening, not the re-test, is the actual fix for that scanner class.
- **On any change to the invite/gate flow** — `src/lib/clients/invite.ts`, `src/app/i/[id]/**`, the invite email template, or `invite_tokens` — re-run.

**Rollback**

N/A — verification only. The scripts self-clean: `teardown` hard-deletes every row a run creates, and the baseline probe deletes its throwaway user in a `finally`. Audit-log rows from the test client's INSERT remain as an append-only trail (they reference a now-deleted client id; harmless) — purge by service-role only if a pristine audit trail is wanted.

---

## Run log

| Date | Client | Control (raw link) | Gated (real invite) | Verdict | Notes |
|---|---|---|---|---|---|
| 2026-06-10 | Gmail (desktop Chrome, receive + tap) | **NOT consumed** through delivery + open (~22 min); consumed only on tap at 00:34:26Z | **NOT consumed** through delivery + open (~22 min); consumed only on gate-button tap at 00:36:30Z | **Pass (Gmail) / partial overall** | Baseline probe first: detector = `email_confirmed_at`, bare GET consumes (303, not followed). Sent 00:11:46Z to `scottyhb19+g2j…` (gated, prod gate `/i/610205f9…`) + `scottyhb19+g2jctl…` (raw `action_link`), org `the-odyssey-platform`. Both `null` at baseline (00:12), after delivery (00:24), and after open (00:29). Operator tapped both → both `email_confirmed_at` set → both links proven live. Gate page rendered correctly on production ("One tap, Prefetch."). Even the **ungated control survived** — Gmail did not fetch-consume the verify URL gated or not, so the prefetch threat did not reproduce for current Gmail; the gate is not breached. Teardown clean (0 rows remaining). **Discovered out of scope (not a gate defect):** post-tap redirect landed on `localhost:3000/#access_token` (Supabase Site URL = localhost / prod callback not allow-listed) and `/login` 500s in cookied browsers — both production-config beta-blockers, filed as separate tasks. **Untested:** enterprise Outlook Safe Links (no M365 tenant). |
