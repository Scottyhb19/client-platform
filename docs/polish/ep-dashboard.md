# Polish-pass gap analysis — EP Dashboard (section 11)

**Brief:** [`Client_Platform_Brief_v2.1.docx`](../../Client_Platform_Brief_v2.1.docx) **§6.8** (extracted: [`docs/_brief_v2.1_extracted.txt`](../_brief_v2.1_extracted.txt) lines 157–184). The dashboard is *"the EP's first screen on login … a clinical briefing, not a calendar … [it] answers: 'what needs my attention?'"* Five named sub-surfaces: §6.8.1 stat cards, §6.8.2 needs-attention panel, §6.8.3 today's sessions, §6.8.4 recently completed, §6.8.5 client list (right column). Also a Phase-1 deliverable in §9.1. Treated as the desired end state, not a greenfield spec.
**Reference prototype:** [`dashboard.html`](../../dashboard.html) — validated by the stakeholder (brief §13). Reference for layout/intent only, not code to port (per CLAUDE.md "Reference prototypes"). It shows all five surfaces including the sticky right-column client list with category chips.
**Carried-in riders this section OWNS:** **none.** The dashboard introduces no new tables, no new RLS policies, and no new SECURITY DEFINER functions — it is a read-only projection over surfaces other sections already built and tested. The remaining open platform-wide anon-EXECUTE sweep item (`client_accept_invite`, §2) is **not** a dashboard concern; it stays indexed in [`go-live-checklist.md`](../go-live-checklist.md) under its own section. (Stated explicitly because most prior sections carried a rider; this one does not.)
**Current implementation:** [`dashboard/page.tsx`](../../src/app/(staff)/dashboard/page.tsx) (772 lines — loader + stat cards + attention panel + today's sessions, all server-rendered), [`dashboard/_components/RecentlyCompletedPanel.tsx`](../../src/app/(staff)/dashboard/_components/RecentlyCompletedPanel.tsx) (278 lines — the §6.8.4 surface, client component). Shared: [`clients/_lib/client-helpers.ts`](../../src/app/(staff)/clients/_lib/client-helpers.ts) (`initialsFor`/`toneFor`/`statusFor`), [`_components/SessionExerciseSummary.tsx`](../../src/app/(staff)/_components/SessionExerciseSummary.tsx). Nav/landing: [`(staff)/layout.tsx`](../../src/app/(staff)/layout.tsx) + [`_components/TopBar.tsx`](../../src/app/(staff)/_components/TopBar.tsx) (Dashboard is the first nav item; brand links to `/dashboard`; login default `next=/dashboard`). Data model already present: `client_categories` ([`20260420100500`](../../supabase/migrations/20260420100500_client_categories.sql)), `clients.category_id` ([`20260420100600:28`](../../supabase/migrations/20260420100600_clients.sql)), seeded per-org ([`20260420102400:66-73`](../../supabase/migrations/20260420102400_bootstrap_functions.sql)), configurable in settings ([`settings/page.tsx:212-217`](../../src/app/(staff)/settings/page.tsx)). Distinct from `/analytics` (a separate 12-month range-slicing surface, Phase-4-flavoured — *not* the §6.8 clinical briefing; do not conflate).
**Audit date:** 2026-06-22
**Status:** **Implemented, verified, and reviewer-follow-up addressed 2026-06-22 (§7).** Protocol steps 1–7 complete + the claude.ai reviewer's five points resolved (§7): P0-1 proven under `TZ=UTC` across the DST boundary; an Overdue past-end-program bug (reviewer-caught) fixed; both verify-by-reasoning passes performed + recorded; routing-test audit rows purged. **P1-1 (client list) and P2-4 (responsive layout) WITHDRAWN as owner UX decisions (§5).** Gate green: type-check + next build + eslint clean; no migrations. Merging to master; Sign-off pending.

---

## 0. Executive summary

The dashboard is **built, server-rendered, and computes from live data** — it is not a stub. Three of the five brief surfaces are genuinely well-made:

- **Stat cards (§6.8.1)** — four cards (Sessions today / Active clients / Need attention / Programs ending) with the brief's green/amber/red tone coding, a "next client" sub-line, and clean empty states (`page.tsx:283-333`).
- **Today's sessions (§6.8.3)** — today's appointments, time-ordered, cancelled excluded, each linking to the client profile, with an empty state (`page.tsx:644-746`).
- **Recently completed (§6.8.4)** — the 5 most recent portal-logged sessions with who/when/day-label/RPE and an optional per-session exercise expander. This one is **fully to brief** (and a touch beyond, tastefully) (`RecentlyCompletedPanel.tsx`).

So this is **not a build from zero.** Per the protocol's caution, the existing code is largely correct and this pass must not assume otherwise. The work concentrates in three places:

1. **One correctness P0 — the "today" window ignores the practice timezone.** The page fetches the org timezone and then **discards the result** (`page.tsx:40-44` — a dead round-trip), and computes "today", the greeting, and the date header from raw server-local time (`page.tsx:46-54, 750-763`). On Vercel the server runs **UTC**, so for an Australian practice (UTC+10/+11) the landing page is wrong for most of the working day: the greeting can say "Good evening" at Sydney breakfast, the date header can read yesterday, and the **Sessions-today / Today's-sessions window is off by up to 11 hours** — silently including tomorrow-early or dropping tonight's appointments. This is the **exact failure class** scheduling §9 fixed as a P0 ("practice-tz reconciliation … fixes the daily-wrong-'today'") and portal §7 fixed ("device-timezone 'today' … closes the AM 'today = yesterday'"). The correct pattern already lives **in this page's own layout** — `TopBar` renders its date with `Intl … { timeZone }` (`layout.tsx:46`, `formatToday` `:74-89`) — so the dashboard's date pill and its body can currently disagree on what day it is.

2. **One brief surface is incomplete against the spec; one is dropped by owner decision.**
   - **The client list (§6.8.5) — withdrawn by owner decision (2026-06-22).** It was absent in the implementation, and the operator has decided **not** to add it: a full client list does not earn its place on a "what needs my attention?" briefing when the Clientele page already provides searchable client navigation. Recorded as a conscious **owner-approved deviation from brief §6.8.5**, *not a gap* (see §5). (Had it been built it would have been surface-only — the data model, seed, and settings editor were all present.) The dashboard therefore keeps its current single-main-column layout.
   - **The needs-attention panel fires only 2 of the 4 brief triggers** (`buildAttentionList`, `page.tsx:471-530`). It produces **Flag** (injury flags unreviewed > 14 days ✓, well done — it correctly keys on `flag_reviewed_at` age, `page.tsx:134-147`) and a **New** item — but New is scoped to *"invited, not onboarded"* rather than the brief's *"completed assessment but no program assigned."* The two amber triggers the brief names — **Overdue** ("hasn't logged beyond their normal frequency") and **Ending** ("program ending within 7 days, no new program created") — are **not implemented at all** (the `tone` union doesn't even include `ending`; `overdue` is typed but never produced). For a screen whose entire stated job is "what needs my attention?", this is half-blind.

3. **A short tail of polish + one stat-correctness bug.** The "Programs ending" stat counts already-expired programs **forever** (`weeksIn + 1 >= duration_weeks` never releases a past-due program; `page.tsx:170-177`) and isn't bounded to "this week"; today's-sessions shows a time-derived Now/Done/Upcoming tag instead of the brief's confirmed/pending; archived clients can leak stale items into the panels; inline-literal/token drift; no responsive breakpoints; minor voice drift.

**The shape of this section is the inverse of Messaging.** Messaging was nearly all *perimeter* (new tenant surface → RLS/audit/immutability/tests). The dashboard adds **no new security surface** — it reads `clients`, `appointments`, `sessions`, `programs`, `clinical_notes`, `client_categories`, every one already RLS-scoped and tested by its own section. So there is **no new pgTAP isolation gate** here (a deliberate, honest call — see §2 FM-11), and the weight falls on **brief completeness + one timezone correctness fix**, not on architecture.

**Audit method:** full reads of both dashboard files, the staff layout + TopBar, the settings page, the standalone clients-list component (the natural reuse target), and the category migrations/seed; brief §6.8 read line-by-line against the implementation; the timezone finding cross-checked against the already-correct `TopBar` pattern in the same layout and against the closed scheduling/portal precedents.

---

## 1. Brief conformance — §6.8 line by line

"Met" = present and to spec. "Partial" = present but diverges. "Missing" = absent.

| Brief clause | Status | Evidence / note |
|---|---|---|
| **§6.8** "first screen on login … clinical briefing, not a calendar" | **Met** | Dashboard is the landing (`TopBar` nav order, brand `→/dashboard`, login `next=/dashboard`). Framed as a briefing, not a calendar. |
| **§6.8.1** Sessions today — count + next client name & time | **Met** | `page.tsx:292-303`. Count excludes cancelled; sub-line shows next client + time. |
| **§6.8.1** Active clients — total + new this week | **Met** | `page.tsx:304-312`. Active = not archived/deleted; "N new this week" from `created_at ≤ 7d`. |
| **§6.8.1** Needs attention — count, colour-coded by urgency | **Partial** | `page.tsx:313-322`. Card renders, but the count is structurally incomplete — it only sums the 2 implemented triggers (capped at 6), so it under-reports vs the brief's 4-trigger definition. → tied to **P1-2**. |
| **§6.8.1** Programs ending this week — count | **Partial** | `page.tsx:323-332` + logic `:170-177`. Counts programs in/after their final week — **including long-expired ones, forever**, and not bounded to "this week". → **P1-3**. |
| **§6.8.1** Colour coding green / amber / red | **Met** | `StatCard` tone → `--color-primary/warning/alert/charcoal` (`page.tsx:397-408`). |
| **§6.8.2** Attention: injury flags unreviewed > 14 days → **Flag** (red) | **Met** | `page.tsx:134-147, 493-511`. Correctly keys on `flag_reviewed_at` age and `flag_resolved_at IS NULL`; "Mark reviewed" clears it for 14 days. |
| **§6.8.2** Attention: not logged beyond normal frequency → **Overdue** (amber) | **Missing** | No code path produces an overdue item. `tone: 'overdue'` is typed (`page.tsx:465`) but never emitted. → **P1-2**. Needs a cadence definition — see **§4 Q1**. |
| **§6.8.2** Attention: program ending ≤ 7 days, no new program → **Ending** (amber) | **Missing** | Not in the `tone` union; not produced. `programsEnding` is computed for the *stat card* but never fed into the panel. → **P1-2**. |
| **§6.8.2** Attention: assessment complete, no program assigned → **New** (green) | **Partial** | A "New" item exists but is scoped to *invited-not-onboarded* (`page.tsx:514-527`), not *assessment-complete-no-program*. Different semantics. → **P1-2** + **§4 Q4**. |
| **§6.8.2** "Phase 2 AI powers this; Phase 1 rule-based" | **Met (Phase-1 posture)** | We stay rule-based. Accepted, not a gap. |
| **§6.8.3** Today's sessions: time, name, clinical context, confirmed/pending | **Partial** | `page.tsx:644-746`. Time ✓, name ✓. Shows `appointment_type` only — **no clinical context**; status is a time-derived Now/Done/Upcoming, **not confirmed/pending**. → **P2-1** + **§4 Q2**. |
| **§6.8.3** "Not a full schedule — just enough to prep" | **Met** | Compact; links to `/schedule` for the full grid. |
| **§6.8.4** Recently completed — 5 most recent: when/who/what/RPE | **Met** | `RecentlyCompletedPanel.tsx`. `limit(5)`, `completed_at DESC`, who + day-label + RPE + relative time; optional exercise expander. To spec. |
| **§6.8.5** Client list (right column) — sticky, searchable | **Out of scope — owner decision** | Withdrawn at the operator's request 2026-06-22 (§5). Deliberate UX/UI deviation from the brief, **not a gap**: the Clientele page is the client-list surface; the dashboard stays a briefing. |
| **§6.8.5** Category chips: All, Athlete, Rehab, Lifestyle, Golf, Osteoporosis, Neurological | **Out of scope — owner decision** | Falls away with the client list (§5). The category data model + settings editor remain intact for the Clientele page / analytics; simply not surfaced as dashboard chips. |
| **§6.8.5** Per-client row: avatar, name, category, context, status dot, click→profile | **Out of scope — owner decision** | Part of the withdrawn client list (§5). |
| **Design system / voice** (CLAUDE.md) | **Mostly met** | Uses `--color-*` tokens + `.card/.tag/.avatar/.eyebrow/.btn` classes; no emoji. But heavy inline raw px/rem literals (→ **P2-3**), no responsive breakpoints (→ **P2-4**), and light voice drift ("Take a breath", "Nice") on a staff surface (→ **P2-5**). |

---

## 2. Premortem — ranked failure modes (protocol step 3)

Weighting per protocol: **infrastructure/security at production grade; operational, UX, and workflow at friends-and-family scope** (operator + one EP collaborator + small invited circle; no paying clinical clients; no real data in the live DB yet). A gap closing a high-likelihood failure mode is promoted in priority. The dashboard is read-only over already-tested RLS surfaces, so the production-grade security weighting finds little to bite on (FM-11) and the section's weight falls on correctness + brief completeness.

| # | Failure mode | Likelihood / exploitability | Impact | → |
|---|---|---|---|---|
| **FM-1** | **The landing page shows the wrong day.** "today" window, greeting, and date header are computed from server-local time (`page.tsx:46-54, 750-763`); the org timezone is fetched and **discarded** (`:40-44`). On Vercel (UTC) an AU practice sees a wrong greeting, a wrong/yesterday date, and a **Sessions-today / Today's-sessions set off by up to 11 hours** for most of the working day. The date *pill* (TopBar, tz-correct) and the date *header* (body, tz-wrong) can disagree on the same screen. | **Certain / daily** during AU morning hours | First-screen credibility + the EP preps the day against the wrong appointment set | **P0-1** |
| **FM-2** | ~~A whole brief surface is missing — the §6.8.5 client list.~~ **Withdrawn 2026-06-22** — the client list is an owner-decided omission, not a failure mode (see §5 + the Accepted list below). | — | Not a gap (owner UX/UI decision) | **Withdrawn** |
| **FM-3** | **The "what needs my attention?" panel is half-blind.** Only Flag + (mis-scoped) New fire; **Overdue** and **Ending** — the two triggers most likely to catch a client quietly falling off — never appear (`buildAttentionList`, `page.tsx:471-530`). The screen's stated purpose is partially unmet. | Certain (absent) | The dashboard's core job; an overdue or about-to-lapse client is invisible here | **P1-2** |
| **FM-4** | **"Programs ending" inflates and never clears.** `weeksIn + 1 >= duration_weeks` (`page.tsx:170-177`) stays true for every program past its final week, so any old never-archived active program is counted as "ending" indefinitely; not bounded to "this week". The number drifts upward and stops meaning anything. | High (any past-due active program) | A misleading stat on the landing page; erodes trust in the cards | **P1-3** |
| **FM-5** | **Today's sessions can't show what's unconfirmed.** Status is derived from the clock (Now/Done/Upcoming), not the appointment's confirmed/pending state (brief §6.8.3), and there's no clinical context line. The EP can't see at a glance which of today's sessions are still unconfirmed. | Medium | Prep-quality; misses a brief-named signal | **P2-1** |
| **FM-6** | **Archived clients leak stale items into the panels.** Flagged-notes and recent-completions queries don't exclude archived clients, so an archived client's old unreviewed flag can sit in Needs-attention forever, and their last session can occupy a Recently-completed slot. | Low–medium | Stale noise on the briefing; worsens slowly as clients are archived | **P2-2** |
| **FM-7** | **Recent-completions fan-out is a deep nested embed on every load.** `sessions → exercise_logs → program_exercise → exercise` + `set_logs`, across all clients, run on each dashboard render (`page.tsx:99-120`). The code itself flags promoting to a SECURITY DEFINER RPC if telemetry says so (`:94-98`). | Low at f&f scale (≤50 clients, limit 5) | Page-load latency *if* caseload/among-clients fan-out grows | **Accept** (re-trigger below) |
| **FM-8** | **Token / inline-literal drift.** Stat cards, panels, and rows are styled with many inline raw px/rem/opacity literals alongside proper `var(--…)` (`page.tsx:284-343`, etc.) — same code-standard class as scheduling P2-13 / messaging P2-3. | Certain / cosmetic | Token-discipline erosion; divergence on any palette/radius change | **P2-3** |
| **FM-9** | **No responsive layout.** Stat grid is a fixed `repeat(4,1fr)` and the body a fixed `2fr 1fr`; nothing collapses below ~900px (brief §8 wants down to 768px). **Accepted — owner decision 2026-06-22:** the operator prefers the original fixed desktop layout and reverted the breakpoint work; desktop-first staff surface. | Certain < ~900px / desktop-first | Cramped on tablet only | **Accepted** (re-trigger in §5) |
| **FM-10** | **Voice drift on a staff surface.** "You're clear. Take a breath." / "Nothing flagged. Nice." are free encouragement; the design system reserves encouragement for *earned* moments (post-session) and the staff voice is "clinician's notepad". | Low / cosmetic | Minor brand-voice inconsistency | **P2-5** |
| **FM-11** | **Cross-client aggregation correctness relies on (already-tested) RLS.** Several loaders carry no explicit `organization_id` filter and lean entirely on RLS to scope to the org (the correct pattern). This is safe *because* every table queried has org-scoped RLS with its own pgTAP coverage — but it's worth a one-line reasoning confirm during implementation rather than a new test suite. | Low (default-safe, tested upstream) | A regression would be a cross-tenant leak — but the boundary is owned/tested elsewhere | **Verify-by-reasoning** (no new suite — see below) |
| **FM-12** | **The recently-completed expander reads as raw, scattered numbers.** `SessionExerciseSummary`'s `54px 1fr auto` set grid (`SessionExerciseSummary.tsx:166-167`) stretches the middle column, so the set result and the RPE sit at opposite edges with a void between; all-bold condensed tabular type compounds the "spreadsheet" feel. Operator-reported 2026-06-22. | Certain (operator-observed) | Polish / legibility on a daily-viewed surface (and the shared client-profile rail) | **P2-7** |

### Accepted rather than mitigated (with rationale and re-trigger)

- **No new RLS/pgTAP suite for the dashboard (FM-11).** The dashboard is a read-only projection over `clients`/`appointments`/`sessions`/`programs`/`clinical_notes`/`client_categories`, each already RLS-scoped and pgTAP-covered by its own section. It adds no table, policy, or RPC, so there is no new isolation surface to gate. Implementation will confirm by reasoning that each loader is org-scoped by RLS. **Re-trigger:** any dashboard gap introduces a SECURITY DEFINER RPC (e.g. if FM-7's fan-out is promoted to one) — that RPC gets an anon-EXECUTE sweep + grants tripwire like every other.
- **Recent-completions stays a direct nested query (FM-7), no RPC.** Fine at f&f scale; the code already documents the promotion path. **Re-trigger:** dashboard load latency is reported, caseload grows materially, or telemetry shows the embed is slow.
- **Attention panel stays rule-based.** Brief §6.8.2 assigns AI-powered detection to Phase 2; Phase 1 is rule-based by design. **Re-trigger:** Phase 2 begins.
- **The §6.8.5 client list is an owner-approved deviation, not a gap (operator decision, 2026-06-22).** The operator decided the dashboard will not carry a client list — it does not earn its place on a "what needs my attention?" briefing, and the Clientele page already provides searchable client navigation. Recorded here, in §1, and in §5 so it is never re-flagged as an implementation miss. **Re-trigger:** the operator later wants at-a-glance client browsing on the dashboard, or category filtering with no other home.
- **Analytics remains a separate surface.** `/analytics` is not the §6.8 briefing and is out of scope for this pass. **Re-trigger:** the brief reframes the dashboard to absorb analytics.

---

## 3. Gap list (protocol step 4)

Each gap cross-references the premortem failure mode it closes. Dependency order: correctness (P0) → brief-completeness (P1) → polish (P2). **No code lands until this list + the §4 decisions are approved.**

### P0 — architectural / correctness

| # | Gap | Closes | Detail |
|---|---|---|---|
| **P0-1** | **Reconcile the dashboard "today" to the practice timezone.** | FM-1 | Use the org timezone (already fetched at `page.tsx:40-44`, currently discarded) — and/or `PRACTICE_TIMEZONE` from `src/lib/constants.ts` — to compute the today-window boundaries, the greeting bucket, and the date header, mirroring the already-correct `TopBar.formatToday` (`layout.tsx:74-89`) and the closed scheduling §9 / portal §7 fixes. Compute the local "today" in the practice tz, derive the UTC `start/end` instants from that, and pass those to the `appointments`/`sessions` window queries. Greeting (`greetingFor`, `:750-755`) and `formatDateLong` (`:757-763`) take the tz too. Net effect: the date pill and the body agree, and "Sessions today" is the practice's today. Removes the dead query (folds in **P2-6**). Verify by reasoning that no other dashboard time math uses server-local `getHours/getDate`. |

### P1 — functional (brief completeness)

| # | Gap | Closes | Detail |
|---|---|---|---|
| ~~**P1-1**~~ | ~~**Build the §6.8.5 client list (right column).**~~ **WITHDRAWN 2026-06-22 — owner UX/UI decision (§5).** | — | The operator has decided the dashboard will **not** carry a client list (§6.8.5): it does not add value on a "what needs my attention?" briefing, and the Clientele page already provides searchable client navigation. A **deliberate, owner-approved deviation from the brief**, recorded so no future audit re-flags the missing list as an implementation miss. Consequences: the dashboard keeps its current single-main-column layout (no 3-zone rework); the §6.8.5 category chips fall away with it (the category data model stays intact for the Clientele page / analytics). |
| **P1-2** | **Complete the needs-attention panel to all 4 brief triggers.** | FM-3 | Add **Overdue** + **Ending**, and correct **New**. **Overdue (Q1 resolved):** a client with an **active program** whose most-recent completed session is **> 10 days ago** — the weekly cadence floor (the least-frequent program is 1×/week = 7 days) plus ~3 days grace. A client with an active program who has *never* logged is measured from `program.start_date + 10 days`, so a brand-new program doesn't flag on day one. **Ending:** active program ending ≤ 7 days with no newer program for that client (reuses the P1-3 window). Add `'ending'` to the `tone`/tag union and render its amber tag. **New (Q4 resolved):** implement the brief's "assessment complete, **no program assigned**" **and** keep "invited — not onboarded" as a *second, distinct* reason (both are real "new client needs setup" states). Keep Flag as-is (already correct). Ensure the §6.8.1 "Need attention" stat counts the same complete set, and revisit the hard `slice(0, 6)` cap (`page.tsx:529`) so a real backlog isn't silently hidden (show "+N more → /clients"). |
| **P1-3** | **Fix "Programs ending" so it means "ending this week", and stops counting expired programs.** | FM-4 | Replace `weeksIn + 1 >= duration_weeks` (`page.tsx:170-177`) with a bounded window: the computed end date (`start_date + duration_weeks`) falls within the next 7 days **and** is not already past — i.e. imminent, not lapsed. Long-expired active programs drop out of the count (and instead, if anything, are an Overdue/attention concern). This same end-date computation feeds the P1-2 "Ending" attention trigger — implement once, use in both. |

### P2 — polish

| # | Gap | Closes | Detail |
|---|---|---|---|
| **P2-1** | **Today's sessions: surface confirmed/pending + (optional) clinical context.** | FM-5 | **Q2 resolved (keep live + add status):** keep the genuinely-useful live Now/Done/Upcoming **and** add a confirmed/pending indicator (brief §6.8.3); optionally a one-line clinical context (e.g. active flag / scheduled program day) beyond the bare `appointment_type` (`page.tsx:736`). |
| **P2-2** | **Exclude archived clients from the panels.** | FM-6 | Filter archived clients out of the flagged-notes (Needs-attention) and recent-completions queries so an archived client's stale flag/last-session can't linger on the briefing. |
| **P2-3** | **Token / inline-literal sweep.** | FM-8 | Verified clean: every colour and design radius in the dashboard files uses `var(--…)` (the one raw chip radius was tokenised to `var(--radius-button)`); the remaining inline values are layout px (gaps/paddings/grid templates), the established app pattern. Grids stay inline per the P2-4 revert (§5). Same outcome as messaging P2-3. |
| ~~**P2-4**~~ | ~~**Responsive breakpoints (down to 768px).**~~ **WITHDRAWN 2026-06-22 — owner reverted to the original fixed layout (§5).** | — | Built initially (4→2→1 stat cards + two-column stacking via `.dash-stats`/`.dash-cols`), but the breakpoints plus an `align-items: start` change altered the desktop look. The operator prefers the original fixed `repeat(4,1fr)` / `2fr 1fr` layout and asked to restore it exactly; reverted to the original inline grids and the classes removed. A deliberate owner UX/UI decision (the brief §8 responsive target is consciously deferred for this desktop-first staff surface). **Re-trigger:** the operator wants the dashboard usable on a tablet / narrow window. |
| **P2-5** | **Voice pass on the empty/sub-line copy.** | FM-10 | Bring "Take a breath" / "Nice" / sub-line copy in line with the quiet-clinical staff voice (factual, encouragement reserved for earned moments). Light copy-only change. |
| **P2-6** | **Remove the dead org-timezone query.** | FM-1 | The `organizations.timezone` fetch at `page.tsx:40-44` discards its result. **Folds into P0-1** (which actually consumes the tz); listed separately so the no-op round-trip is explicitly closed, not left behind. |
| **P2-7** | **Redesign the "recently completed" expanded session detail — easier on the eye.** | FM-12 | Operator request (2026-06-22): the expander reads as raw numbers spread too far apart. Root cause: `SessionExerciseSummary`'s per-set grid is `54px 1fr auto` (`SessionExerciseSummary.tsx:166-167`) — the `1fr` stretches, throwing the set result and the RPE to opposite edges, and every value is bold Barlow-Condensed tabular (spreadsheet feel). Redesign to group each set tightly (content-sized columns, capped block width, a soft surface-tinted set block, RPE as a small muted pill — **not** green, per the design system), with type hierarchy from scale/family (weight number prominent, unit lighter). **Shared-scope flag:** `SessionExerciseSummary` is used by **both** the dashboard expander **and** the client-profile completions rail (`ClientProfile.tsx` / `clients/[id]/page.tsx`); the redesign improves both and must read well at **both** widths (wide dashboard expander + narrow profile rail). A visual mock is proposed in chat for approval **before** build. |

---

## 4. Decisions needed before / at approval

Four product-shaped calls that change what gets built. Each lists ≤3 options with a recommendation (per CLAUDE.md communication style). These can be answered inline, or taken to the claude.ai reviewer alongside the gap list — the list does not become the contract until they're settled.

**Q1 — How is "Overdue" defined? (drives P1-2's Overdue trigger)**
The brief says *"hasn't logged a session beyond their normal frequency"* but "normal frequency" is **not a stored field**.
- **(a) Simple fixed threshold — RECOMMENDED.** Flag a client with an active program and no completed session in the last *N* days (e.g. 10). Cheap, predictable, no schema change; tune N later. Closest safe Phase-1 reading.
- (b) Derive cadence from the active program's training-days-per-week and flag when elapsed time since last log exceeds ~1.5× the expected gap. Truer to the brief's wording; more logic, more edge cases (programs with irregular days).
- (c) Add a per-client "expected sessions/week" field and compare against it. Most accurate; requires schema + a settings/profile control — heaviest.

**Q2 — Today's-sessions status display (drives P2-1)**
- **(a) Keep live Now/Done/Upcoming AND add confirmed/pending — RECOMMENDED.** The live status is genuinely useful for prepping the day; confirmed/pending is the brief's named signal. Show both compactly.
- (b) Replace the live status with confirmed/pending only (literal brief).
- (c) Confirmed/pending only, plus a one-line clinical-context field.

**Q3 — Client-list "current context" line + relationship to the Clientele page (drives P1-1)**
- **(a) Program status + active-flag + last-activity, as a read-only quick-jump that complements the Clientele page — RECOMMENDED.** The dashboard list is for at-a-glance triage and fast navigation; the full Clientele page remains the management surface. No duplication of management actions.
- (b) Mirror the Clientele page's row exactly (category subtitle only) for consistency.
- (c) Make the dashboard list the primary client surface and thin out Clientele (larger scope; not recommended).

**Q4 — "New" attention trigger semantics (drives P1-2)**
- **(a) Implement the brief's "assessment complete, no program assigned", and keep "invited-not-onboarded" as a second distinct reason — RECOMMENDED.** Both are real "new client needs setup" states; surfacing both is more useful than either alone.
- (b) Replace with the brief's literal "no program assigned" only.
- (c) Keep the current "invited-not-onboarded" only (status quo; diverges from brief).

---

## 5. Decisions resolved (operator, 2026-06-22)

All four §4 questions answered, plus one new scope item (+5). These amend the gap list above; where a §3 row references a "§4 Qn", the resolution here governs.

| Q | Decision | Effect on the contract |
|---|---|---|
| **Q1 — Overdue cadence** | **No completed session in 10 days**, for a client with an active program. Rationale (operator): the minimum prescribed frequency is one session/week (a 7-day floor), so 10 days = the weekly cadence + ~3 days grace. | Baked into **P1-2**. Never-logged-yet clients measured from `start_date + 10d` so a new program doesn't flag on day one. |
| **Q2 — Today's-sessions status** | **Recommendation** — keep the live Now/Done/Upcoming **and** add confirmed/pending. | Baked into **P2-1**. |
| **Q3 — Client list (§6.8.5)** | **Do not build it.** A full client list does not add value on the dashboard; the Clientele page serves that role. **A deliberate UX/UI decision by the operator — to be recorded as an owner-approved deviation from the brief, not an implementation mistake.** | **P1-1 WITHDRAWN.** §6.8.5 reclassified "out of scope — owner decision" in §1; FM-2 withdrawn; added to the §2 Accepted list. Dashboard keeps its single-main-column layout. |
| **Q4 — "New" trigger** | **Recommendation** — implement the brief's "assessment complete, no program assigned" **and** keep "invited — not onboarded" as a second distinct reason. | Baked into **P1-2**. |
| **+5 — Recently-completed expander redesign** | New operator request: make the expanded per-session detail "nicer and easier on the eye" — currently too spread out, looks like raw numbers; exploration invited. | New **P2-7** (closes new **FM-12**). Visual mock proposed in chat for approval before build. Shared `SessionExerciseSummary` → improves the client-profile rail too. |
| **+6 — Page layout (post-build)** | After the build, the operator confirmed the functions/triggers + the expander, but asked to **keep the original page layout** — the responsive breakpoints + an `align-items` change made the overall page worse. | **P2-4 withdrawn; FM-9 accepted.** Reverted to the exact original inline grids (`repeat(4,1fr)` / `2fr 1fr`, no breakpoints, no `align-items`); `.dash-stats`/`.dash-cols` removed. All functions/triggers + the P2-7 expander retained. |

**Revised build order** (dependency order, client list removed): **P0-1 (timezone)** → **P1-2 (attention triggers: Overdue/Ending/New)** → **P1-3 (programs-ending correctness)** → **P2-1, P2-2, P2-7 (expander redesign), P2-3, P2-4, P2-5** (P2-6 folds into P0-1).

**Build gate:** with these resolved, the contract was settled and the build proceeded on `polish/section-11-dashboard`. **Built, verified, and reverted-where-noted — see §6.**

---

## 6. Closing commit (2026-06-22)

Implemented on branch `polish/section-11-dashboard` (commits `0ee8d15` docs → `b9d1007` feat → `13020a8` layout-revert). **No migrations** — the dashboard is a read-only projection over already-RLS-tested tables.

**What changed, by gap:**
- **P0-1** — Practice-timezone "today". The today-window, greeting, date header, and appointment times now resolve in the org timezone (`src/lib/dates.ts` helpers), consuming the `org.timezone` that was previously fetched and discarded. Folds in **P2-6** (dead query removed). Closes the daily wrong-day on the AU landing page.
- **P1-1** — *Withdrawn (owner UX decision).* The §6.8.5 client list was deliberately not built; the Clientele page serves that role. Recorded as an owner-approved deviation, not a miss.
- **P1-2** — Needs-attention completed to all four brief triggers: Flag (kept), Overdue (no completed session in 10 days; never-logged measured from `start_date + 10d`), Ending (active program ending ≤ 7 days with no drafted successor), New (completed assessment + no program, plus invited-not-onboarded as a second reason). Deduped to one row per client by urgency; "+N more" overflow. **Per-trigger action routing:** Flag/Overdue → client details, Ending → the client's program calendar, New(no program) → the new-program builder.
- **P1-3** — "Programs ending" bounded to the next 7 days; no longer counts long-expired programs.
- **P2-1** — Today's sessions: confirmed/pending status pill + live now/done cue.
- **P2-2** — Archived clients excluded from the attention + recently-completed panels.
- **P2-3** — Token sweep verified clean (every colour/radius tokenised; one chip radius → `var(--radius-button)`).
- **P2-4** — *Withdrawn (owner UX decision).* Responsive breakpoints + an `align-items` change altered the preferred desktop layout; reverted to the original fixed grids. FM-9 accepted.
- **P2-5** — Quieter, factual greeting sub-line + empty-state copy.
- **P2-7** — Recently-completed expander (shared `SessionExerciseSummary`) redesigned to grouped, column-aligned set rows with weight/unit type hierarchy and a neutral RPE pill; improves the client-profile completions rail too. Minor deviation from the mock: kept the app-wide A1/A2 superset-letter convention (no separate "Superset" eyebrow) and a tokenised neutral sequence chip (no deep-green token exists).

**Acceptance tests + results:**
- `type-check` (tsc --noEmit): clean.
- `next build`: clean (`/dashboard` compiled).
- ESLint (page.tsx, RecentlyCompletedPanel.tsx, SessionExerciseSummary.tsx): clean (fixed one `Date.now()`-in-render → `now.getTime()`).
- No migrations → no new pgTAP gate (read-only projection; FM-11).
- Operator visual verification at :3000 (branch): all panels + the four trigger types confirmed, **including per-trigger routing** — verified live via two seeded test clients (program-ending → calendar; assessment-done-no-program → new-program builder), then removed (DB confirmed clean: 0 rows remain).

**Deferred (with re-trigger):**
- P1-1 client list (§6.8.5) — owner decision. Re-trigger: operator wants at-a-glance client browsing on the dashboard, or category filtering with no other home.
- P2-4 responsive layout — owner decision. Re-trigger: operator wants the dashboard usable on a tablet / narrow window.

**Premortem — mitigated vs accepted:**
- Mitigated: FM-1 (tz/today), FM-3 (attention triggers), FM-4 (programs-ending), FM-5 (today's status), FM-6 (archived), FM-8 (tokens), FM-10 (voice), FM-12 (expander).
- Accepted: FM-2 (client list — owner decision), FM-7 (recent-completions stays a direct nested query at f&f scale; re-trigger: load latency / caseload growth), FM-9 (fixed layout — owner decision), FM-11 (no new RLS suite — read-only over already-tested surfaces).

**Next:** operator merges `polish/section-11-dashboard` → master (prod deploy) and pastes this Closing commit into the claude.ai project chat; the Sign-off (Date / Reviewer / Decision) is recorded below.

## 7. Reviewer follow-up (2026-06-22)

The claude.ai reviewer raised five points on the §6 closing commit; all addressed before merge.

1. **P0-1 verified on a UTC clock (not just :3000).** The reviewer correctly noted local dev ≈ Sydney tz masks the bug. Ran the dashboard's exact date wiring (the `src/lib/dates.ts` helpers, verbatim) under `TZ=UTC` with "now" frozen to instants where the UTC date ≠ the Sydney date, in **both** AEST (Jun, UTC+10) and AEDT (Jan, UTC+11 — the DST boundary). All assertions passed: `todayIso` = Sydney's date (distinct from the UTC server-local date), greeting hour = Sydney hour, `todayStart`/`todayEnd` = the correct UTC instants of Sydney midnight, and the frozen "now" falls inside the window. The process clock was confirmed UTC (`getTimezoneOffset() === 0`).
2. **Overdue inherited FM-4's ghost — fixed.** The reviewer was right: Overdue keyed on `status='active'` with no end-date gate, so a never-archived past-end program with no recent log was a permanent Overdue item — the same inflation P1-3 removed from the stat card, relocated to the panel. Fixed: Overdue now requires the program to be **in-window** (`endIso === null` for open-ended, or `endIso >= todayIso`); past-end programs are excluded. Re-verified green.
3. **The two "verify-by-reasoning" passes performed + recorded** (not just asserted):
   - *No other server-local time math:* a grep of the dashboard surface for `getHours/getDate/getMonth/getFullYear/getDay/toISOString().slice` found only `const now = new Date()` (`page.tsx:62`) — an instant used purely for instant comparisons (isLive/isPast, `now.getTime()` diffs). Every date/time *part* is derived via the tz-aware helpers or `Intl` with an explicit `timeZone`. (RecentlyCompletedPanel's `Date.now()` is an instant-diff for "X min ago", tz-agnostic.)
   - *Each loader org-scoped by RLS:* all 8 dashboard loaders use the authenticated `createSupabaseServerClient()` (no service-role, no explicit org filter). Each table queried — `clients`, `appointments`, `sessions`, `programs`, `clinical_notes`, `assessments` — has a `FOR SELECT TO authenticated` policy with `USING (organization_id = public.user_organization_id())` (confirmed in `20260420102600_rls_enable_and_policies.sql`, lines 138 / 1043 / 852 / 667 / 214 / 279). The dashboard adds no query that bypasses this.
4. **Commit granularity acknowledged.** `b9d1007` bundled eight gaps; per-idea commits would have isolated P2-7 (the shared `SessionExerciseSummary`). Mitigation: the P2-7 change is confined to one file, so it stays file-revertable; and this follow-up uses separate commits (the Overdue fix is its own). Per-idea commits adopted going forward.
5. **Routing-test audit rows checked + purged.** `clients`/`programs`/`assessments` are audit-logged, so the seed/cleanup wrote 8 `audit_log` rows (4 INSERT + 4 DELETE). Identified by sentinel/linkage and removed (re-check: 0 remain). A deliberate pre-launch test-data exception — real audit rows are append-only and never deleted. The dashboard feature itself writes nothing (read-only), audit or otherwise.

Acceptance re-run after the Overdue fix: type-check + next build + eslint all clean.

## Sign-off

_Pending — operator to paste the §6 closing commit + §7 follow-up into the claude.ai project chat and record Date / Reviewer / Decision here._
