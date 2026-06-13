# Polish-pass gap analysis — Program calendar

**Brief:** `Client_Platform_Brief_v2.1.docx` §6.2 (Program Calendar, Staff View), constrained by §2.1 (progressive disclosure), §2.3 (contextual reference), §2.4 (inline navigation), §9.1 (Phase 1 build scope).
**Reference prototype:** [`program-calendar.html`](../../program-calendar.html) — validated design intent, **partially superseded** by operator walkthrough decisions recorded in [`programs.md`](programs.md) (popover day model, single-month grid, block-level toolbar). Where this doc says "accepted deviation," the provenance is a recorded operator sign-off, not a silent pick.
**Prior pass:** [`docs/polish/programs.md`](programs.md) (Phases A–F, closed 2026-05-04). This section is a polish pass over that work, not a rebuild.
**Carried in from section 5 (program engine, closed 2026-06-12):** (a) re-verify calendar Copy/Repeat affordances against the G-1-fixed clone RPCs; (b) browser pass for the clone operations substituted with pgTAP coverage at section-5 sign-off; (c) the view-mode / pin-state persistence question (localStorage vs `practice_preferences`).
**Current implementation:** [`page.tsx`](../../src/app/(staff)/clients/[id]/program/page.tsx), [`MonthCalendar.tsx`](../../src/app/(staff)/clients/[id]/program/_components/MonthCalendar.tsx), [`ProgramToolbar.tsx`](../../src/app/(staff)/clients/[id]/program/_components/ProgramToolbar.tsx), [`CalendarSidePanel.tsx`](../../src/app/(staff)/clients/[id]/program/_components/CalendarSidePanel.tsx), [`CalendarPanelToggle.tsx`](../../src/app/(staff)/clients/[id]/program/_components/CalendarPanelToggle.tsx), [`day-actions.ts`](../../src/app/(staff)/clients/[id]/program/day-actions.ts), [`program-actions.ts`](../../src/app/(staff)/clients/[id]/program/program-actions.ts); RPC family in migrations `20260503120000`–`20260504110000`, `20260612100000`, `20260612130000`.
**Audit date:** 2026-06-12
**Status:** Gap document — awaiting sign-off before any code changes (protocol step 5).

---

## 0. Executive summary

The calendar is in good shape. The 2026-05 programs pass already delivered the month grid, collapsible weeks, the day popover with Open/Copy/Repeat/Delete, block-level toolbar operations, conflict handling, the Notes/Reports side panel, and 55 green pgTAP assertions across the RPC family. The G-1 per-set fan-out fix (migration `20260612100000`) closed the worst data-integrity hole before this section opened.

What remains is narrower than a typical section: **one correctness bug** (server-side "today" is computed in UTC, so every morning before ~10–11am AEST the calendar's notion of today is yesterday), **one carried security rider** (`_program_for_date` is a guardless SECURITY DEFINER helper still anon-EXECUTE), **one spec disagreement to resolve** (the brief and CLAUDE.md name "Copy Week / Repeat Specific" toolbar operations; the signed-off programs pass deliberately replaced them with block + day operations), **one verification debt** (the clone operations substituted with pgTAP coverage at section-5 sign-off still need their browser pass), and a short tail of polish items.

### 0.1 Sign-off log (2026-06-12)

Operator approved the gap list with four decisions and one amendment (chat, 2026-06-12, with screenshot of the live calendar):

| Q | Decision | Notes |
|---|---|---|
| Q1 | **(a), amended** | Add week-level **Copy AND Repeat** operations. Affordances live on the **collapsed week summary row**, next to the session count (operator pointed at the collapsed 8–14 Jun row in the screenshot). No new toolbar buttons — day-level repeat-weekly stands as the "Repeat Specific" fulfilment. P1-1 rewritten accordingly. |
| Q2 | **(a)** | Pin/view-mode state stays in localStorage for the f&f beta. `practice_preferences` re-trigger unchanged (second device/practitioner in real use, or a Settings preferences surface). |
| Q3 | **(a)** | Honor the brief — full-width container in both panel states. |
| Q4 | **(a)** | Practice timezone as a constant in `src/lib/constants.ts` (`Australia/Sydney`); noted as a future `practice_preferences` candidate. |
| Side note | New gap **P2-6** | Operator: the toolbar row squishes the "Program Calendar" title into a wrapped, jumbled header. Rearrange clean and concise. |

---

## 1. §6.2 conformance — line by line

| §6.2 requirement | Status | Evidence / provenance |
|---|---|---|
| Pure month-view calendar, no mesocycle language | **Met** | Single Mon-first 6×7 grid; "training block" naming operator-approved (programs.md P2-6) |
| Mon–Sun columns, date numbers per cell | **Met** | `MonthCalendar.tsx` MonthGrid |
| Month nav arrows + "Today" snap-back | **Met, with FM-1 caveat** | Today button renders only off-current-month; "today" itself is UTC-derived (page.tsx:166) |
| Session days show "Day A" badge | **Met** | Badge + exercise-count caption per cell |
| Click week's date row to expand and reveal exercises | **Accepted deviation** | Operator chose the anchored day popover over inline row expansion at the Phase B walkthrough (programs.md). Residual: collapse affordance is chevron-only and weeks default to expanded — see FM-7 / P2-3 |
| Days within a week open/close independently | **Accepted deviation** | Single-open popover at a time, operator-approved ("keeps the calendar readable") |
| Trailing adjacent-month dates muted | **Met** | 40% opacity |
| Calendar fills full screen width by default | **Not met** | Closed-state page is capped at the standard 1200px `.page` container; the wide `min(2000px, 98vw)` layout engages only when the side panel is open (Phase E.0a) — see Q3 |
| Notes panel slides in from right; calendar resizes, never overlays | **Met** | CSS grid `1fr` ↔ `1fr 260px`; no overlay. No slide animation (conditional render) — acceptable under the restrained-motion rules |
| **Copy Week and Repeat Specific buttons in the toolbar** | **Not met as written** | Toolbar has Copy/Repeat **block** + Archive + Save as template + New block; day popover has Copy/Repeat **day**. No week-level operation exists anywhere; multi-day copy was explicitly out-of-scoped in programs.md §5. Brief §6.2, the prototype, and CLAUDE.md's active-section line all name week-level ops — **document disagreement, surfaced as Q1** |
| Program label with an Active tag | **Partially met** | Block name renders in the header (page.tsx:343) and a meta line shows duration/start; no Active status tag — see P2-5 |

---

## 2. Premortem — ranked failure modes (protocol step 3)

Weighting per protocol: infrastructure and security failure modes at **production grade**; operational, UX, and workflow failure modes at **friends-and-family scope** (operator + one EP collaborator + small invited circle, no paying clinical clients).

| # | Failure mode | Likelihood | Impact | Notes |
|---|---|---|---|---|
| **FM-1** | **"Today" is wrong every morning.** `page.tsx:166` computes `todayIso` as `new Date().toISOString().slice(0,10)` — UTC, on the server. For an Australian operator (UTC+10/+11), from local midnight until ~10–11am the calendar believes today is yesterday. Effects: today ring on the wrong date; "Today" snap-back lands on the wrong month on the 1st; copy-pick mode dims the wrong "past" set (yesterday becomes a paste target); `resolveCurrentBlock` picks the previous block on boundary mornings. The EP programs in the morning — this fires exactly when the tool is used. | **Certain** (daily window) | Medium-high — correctness of paste-target gating and block resolution, plus visible wrongness that erodes trust | → P0-2 |
| **FM-2** | **Guardless SECURITY DEFINER helper reachable by anon.** `_program_for_date` (migration `20260503120000`) has no in-body auth guard and — per the Supabase default-EXECUTE-grant gotcha — remains anon-EXECUTE; the `20260612130000` sweep covered six functions but not this one, nor the older siblings (`copy_program`, `repeat_program`, `create_program_day`, the program soft-delete/restore family). Read-only and requires a client UUID, but it is the named priority in the carried go-live rider, and the auto-grant condition keeps re-tripping on every new function. Weighted production-grade per protocol. | Low (exploit) / High (audit) | Information disclosure surface; non-negotiable hygiene before first real login | → P0-1 |
| **FM-3** | **Generic action failures are silent or mislabeled.** `runRepeat` error path returns to idle with only a `console.error` (MonthCalendar.tsx:266–270) — the EP sees nothing. `runCopy` error path shows the *no-active-block* toast for **any** error including network/RLS failures (MonthCalendar.tsx:230–235) — a wrong, misleading message. First flaky connection or expired session produces "I clicked it and nothing happened" or a false explanation. | Medium | Medium — confusion, retry storms, mistrust of batch ops | → P1-2 |
| **FM-4** | **Clone fan-out has pgTAP coverage but no browser pass.** At section-5 sign-off, clone operations were verified by pgTAP in lieu of a browser walkthrough (carried item (b)). If the UI mishandles cloned per-set prescriptions (popover summary, builder open on a cloned day), the EP trusts a copy that is silently wrong — the exact failure class G-1 fixed at the DB layer, one layer up. | Low-medium | High if real — wrong prescriptions delivered to a client | → P1-3 |
| **FM-5** | **Section ships non-conformant to §6.2's named toolbar ops.** "Copy Week / Repeat Specific" appear in the brief, the prototype, and CLAUDE.md's active-section scope, but not in the product. Either the reviewer returns the section, or — worse — the EP genuinely lacks the highest-leverage batch operation (copying a whole training week is the everyday EP workflow; day-by-day copying a 4-day week is 4× the clicks). | Certain (process) / Medium (workflow) | Medium | → P1-1 + Q1 |
| **FM-6** | **Block boundaries are invisible on the grid.** A month spanning two blocks renders identically across the boundary (programs.md P1-6, deferred then, still open). Near a boundary the EP can misattribute a day to the wrong block, and the repeat auto-extend vs adjacent-block fallback (pgTAP G1 case) is invisible in the UI. The "N blocks" eyebrow partially mitigates. | Low-medium | Low-medium at f&f scope | → P2-1 |
| **FM-7** | **Week-collapse affordance is undiscoverable and default deviates from brief.** §2.1 says weeks are minimised by default; implementation defaults to expanded with a small chevron-only toggle that resets on month change. In the single-month-grid model (operator-validated), expanded-by-default is the right call — but the affordance itself is easy to miss. | Low | Low | → P2-3, accepted-deviation note |
| **FM-8** | **Pin/view-mode state is localStorage-only** (`ReportsPanel.tsx:92–244`, keyed per client per Q-M12(b)). EP switches browser/device → pins and view-mode silently reset. Carried premortem question (c). At f&f scope this is an annoyance, not a failure. | Medium | Low | → Q2 (decision, not code, unless overridden) |
| **FM-9** | **Full-width default unfulfilled** — at 1920px the closed-state calendar is a 1200px column with dead margins; §6.2 asks for full width by default. Operator approved the panel-open tuning (E.0a) but the closed-state cap was inherited, never decided. | Certain (visual) | Low | → Q3 / P2-4 |
| **FM-10** | **Design-token drift in calendar components.** Hardcoded hex/rgba, radii, and shadows in MonthCalendar dialogs/popovers; duplicated inline colour constants in CalendarSidePanel/CalendarPanelToggle — violates the "tokens live in globals.css and constants.ts only" code standard. Maintainability, not user-facing. | Certain (exists) | Low | → P2-2 |

### Accepted rather than mitigated (with rationale and re-trigger)

- **Q-D concurrency acceptances** carried unchanged from section 5 (reorder/group race, conflict-check TOCTOU window, two-pass repeat loop, absent dirty-state guard) — re-accepted at single-practitioner f&f scale. Re-trigger: second concurrent staff user.
- **Loader fetches the client's full program history** (all active programs + all days + all exercises in bulk). Fine at f&f scale. Re-trigger: perceptible page slowness or a client exceeding ~50 blocks.
- **`MonthCalendar.tsx` monolith (~2,000 lines).** Accepted; same posture as the builder monolith acceptance. Re-trigger: next structural feature on this surface.
- **Copy-pick / week-pick modes are mouse-only.** No keyboard path beyond Esc-cancel. Accepted at f&f scope. Re-trigger: accessibility bar pre-paying-client (hard rule (a) review).
- **No slide animation on side-panel open** (conditional render + grid resize). Accepted under restrained-motion rules; "slides in" in the brief is not worth a client-transition rework.

---

## 3. Gap list (protocol step 4)

### P0 — architectural / security

| # | Gap | Closes | Detail |
|---|---|---|---|
| **P0-1** | **Anon-EXECUTE sweep of the calendar-owned RPC family.** | FM-2 | One migration, same pattern as `20260612130000`: `REVOKE EXECUTE … FROM anon` on `copy_program`, `repeat_program`, `create_program_day`, `soft_delete_program_day`, `soft_delete_program_exercise`, `restore_program_exercise`; `REVOKE … FROM anon, authenticated` on `_program_for_date` (internal-only, mirroring the `_clone_program` treatment). pgTAP assertions via `has_function_privilege`. Discharges the *calendar-family* portion of the go-live rider; the full-platform sweep stays indexed in `docs/go-live-checklist.md`. |
| **P0-2** | **Practice-timezone "today" foundation.** | FM-1 | A single helper (e.g. `todayInPracticeTz()` in `src/lib/dates.ts`) deriving the ISO date in the practice timezone (source per Q4). Replace `page.tsx:166`; audit every `todayIso` consumer (today ring, `gotoToday`, copy-pick past-dimming, `RepeatEndDatePicker` defaults, `resolveCurrentBlock`). Lands before any UX gap that builds on date logic. **Rider out:** the client portal's week-strip today-highlight shares the same UTC pattern — recorded as a rider to section 7 (Client portal PWA), not fixed here. |

### P1 — functional

| # | Gap | Closes | Detail |
|---|---|---|---|
| **P1-1** | **Copy week + Repeat week batch operations** *(Q1 = a, amended)*. | FM-5 | Affordances: Copy and Repeat icon buttons on the **collapsed week summary row**, next to the session count; disabled (quiet title explaining why) when the week has 0 sessions. No new toolbar buttons — the toolbar stays block-level, which also relieves the header (P2-6). **Copy week:** click Copy on the source row → target-week-pick mode mirroring the day-copy state machine (destination week rows become click targets; past weeks and the source dim; Esc cancels) → RPC `copy_program_week(p_client_id, p_source_week_start, p_target_week_start, p_force)` clones every programmed day in the source Mon–Sun range onto the same weekday offsets in the target week. **Repeat week:** click Repeat → end-date picker (reuse the `RepeatEndDatePicker` pattern; preview line, e.g. "3 weeks — Mon 15 Jun to Sun 5 Jul") → RPC `repeat_program_week(p_client_id, p_source_week_start, p_end_date, p_force)` clones the whole week onto each subsequent week through the end date. Both RPCs reuse the `copy_program_day` per-day internals — per-set fan-out, superset remap, conflict accumulation across **all** target dates in one response, out-of-coverage reporting, auto-extend semantics matching day-repeat. SECURITY DEFINER + org/role guard + anon revoke from birth. Conflict UX reuses `ConflictDialog`. pgTAP before UI. "Repeat Specific" is satisfied by the existing day-level repeat-weekly flow. |
| **P1-2** | **Honest error surfacing on all calendar mutations.** | FM-3 | Distinct generic-error dialog (factual voice: "Copy failed. Check your connection and try again."), correcting the `runCopy` mislabel and the `runRepeat` silent return; audit the block-level dialogs' generic-error paths for the same. No toast library — reuse the existing one-button `ConflictDialog` shape. |
| **P1-3** | **Browser pass for the four clone paths.** | FM-4 | On the live calendar (port-3000 dev server): copy day, repeat day weekly, copy block, repeat block — each verified end-to-end in the browser including per-set prescriptions rendering correctly in the day popover and in the builder on a cloned day. Discharges section-5 carried items (a) and (b). Verification work, not new code — but it is a gap because the section cannot close without it. |

### P2 — polish

| # | Gap | Closes | Detail |
|---|---|---|---|
| **P2-1** | Block-boundary cue. | FM-6 | Quiet block-name eyebrow in the day popover (verify presence; add if absent) so any day self-identifies its block. Optionally a 1px boundary hairline between blocks within the grid — only if it survives the restraint bar. |
| **P2-2** | Design-token sweep of calendar components. | FM-10 | Replace hardcoded hex/rgba/radii/shadows in MonthCalendar dialogs and popovers, CalendarSidePanel, CalendarPanelToggle with token references; collapse the duplicated inline colour constants. The floating-overlay shadow accepted in the Phase F P2-4 audit stays — just named, not inlined. |
| **P2-3** | Week-collapse affordance widening. | FM-7 | Make the collapsed summary strip and the expanded row's left gutter both full click targets (not chevron-only). Default stays expanded — recorded as an accepted deviation from §2.1, rationale: in the operator-validated single-month grid, collapsed-by-default would hide the month at a glance. |
| **P2-4** | Full-width closed-state layout *(pending Q3)*. | FM-9 | If Q3 = A: use the wide container in both panel states so the calendar fills the screen by default per §6.2. |
| **P2-5** | Active tag on the current-block label. | §6.2 | Small status chip beside the block name in the header (page.tsx:343). Meaningful now that multiple blocks (active/archived) coexist. |
| **P2-6** | Header layout rearrangement. | Operator request (sign-off log) | The five toolbar buttons + panel toggle squeeze the "Program Calendar" title into a two-line wrap; the eyebrow/title/meta stack reads jumbled. Rearrange so the title sits on one line and the actions read as one calm group — consider demoting secondary actions (Archive, Save as template) behind a quiet overflow if needed. Lands together with P2-4's full-width container, which buys the horizontal room. Visual walkthrough approval required before this one closes. |

---

## 4. Open questions — all resolved 2026-06-12 (see §0.1 sign-off log)

**Q1 — "Copy Week / Repeat Specific" document disagreement.** Brief §6.2 + prototype + CLAUDE.md active-section line name week-level toolbar ops; the signed-off programs pass (2026-05-03) deliberately replaced the toolbar with block-level ops and explicitly out-of-scoped multi-day copy. Surfacing per the source-of-truth rule rather than silently picking. Options:
- **(a) Recommended — add Copy Week (P1-1); treat Repeat Specific as already shipped.** The day-level repeat-weekly flow *is* "repeat specific" (repeat a specific day on its weekday until an end date — programs.md Q4b). Copy Week is the genuinely missing op and the EP's highest-leverage batch action. No new "Repeat Specific" toolbar button.
- **(b)** Declare the block + day operation family the fulfilment of §6.2's intent; amend the conformance note and CLAUDE.md wording; no new code.
- **(c)** Full prototype parity: both "Copy Week" and "Repeat Specific" as toolbar buttons.
Recommend **(a)**: CLAUDE.md (most recent, governs this section) names the ops as section scope, and (c) would duplicate an existing flow behind a second entry point.
**Resolved: (a), amended** — week-level Copy *and* Repeat both in scope; affordances on the collapsed week summary row, not the toolbar. P1-1 carries the full spec.

**Q2 — Pin-state / view-mode persistence** (carried item (c)). Options: **(a) Recommended — keep localStorage for the f&f beta**, document the limitation; re-trigger for a DB-backed `practice_preferences` table: a second device/practitioner in real use, or when Settings grows a preferences surface. **(b)** Build `practice_preferences` now (new tenant table: RLS, audit register, migration — real cost for an annoyance-class problem at current scope).
**Resolved: (a).**

**Q3 — Calendar full-screen width by default** (§6.2, currently unmet). Options: **(a) Recommended — honor the brief**: wide container in both panel states; cells grow from ~257px to ~290px+ on a 1920px display. **(b)** Keep the 1200px closed-state cap for visual consistency with the rest of the staff app, and record the §6.2 line as an accepted deviation. Recommending (a) because the brief is explicit and the E.0a approval never actually weighed the closed state.
**Resolved: (a).**

**Q4 — Practice timezone source for P0-2.** Options: **(a) Recommended — constant in `src/lib/constants.ts`** (`Australia/Sydney`), single-practice reality, zero schema cost; noted as a `practice_preferences` candidate alongside Q2's re-trigger. **(b)** Env var. **(c)** Per-practice DB setting now. Recommending (a): configuration-at-runtime matters when the EP needs to change it without a deploy — a solo Australian practice does not change timezone.
**Resolved: (a).**

---

## 5. Out of scope for this pass

- **Completion data on the calendar, in any form.** Hard rule — prescription and scheduling only; completion lives on the client profile.
- **Drag-and-drop on the calendar surface.** §9.1's "drag-and-drop reorder" line belongs to the session builder (where it shipped); §6.2 is silent. Most-specific-wins; disagreement noted here rather than silently resolved.
- **Template management screen** — deferred from section 5 with its own trigger.
- **Client portal program view** (section 7), **scheduling calendar** (section 9), **dashboard** (section 11).
- **`SessionTypesEditor` stale-add fix** and **test 05 fixture repair** — riders owned by other sections, already spawned as standalone tasks.
- **Program archival / hide-old-blocks UI** — tracked in `deferred-prompts.md`.

---

## 6. Stop point — contract approved

Approved by the operator 2026-06-12: Q1 a (amended — week ops on the collapsed week row), Q2 a, Q3 a, Q4 a; header-layout side note recorded as P2-6. This list is now the contract for the section.

Build order (protocol step 6 — architecture before features, features before polish):
**P0-1** (anon-EXECUTE sweep migration) → **P0-2** (practice-timezone foundation) → **P1-1** (copy/repeat week: RPCs + pgTAP, then UI) → **P1-2** (error surfacing) → **P1-3** (browser pass of all clone paths, now including the week ops) → **P2-4 + P2-6** (full-width layout + header rearrangement, together) → **P2-2** (token sweep) → **P2-1 / P2-3 / P2-5** (boundary cue, collapse affordance, Active tag).

Each gap closes with a brief note in the progress log below.

---

## 7. Progress log

### P0-1 — Anon-EXECUTE sweep of the calendar RPC family (closed; pgTAP 23 21/21 green on live 2026-06-12)

- **Live grant probe first, migration second.** Rather than enumerating from migration files, queried the live project for every public function `anon` can execute. This caught one function the audit had missed (`duplicate_program_day`, `20260508100000`) and confirmed the `20260612130000` six were already clean.
- **Migration [`20260612150000_revoke_anon_execute_calendar_rpcs.sql`](../../supabase/migrations/20260612150000_revoke_anon_execute_calendar_rpcs.sql):** anon revoked on the ten guarded caller-facing functions (`copy_program`, `repeat_program`, `create_program_day`, `duplicate_program_day`, `soft_delete_program_day`, `soft_delete_program_exercise`, `restore_program_exercise`, `soft_delete_program_exercise_set`, `reorder_program_exercises`, `swap_program_exercise`); the guardless internal `_program_for_date` made definer-only (anon + authenticated revoked, mirroring `_clone_program`; verified no supabase-js caller in `src/`). Grants only — no signature or body changes, so no type regen needed. Pushed 2026-06-12.
- **pgTAP [`23_program_rpc_grants.sql`](../../supabase/tests/database/23_program_rpc_grants.sql)** — 21/21 green on live: §A anon holds EXECUTE on none of the 17-function family; §B both internal helpers are definer-only; §C authenticated keeps its grants (a too-broad revoke would break the calendar, not secure it). This is the regression tripwire for the auto-grant trap — any future `CREATE OR REPLACE` in the family that re-trips it fails the suite.
- **Carried rider discharged for this family;** `docs/go-live-checklist.md` §4 updated. The same live probe surfaced the `_test_*` fixture helpers as anon-executable — **outside this section's contract**, recorded in the checklist with remediation shape and flagged to the operator (see §4 entry dated 2026-06-12).

### P0-2 — Practice-timezone "today" foundation (closed; type-check clean 2026-06-12; browser confirmation rides with P1-3)

- **Q4 = (a):** [`src/lib/constants.ts`](../../src/lib/constants.ts) created with `PRACTICE_TIMEZONE = 'Australia/Sydney'`. (Note: CLAUDE.md states design tokens live in `constants.ts`, but the file did not exist until now — tokens are in `globals.css` only. CLAUDE.md drift, surfaced to the operator 2026-06-12.)
- **Helper:** [`src/lib/dates.ts`](../../src/lib/dates.ts) → `todayIsoInPracticeTz()` — `Intl.DateTimeFormat('en-CA', { timeZone })` does the conversion and the `YYYY-MM-DD` formatting in one step. Works server- and client-side, so every surface uses the same source.
- **Three call sites swapped:** the calendar loader ([`page.tsx`](../../src/app/(staff)/clients/[id]/program/page.tsx) — feeds the today ring, Today snap-back, copy-pick past-dimming, and `resolveCurrentBlock`), the new-block default start date ([`new/page.tsx`](../../src/app/(staff)/clients/[id]/program/new/page.tsx) — same UTC bug, found during the consumer audit), and [`SingleDatePicker`](../../src/app/(staff)/clients/[id]/program/_components/SingleDatePicker.tsx) (browser-local clock — right only while the browser is physically in the practice timezone).
- **Deliberately left alone:** `published_at` / `archived_at` writes (full UTC timestamps into timestamptz — correct as-is) and the `parseIso`/`isoFromDate`/`addDaysTo` helpers (local-parts date math, internally consistent, no observed defect — changing them risks regressions for no gain).
- **Verification:** mechanism confirmed via node (`Intl` output matches expected ISO shape); `npm run type-check` clean. The visible assertion — today ring on the right date before 10am AEST — is observable any morning and is folded into the P1-3 browser pass. **Not yet deployed** — `git push` is the prod deploy on this project; commits are local until the build gate runs.

### P1-1 — Copy week + Repeat week (DB layer closed, pgTAP 24 20/20 green on live 2026-06-12; UI built, type-check + lint + `next build` clean; visual walkthrough pending → P1-3)

- **RPCs first, UI second**, per the gap spec. Migration [`20260612160000_program_week_copy_repeat.sql`](../../supabase/migrations/20260612160000_program_week_copy_repeat.sql): `copy_program_week(p_client_id, p_source_week_start, p_target_week_start, p_force)` and `repeat_program_week(p_client_id, p_source_week_start, p_end_date, p_force)`. Both are **orchestrators over `copy_program_day`** — pass 1 buckets every (source day → target date) pair into create/conflict/no-program so the UI gets ONE confirm dialog for the whole operation; pass 2 delegates each pair to the G-1-verified day-clone path (exercises, superset remap, per-set fan-out, all inherited, one transaction). Trade-off documented in the migration header: pass 1 duplicates ~10 lines of conflict detection rather than refactoring the freshly-verified clone internals. Repeat adds the day-level auto-extend (anchored on the block covering the latest source day) and a 105-week end-date cap (bounds the loop; day-repeat's unbounded loop is accepted, but a week multiplies the work ×7). TOCTOU between passes = the standing Q-D acceptance.
- **pgTAP [`24_program_week_copy_repeat.sql`](../../supabase/tests/database/24_program_week_copy_repeat.sql)** — 20/20 green on live, first run. Covers the week-level semantics the orchestrators add: weekday-offset preservation, fan-out through delegation, superset cohesion under one fresh group id, week-wide conflict accumulation, force overwrite without duplication, empty week, non-Monday rejection, repeat conflict accumulation across all target weeks, day-granular end-date cutoff, client-role + unknown-client denials, invalid end date. Day-level clone correctness is inherited and already covered by tests 10/23.
- **Server actions** `copyWeekAction` / `repeatWeekAction` in [`day-actions.ts`](../../src/app/(staff)/clients/[id]/program/day-actions.ts) — same tagged-union + `requireRole` + `revalidatePath` shape as the day family. Types regenerated.
- **UI (Q1 amendment):** Copy and Repeat icon buttons on the **collapsed week summary row**, right of the session count; disabled with a factual title at 0 sessions (counted over the FULL Mon–Sun range — a boundary week can hold adjacent-month days the in-month display count doesn't show); hidden during any pick mode. Copy enters a week-pick mode reusing the day-copy visual machinery at row granularity (source week and past weeks dim; every other week — expanded cells AND collapsed summaries — is a click target with the dashed-accent affordance; Esc cancels). Repeat opens the existing `RepeatEndDatePicker` in a new `weekMode` (same Monday-stepped date maths; title/description/preview re-phrased). Conflict dialogs reuse `ConflictDialog`.
- **P1-2 head start:** the week runners surface generic failures through a new `error-toast` mode (factual one-button dialog) instead of inheriting the day runners' silent-console pattern. Migrating the day-level runners and block dialogs onto it is what remains of P1-2.

### P1-2 — Honest error surfacing on all calendar mutations (closed; type-check clean 2026-06-12)

- **Audit first:** [`ProgramToolbar.tsx`](../../src/app/(staff)/clients/[id]/program/_components/ProgramToolbar.tsx) was **already compliant** — all four block-level operations (copy, repeat, archive, save-as-template) surface generic failures through its `ErrorDialog` with a title and description. No changes there.
- **The four day-level runners in [`MonthCalendar.tsx`](../../src/app/(staff)/clients/[id]/program/_components/MonthCalendar.tsx) migrated to the `error-toast` mode** introduced with the week ops: `runCopy` no longer mislabels a network/auth failure as the no-program toast ("No active block on that date" was a false explanation); `runRepeat` and `runDelete` no longer return silently to idle; `runCreate` no longer just closes the popover. Each now shows a factual one-button dialog ("Copy failed. The session could not be copied. Check your connection and try again." voice) and still logs the raw error to the console for diagnosis.
- FM-3 closed. Verified by type-check + lint (no new findings); the dialogs reuse the `ConflictDialog` shell already visually approved in the programs pass.

### P1-3 — Browser pass of the clone paths (STAGED 2026-06-12; blocked on operator login)

- Dev server started on port 3000 via the preview harness; landing and login pages verified rendering; middleware correctly bounces a stale session. `next build` already green (strongest compile gate).
- **The authenticated walkthrough requires the operator to sign in** — entering credentials is the operator's step, never automated. Walkthrough script on login: (1) today ring on the correct practice-timezone date (P0-2); (2) copy day → target-pick → cloned day's exercises and per-set prescriptions render in popover and builder; (3) repeat day weekly → all occurrences; (4) **week copy from the collapsed row** (Q1 amendment) → both days land on matching weekdays; (5) week repeat → conflict dialog accumulates the full week, force overwrites; (6) block copy + repeat from the toolbar; (7) delete the days/blocks created during the pass (test-client cleanup). DB-level fan-out is already proven (pgTAP 10/24); this pass proves the UI wiring and rendering.
- **Walkthrough run by operator 2026-06-12: seven of eight steps passed (incl. P0-2 today-ring).** Step 10 (block copy) failed and surfaced three real defects → P1-4 below. The seven passing steps stand as their browser-pass evidence; block copy/repeat re-verify under P1-4.

### P1-4 — Block copy/repeat defects from the P1-3 walkthrough (closed; pgTAP 11 16/16 + 23 32/32 green on live, type-check/lint/build clean 2026-06-12; re-walkthrough pending operator)

Five operator-reported issues across two walkthrough rounds, each root-caused from the live DB before any fix (no symptom-patching). Issues 1–3 from round one, issues 4–5 from the round-two re-test:

- **Issue 1 — "overlap" on a date with no visible block.** *Root cause:* during the walkthrough a day-level repeat had auto-extended the active block from 4→7 weeks (the live DB confirmed the block ran to 24 Jul). An empty *covered* week is visually identical to an uncovered one, so copying into "empty" July genuinely collided with the auto-extended range; the bare `overlap` status couldn't say so. *Fix:* migration [`20260612170000`](../../supabase/migrations/20260612170000_block_overlap_detail.sql) — `copy_program` / `repeat_program` pre-check the candidate range against the client's active blocks and return `conflicts[{name,start_date,end_date}]` (end inclusive). The EXCLUDE constraint stays the race-proof backstop inside `_clone_program` (untouched). [`program-actions.ts`](../../src/app/(staff)/clients/[id]/program/program-actions.ts) threads the conflicts; [`ProgramToolbar.tsx`](../../src/app/(staff)/clients/[id]/program/_components/ProgramToolbar.tsx)'s `ErrorDialog` now lists the colliding block(s) by name and date so the EP sees exactly where the gap ends. pgTAP 11 §F (F1/F2) asserts the payload; +2 → 14/14.
- **Issue 2 — archived block still shown on the client-profile Program tab.** *Root cause:* the profile loader ([`page.tsx`](../../src/app/(staff)/clients/[id]/page.tsx)) used `.eq('status','active').maybeSingle()`. Since back-to-back blocks are first-class (D-PROG-002), two active blocks make `.maybeSingle()` error → the tab fell back to showing whichever single active block survived (a zero-session walkthrough zombie), reading as "the archived block is still here." *Fix:* fetch all active blocks ascending and resolve the display block with the **shared** `resolveCurrentBlock` (extracted to [`src/lib/programs/current-block.ts`](../../src/lib/programs/current-block.ts), now used by both the calendar toolbar and the profile tab). Archived blocks are correctly excluded; the multi-active case no longer errors. The current-week badge calc moved off UTC `Date.now()` onto `todayIsoInPracticeTz()` in the same edit (same P0-2 bug class; also cleared a pre-existing impure-render lint error).
- **Issue 3 — no way to tell which block you're copying.** *Fix:* `CopyBlockDialog` gains a **source-block selector** (`BlockSourceField`) — a dropdown when the client has 2+ active blocks (each option shows the block name + its date range, the resolved current one tagged `(current)`), or a static date-range line for a single block. Switching the source re-derives the suggested start date (day after that block ends), name, and visible month in one handler. The whole `blocks` list is threaded page → toolbar → dialog.
- **Issue 4 — couldn't pick which block to archive; the toolbar went empty.** *Root cause (two parts, both from the live DB):* (a) after a copy the client had a future-only active block, and `resolveCurrentBlock` returned **null** for a future-only set (no block contains today, none started in the past) → the toolbar hid every block action even though the block was on the calendar ("exists as if it is not there"); (b) Archive only ever acted on the resolved current block, so a second block couldn't be archived. *Fix:* (a) `resolveCurrentBlock` gains a step-3 **earliest-upcoming fallback** so a future-only block still resolves and the toolbar stays actionable; (b) `ArchiveBlockDialog` reuses `BlockSourceField` ("Archive which block") so the EP picks the block to archive; `runArchive(blockId)` and the threaded `blocks` carry it through.
- **Issue 5 — copy misaligned session weekdays.** *Root cause:* `_clone_program` shifts every day by the raw calendar-day delta `new_start − source_start`. Picking a different weekday than the source start (Mon 15 Jun pick for a Fri 8 May block = 38 days, not a week-multiple) moved every session 3 weekdays — a Tue/Thu block became Fri/Sun. *Fix:* migration [`20260612180000`](../../supabase/migrations/20260612180000_copy_program_weekday_align.sql) — `copy_program` **aligns** the picked start to the source-start weekday within the picked Mon–Sun week (`aligned = picked − isodow(picked) + isodow(source)`), so the shift is always whole weeks and every session keeps its weekday; the picked date still chooses the week. `repeat_program` was already whole-week (untouched). The UI mirrors the same align math (`alignToSourceWeekday`) so the dialog snaps the highlighted date and the preview is truthful, with a "sessions keep the same weekdays" note. pgTAP 11 §G (G1/G2) copies to a non-source weekday and asserts the cloned day stays on the source weekday; +2 → 16/16.
- **Verification:** pgTAP 11 16/16 and 23 32/32 green on live; type-check, lint (no new findings), and `next build` clean; the calendar route serves (redirects unauth, no 500). Visual confirmation of the selectors, overlap-detail dialog, and weekday-preserving copy needs the operator's authenticated session — folded into the P1-3 re-walkthrough.

### Rider closed en route — `_test_*` pgTAP fixture helpers locked down (operator-approved 2026-06-12)

- Migration `20260612160000` §3 revoked anon + authenticated; **pgTAP 23 §D caught, on its first run, that the revoke wasn't enough** — the helpers had never had a PUBLIC revoke, so API roles still resolved EXECUTE through the PUBLIC grant (the inverse of the program family's trap). Follow-up migration [`20260612160100`](../../supabase/migrations/20260612160100_test_helpers_revoke_public.sql) revoked PUBLIC.
- The suite re-run then surfaced the real constraint: eight test files swap JWT identities mid-test **while role-switched to `authenticated`**, so a grant-level lockdown of `_test_set_jwt` breaks them. Fix chosen: [`00_test_helpers.sql`](../../supabase/tests/database/00_test_helpers.sql) is now **self-securing** — every helper carries an in-body `session_user = 'postgres'` guard (`SET ROLE` never changes `session_user`, so the owner-session test runner passes even role-switched, while a PostgREST `authenticator` session raises 42501 regardless of grants — and the guard survives the auto-grant trap on any future `CREATE OR REPLACE`). The two JWT spoofers keep an `authenticated` EXECUTE grant solely for the role-switched test pattern; the five fixture writers are owner-only at the grant level too. Applied to live; pgTAP 23 §D updated to assert exactly this posture.
- **Empirical proof:** full scriptable suite re-run after the lockdown — **176/176 green across 15 files** (09–13, 15–24), zero errors, no test-file edits needed. `docs/go-live-checklist.md` §4 finding resolved (entry updated at next checklist touch; the polish-doc record here is authoritative for the how).
