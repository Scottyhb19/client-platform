# Parity-pass sitting record — 2026-07-23 (paying-client parity, executed)

**One-time sitting record** (the `prod-apply-sitting-2026-07.md` pattern). Operator directive: *"complete parity for paying clients bar the external reviewing process that neither of us can do; do not spend money."* Everything below ran autonomously in one session; commit `d53eeb4` carries the build + ledger updates, this record carries the prod-verify evidence.

## What closed (all previously paying-client-gated; index: `go-live-checklist.md` §8)

| Item | Closure | Tripwire |
|---|---|---|
| G-6 F-4 TRUNCATE blind spot | `20260723120000` REVOKE from service_role | pgTAP 61 #9 |
| G-6 F-2a/F-2b §11 alert thresholds | `client_ip` capture + `auth_events_threshold_scan()` + `auth-events-alerts` EF, hourly Vault cron | pgTAP 61 #10, #12–14 |
| G-6 F-1 org-attribution snapshot | `organization_id_snapshot` stamped at insert | pgTAP 61 #11 |
| G-6 B-4 audit-write failure routing | `logAuthEvent` → `captureException` seam | scenario COMMS-5 sibling |
| §12 unbounded-resend latent | `20260723130000` non-fatal trigger + SMS branch + EF send bound | pgTAP 62 #7–9 + `reminder-logic-verify` 12/12 |
| Completed-lock hard gate (RPC-only unassign) | `20260723140000` guard branch (c) + `unassign_program_day()` | pgTAP 60 #18–22 |
| CN-7 FM-8 archived message history | `20260723160000` archived-arm thread policy + Comms-tab transcript | pgTAP 63 + harness |
| CN-7 P2-3 archived portal end-state | `AccessEnded` closed door in the portal layout | e2e parity-pass |
| G-15 staff deep-link drop | middleware `isProtected` widened (fix shape (a)) | e2e parity-pass (incl. re-derived claimless control) |
| Origin-idiom consolidation | all 3 silent-fallback chains → `getPublicOrigin()` (entry undercounted by 2) | fail-loud + health check |
| clinical_notes client-deny coverage | new suite | pgTAP 64 |
| R-4 request-path half | `scripts/r4-request-path-verify.mjs` — real GoTrue tokens over raw PostgREST | script (staging green; reviewer re-runs on prod) |
| Ledger holes | staging-to-prod-parity standing entry; §12 Leg-2 stale line reconciled; exclusions register added | — |

## Verification record

- **Staging:** 6 migrations applied; full pgTAP **64 files** (one first-run failure — suite 60, the guard's flat-AND record-field evaluation — root-caused, fixed in the migration file, corrected body re-applied to staging, 60 re-run **22/22**; hash parity later proved zero drift); types regen + `tsc` green; `next build` green; eslint clean; e2e **13/13**; R-4 probe **all green** (with one expectation corrected to the tenant-boundary reality: cross-INSERT is refused by `enforce_same_org_fk` before RLS `WITH CHECK`, zero residue).
- **Production (explicit prod channels only):** both EFs deployed (`auth-events-alerts` new, `send-appointment-reminders` updated) BEFORE the cron migration; `db push` applied exactly the 6, zero pending after; pgTAP **17: 8/8** and **63: 6/6** run on prod (BEGIN/ROLLBACK); catalog census all-true (TRUNCATE revoked, 2 new columns, FM-8 policy, cron job, RPC grants); **CR-normalised function-hash parity staging≡prod on all four touched functions**; frontend deployed (`d53eeb4`), `/api/health` 200 db:ok config:ok; **standing synthetic send check GREEN** (`succeeded:1`, row `sent` + provider id, derived comms row exact, teardown comms-first, census 0/0); `auth-events-alerts` invoked with the cron bearer → **500 "missing alert config"** — the designed fail-loud (see below).

## Operator actions remaining (each blocked from this session by permissions or policy, none by build state)

1. **Set the alert inbox** (the session's permission gate blocked `supabase secrets set`):
   ```powershell
   cd "C:\Users\scott\Desktop\Client Software Platform"
   supabase secrets set ALERT_EMAIL=<your alert inbox> --project-ref azjllcsffixswiigjqhj
   ```
   Until set, the hourly `auth-events-alerts-hourly` tick returns 500 "missing alert config" (EF logs) — fail-loud, never a silent skip. After setting, the next :07 tick should return 200 `{breaches:0}`.
2. **Optional env tidy-up:** remove the now consumer-less `NEXT_PUBLIC_APP_URL` from Vercel (the reminder EF keeps its own copy in the Supabase secret set); then drop the key from `required-env.ts` in the same change.
3. **Sign-off ritual** for the four appended closures (G-6 register / unbounded-resend / hard gate / FM-8+P2-3), per the standing pattern.

## What remains open at the paying-client gate — by design, not omission

The §8 **exclusions register** (same commit) is the authority: PITR + S3 exports (money), pen test (money + external; deferred-with-justification recorded for the Tier-2 clause), Safe Links M365 re-run (no enterprise mailbox exists), session-duration revisit (operator config decision at onboarding), §12 compose (operator-decided feature deferral with OAuth decisions), hard rule (a)/(b)/(c) (external review / BAA / entity), Cliniko migration (its own project).
