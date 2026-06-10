# Runbooks

Operational procedures for OdysseyHQ. Each runbook is self-contained and follows the same shape: **evidence base → Purpose → Prerequisites → Steps → Verification → Rollback**. If a procedure is not derivable from the codebase and commit history, the runbook says `TODO — procedure not yet documented` rather than inventing plausible steps. An honest stub beats a confident fabrication.

## Available runbooks

- [`rotate-a-secret.md`](rotate-a-secret.md) — Rotate `RESEND_API_KEY` or `CRON_SHARED_SECRET`. Service-role-key rotation is an explicit TODO.
- [`deploy-an-edge-function.md`](deploy-an-edge-function.md) — Deploy `send-appointment-reminders` (or any Edge Function) and (re)schedule its pg_cron trigger.
- [`check-cron-health.md`](check-cron-health.md) — Inspect pg_cron job + Edge Function health and triage failures.
- [`verify-auth-config.md`](verify-auth-config.md) — Verify the four dashboard-config security properties (custom-access-token hook, HIBP, refresh-token lifetime, email confirmations) via `scripts/verify-auth-config.mjs` + documented value. Cadence: quarterly + on every RLS/auth migration.
- [`verify-cross-tenant-isolation.md`](verify-cross-tenant-isolation.md) — Manual by-hand confirmation that one org cannot read/write another org's rows. The interim compensation for suggested-runbook #1 (the automated pgTAP cross-tenant test) while it stays deferred.
- [`recover-stuck-client-onboarding.md`](recover-stuck-client-onboarding.md) — Operator procedure for a client reporting they signed in to the portal and saw "Not authorized". Distinguishes the two C-1 R-5 sub-states (membership-never-created vs JWT-stale) and clears each. Compensating control for the C-1 R-5 sub-case where the in-flow FinishSetup recovery was bypassed or never ran.
- [`verify-invite-prefetch.md`](verify-invite-prefetch.md) — Verify the `/i/[id]` anti-prefetch invite gate stops a real mail-client link-prefetcher from consuming the one-time invite token before the human taps (C-14 / F-14), via `scripts/c14-prefetch-test.mjs` + a real mailbox. Cadence: on any invite/gate-flow change, and before onboarding any paying clinical client (including an enterprise Safe Links mailbox).

## Not yet written

> **Tier dependency.** Some items below depend on Supabase Pro tier features (PITR, Vault, etc.). Confirm current tier before scoping a runbook that assumes them.

This is a planning artefact, not a commitment. Items here are observed gaps, not scheduled work.

### Suggested runbooks (repo-derived)

1. Add a pgTAP test asserting direct cross-tenant SELECT/UPDATE is blocked (diagnostic CRITICAL #5 — bare-table test absent).
2. Migrate the inline pg_cron `CRON_SHARED_SECRET` literal (job_id 1) to Supabase Vault (rotation-log Follow-up; `docs/polish/client-portal-booking.md:168`).
3. Verify a Resend sending domain (SPF/DKIM/DMARC) and cut `EMAIL_FROM` over from the sandbox sender (diagnostic CRITICAL #1).
4. Onboard a friends-and-family beta tester end-to-end (invite → `/i` token gate → `/welcome` → portal).
5. Restore the database from Supabase PITR (confirm Pro tier + window first) (slos.md / incident-response.md, dashboard-only).
6. Run the pgTAP suite against remote Supabase with no local Docker (memory-noted constraint).
7. Apply a schema migration: migration file → `db push` → `gen types` → verify (standing process).
8. Post-deploy production smoke checklist (diagnostic Section 4 — none exists).
9. Document email delivery health (Resend dashboard checks, bounce handling, sandbox vs verified domain delivery).

### Tracked follow-ups

Canonical wording — cross-referenced verbatim from `CLAUDE.md` and `docs/secrets-inventory.md`. Do not paraphrase; downstream docs point at these exact strings.

- **Flag D:** Reconcile external-review-gate language across auth.md, slos.md, incident-response.md, and the diagnostic — currently divergent from CLAUDE.md after Build Prompt #2.
- **Flag E:** Reconcile NEXT_PUBLIC_SITE_URL vs NEXT_PUBLIC_APP_URL — currently dual-keyed for the same logical value across signup, booking, and reminder email paths. Signup uses NEXT_PUBLIC_SITE_URL; booking and reminder emails use NEXT_PUBLIC_APP_URL. Until reconciled, both must be set to the same value in every environment or the signup and booking confirmation URLs break.
- **Phase 2 AI data flow:** Before any Phase 2 feature is enabled in the friends-and-family beta, document the AI data flow: what clinical-adjacent data is sent to the inference layer, where it's processed, what gets retained, and how it interacts with the architectural principle of identified data staying internal as rules-based automation while AI receives de-identified data only.
- **SUPABASE_SERVICE_ROLE_KEY rotation:** Determine rotation status of SUPABASE_SERVICE_ROLE_KEY (diagnostic external-confirm item #6). If it has never been rotated since initial deploy and has ever sat in .env.local on a non-current machine, rotate it. The service-role key bypasses RLS and is the highest-privilege credential in the system.
- **Flag F — CLOSED by 8780e7c.** Booking-confirmation email path at src/app/portal/book/new/actions.ts:85 silently swallowed all email failures via .catch(() => null), including EmailConfigError from Commit 5 (1656859). Surfaced by the Commit 5 caller audit. Closed by type-discrimination in .catch: re-throw EmailConfigError, return null on all other errors. Sanity-sweep at fix time confirmed no other email-send patterns or fail-silent .catch chains on the email-send surface elsewhere in the codebase.
