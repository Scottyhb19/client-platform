# DB-level write immutability — the CN-7 trigger family + completed-session lock

**Status: CLOSED with deferred items — reviewer sign-off recorded at the foot of this doc (2026-07-22).** BUILT 2026-07-21 on staging; returned for revision then revised 2026-07-22 across two rounds (§7); revised closing commit at §8. **NOT yet applied to production** (prod apply rides the Step-7 deploy sitting, on explicit operator instruction). **Open production exposure until that apply is recorded as an accepted-risk window in `docs/incident-response.md` §10** — a staff credential can direct-UPDATE/DELETE an archived client's `clients` row; low severity at f&f scope, deadline = the deploy sitting.

**Provenance.** This is the named paying-client-gate upgrade pulled forward as Step 2 of the 2026-07-21 internal work sequence (the sequence the operator ratified before handing off; goal: "only external reviews left"). It closes, uniformly at the database layer:

1. the three CN-7 write-immutability residuals (`docs/polish/archived-client-access.md` §7/§8 FU-6; indexed in `go-live-checklist.md` §8): **raw-PostgREST write** by a staff credential, **schedule force-book** of an archived client, **program stale-tab write** (~28 mixed-keyed builder actions);
2. the **completed-session edit-lock** DB enforcement (`go-live-checklist.md` §8, deferred 2026-07-15 — currently UI-only via `SessionLockContext`).

**Approval note (deviation, recorded).** The polish protocol's step 5 requires operator approval of this gap list before code. The original build ran in an autonomous session with the operator absent; the scope was strictly the already-ratified sequence item (both halves' shapes prescribed in the checklist entries). The sign-off ritual ran: the closing commit went to the reviewer chat, which **returned it for revision** (§7).

**Deviations from the ratified prescription, recorded:**
- **`odyssey.test_enforce_guards`** — a pgTAP-only, transaction-local GUC that *disables* the postgres maintenance exemption so tests exercise the API path. Strictness-only (can never bypass a guard). Discovered necessary during the original build.
- **The 2026-07-22 GUC narrowing + `soft_delete_client` v4 reorder** (operator-approved this session, in response to the reviewer): the cascade GUC was reduced from exempting the whole guard family to exempting only `clients_row_write_guard`, and `soft_delete_client` was reordered (cancel-then-archive) so it needs no GUC. Exceeds the original prescription; taken to convert the GUC's safety from an asserted PostgREST-boundary claim into a demonstrable, tripwired invariant.
- **`clients` DELETE guard** (operator-approved this session): the P0-3 guard extended from UPDATE-only to UPDATE+DELETE to make §4's "DELETE everywhere" literally true.

---

## §1 Audit — what exists

- **App layer:** `assertClientLive` (`src/lib/clients/archive-guard.ts`) gates every client-scoped mutating action; predicate is `clients.deleted_at IS NOT NULL` → refuse. The archived state is **deleted_at set** (`soft_delete_client` v2 sets `deleted_at` + `archived_at` together, migration `20260702190000` §2); `archived_at` is bookkeeping, `deleted_at` is the operative flag in every policy and guard.
- **Builder lock (UI-only):** day page computes `locked = (∃ sessions row: client_id, program_day_id = day, completed_at NOT NULL, deleted_at NULL) AND day.published_at IS NOT NULL`; unassigning (`published_at → NULL`) is the deliberate unlock. `SessionLockContext` gates every write control in `SessionBuilder.tsx`; server actions / raw PostgREST are **not** refused.
- **Archive cascade (must keep working):** `soft_delete_client(p_id)` (SECURITY DEFINER) sets the client's `deleted_at`/`archived_at` **first**, then UPDATEs `appointments` (cancel future live bookings → reminder cascade). `restore_client` un-archives and cascades `message_threads` restore. **Any appointments/clients trigger that blocks archived-client writes will break these two functions unless exempted.**
- **Program writes** funnel through SECURITY DEFINER RPCs + PostgREST; `session_user` for every API-originated write (including RPC-internal statements — SECURITY DEFINER changes `current_user`, not `session_user`) is the API connection role, never `postgres`. pgTAP fixtures and maintenance scripts run as `postgres`.
- **Existing model:** `message_enforce_immutability` (BEFORE UPDATE, §10) is the established column-freeze trigger pattern; `_test_*` helpers use the `session_user = 'postgres'` in-body guard pattern.

## §2 Premortem (ranked)

- **FM-A (highest): the trigger breaks the archive/restore cascade itself.** `restore_client` writes the archived client row; `soft_delete_client` cancels the client's future appointments. Blocked cascade = archiving outage. *Mitigation (revised 2026-07-22, §7):* `soft_delete_client` **v4** is reordered to cancel appointments *while the client is still live*, so those writes pass on the merits with **no exemption GUC**. `restore_client` keeps the transaction-local `odyssey.archive_cascade` GUC, now honoured by **only `clients_row_write_guard`** (the un-archive UPDATE writes an already-archived row). The GUC is not settable through PostgREST (no exposed setter; PostgREST namespaces its injected GUCs under `request.`). pgTAP 60 asserts the full cascade end-to-end (14–17) **and** tripwires that the family guards ignore a forged GUC (11–12).
- **FM-B: maintenance breakage.** pgTAP fixtures, `seed-staging.mjs --wipe`, migrations write archived-client rows as `postgres`. *Mitigation:* `session_user = 'postgres'` exemption (the `_test_*` helper pattern) — API roles (`authenticator`→`anon`/`authenticated`/`service_role`) are never exempt.
- **FM-C: completed-day guard overreaches into legitimate builder flows** — copy FROM a completed day, repeat-weekly sourcing it, sibling reorders. *Mitigation:* predicate keys on the **target row's own day** only; the existing builder pgTAP suites (22/24/39/40) are the regression net; test 60 adds explicit controls.
- **FM-D: unassign-unlock fails at the DB layer** (UI unlocks, DB still refuses). *Mitigation:* predicate mirrors the day page exactly, including `published_at IS NOT NULL`; test 60 asserts write-allowed after unassign.
- **FM-E: predicate divergence from the app guard** (archived_at vs deleted_at). *Mitigation:* `deleted_at IS NOT NULL`, same as `assertClientLive`; trigger messages reuse the app's exact copy so a raw 400 reads identically.
- **FM-F: bulk-write performance** (per-row parent walk on copy-week fan-outs). Indexed PK walks, ≤3 levels, f&f scale — accepted.
- **FM-G: future service-role admin flows blocked.** Accepted + named. After the 2026-07-22 narrowing the cascade GUC exempts **only `clients_row_write_guard`**, so a future definer RPC that must write an archived client's *child* rows (programs/appointments/notes/history/meds) can no longer lean on the GUC — it would un-archive first, or run as `postgres` maintenance. A deliberate trade: shrinking the GUC's blast radius (one guard, not the whole family) over future write-through convenience. Re-widening is a one-line change in a later migration if such a flow ever lands.
- **FM-H: trigger coexistence** (OCC `bump_version_and_touch`, audit triggers, `appointment_manage_reminder`). BEFORE-trigger ordering is alphabetical but irrelevant — a raise aborts the row regardless of order; no state is half-written (transactional). Verified by suite re-run (51/55 OCC, 29 reminders, 34 messaging).

## §3 Gap list (the contract)

- **P0-1 — `client_record_write_guard()`** — BEFORE INSERT/UPDATE/DELETE row trigger on the direct `client_id` tables: `programs`, `appointments`, `clinical_notes`, `client_medical_history`, `client_medications`. Refuses when the referenced client has `deleted_at IS NOT NULL` (for appointments: only when `client_id` is non-null — unavailable blocks carry none). Exemptions: `session_user = 'postgres'`; cascade GUC. Message = `ARCHIVED_CLIENT_MESSAGE` verbatim.
- **P0-2 — `program_write_guard()`** — BEFORE INSERT/UPDATE/DELETE row trigger on `program_days`, `program_exercises`, `program_exercise_sets` (parent-walk to the owning client): (a) archived-client refusal as P0-1; (b) on `program_exercises`/`program_exercise_sets` only, the **completed-and-assigned lock**: refuse when the target row's `program_day` has `published_at IS NOT NULL` and a live completed session (`sessions.completed_at IS NOT NULL AND deleted_at IS NULL`). UPDATE also checks the OLD parent (a move OUT of a locked day is an edit of it).
- **P0-3 — `clients_row_write_guard()`** — BEFORE **UPDATE OR DELETE** on `clients` (DELETE added 2026-07-22, §7 blocker 3): refuse edits or hard-deletes of an already-archived row (`OLD.deleted_at IS NOT NULL`) except under the exemptions; the archive transition itself (`OLD.deleted_at IS NULL`) always passes.
- **P0-4 — cascade compatibility** — `CREATE OR REPLACE` (same signatures, no drop) of `soft_delete_client` + `restore_client`. **Revised 2026-07-22 (§7):** `restore_client` v3 sets `set_config('odyssey.archive_cascade', '1', true)` (honoured only by `clients_row_write_guard`); `soft_delete_client` **v4** is reordered to cancel-then-archive and sets **no** GUC. Bodies diffed against their last defining migrations (`20260702190000` / `20260429130000`) before the replace.
- **P1-1 — pgTAP `60_write_immutability.sql`** — fixture: archived + live clients, programs/days/exercises/sets for both, a completed+assigned day and an unassigned-completed day, a future appointment on a to-be-archived client. Asserts: refusals per table (as `authenticated` via the JWT-spoof pattern), live-client controls, completed-lock refusal + copy-into-other-day control + unassign unlock, `soft_delete_client` cascade end-to-end, `restore_client` end-to-end.
- **P1-2 — scenario rows** in `test_scenarios_template.md` (maintenance rule): DBWI-1..3.

## §4 Decisions

- **Predicate = `deleted_at`** (app-guard parity), not `archived_at`.
- **Error shape:** `RAISE EXCEPTION` (P0001) with the app's own user-facing copy; PostgREST maps to 400. The app guards remain first line — the trigger is the floor, not the UX.
- **Exemption model:** `session_user = 'postgres'` (owner maintenance) + transaction-local `archive_cascade` GUC — the latter honoured by **only `clients_row_write_guard`** after the 2026-07-22 narrowing (§7). No role-name string matching beyond that. The pgTAP-only `test_enforce_guards` GUC disables the postgres exemption (strictness-only) so tests exercise the API path.
- **DELETE included** everywhere, **including the `clients` row itself** (corrected 2026-07-22, §7 blocker 3 — was UPDATE-only, which contradicted this decision). Defense-in-depth; soft-delete UPDATEs are the real routes and are covered.

## §5 Parked (named, not built — outside the ratified prescription)

- Guards on `sessions`/`exercise_logs`/`set_logs` (portal lockout already denies archived clients; staff don't write logs) — revisit if a staff-side logging path ever lands.
- Guards on test tables (`test_sessions` etc.) — app-guarded (FU-1..5); the raw-PostgREST residual for them narrows to this family and is re-triggered with the pen-test/external review.
- `program_days` **row** writes under the completed lock (unassign / reschedule / soft-delete a completed day) — **explicitly accepted 2026-07-22 (§7 blocker 1), not silently parked.** Unassign (`published_at → NULL`) is the sanctioned unlock at every layer, so a staff credential can unassign→edit→reassign via raw PostgREST. Accepted because (i) the actor is same-org authenticated staff, (ii) unassign is audit-logged (`audit_program_days`) so the path is detectable, (iii) the performed record (`set_logs`/`sessions`) is untouched by prescription edits. Re-trigger for the hard gate (RPC-only unassign): before any paying clinical client, or when a non-trusted second staffer joins an org.
- Messaging tables — FM-8 (archived comms history) is a separately-owned compliance-boundary item; message immutability already has its own trigger.
- `invite_tokens` — re-invite semantics operate on a NEW client row; nothing to guard.

---

## §6 Closing commit (2026-07-21) — SUPERSEDED by §8 after reviewer return (§7)

> **This is the original closing commit. The reviewer returned it for revision on 2026-07-22 (§7). The authoritative closing commit is now §8.** Kept verbatim below for the record.

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

---

## §7 Reviewer return (2026-07-22) and resolutions

**Reviewer verdict:** *"Not sound to close as written. The engineering looks strong; the closing record has four defects, two of which are substantive."* Returned for revision. Per the sign-off ritual, the items are logged here and the seven-step protocol re-engaged from step 5; two forks were put to the operator and decided in-session.

**Blocker 1 — completed-lock is one UPDATE deep (unassign→edit→reassign bypass). RESOLVED: accepted explicitly (operator decision).**
Confirmed in code: `program_write_guard` applies the completed-lock only for `program_exercises`/`program_exercise_sets`; a raw `UPDATE program_days SET published_at = NULL` on a completed day is a live-client write and passes, unlocking the exercises. Unassign is the *sanctioned* unlock, and it is a raw PostgREST update (`unpublishProgramDayAction`, not an RPC), so refusing the transition would break the UI unlock — a true fix means an RPC-only unassign (real mini-build). **Decision: accept explicitly**, on three facts the original commit omitted: (i) the actor is a same-org authenticated staff credential (operator + one trusted EP), not an outsider or client; (ii) unassign is **audit-logged** (`audit_program_days` AFTER INSERT/UPDATE/DELETE, migration `20260420102300`) — the reviewer's stated condition for accepting — so the path is detectable; (iii) the *performed* record (`set_logs`/`sessions`) is never touched by a prescription edit, so the completed-lock protects a plan from casual edits, not the clinical record. Re-trigger for the hard gate: before any paying clinical client, or when a non-trusted second staffer joins an org. Recorded at contract §5 and `go-live-checklist.md` §8 (completed-lock entry).

**Blocker 2 — the incidental finding is an open production exposure, filed as "incidental." RESOLVED: recorded as an accepted-risk window.** Agreed with the framing. The guards are staging-only until the Step-7 deploy sitting; a staff credential can direct-UPDATE (and, unguarded, hard-DELETE) an archived client's `clients` row on prod until then. Now recorded in `docs/incident-response.md` §10 as a dated exposure window with the deploy sitting named as the deadline and the low-severity f&f rationale (same-org staff, already-archived row, raw-PostgREST-only, app-guarded in the UI). Not a footnote.

**Blocker 3 — §4 says "DELETE everywhere" but the `clients` guard was UPDATE-only. RESOLVED: fixed the trigger.** `clients_row_write_guard` now branches `TG_OP` and its trigger is `BEFORE UPDATE OR DELETE`; a hard-DELETE of an archived `clients` row is refused by design. (In practice `clients` has no staff DELETE policy, so RLS also denies the API DELETE — test 60 #13 accepts either layer and fails only on `rows:1`.) §4's decision text and the code now agree.

**Blocker 4 — "see run log" is not evidence. RESOLVED: real output supplied.** Demonstrated TAP is in §8 (test 60 = 17/17) and the full 62-file suite = 62/62 green on staging (the runner's per-file verdict lines). Both were run live this session; the run also surfaced (and this doc records) a transient empty-API-response flake on four old-pattern files, cleared to `num_failed=0` on re-run.

**Verify-before-prod items:**
- **`SET search_path` pinned** — was already present on all three guards (`= public, pg_temp`); the closing commit just didn't show it. Tightened this revision to `SET search_path = public` (no `pg_temp`) — every relation the guards read is in `public`, so `pg_temp` was unused and pinning it out removes the temp-shadowing vector the reviewer named. The two v3 RPCs keep `public, pg_temp` (their deployed form; unchanged to keep the prod diff to the intended body change).
- **Explicit anon/authenticated revokes** — already present on all three: `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` (the twice-burned lesson). Belt-and-suspenders on trigger functions, but exactly the revoke the reviewer asked to see; the commit now names the grantees.
- **GUC tripwire + config-drift. RESOLVED: narrowed the blast radius (operator decision).** A forged `odyssey.archive_cascade` cannot be turned into a green "still refused" test while the whole family honours it — custom GUCs are session-settable by any role, so the safety rested entirely on PostgREST exposing no `SET`. So `soft_delete_client` was **reordered** (v4: cancel appointments while the client is live, then archive → needs no GUC), and GUC-honouring was **removed** from `client_record_write_guard` and `program_write_guard`. Only `clients_row_write_guard` still consults it (restore must write an archived row). Test 60 #11/#12 now forge the GUC as `authenticated` and prove the family guards **ignore** it — a demonstrable invariant, not a prose claim.
- **Diff prod bodies before `CREATE OR REPLACE`. DONE (repo-history diff, rule-compliant).** The environment rule bars diagnostic prod queries without explicit instruction, and functions are only ever defined via migrations (never the dashboard), so the migration history is authoritative for prod's deployed body. Diffed: `soft_delete_client` file body = `20260702190000` (the actual latest) + intended v4 reorder; `restore_client` file body = `20260429130000` (the bare fn's last *body* definition — `20260623180000` and later matches were REVOKE-only or the `_medications`/`_medical_history` variants, verified) + the one GUC line. No stale body resurrected. Independent live corroboration: pgTAP 38 (`soft_delete_restore_grants`) ran 38/38 on staging *after* apply, proving the `CREATE OR REPLACE` did not re-trip the Supabase anon-EXECUTE grant.
- **Record `test_enforce_guards` as a deviation. DONE** — added to the Approval note above, alongside the GUC-narrowing/reorder and the `clients` DELETE guard.

### Round-2 re-review (2026-07-22): "sound to close after one revert" — resolutions

- **BLOCKING revert — `SET search_path = public` → `public, pg_temp`.** The reviewer was right and the round-1 revision was wrong: Postgres implicitly searches `pg_temp` **first** for relation/type names when it is not named in the path, so a bare `= public` re-opened the shadowing vector rather than closing it — and the pgTAP channel populates `pg_temp` (`pg_temp._try`), so a temp relation could silently shadow a guard's `clients`/`sessions`/`program_days` lookup and never be seen. Reverted on all three guards; catalog-verified `search_path=public, pg_temp`; migration re-applied to staging; pgTAP 60 re-run **17/17**.
- **Follow-up 1 (clients DELETE untested).** #13 had been loosened to accept `rows:0` (RLS invisibility), so it could pass without the guard firing. Now **deterministic**: #13 runs the DELETE as `postgres` (BYPASSRLS on Supabase — the fixture INSERTs prove it) with `test_enforce_guards='1'` (postgres exemption disabled), so RLS cannot hide the row and only `clients_row_write_guard` can refuse — error-only, proving the DELETE branch executes.
- **Follow-up 2 (GUC prose-claim survives on the one guard that matters).** Stated plainly, not papered over: `clients_row_write_guard` still consults `archive_cascade` and has **no green forgery tripwire** — a forgery test there would *demonstrate the bypass*, since `restore_client` must set the GUC. For this one guard, **PostgREST's boundary is the sole control**: an actor able to `set_config` the GUC over the API could edit/un-archive an archived `clients` row (low impact — already archived, un-archive is reversible and audit-logged). Blast radius shrank six-to-one; the *kind* of claim is unchanged for this one guard. **Standing check added — and verified once (2026-07-22):** no API-exposed function may pass a caller-supplied first argument to `set_config`. Grep of the whole migrations tree confirms the *only* `set_config` call anywhere is `restore_client`'s hardcoded literal `('odyssey.archive_cascade','1',true)` — no caller input reaches a GUC name. Any new GUC-touching SECURITY DEFINER helper joins this check alongside the §4 anon-EXECUTE sweep.
- **Follow-up 3 (prod body diff is asserted discipline, not verified).** Added a `pg_get_functiondef` pre-replace snapshot step to the prod channel in `runbooks/use-the-staging-project.md`: run it against prod immediately before the `db push`, eyeball the two live bodies vs the file, stop on any drift beyond the intended change. Named as a prod-apply precondition below.
- **Follow-up 4 (the 03–06 flake).** Confirmed the runner **fails closed** on an empty API response — both the old-pattern (`${failed:-x}` ≠ `0` → FAIL) and new-pattern (`okc -gt 0` guard → FAIL) branches score empty as FAIL, never zero-failures — so a green sweep is trustworthy. Recorded the flake + this reasoning in `runbooks/use-the-staging-project.md` (Step 3 note), the findable home.
- **Follow-up 5 (prod pgTAP 60 is a write-heavy fixture against prod under BEGIN/ROLLBACK).** Acknowledged. Staging already landed before identifiable client data (env-separation flip 2026-07-21), the durable answer. The prod-apply confirmation is downgraded to a **light smoke** (guard present in the catalog + one archived write refused), not the full write-heavy fixture — see the prod-apply precondition below.

## §8 Revised closing commit (2026-07-22)

**What changed** (migration `20260721120000_write_immutability_guards.sql`, re-applied to staging; pgTAP `60_write_immutability.sql`, plan 17):

- **P0-1 / P0-2 / P0-3 shipped, P0-3 extended.** `client_record_write_guard()` on `programs` / `appointments` / `clinical_notes` / `client_medical_history` / `client_medications`; `program_write_guard()` on `program_days` / `program_exercises` / `program_exercise_sets` (parent-walk + the completed-and-assigned lock on the two prescription tables); `clients_row_write_guard()` on `clients` **UPDATE + DELETE** (blocker 3). All three SECURITY DEFINER, `SET search_path = public`, uniform trigger name `write_immutability_guard`, `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`.
- **GUC narrowed (blocker/verify: config-drift).** `soft_delete_client` **v4** reordered to cancel-appointments-while-live then archive — sets **no** GUC. GUC-honouring removed from the two family guards; only `clients_row_write_guard` consults `odyssey.archive_cascade`, set solely by `restore_client` v3 for the un-archive UPDATE. Bodies diffed against `20260702190000` / `20260429130000` before the replace (§7). For that one remaining guard the GUC's safety rests on the PostgREST boundary (no green forgery tripwire is possible where the GUC must be honoured) — stated plainly, with a standing "no caller-supplied `set_config` first-arg" check (Round-2 follow-up 2).
- **`test_enforce_guards`** — unchanged from the original build (pgTAP-only, strictness-only; disables the postgres exemption so tests exercise the API path). Recorded as a deviation (Approval note).
- **P1-1 shipped, expanded to 17.** pgTAP `60` = **17/17 on staging**: per-table archived refusals with the exact app copy (1–4), the clients-row UPDATE refused **by the guard** (5 — tightened to error-only now that the incidental finding proved staff RLS reaches the row), live-client control (6), completed-lock refusals UPDATE+INSERT (7–8), assigned-not-completed control (9), unassign unlock (10), **GUC-forgery tripwires** proving the family guards ignore a forged `archive_cascade` (11–12), archived clients-row **DELETE** refused — proven deterministically as `postgres`/BYPASSRLS with enforce-GUC on so the guard is the sole control (13) — and the full archive→cancel→restore cascade under v4/v3 with no family GUC (14–17). The `pg_temp._try` probe makes a silent RLS 0-row no-op a FAILURE, so a policy change cannot fake a guard pass.
- **P1-2 shipped** — scenarios DBWI-1..3, plus **DBWI-4** (clients-row edit/delete + the accepted day-row bypass boundary) and **DBWI-5** (forged-GUC tripwire) in `test_scenarios_template.md`.

**Run log (demonstrated, staging):**

```
-- pgTAP 60 (plan 17)
ok 1  - archived: clinical_notes INSERT refused by the DB guard
ok 2  - archived: client_medical_history UPDATE refused by the DB guard
ok 3  - archived: appointments INSERT (force-book residual) refused by the DB guard
ok 4  - archived: program_exercise_sets UPDATE (stale-tab residual) refused by the DB guard
ok 5  - archived: clients row UPDATE refused BY THE GUARD (staff RLS reaches the row)
ok 6  - control: clinical_notes INSERT for a LIVE client succeeds
ok 7  - lock: set UPDATE under a completed+assigned day refused
ok 8  - lock: program_exercises INSERT into a completed+assigned day refused
ok 9  - control: set UPDATE under an assigned, NOT-completed day succeeds
ok 10 - unlock: set UPDATE under an UNASSIGNED completed day succeeds (published_at IS NULL)
ok 11 - GUC tripwire: client_record_write_guard ignores a forged archive_cascade
ok 12 - GUC tripwire: program_write_guard ignores a forged archive_cascade
ok 13 - archived: clients row DELETE refused BY THE GUARD (postgres bypasses RLS + enforce-GUC on → guard is the sole control)
ok 14 - cascade: soft_delete_client runs end-to-end as staff (v4 cancels the future appt while the client is live — no GUC)
ok 15 - cascade: the future appointment flipped to cancelled
ok 16 - cascade: restore_client runs end-to-end as staff (archive_cascade GUC passes the un-archive UPDATE)
ok 17 - cascade: the client is live again after restore

-- full suite: 62 pass / 0 fail of 62 files (runner exit 0)
```
*(The sweep first recorded a transient empty-API-response flake on four old-pattern files, 03–06; each cleared to `num_failed=0` on targeted re-run, and the re-run produced the clean 62/62 above.)*

**Acceptance:** pgTAP 60 = 17/17 (incl. the deterministic clients-DELETE guard proof, #13); full 62-file suite = 62/62 green on staging. `search_path=public, pg_temp` catalog-verified on all three guards. No app-code change → `tsc` unaffected.

**Prod-apply preconditions (Step-7 deploy sitting):** (1) run the `pg_get_functiondef` drift check on prod's `soft_delete_client`/`restore_client` immediately before `db push` (runbook: `use-the-staging-project.md` → Production channel); (2) `db push` the migration; (3) **light prod smoke** — confirm the three guards exist in the catalog and one archived write is refused — rather than the full write-heavy pgTAP 60 fixture against prod (Round-2 follow-up 5).

**Deferred (contract §5):** sessions/logs tables, test tables, messaging (FM-8 owner), `invite_tokens`, and — now **explicitly accepted, not parked** — the `program_days` day-row unassign bypass (blocker 1: audit-logged, same-org-staff-only, performed record untouched; re-trigger = paying client / non-trusted second staffer).

**Premortem accounting:** FM-A mitigated (v4 reorder + GUC narrowed to one guard; tests 11–17); FM-B mitigated (postgres exemption + enforce-GUC test path); FM-C mitigated (target-day predicate; suites 22/24/39/40 green); FM-D mitigated (test 10); FM-E mitigated (deleted_at + exact app copy); FM-F accepted (indexed walks); FM-G accepted + narrowed (GUC no longer the family extension point; §2); FM-H verified by the full-suite re-run (62/62).

**Open production exposure** (blocker 2): recorded in `incident-response.md` §10 — closes at the Step-7 prod apply.

---

## Sign-off

- **Date signed off:** 2026-07-22
- **Reviewer:** claude.ai project chat (challenger role)
- **Decision:** Closed with deferred items

**Basis.** Round 1 (§7, original §6 closing commit) was **Returned for revision** — four defects, two substantive. The revision addressed all four plus the verify-before-prod items (§7). Round 2 verdict: *"sound to close — after one revert"* — the round-1 `search_path = public` change was itself a regression; reverted to `public, pg_temp` (catalog-verified) and pgTAP 60 re-run 17/17, full suite 62/62 on staging. The five named follow-ups were explicitly non-blocking and were all addressed this session (deterministic clients-DELETE proof; GUC residual stated plainly + standing check verified; prod `pg_get_functiondef` pre-apply diff in the runbook; flake recorded + runner fail-closed confirmed; prod confirmation downgraded to a light smoke). The reviewer's conditional close is recorded here on the operator's instruction; the reverted state was verified by the run logs in §8, not re-reviewed in the reviewer chat.

**Deferred items (re-triggers):**
- **Day-row unassign bypass of the completed-lock** (blocker 1, accepted): unassign is the sanctioned unlock at every layer, audit-logged, same-org-staff-only, performed record untouched. Re-trigger for the RPC-only hard gate: before any paying clinical client, or a non-trusted second staffer.
- **`clients_row_write_guard` GUC residual** (round-2 follow-up 2): the one guard whose `archive_cascade` safety rests on the PostgREST boundary. Standing check in force (no caller-supplied `set_config` first arg). Re-trigger: any API-exposed GUC setter, or the SaaS fork.
- **Contract §5 parks:** sessions/`set_logs` tables, test tables, messaging (FM-8 owner), `invite_tokens`.
- **Production apply** of `20260721120000` (all of the above enforcement is staging-only): Step-7 deploy sitting, with the `pg_get_functiondef` drift check + light smoke as preconditions (§8). Exposure window open until then (`incident-response.md` §10).
