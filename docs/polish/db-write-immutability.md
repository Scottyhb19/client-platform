# DB-level write immutability — the CN-7 trigger family + completed-session lock

**Status: BUILT 2026-07-21 on staging — closing commit below; awaiting the sign-off ritual (operator → reviewer chat). NOT yet applied to production** (prod apply rides the Step-7 deploy sitting, on explicit operator instruction).

**Provenance.** This is the named paying-client-gate upgrade pulled forward as Step 2 of the 2026-07-21 internal work sequence (the sequence the operator ratified before handing off; goal: "only external reviews left"). It closes, uniformly at the database layer:

1. the three CN-7 write-immutability residuals (`docs/polish/archived-client-access.md` §7/§8 FU-6; indexed in `go-live-checklist.md` §8): **raw-PostgREST write** by a staff credential, **schedule force-book** of an archived client, **program stale-tab write** (~28 mixed-keyed builder actions);
2. the **completed-session edit-lock** DB enforcement (`go-live-checklist.md` §8, deferred 2026-07-15 — currently UI-only via `SessionLockContext`).

**Approval note (deviation, recorded).** The polish protocol's step 5 requires operator approval of this gap list before code. The operator is not present in this autonomous session; the scope below is strictly the already-ratified sequence item (both halves' shapes were prescribed in the checklist entries themselves). Anything beyond that prescription is parked in §5, not built. The sign-off ritual still runs: the closing commit goes to the reviewer chat when the operator returns.

---

## §1 Audit — what exists

- **App layer:** `assertClientLive` (`src/lib/clients/archive-guard.ts`) gates every client-scoped mutating action; predicate is `clients.deleted_at IS NOT NULL` → refuse. The archived state is **deleted_at set** (`soft_delete_client` v2 sets `deleted_at` + `archived_at` together, migration `20260702190000` §2); `archived_at` is bookkeeping, `deleted_at` is the operative flag in every policy and guard.
- **Builder lock (UI-only):** day page computes `locked = (∃ sessions row: client_id, program_day_id = day, completed_at NOT NULL, deleted_at NULL) AND day.published_at IS NOT NULL`; unassigning (`published_at → NULL`) is the deliberate unlock. `SessionLockContext` gates every write control in `SessionBuilder.tsx`; server actions / raw PostgREST are **not** refused.
- **Archive cascade (must keep working):** `soft_delete_client(p_id)` (SECURITY DEFINER) sets the client's `deleted_at`/`archived_at` **first**, then UPDATEs `appointments` (cancel future live bookings → reminder cascade). `restore_client` un-archives and cascades `message_threads` restore. **Any appointments/clients trigger that blocks archived-client writes will break these two functions unless exempted.**
- **Program writes** funnel through SECURITY DEFINER RPCs + PostgREST; `session_user` for every API-originated write (including RPC-internal statements — SECURITY DEFINER changes `current_user`, not `session_user`) is the API connection role, never `postgres`. pgTAP fixtures and maintenance scripts run as `postgres`.
- **Existing model:** `message_enforce_immutability` (BEFORE UPDATE, §10) is the established column-freeze trigger pattern; `_test_*` helpers use the `session_user = 'postgres'` in-body guard pattern.

## §2 Premortem (ranked)

- **FM-A (highest): the trigger breaks the archive/restore cascade itself.** `soft_delete_client` cancels appointments *after* archiving; `restore_client` writes the archived client row. Blocked cascade = archiving outage. *Mitigation:* both RPCs set a transaction-local GUC (`odyssey.archive_cascade = '1'`, `set_config(..., true)`); the guards honour it. GUC is not settable through PostgREST (no exposed setter), so it is not a bypass surface. pgTAP asserts the full cascade end-to-end.
- **FM-B: maintenance breakage.** pgTAP fixtures, `seed-staging.mjs --wipe`, migrations write archived-client rows as `postgres`. *Mitigation:* `session_user = 'postgres'` exemption (the `_test_*` helper pattern) — API roles (`authenticator`→`anon`/`authenticated`/`service_role`) are never exempt.
- **FM-C: completed-day guard overreaches into legitimate builder flows** — copy FROM a completed day, repeat-weekly sourcing it, sibling reorders. *Mitigation:* predicate keys on the **target row's own day** only; the existing builder pgTAP suites (22/24/39/40) are the regression net; test 60 adds explicit controls.
- **FM-D: unassign-unlock fails at the DB layer** (UI unlocks, DB still refuses). *Mitigation:* predicate mirrors the day page exactly, including `published_at IS NOT NULL`; test 60 asserts write-allowed after unassign.
- **FM-E: predicate divergence from the app guard** (archived_at vs deleted_at). *Mitigation:* `deleted_at IS NOT NULL`, same as `assertClientLive`; trigger messages reuse the app's exact copy so a raw 400 reads identically.
- **FM-F: bulk-write performance** (per-row parent walk on copy-week fan-outs). Indexed PK walks, ≤3 levels, f&f scale — accepted.
- **FM-G: future service-role admin flows blocked.** Accepted + named: any future legitimate write to archived records goes through a SECURITY DEFINER RPC that sets the cascade GUC.
- **FM-H: trigger coexistence** (OCC `bump_version_and_touch`, audit triggers, `appointment_manage_reminder`). BEFORE-trigger ordering is alphabetical but irrelevant — a raise aborts the row regardless of order; no state is half-written (transactional). Verified by suite re-run (51/55 OCC, 29 reminders, 34 messaging).

## §3 Gap list (the contract)

- **P0-1 — `client_record_write_guard()`** — BEFORE INSERT/UPDATE/DELETE row trigger on the direct `client_id` tables: `programs`, `appointments`, `clinical_notes`, `client_medical_history`, `client_medications`. Refuses when the referenced client has `deleted_at IS NOT NULL` (for appointments: only when `client_id` is non-null — unavailable blocks carry none). Exemptions: `session_user = 'postgres'`; cascade GUC. Message = `ARCHIVED_CLIENT_MESSAGE` verbatim.
- **P0-2 — `program_write_guard()`** — BEFORE INSERT/UPDATE/DELETE row trigger on `program_days`, `program_exercises`, `program_exercise_sets` (parent-walk to the owning client): (a) archived-client refusal as P0-1; (b) on `program_exercises`/`program_exercise_sets` only, the **completed-and-assigned lock**: refuse when the target row's `program_day` has `published_at IS NOT NULL` and a live completed session (`sessions.completed_at IS NOT NULL AND deleted_at IS NULL`). UPDATE also checks the OLD parent (a move OUT of a locked day is an edit of it).
- **P0-3 — `clients_row_write_guard()`** — BEFORE UPDATE on `clients`: refuse edits to an already-archived row (`OLD.deleted_at IS NOT NULL`) except under the exemptions; the archive transition itself (`OLD.deleted_at IS NULL`) always passes.
- **P0-4 — cascade GUC injection** — `soft_delete_client` + `restore_client` v3 (`CREATE OR REPLACE`, same signatures, no drop): `set_config('odyssey.archive_cascade', '1', true)` at the top.
- **P1-1 — pgTAP `60_write_immutability.sql`** — fixture: archived + live clients, programs/days/exercises/sets for both, a completed+assigned day and an unassigned-completed day, a future appointment on a to-be-archived client. Asserts: refusals per table (as `authenticated` via the JWT-spoof pattern), live-client controls, completed-lock refusal + copy-into-other-day control + unassign unlock, `soft_delete_client` cascade end-to-end, `restore_client` end-to-end.
- **P1-2 — scenario rows** in `test_scenarios_template.md` (maintenance rule): DBWI-1..3.

## §4 Decisions

- **Predicate = `deleted_at`** (app-guard parity), not `archived_at`.
- **Error shape:** `RAISE EXCEPTION` (P0001) with the app's own user-facing copy; PostgREST maps to 400. The app guards remain first line — the trigger is the floor, not the UX.
- **Exemption model:** `session_user = 'postgres'` (owner maintenance) + transaction-local cascade GUC (definer RPCs only). No role-name string matching beyond that.
- **DELETE included** everywhere (defense-in-depth; API roles mostly lack DELETE paths anyway; soft-delete UPDATEs are the real routes and are covered).

## §5 Parked (named, not built — outside the ratified prescription)

- Guards on `sessions`/`exercise_logs`/`set_logs` (portal lockout already denies archived clients; staff don't write logs) — revisit if a staff-side logging path ever lands.
- Guards on test tables (`test_sessions` etc.) — app-guarded (FU-1..5); the raw-PostgREST residual for them narrows to this family and is re-triggered with the pen-test/external review.
- `program_days` **row** writes under the completed lock (rescheduling/soft-deleting a completed day) — the checklist shape names `program_exercises`/`program_exercise_sets` only; the day-row question goes to the reviewer at sign-off.
- Messaging tables — FM-8 (archived comms history) is a separately-owned compliance-boundary item; message immutability already has its own trigger.
- `invite_tokens` — re-invite semantics operate on a NEW client row; nothing to guard.

---

## §6 Closing commit (2026-07-21)

**What changed** (migration `20260721120000_write_immutability_guards.sql`, staging-applied; pgTAP `60_write_immutability.sql`):

- **P0-1 / P0-2 / P0-3 shipped as specified** — `client_record_write_guard()` on `programs` / `appointments` / `clinical_notes` / `client_medical_history` / `client_medications`; `program_write_guard()` on `program_days` / `program_exercises` / `program_exercise_sets` (parent-walk + the completed-and-assigned lock on the two prescription tables); `clients_row_write_guard()` on `clients` UPDATE. All three SECURITY DEFINER (truth lookups independent of the writer's RLS view), uniform trigger name `write_immutability_guard`, API-role EXECUTE revoked.
- **P0-4 shipped** — `soft_delete_client` / `restore_client` v3 (`CREATE OR REPLACE`, same signatures): transaction-local `odyssey.archive_cascade` GUC as the first statement so their own cascades pass the new guards.
- **One design addition discovered in testing:** the pgTAP channel connects with `session_user = 'postgres'`, so the maintenance exemption exempted the test assertions themselves. Added `odyssey.test_enforce_guards` — a transaction-local GUC that **disables the postgres exemption** (strictness-only; cannot be used to bypass anything). Test 60 sets it after fixture build; production semantics are unchanged.
- **P1-1 shipped** — pgTAP `60` (14/14 on staging): per-table archived refusals with the exact app copy, force-book + stale-tab residual refusals, live-client controls, completed-lock refusals (UPDATE + INSERT), assigned-not-completed control, unassign unlock, and the full archive→cancel→restore cascade as a real staff session. The probe style (`pg_temp._try`) makes a silent RLS 0-row no-op a FAILURE, so a policy change can never fake a guard pass.
- **P1-2 shipped** — scenarios DBWI-1..3 in `test_scenarios_template.md`.

**Incidental finding (pre-guard, confirmed live on staging):** a staff credential could direct-UPDATE an archived client's `clients` row (`rows:1`) — the P0-3 guard now refuses it; test 60 #5 is the tripwire.

**Acceptance:** pgTAP 60 = 14/14; full 60-file suite re-run green on staging (see run log). `tsc` unaffected (no app-code change).

**Deferred (contract §5, unchanged):** sessions/logs tables, test tables, `program_days` day-row completed-lock question (flagged for the reviewer), messaging (FM-8 owner), `invite_tokens`.

**Premortem accounting:** FM-A mitigated (cascade GUC + tests 11–14); FM-B mitigated (postgres exemption + enforce-GUC test path); FM-C mitigated (target-day predicate; suites 22/24/39/40 green); FM-D mitigated (test 10); FM-E mitigated (deleted_at + exact app copy); FM-F accepted (indexed walks); FM-G accepted + named (future definer RPCs set the cascade GUC); FM-H verified by suite re-run (51/55/29/34 green).

**Checklist updates:** `go-live-checklist.md` §8 CN-7 residual entry + completed-session edit-lock entry marked closed-by-`20260721120000` (pending prod apply at the deploy sitting).
