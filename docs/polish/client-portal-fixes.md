# Polish-pass gap analysis — Client portal bug-fix pass

**Audit date:** 2026-05-10
**Branch:** `claude/gracious-lamport-269d3b` (worktree HEAD == master `16191de`)
**Sibling doc:** [`client-portal.md`](./client-portal.md) — the prior polish-pass audit. This doc is a focused fix pass on bugs surfaced after Phases A + B + F merged; it does not supersede the sibling.
**Status:** **Implemented 2026-05-10** — defaults (i / b / in-scope / yes) chosen. All five bugs closed; Phase 0 (Phase C UI) bundled in. See §7 sign-off log.

---

## 0. Pre-flight finding — load-bearing discrepancy in the brief

The brief states twice:

> "Phase C UI work is already merged to master."
> "Phase C is already merged. Tests 2 / 3 / 4 (any combination with RPE blank) will all error today. This RPC fix is the unlock."

**This is not what the code shows.** I verified:

- `git log --all --grep="Client portal polish: Phase"` returns only Phases **A**, **B**, **F**. There is no Phase C, D, or E commit on any branch.
- [`Logger.tsx:604-614`](../../src/app/portal/session/[dayId]/_components/Logger.tsx) — `CompletePrompt.handleComplete` still calls `completeSessionAction(sessionId, dayId, null, null)` with literal nulls and inline comments saying "feedback — collected on the completion screen" and "session_rpe — could average per-set rpes here." No textarea, no RPE picker.
- [`complete/page.tsx`](../../src/app/portal/session/[dayId]/complete/page.tsx) — read-only stats screen. Doesn't capture feedback or RPE either.
- The sibling gap doc [`client-portal.md`](./client-portal.md) §4 lists Phase C as **not yet done** ("scope: add feedback textarea + 1-10 RPE picker").

**What this means for the bug fix:**

If I only fix Bug #5 (the RPC's `IS NULL` rejection), the Phase C four-test sequence in the brief's acceptance bar (rows 1-4 with various combos of feedback/RPE filled or blank) **will not pass.** The RPC will accept the call, but `feedback` and `session_rpe` will both land `NULL` on every session because the UI never captures them. The acceptance bar's "row 1 has both populated, rows 2/3 have one NULL each, row 4 has both NULL" is unreachable without the capture UI.

**Resolution options — needs your call:**

| Option | What it means | Trade-off |
|---|---|---|
| **(i)** | Phase C UI is genuinely missing; bundle Phase C with this fix pass. Adds a textarea + 1-10 RPE picker to `CompletePrompt`, wires both into `completeSessionAction`. ~30-40 lines of UI + a small refactor of `handleComplete`. Then Bug #5 is the unlock the brief described. | Scope grows by one component. Same chat, same branch, single PR. Aligns with the brief's verification expectation. |
| **(ii)** | Phase C is being done in a parallel chat I'm not aware of; the brief is calling it "merged" prospectively. I do the five bug fixes only. Phase C lands separately and the user runs the four-test sequence after both are merged. | Smaller scope. Risk: if Phase C never gets done, Bug #5 sits validated but unreachable. Also: the worktree-merge-coordination memory note (`feedback_phase_branches_stack_not_fan.md`) — Phase C touches the same file (`Logger.tsx`) as no other phase here, so this is low-risk for collision. |
| **(iii)** | Phase C is in fact merged on a branch I haven't found. Point me to the branch and I'll verify before doing anything. | Zero risk; just needs a branch name. |

**Recommendation: (i).** Phase C UI is small, sits inside `Logger.tsx`'s existing `CompletePrompt`, and is the only way to deliver the brief's acceptance bar. Doing it here keeps the fix pass and its verification co-located. If the user disagrees, (iii) → (ii) is the fallback.

**This question gates everything below. The Phase 1-4 implementation plan in §4 assumes (i) is chosen — flag if not, and I'll re-cut.**

---

## 1. Bug-by-bug audit

Each bug re-verified against the cited files. Findings here override the brief's diagnosis where they differ.

### Bug #1 — Today screen shows "Exercise" placeholder instead of real names · **P1 functional**

- **Confirmed.** [`portal/page.tsx:81`](../../src/app/portal/page.tsx) chains `exercise:exercises(name)` inside a SELECT against `program_days`. [`portal/page.tsx:244`](../../src/app/portal/page.tsx) falls back to `'Exercise'` when `e.exercise?.name` is null.
- **Root cause confirmed.** [`20260420102600_rls_enable_and_policies.sql:445-465`](../../supabase/migrations/20260420102600_rls_enable_and_policies.sql) — the `exercises` table has only staff-only RLS policies (`user_role() IN ('owner','staff')`). Clients reading `exercises` via PostgREST get nothing back, so the embedded `exercise:exercises(name)` resolves to `null` for every row. The fallback fires.
- **Confirmed precedent for the fix pattern.** [`session/[dayId]/page.tsx:31-37`](../../src/app/portal/session/[dayId]/page.tsx) explains the contract in a comment: "Using the RPC rather than a direct SELECT because the exercises table isn't client-readable under RLS; the RPC pins the query to auth.uid()."
- **Fix paths considered:**

| | Approach | Pros | Cons |
|---|---|---|---|
| **(a)** | Loop calling `client_get_program_day_exercises_v2(day_id)` for each programmed day in the week | Zero new SQL; reuses existing RPC; mirrors the session page pattern exactly | Up to 7 RPC round trips per page render; the RPC also returns `prescription_sets jsonb` per set which is overkill for the Today preview line that only needs name + sets count + reps |
| **(b)** | New RPC `client_get_week_overview(week_start_date)` returning the whole week's days + exercise summary in one hop | Single round trip; tailored return shape (just what the preview needs); idiomatic for a per-week portal screen; future-proof for the calendar view | One new migration + type regen; adds API surface area |

- **Recommendation: (b).** The Today screen renders once per visit and the data is bounded (≤ 7 days, each with ≤ ~10 exercises). One trip beats seven. The new RPC's return shape is also exactly what the page needs — name + sets + reps + optional value, no per-set JSON. If the user prefers (a) for speed of landing, I'll take (a) and accept the seven RPCs.

### Bug #2 — Cannot navigate to other weeks on Today · **Design call**

- **Confirmed missing — not by design.** [`portal/page.tsx:44`](../../src/app/portal/page.tsx) hardcodes `mondayOfCurrentWeek()` with no override path; [`TodayScreen.tsx:84-108`](../../src/app/portal/_components/TodayScreen.tsx) renders the seven dots but has no prev/next chrome.
- **Prototype intent verified.** [`client-portal.html:131-141`](../../client-portal.html) defines `<div class="week-strip-nav">` containing a month-label (`April 2026`) and `.week-strip-arrows` with prev/next chevron buttons. The prototype clearly shows week navigation as the intended UX.
- **Note:** the sibling gap doc [`client-portal.md`](./client-portal.md) is silent on this. Phase B refactored the strip onto `.portal-day-cell` primitives but did not add navigation. So this is a real gap; the fix is to add prev/next chrome plus the necessary state plumbing (likely a query param `?w=YYYY-MM-DD` so the page stays a Server Component and revalidates correctly).
- **Smallest viable scope:** chevron prev / month-label / chevron next above the strip. Tap chevron → page reloads with `?w=` set to the new Monday. Today's date stays highlighted only when on the current week; otherwise the selected day is the first programmed day of the visited week (or the Monday if none).
- **Question for the user:** confirm this is in-scope before I do it. It's a feature, not a bug fix.

### Bug #3 — No green dot on programmed dates · **P2 polish**

- **Confirmed misrendered, not data-missing.** [`TodayScreen.tsx:99-104`](../../src/app/portal/_components/TodayScreen.tsx) renders the dot only when `d.state === 'done' && !d.dayLabel`. But [`portal/page.tsx:102-105`](../../src/app/portal/page.tsx) sets `dayLabel` for every programmed day. So the `&& !d.dayLabel` check makes the dot effectively unreachable for programmed days; the day-label tag renders instead.
- **Prototype intent verified.** [`client-portal.html:28`](../../client-portal.html) — `.week-day.has-session::after { content:''; width:5px; height:5px; border-radius:50%; background:var(--bright); margin-top:4px }`. The dot is bound to "has-session" (programmed), full stop. There is no day-label tag in the prototype.
- **Diagnosis:** Phase A/B introduced the day-label tag (e.g. "Day A") as a substitute for the dot. The user wants the dot back per the prototype. The tag is fine to keep alongside, or to drop — design call.
- **Recommendation:** restore the dot for any programmed day (state ∈ {today, upcoming, done}), keep the day-label tag too. Both are useful: tag identifies which programmed day, dot signals "session today" at a glance. The dot uses `var(--color-accent)` (the brand green) per the prototype.
- **Out-of-scope clarification:** the brief asks "is this a programmed dot or a completed dot?" — confirmed it's the **programmed** dot. The "completed" indicator is a separate concern tracked in the sibling gap doc as Phase H (count `sessions WHERE completed_at IS NOT NULL` for the week). Phase H stays deferred; this fix only restores the programmed-day dot.

### Bug #4 — `client_start_session` errors with "No active program day for this caller" · **P0 architectural**

- **Confirmed.** [`20260420102500_client_portal_functions.sql:162-173`](../../supabase/migrations/20260420102500_client_portal_functions.sql) — the lookup INNER-JOINs `program_days pd → program_weeks pw ON pw.id = pd.program_week_id → programs p ON p.id = pw.program_id`.
- **Schema-level confirmation.** [`docs/schema.md:141`](../../docs/schema.md) — "`program_weeks_id` is nullable (NULL on copy/repeat-created days)." [`docs/schema.md:519-520`](../../docs/schema.md) — `program_days.program_id` is the direct FK, `program_weeks_id` is `SET NULL` on copy. So days created via "copy day" or "repeat block" carry `program_week_id = NULL`, fail the INNER JOIN, the SELECT returns no row, `found_client_id IS NULL`, exception fires.
- **Pattern to mirror.** [`20260507100100_client_get_program_day_exercises_v2.sql`](../../supabase/migrations/20260507100100_client_get_program_day_exercises_v2.sql) — Phase C of the session-builder pass already did this exact fix on the read RPC. Same shape: drop the `program_weeks` join, walk via `pd.program_id` directly. Drop the `pw.deleted_at` filter (no longer needed). The return shape and arity are unchanged so `CREATE OR REPLACE` is enough — no DROP, no signature collision.
- **Migration filename plan:** `supabase/migrations/20260510120000_client_start_session_v2.sql` (timestamp picked at write time to avoid collision per the `project_supabase_migration_timestamp_collision` memory note). Will diff `supabase/migrations/` against master before pushing.
- **Side check:** [`client_list_program_days`](../../supabase/migrations/20260420102500_client_portal_functions.sql) (lines 24-66) has the same `JOIN program_weeks pw ON pw.id = pd.program_week_id` pattern. The brief doesn't list this as a bug, but it's the same hazard. **Will I fix it?** It's used by the Program tab, not the Today screen, but it would silently drop copy/repeat-created days from the listing too. Recommend folding it into the same migration as a defensive sweep — same file, same fix shape, ~10 extra lines. Flag if you'd rather scope-creep-protect and leave it alone.

### Bug #5 — `client_complete_session` rejects `NULL session_rpe` · **P0 functional**

- **Confirmed.** [`20260420102500_client_portal_functions.sql:334-336`](../../supabase/migrations/20260420102500_client_portal_functions.sql) — `IF p_session_rpe IS NULL OR p_session_rpe NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'session_rpe must be between 1 and 10'`.
- **Diagnosis confirmed.** Per the brief, Phase C UI design accepts blank RPE (clients can skip). The RPC contradicts that contract.
- **Fix shape.** Change the guard to `IF p_session_rpe IS NOT NULL AND p_session_rpe NOT BETWEEN 1 AND 10` — range check applies only when a value is supplied. Function name + arity + return type unchanged, `CREATE OR REPLACE` only.
- **Migration filename plan:** `supabase/migrations/20260510120100_client_complete_session_v2.sql`. Same migration push as Bug #4.

---

## 2. Severity grouping (per protocol)

| Severity | Bugs |
|---|---|
| **P0 architectural** — RPC joins through removed schema layer | #4 |
| **P0 functional** — RPC contradicts published Phase C contract | #5 |
| **P1 functional** — Today screen unusable without exercise names | #1 |
| **P2 polish** — Visual signal missing | #3 |
| **Design call** — Verify intent first | #2 |
| **Pre-flight blocker** — Phase C-not-actually-merged | §0 above |

---

## 3. What NOT to touch

Inherited from the sibling gap doc plus this audit:

- **`Logger.tsx` per-set RPC flow** — set-keyed inputs, optimistic state, `client_log_set` calls. Untouched.
- **`startOrResumeSessionAction` idempotency** — the "is there an in-progress session" check before calling the RPC. Untouched.
- **`BottomNav` realtime + visibility resync** — load-bearing. Untouched.
- **`client_log_set`, `client_get_published_reports`, `client_available_slots`** — only the two named RPCs (`client_start_session`, `client_complete_session`) get v2 migrations. Other RPCs in the same file stay as-is.
- **RLS on `exercises`** — staff-only stays. Bug #1 fix uses an RPC, not a policy change.
- **Sibling gap doc Phases A, B, F** — already merged; those are outside this fix pass. Phase H (completed-this-week count) stays deferred unless the user reopens it.

---

## 4. Implementation plan

**Assumes Option (i) on the Phase C question (§0). If (ii) or (iii), Phase 0 changes accordingly.**

| Phase | Closes | Scope | Files |
|---|---|---|---|
| **0** | §0 Phase C UI | Add a textarea + 1-10 RPE picker to `CompletePrompt`. Wire both into `completeSessionAction(...)`. Two pickers don't need separate sub-components — both stay inline in `CompletePrompt`. | [`Logger.tsx:593-...`](../../src/app/portal/session/[dayId]/_components/Logger.tsx) |
| **1a** | Bug #4 | Migration `20260510120000_client_start_session_v2.sql` — `CREATE OR REPLACE FUNCTION public.client_start_session(p_program_day_id uuid)` walking via `pd.program_id` direct. **Plus** the same fix on `client_list_program_days` (same file, same hazard) — see Bug #4 audit's side-check. | New migration |
| **1b** | Bug #5 | Migration `20260510120100_client_complete_session_v2.sql` — `CREATE OR REPLACE` flipping the NULL guard to permissive. | New migration |
| **1c** | 1a + 1b | `supabase db push` (live remote — no Docker per the `project_no_docker_local_supabase` memory note). Then `supabase gen types typescript --project-id ... > src/types/database.ts` for type regen. Diff before push to dodge silent timestamp collisions. | Live Supabase + `src/types/database.ts` |
| **2a** | Bug #1 (preferred path b) | Migration `20260510130000_client_get_week_overview.sql` — new RPC returning per-week days + per-exercise summary. SECURITY DEFINER + `auth.uid()` pin + `GRANT EXECUTE TO authenticated`. Returns `program_day_id, scheduled_date, day_label, sort_order, exercises jsonb` where `exercises` is `jsonb_agg(jsonb_build_object('name', e.name, 'sort_order', pe.sort_order, 'sets', ..., 'reps', ..., 'optional_value', ..., 'rpe', ..., 'superset_group_id', ...))`. | New migration |
| **2b** | Bug #1 | Refactor [`portal/page.tsx:73-92`](../../src/app/portal/page.tsx) to call `client_get_week_overview` instead of the SELECT chain. Drop the local `RawExercise` type, drive `buildExerciseList` off the RPC return shape. | `portal/page.tsx` |
| **3** | Bug #3 | [`TodayScreen.tsx:99-104`](../../src/app/portal/_components/TodayScreen.tsx) — render `.portal-day-cell__dot` for any state ∈ {today, upcoming, done}, keep `__tag` separately. The dot is `var(--color-accent)` per the existing `.portal-day-cell__dot` rule in [`globals.css:1104-1109`](../../src/app/globals.css). No new CSS, no new tokens. | `TodayScreen.tsx` |
| **4** | Bug #2 (if confirmed in scope) | Add `?w=YYYY-MM-DD` query param to [`portal/page.tsx`](../../src/app/portal/page.tsx); `mondayOfCurrentWeek()` becomes `mondayFromQueryOrToday(searchParams)`. New `WeekStripNav` chrome above the strip with month label + prev/next chevrons (Lucide `ChevronLeft` / `ChevronRight`, 2px stroke, parchment outline). Today highlight only when current week. Skip if user says by-design. | `portal/page.tsx`, `TodayScreen.tsx`, new chrome |
| **5** | Acceptance | Run the brief's 9-step bar. `npm run build` from inside the worktree (NOT the main repo — see CLAUDE.md "Local dev gotchas"). Verify against `:3000` (per `feedback_dev_server_3000_only`). | — |

**Dependency notes:**

- Phase 0 (Phase C UI) doesn't depend on the RPC fixes — the UI can land first and the RPC errors will surface in the alert. But the alert UX is bad, so I'll order it as Phase 1c → Phase 0 → testing.
- Phase 2 depends on Phase 1c (because the new `client_get_week_overview` RPC is added in the same `db push`).
- Phase 3 is independent. Phase 4 is independent. They can land in any order after Phase 1c.
- Acceptance test suite is the gate, not "looks fine" — per CLAUDE.md.

---

## 5. Acceptance bar

Per the brief, an EP can:

1. Log in as a seed client.
2. Navigate to `/portal` and see real exercise names on Today's session card (no "Exercise" placeholders). · Bug #1
3. See a green dot under each date that has a programmed session in the current week. · Bug #3
4. Tap into today's session — reach the Logger without "No active program day for this caller". · Bug #4
5. Log all sets through the Logger.
6. Reach the Phase C `CompletePrompt`. · Phase 0 (i)
7. Tap **Finish session** with both fields blank — succeed without error and land on `/portal/session/[dayId]/complete`. · Bug #5 + Phase 0 (i)
8. Repeat with feedback only / RPE only / both filled — all succeed. · Phase 0 (i)
9. SQL-verify against `sessions`: row 1 has both populated, rows 2/3 one NULL each, row 4 both NULL, all four `completed_at` non-NULL. · Phase 0 (i) + Bug #5
10. (Conditional, only if Bug #2 in scope) Tap chevron prev/next on the week strip — week reloads, dots reflect that week's programmed days.

`npm run build` passes from inside the worktree.

No new RLS, no schema drift outside the v2 RPCs and the new `client_get_week_overview`. Audit-register impact: zero (the new RPC is read-only and adds no tables). RLS-first design preserved (the new RPC is SECURITY DEFINER, pins to `auth.uid()`, GRANT to `authenticated`).

---

## 6. Sign-off questions

Three answers unblock the work.

| Q | Question | Default |
|---|----------|---------|
| **1** | Phase C resolution per §0 — pick (i), (ii), or (iii) | (i) |
| **2** | Bug #1 — RPC path (a) per-day loop, or (b) new week-overview RPC | (b) |
| **3** | Bug #2 — confirm in-scope (build week navigation) or out-of-scope (close as by-design / defer) | in-scope (build it) |

Bonus question — small, safe to ignore:
- **4.** Bug #4 side-check — do the same `program_weeks` JOIN drop on `client_list_program_days` while the migration is open? Same file, same risk class, ~10 extra lines. Default: yes.

Reply with the four answers (or just "(i), (b), in-scope, yes") and I'll proceed in dependency order.

---

## 7. Sign-off + resolution log (2026-05-10)

**Choices locked:** (i), (b), in-scope, yes. Implemented in dependency order per §4.

| Item | Resolution | Files |
|---|---|---|
| **§0 Phase C** | (i) — Phase C UI bundled. `CompletePrompt` now has a 1-10 RPE chip strip + a feedback textarea. Both optional. Empty feedback normalises to NULL on submit so `''` doesn't store. | [`Logger.tsx:593-...`](../../src/app/portal/session/[dayId]/_components/Logger.tsx) |
| **Bug #4** | New migration `20260510130000_client_start_session_v2.sql`. `client_start_session` walks via `pd.program_id` direct, drops the `program_weeks` JOIN. Side-check fix folded in: `client_list_program_days` switched to LEFT JOIN of `program_weeks` (so `week_number` stays available when present). `day_of_week` derived from `EXTRACT(ISODOW FROM scheduled_date) - 1` — the column itself was dropped in `20260503100000`. | [Migration](../../supabase/migrations/20260510130000_client_start_session_v2.sql) |
| **Bug #5** | Two-layer fix. **(a)** RPC: migration `20260510130100_client_complete_session_v2.sql` flipped the guard to `IS NOT NULL AND NOT BETWEEN 1 AND 10`. **(b)** Schema (added 2026-05-10 follow-up after first end-to-end test surfaced the table-level reject): migration `20260510150000_relax_sessions_completed_requires_rpe.sql` drops the CHECK constraint `sessions_completed_requires_rpe`. The original schema in `20260420101900_session_logging.sql:42-44` enforced "completed ⇒ RPE not null" at the table level — my first pass missed this because I only audited the RPC. The application-layer fix was a no-op without the schema-layer fix; the alert `"new row for relation \"sessions\" violates check constraint \"sessions_completed_requires_rpe\""` surfaced on the first manual test. Column-level `BETWEEN 1 AND 10` guard remains. | [RPC migration](../../supabase/migrations/20260510130100_client_complete_session_v2.sql), [Schema migration](../../supabase/migrations/20260510150000_relax_sessions_completed_requires_rpe.sql) |
| **Bug #1** | (b) — new RPC. Migration `20260510140000_client_get_week_overview.sql` returns published days for the week + a per-day jsonb array of exercise summaries. `portal/page.tsx` swaps the broken `exercise:exercises(name)` PostgREST embed for one RPC call. New `RawExercise` shape carries `name` directly (RPC pre-resolved through SECURITY DEFINER). | [Migration](../../supabase/migrations/20260510140000_client_get_week_overview.sql), [`page.tsx`](../../src/app/portal/page.tsx) |
| **Bug #3** | `TodayScreen.tsx` — `.portal-day-cell__dot` now renders for any state ≠ 'rest' (was: only `'done' && !dayLabel`, which never fired). Tag and dot coexist — tag identifies which day variant, dot signals "session today" at a glance. Mirrors the prototype's `.has-session::after` rule. | [`TodayScreen.tsx:99-115`](../../src/app/portal/_components/TodayScreen.tsx) |
| **Bug #2** | In-scope. `?w=YYYY-MM-DD` query-param navigation. `mondayFromIso` helper added to `portal-helpers.ts` (snaps any date to its Monday, falls back to today on bad input). New chrome above the strip: month label (left), prev/next chevron Links (right), plus a "Back to today" pill that only shows when the visited week ≠ current week. | [`portal-helpers.ts:7-39`](../../src/app/portal/_lib/portal-helpers.ts), [`page.tsx`](../../src/app/portal/page.tsx), [`TodayScreen.tsx`](../../src/app/portal/_components/TodayScreen.tsx) |

### 7.1 Migration push transcript

Three migrations of mine + two of Phase F (which had been committed to master but never pushed to live Supabase):

```
$ supabase db push --yes
Applying migration 20260510120000_client_book_appointment.sql...
Applying migration 20260510120100_client_select_session_types.sql...
ERROR: policy "client select session_types in own org" for table "session_types" already exists (SQLSTATE 42710)
```

The Phase F session_types policy had already been applied to the remote DB through some other path (likely a parallel worktree or the SQL Editor), but the migration history table didn't know. Resolved per the `project_supabase_migration_timestamp_collision` memory note pattern:

```
$ supabase migration repair --status applied 20260510120100 --yes
Repaired migration history: [20260510120100] => applied

$ supabase db push --yes
Applying migration 20260510130000_client_start_session_v2.sql...
Applying migration 20260510130100_client_complete_session_v2.sql...
Applying migration 20260510140000_client_get_week_overview.sql...
Finished supabase db push.
```

`supabase migration list` now shows all five timestamps with both local and remote columns populated.

### 7.2 Type regen + build

`supabase gen types typescript --project-id azjllcsffixswiigjqhj > src/types/database.ts` then stripped two trailing CLI version-update notice lines that the gen subcommand prints to stdout (would-be artefact in the generated file).

After type regen, two stale `// @ts-expect-error` directives that Phase F left in place ("remove after the next successful `npm run supabase:types`") became real errors and were removed:

- [`src/app/portal/book/actions.ts:28`](../../src/app/portal/book/actions.ts) — over `client_cancel_appointment` rpc call
- [`src/app/portal/book/new/actions.ts:55`](../../src/app/portal/book/new/actions.ts) — over `client_book_appointment` rpc call

`npm run build` from inside the worktree: ✓ passes. Routes listed include all 8 portal routes.

### 7.3 What still needs the user

- **Visual verification on `:3000`** — per project memory `feedback_dev_server_3000_only`, I do not spin worktree previews. The user runs the four-test sequence on the existing localhost dev server after the worktree is fast-forwarded onto master. Test sequence below in §7.4.
- **External IT review of the new RPC** — `client_get_week_overview` is SECURITY DEFINER pinned to `auth.uid()`, follows the same posture as the rest of the family. Listed here so it doesn't slip through the open gates check (CLAUDE.md "Open gates" — external review of `auth.md` + `rls-policies.md` should include this RPC's SECURITY DEFINER footprint).

### 7.4 Phase C four-test verification sequence

For pasting back into the Phase C chat. Run after fast-forwarding master:

1. **Both filled** — pick today's session → log all sets → on `CompletePrompt`, type "Felt strong" in feedback, tap RPE = 7, tap **Finish session**. Lands on `/portal/session/[dayId]/complete`.
2. **RPE only** — start fresh session (different day or after resetting). Skip feedback, tap RPE = 6, finish.
3. **Feedback only** — type "Right knee twinge" in feedback, leave RPE chips untapped, finish.
4. **Both blank** — leave both empty, tap **Finish session** straight through.

DB check:

```sql
SELECT id, completed_at, session_rpe, feedback
  FROM sessions
 WHERE client_id = '<seed-client-id>'
   AND completed_at IS NOT NULL
 ORDER BY completed_at DESC
 LIMIT 4;
```

Expected: row 1 (most recent — test 4) both NULL, row 2 (test 3) feedback set + rpe NULL, row 3 (test 2) rpe set + feedback NULL, row 4 (test 1) both populated, all four `completed_at` non-null.
