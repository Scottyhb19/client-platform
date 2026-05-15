# Polish-pass gap analysis — Staff Reports Category ↔ Test Battery view toggle (Phase M)

**Parent doc:** [`testing-module.md`](./testing-module.md) — active parent polish for the structured testing module.
**Handoff brief:** [`staff-reports-view-toggle-handoff.md`](./staff-reports-view-toggle-handoff.md).
**Deferred-prompts source:** [`docs/deferred-prompts.md`](../deferred-prompts.md) "Staff Reports — Category ↔ Test Battery view toggle (future Phase M)".
**Phase J cross-reference:** [`client-portal-data-tab.md`](./client-portal-data-tab.md) §9.5/§9.6 — the session-grouped pattern Phase M is the staff-side analytics cousin of.
**Audit date:** 2026-05-15
**Status:** Gap document — awaiting EP sign-off on Q-M1..Q-M11 before any code.

---

## 0. Executive summary

Phase M adds a top-level **Category ↔ Test Battery** view-mode toggle on two staff surfaces:

1. **Client-profile Reports tab** (`/clients/[id]?tab=reports`) — today drives `CategoryGrid` → `CategoryDetail` → `TestCard` only. Phase M wraps that with a mode toggle and adds a new **Test Battery view** alongside.
2. **Session-builder right-rail `ReportsPanel`** — today a flat publications list → `ReportReader`. Phase M optionally adds a **Category mode** (per Q-M7).

The data plumbing is almost entirely already in place. Phase J shipped pure helpers in [`src/lib/testing/comparison.ts`](../../src/lib/testing/comparison.ts) that Phase M reuses (`pickPreviousBefore`, `pointAtSession`, `valuesAtSession`, `groupHistoryBySession`, `SessionGroup`, `SessionGroupTest`). `BatteryRow` is loaded server-side and threaded through to the Reports tab. RLS is already correct on both sides.

**One small loader/type extension is the only data-shape change.** `SessionInfo` carries `battery_name` but drops `applied_battery_id` — Phase M needs the id (stable; names can collide or be renamed). One field on the type, one column in the SELECT, one field in the aggregation. ~5 lines.

**Pre-launch advantage is not load-bearing here.** No schema migration. No RLS change. No new RPC. No types regen needed. The entire phase is React + a couple of pure helpers.

**The two locked decisions inherited from Phase J's sign-off (Q-J12 + Q-J13):**

- Orphan tests render as a **pseudo-group at the bottom** named "Not in a saved battery", visually distinct (italic header or lighter weight).
- Per-battery card has a **sub-toggle Sessions ↔ Progression**: Sessions = clickable session-row list with drill-in; Progression = per-test cross-session charts filtered to this battery's applied sessions.

The eleven open decisions in §5 are what the EP needs to sign before code starts.

---

## 1. What's already correct (regression protection)

Pieces of the existing implementation that align with Phase M's target and must be preserved.

### 1.1 Phase J helpers in `comparison.ts`

[`comparison.ts`](../../src/lib/testing/comparison.ts) is pure (no DB access, no `'server-only'` import) and works in both server and client components. Phase M reuses every helper as-is:

- `ComparisonMode` type (`'baseline' | 'previous'`) — surfaces the same toggle inside any per-test card in the Battery view.
- `pickPreviousBefore`, `pointAtSession`, `valuesAtSession` — anchor per-(session, side) values.
- `groupHistoryBySession(history, publications)` — already pivots into session-groups; Phase M writes a sibling `groupHistoryByBattery(history, publications, batteries)`.
- `SessionGroup`, `SessionGroupTest` interfaces — the shape Phase M's Sessions sub-view (Q-M4 expand-in-place) consumes directly.

### 1.2 `ChartFactory` + Recharts dispatch

[`ChartFactory.tsx`](../../src/app/(staff)/clients/[id]/_components/reports/charts/ChartFactory.tsx) switches on `default_chart` and renders `LineChartCard` / `BarChartCard` / `AsymmetryBarChartCard` / `TargetZoneChartCard`. Phase M's Progression sub-view reuses this surface — same charts, different filter on the metric series points (only points whose `session_id` is in the battery's applied set).

### 1.3 `TestCard` + `MetricBadge` + `groupMetricsByShape`

Per-test rendering in [`TestCard.tsx`](../../src/app/(staff)/clients/[id]/_components/reports/TestCard.tsx) handles combined-metric detection (KOOS-style same-shape metrics into one chart) and direction-of-good colouring via `MetricBadge`. Phase M's Battery view's Progression sub-view renders the same component with a filtered `TestHistory` — no fork.

### 1.4 `ComparisonOverlay` overlay pattern

[`ComparisonOverlay.tsx`](../../src/app/(staff)/clients/[id]/_components/reports/ComparisonOverlay.tsx) is the precedent for any cross-cutting overlay surface (z-index 200, Escape dismiss, body-scroll lock). Phase M's Q-M4 has overlay as one option, but the audit recommends expand-in-place — Overlay precedent stays available if the EP picks (a).

### 1.5 `BatteryRow` data already loaded

[`page.tsx`](../../src/app/(staff)/clients/[id]/page.tsx) loads `testBatteries` via `loadActiveBatteries(supabase, organizationId)` in the parallel block (line 201). It threads `page.tsx → ClientProfile → ReportsTab` as a `BatteryRow[]` prop. Phase M's Battery view reads this directly — zero new SQL.

### 1.6 RLS on `test_batteries` is open to staff

Pattern A (staff-only SELECT) per migration `20260428120800_testing_module_rls.sql`. Phase M is staff-side only, so staff has the access it needs. The Phase J-2-γ migration `20260515120000_client_select_test_batteries.sql` opened a narrow CLIENT path (battery → published session); irrelevant to Phase M.

### 1.7 `applied_battery_id` is populated end-to-end

Phase J-2-γ (`TestPublishDialog`'s `SessionBatteryTag`) lets the EP set `test_sessions.applied_battery_id` after capture. The column has existed since Phase B (`20260428140000`). Phase M can rely on it as the stable grouping key.

### 1.8 The `ReportsPanel` rail mounts in three places

Confirmed via grep:

1. [`SessionBuilder.tsx:473`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx) — the protected file. **Do NOT modify.** Phase M only edits the `ReportsPanel.tsx` it imports.
2. [`CalendarSidePanel.tsx:82`](../../src/app/(staff)/clients/[id]/program/_components/CalendarSidePanel.tsx) — the program calendar's right rail. Same `ReportsPanel` props; benefits automatically from any improvement.
3. `program/page.tsx:25` + `program/days/[dayId]/page.tsx:25` — type-only imports for `SessionReport`. No code change needed.

This means a change to `ReportsPanel.tsx` (M-4) benefits both the session builder rail and the calendar side panel rail in one edit. Worth flagging — the EP should know that "rail" really means "both rails" by virtue of the shared component.

---

## 2. Gaps to close

### P0 — Architectural / data shape (non-negotiable)

| # | Gap | Files |
|---|-----|-------|
| **P0-1** | `SessionInfo` doesn't carry `applied_battery_id`. The Phase D test-history loader joins `battery_name` but drops the id. Phase M needs the id as the stable grouping key — battery names can collide between batteries and can be renamed. One-line `interface SessionInfo` extension + one-line SELECT extension + one-line aggregation extension. Verified absent: [`loader-types.ts:151-156`](../../src/lib/testing/loader-types.ts) (no `applied_battery_id` field). | [`loader-types.ts`](../../src/lib/testing/loader-types.ts), [`loaders.ts`](../../src/lib/testing/loaders.ts) |
| **P0-2** | No `groupHistoryByBattery(history, publications, batteries)` helper. The pivot shape: one entry per saved battery, listing the sessions where this battery was applied (deduped, sorted newest-first), plus an "orphan" group at the end for sessions with `applied_battery_id = NULL` per Q-J12. Sibling to `groupHistoryBySession`. | [`comparison.ts`](../../src/lib/testing/comparison.ts) |
| **P0-3** | No top-level view-mode primitive on the Reports tab. Today [`ReportsTab.tsx`](../../src/app/(staff)/clients/[id]/_components/ReportsTab.tsx) only flips between `CategoryGrid` (default) and `CategoryDetail` (drilled in). The Phase M mode toggle wraps both — adding a new outer state slot. | [`ReportsTab.tsx`](../../src/app/(staff)/clients/[id]/_components/ReportsTab.tsx) |

### P1 — Functional (Phase M behaviour)

| # | Gap | Files |
|---|-----|-------|
| **P1-1** | No `BatteryView` component family. Needs: outer container, per-battery card, header (name + N sessions count), sub-toggle Sessions ↔ Progression (Q-J13 locked), Sessions sub-view (drill-in pattern per Q-M4), Progression sub-view (per-test charts filtered to this battery's session_ids; chart approach per Q-M5). | new files under `_components/reports/battery/` (or similar) |
| **P1-2** | Orphan pseudo-group "Not in a saved battery" — visually distinct (italic header or lighter weight per Q-J12 locked), at the bottom of the Battery view. Q-M6 decides collapsibility. | within the Battery view family |
| **P1-3** | Session-builder rail `ReportsPanel.tsx` is single-mode (publications list → ReportReader). Phase M's M-4 adds Category mode (per Q-M7). Battery mode at ~320px is tight; Q-M7 (a) recommendation is Category-only on the rail. | [`ReportsPanel.tsx`](../../src/app/(staff)/clients/[id]/_components/ReportsPanel.tsx) |
| **P1-4** | The Reports tab header today carries title + count (left) and "Compare sessions" + "+ Record test" (right). Q-M1 decides where the view-mode toggle sits in this strip. | [`ReportsTab.tsx`](../../src/app/(staff)/clients/[id]/_components/ReportsTab.tsx) |

### P2 — Polish (defer until P0 + P1 land)

| # | Gap |
|---|-----|
| **P2-1** | Voice pass on the new labels — "Category", "Test Battery", "Sessions", "Progression", "Not in a saved battery". Sentence case per design system §02. Imperative for actions ("Open battery", "Hide sessions"). |
| **P2-2** | Visual treatment of orphan pseudo-group header. Italic eyebrow vs lighter weight — pick one. Per Q-J12 the goal is "visible gap that encourages tagging" — leans toward italic (softly different, not hidden). |
| **P2-3** | Per-battery card visual — borrow the session-builder rail's compact aesthetic (1px borders, 8–10px radius, generous whitespace per design system §03). |
| **P2-4** | Battery view loading/empty states — "No saved batteries yet" (link to Settings → Tests → Saved batteries), "This battery hasn't been applied to a session yet" (per Q-M9). |
| **P2-5** | Battery view interacts with `CategoryGrid`'s empty state — when there are zero test sessions at all, both Category view and Battery view need empty states. Currently `CategoryGrid` has its own. Battery view's empty state can be parallel (similar wording, different button: "Open Settings → Saved batteries" rather than "+ Record test"). |

### Data-shape verification (closed during audit, listed for transparency)

| # | Check | Result |
|---|-------|--------|
| **V-1** | Does `test_sessions.applied_battery_id` exist and get populated? | Yes — column shipped in `20260428140000`; Phase J-2-γ `TestPublishDialog` writes to it via `setSessionBatteryAction`. |
| **V-2** | Does the loader's session-by-session row carry `applied_battery_id`? | **No** — [`loaders.ts:425-495`](../../src/lib/testing/loaders.ts) joins `battery:test_batteries(name)` and projects `battery_name` only. P0-1 closes this. |
| **V-3** | Does `loadActiveBatteries` return `BatteryRow[]` with `id` + `name`? | Yes — already wired and threaded to `ReportsTab` as the `batteries` prop. |
| **V-4** | Does staff RLS on `test_batteries` permit SELECT? | Yes — Pattern A staff-only SELECT in `20260428120800_testing_module_rls.sql`. |
| **V-5** | Is `applied_battery_id` an FK to a single battery (1:1) or N:M? | 1:1. One session → one battery (or NULL). Phase M's Battery view inherits this — a session lives in exactly one battery group or the orphan group. |

---

## 3. What NOT to touch (regression protection)

- **`SessionBuilder.tsx`** ([the 2951-line session-builder file](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx)) — the load-bearing differentiator. CLAUDE.md and project memory ("Protect session builder + clinical notes adjacency") both flag this. Phase M's M-4 modifies `ReportsPanel.tsx` (the component consumed by the session builder), not the session builder itself. Byte-identical pre- and post-Phase-M is the acceptance bar.
- **The existing `CategoryGrid` → `CategoryDetail` → `TestCard` flow** — Category view is the regression baseline. Phase M wraps it with a mode toggle; it doesn't modify these components.
- **`loadTestHistoryForClient` beyond the P0-1 `applied_battery_id` extension** — the rest of the pipeline serves Phase D Category view correctly.
- **RLS on `test_results` / `client_publications` / `test_batteries`** — staff has the access needed. Don't touch.
- **The portal Data tab** — Phase J closed 2026-05-15. Phase M is staff-only.
- **The testing-module schema** (`physical_markers_schema_v1.1.json`) and the resolver — no schema-level changes.
- **`test_results` and `test_sessions` tables / triggers / RPCs** — Phase M is render-layer only.
- **`reports/helpers.ts`** beyond the single `filterPointsBySessions` helper (per Q-M5 (a) recommendation) — keep the Phase D surface stable.

---

## 4. Sub-phase plan

(Refining the handoff brief's M-1..M-4 split based on audit findings.)

### M-1 — Audit, data shape, helpers (no UI changes)

- Extend `SessionInfo` to add `applied_battery_id: string | null` ([loader-types.ts:151-156](../../src/lib/testing/loader-types.ts)).
- Extend `loadTestHistoryForClient`'s `RawHistoryRow` + the session-bucket aggregation ([loaders.ts:430-674](../../src/lib/testing/loaders.ts)) to carry `applied_battery_id`. SELECT extension is one column.
- Write `groupHistoryByBattery(history, publications, batteries)` in [`comparison.ts`](../../src/lib/testing/comparison.ts). Output shape (proposed; refine in code review):
  ```ts
  interface BatteryGroup {
    battery_id: string | null   // null = orphan pseudo-group
    battery_name: string         // "Not in a saved battery" when orphan
    is_orphan: boolean
    /** Sessions where this battery was applied, sorted newest-first. */
    sessions: SessionInfo[]
  }
  function groupHistoryByBattery(
    history: ClientTestHistory,
    publications: PublicationRow[],
    batteries: BatteryRow[],
  ): BatteryGroup[]
  ```
  Sort: saved batteries first (alphabetical by name or display order — TBD; recommend alphabetical for v1), orphan last.
- Optional: add `filterPointsBySessions(points, sessionIds)` to [`helpers.ts`](../../src/app/(staff)/clients/[id]/_components/reports/helpers.ts) — sibling to `filterPointsByWindow`. Pure function, ~5 lines. Drives Progression sub-view.
- No render changes. `npm run type-check` + `npm run build` clean (stash `database.ts` BOM drift, restore after).

**Acceptance:** type-check + build clean. Helpers callable from a stub test file or via a temporary console.log on the Reports tab (revert before commit). No visible UI change.

### M-2 — Top-level Category ↔ Battery toggle on the Reports tab

- New `ViewModeToggle` component (file-local in `ReportsTab.tsx` initially; lift to shared if M-4 needs it). Sentence-case segmented control matching the design-system pill pattern (already in use in the Phase J portal `PortalTestCard.tsx`).
- Per Q-M1: place per sign-off (audit recommends inside the existing Reports tab header strip, left of the buttons).
- New `BatteryView.tsx` component family under `_components/reports/battery/`:
  - `BatteryView.tsx` — outer container; maps over `groupHistoryByBattery(...)`.
  - `BatteryCard.tsx` — per-battery card; header (name + N sessions); body is empty in M-2 (M-3 owns Sessions/Progression).
  - `OrphanGroup.tsx` (or inline within `BatteryView`) — pseudo-group at the bottom (Q-J12 locked).
- No sub-toggle UI yet (M-3).

**Acceptance:** EP can toggle between Category and Battery views; Battery view shows one card per saved battery + the orphan group at the bottom with session counts. Category view unchanged (regression check).

### M-3 — Per-battery Sessions ↔ Progression sub-toggle

- Inside each `BatteryCard`, add a sub-toggle component (same segmented-control primitive as M-2).
- **Sessions sub-view** per Q-M4 (audit recommends expand-in-place):
  - List of session rows, newest first.
  - Click a row → expand into the test-grouped detail (reuse `SessionGroup` rendering pattern from Phase J's portal Data tab).
  - Or — if Q-M4 (a) overlay or (b) route — implement the chosen pattern.
- **Progression sub-view** per Q-M5 (audit recommends reuse `ChartFactory`):
  - Filter each `TestHistory.metrics[].points[]` to only points whose `session_id ∈ battery.sessions[].session_id`.
  - Render filtered tests via the existing `TestCard` component.
  - Tests that have ZERO points after the filter render with an "Not captured in this battery" empty state, or are hidden entirely (Q-M5 sub-question — recommend hidden to keep the view tight).

**Acceptance:** Sessions sub-view drills in cleanly; Progression sub-view shows per-test cards with only the battery's applied sessions plotted. Per-battery sub-toggle state is independent per card.

### M-4 — Session-builder rail mirror (per Q-M7 scope)

- Per Q-M7 sign-off, add Category mode and/or Battery mode to `ReportsPanel.tsx`.
- **Audit recommendation: Category mode only.** Battery mode at ~320px width is tight; the rail is a programming-context tool, not an analytics surface.
- Add a top-of-panel toggle (segmented control). Q-M11 decides default mode (Publications retains current behaviour; Category is the additive new mode).
- The "Category mode" rendering on the rail is a condensed version of `CategoryGrid` — single-level, narrow-column friendly. Reuse `CategoryTile` if it fits the width budget; otherwise a denser row-based layout.
- Touch ONLY `ReportsPanel.tsx`. SessionBuilder.tsx and CalendarSidePanel.tsx remain byte-identical. Note: any change benefits both rails (they share the component).

**Acceptance:** The session-builder rail and the calendar side panel both gain Category mode in a single edit. SessionBuilder.tsx and CalendarSidePanel.tsx unchanged. Rail's existing publications-list behaviour is preserved as the default (or the toggle restores it cleanly).

### Per-sub-phase sign-off cadence

Per CLAUDE.md polish-pass protocol: each sub-phase appends a closure note + EP sign-off here before the next opens. M-1 → EP confirms helpers + loader extension look right → M-2 opens. Same after M-2 before M-3, and M-3 before M-4.

---

## 5. Decisions to surface — Q-M1..Q-M11

EP sign-off needed on these before any code lands. Q-M1..Q-M8 come from the handoff brief; Q-M9..Q-M11 surfaced during audit.

### Q-M1 — Toggle placement on Reports tab

Today's header strip ([`ReportsTab.tsx:85-141`](../../src/app/(staff)/clients/[id]/_components/ReportsTab.tsx)):
- Left: title "Test history" + count "{N} categories · {M} tests"
- Right: "Compare sessions" (when ≥2 sessions) + "+ Record test"

Options:

| # | Placement | Trade-off |
|---|-----------|-----------|
| **(a) Inside Reports tab header strip — between title and buttons** | Visually proximate to the data it controls. Segmented control on the right side of the title cluster, left of the buttons. | Keeps page-level navigation simple. Most natural location for a view-mode control. |
| (b) Above the tab strip (page-level, on `ClientProfile`) | View mode affects only the Reports tab today — so placing it page-level mis-suggests scope. | Wasted visual real estate; cognitive mismatch. |
| (c) Replace the existing "Compare sessions" + "+ Record test" header strip | Saves vertical space. But "Compare sessions" is a behavioural action (open overlay) and "+ Record test" is a write action — they're not view modes. Conflating them invites confusion. | Bad UX semantics. |

**Audit recommendation: (a).**

### Q-M2 — Session-builder rail toggle state: own or shared with Reports tab?

| # | Behaviour | Trade-off |
|---|-----------|-----------|
| **(a) Own state per surface** | Rail resets to its own default on each mount. Reports tab keeps its own state. Surfaces are independent. | Predictable; no cross-surface surprise. Two state slots to wire. |
| (b) Shared via URL parameter | Both surfaces read `?view=battery`. URL-driven. | Pollutes the URL. Battery mode on the rail isn't recommended (Q-M7 (a)) so the shared param would only matter for Category mode — minor. |
| (c) Shared via per-EP preference (covered by Q-M3) | Sticks across mounts and surfaces. | Adds schema or storage surface. See Q-M3. |

**Audit recommendation: (a).** Independent per-surface state. Toggle is cheap to re-set; cross-surface coupling adds complexity for marginal benefit.

### Q-M3 — Sticky-per-EP storage

| # | Storage | Trade-off |
|---|---------|-----------|
| (a) `practice_preferences` row keyed on user_id | Durable, server-side. | Adds a schema surface or assumes one exists. Requires migration if absent. |
| (b) `localStorage` | Per-browser durable. No schema cost. | Different on each browser/device — not truly per-EP. |
| **(c) Session/component state only** | Resets on reload. | Cheapest. EP picks mode each session. |

**Audit recommendation: (c).** Defer persistence to a later phase if the EP actually wants it. The cost of re-clicking the toggle once per session is low; the cost of a schema surface for a UI preference is higher.

### Q-M4 — Sessions sub-view drill-in pattern

Per Q-J13 locked, clicking a session row in a battery card drills into per-session detail (sibling tests captured in that session, framing texts, values).

| # | Pattern | Trade-off |
|---|---------|-----------|
| (a) Full-page overlay (mirror `ComparisonOverlay`) | Z-index 200, Escape dismisses, body-scroll locked. Pattern proven. | Heavyweight for what's essentially a sibling list. Pulls EP out of the Reports tab context. |
| (b) Dedicated route — `/clients/[id]/reports/sessions/[sessionId]` or `?session=...` | URL-addressable. Browser back works naturally. | Adds page-level routing for a drill-in. Phase M doesn't otherwise need URL state. |
| **(c) Expand-in-place inside the battery card** | Newest-first list of session rows; click a row → expands into the session-group detail. Phase J's portal pattern (proven). | Keeps EP in context. Multiple expansions possible. Matches portal Data tab UX — same data, similar lens. |

**Audit recommendation: (c) Expand-in-place.** Mirrors the portal Data tab pattern (Phase J-2-α collapsibility); keeps the EP in the Reports tab. Overlay is the right pattern for `Compare sessions` (cross-cutting analytical surface). Per-session expand is a sibling pattern, not a separate context.

### Q-M5 — Progression sub-view chart approach

| # | Approach | Trade-off |
|---|----------|-----------|
| **(a) Reuse `ChartFactory` (Recharts)** — filter `MetricHistory.points` to the battery's session_ids, pass to existing `TestCard` | Identical visual to Category view. Zero new chart code. Adding `filterPointsBySessions(points, sessionIds)` is ~5 lines. | Consistent visual language across both views; the EP's eye doesn't need to re-learn. |
| (b) Specialised "battery-progression" renderer — different visual that emphasises the battery-as-unit | Could surface battery-level totals or session-vs-session deltas. | Adds a chart surface to maintain. Visual divergence between views. |

**Audit recommendation: (a) Reuse `ChartFactory`.** The Category view's `TestCard` already communicates "this metric, across these moments" — filtering the moments to a battery's applications is the Progression story. No new rendering surface needed.

**Sub-question Q-M5.1 — Tests with zero points after filter:**

A saved battery's `metric_keys` may reference tests/metrics that haven't been captured yet for this client. In Progression sub-view, render those as empty cards or hide them?

| # | Treatment |
|---|-----------|
| **(a) Hide them** — the view shows only tests with captured data in this battery's sessions. | Keeps the view tight; honest about what's been measured. |
| (b) Render with "Not yet captured" state | More complete picture of what's *supposed* to be measured. Verbose. |

**Audit recommendation: (a) Hide them.** The Progression view answers "how has this battery's data trended" — empty cards add noise without answering the question.

### Q-M6 — Orphan pseudo-group "Not in a saved battery" collapsibility

| # | Behaviour |
|---|-----------|
| (a) Always open | Visible reminder to tag, can't be hidden. |
| **(b) Collapsible, default expanded** | Visible by default; EP can collapse once seen. |
| (c) Collapsible, default collapsed | Hides the gap; defeats Q-J12's "visible gap encourages tagging" rationale. |

**Audit recommendation: (b).** Default expanded preserves Q-J12 intent; collapse affordance is humane once the EP has read the list.

### Q-M7 — Session-builder rail scope

| # | Scope | Trade-off |
|---|-------|-----------|
| **(a) Category mode ONLY** | Rail gets Category + Publications (existing). No Battery mode. | Rail is ~320px — Battery mode's per-card sub-toggle is cramped at that width. Rail's purpose is programming-context lookup; Battery mode is analytics-density. |
| (b) Category + Battery modes | Same affordance as Reports tab. | Wider visual surface than the rail's width budget comfortably supports. |
| (c) Same modes as today (Publications only) + new Category mode | Same as (a) phrased differently. | — |
| (d) DEFER M-4 entirely | The rail's existing publications view is fine. Revisit if a need emerges. | Loses the "review a metric trend from inside the program builder" value the handoff brief flagged. |

**Audit recommendation: (a) Category mode only on the rail.** Programming context, narrow column, additive only.

### Q-M8 — Sub-phase scoping

Confirm M-1 / M-2 / M-3 / M-4 split as drafted in §4, or refine.

**Audit recommendation: confirm as-drafted.** Each sub-phase has a clean acceptance bar; dependencies are linear (M-1's helpers → M-2's mode toggle → M-3's sub-toggle → M-4's rail mirror).

### Q-M9 — Saved battery with ZERO applied sessions: render or hide?

A saved battery exists in Settings → Tests but hasn't been applied to any session for THIS client.

| # | Behaviour |
|---|-----------|
| **(a) Render with "Not yet applied" empty state** — muted; sub-toggle disabled or shows the same empty state | The EP can see which batteries are unused for this client → discoverability. Inert but present. |
| (b) Hide entirely | Tighter view; "junk drawer" risk if the EP forgets a battery exists. |
| (c) Render with full card but show "0 sessions" — sub-toggle expands to a blank state | Cluttered if many batteries exist. |

**Audit recommendation: (a).** Visibility supports discoverability without overwhelming the view; muted treatment keeps focus on batteries with data.

### Q-M10 — "+ Record test" button placement under Battery view

Today "+ Record test" sits in the Reports tab header. In Battery view:

| # | Placement |
|---|-----------|
| **(a) Keep in the Reports tab header** | Single, consistent entry. The capture modal already handles battery selection (`lastUsedBattery` hint + dropdown). |
| (b) Move into each battery card — "+ Record this battery" pre-selects the battery in the capture modal | Battery-contextual. But the capture modal's existing battery dropdown already does this; per-card duplicates the affordance. |
| (c) Both — header + per-card | Two entry points to the same flow; risks confusion. |

**Audit recommendation: (a).** Existing capture modal already handles battery selection. Per-card buttons add UI without adding capability; the orphan pseudo-group also has no battery to pre-select, breaking the symmetry.

### Q-M11 — Rail toggle placement and default mode

If Q-M7 (a) is signed: the rail gets a Publications ↔ Category toggle. Where does it sit, and which mode is the default?

| # | Placement / default |
|---|---------------------|
| **(a) Top of the panel (above eyebrow), default Publications** | Preserves current rail behaviour; Category is the additive option. EP opt-in. |
| (b) Top of the panel, default Category | New mode is the headline; Publications is the alternate. Risk: EP arrives at a different default than they're used to. |
| (c) Embedded in the eyebrow row "Published reports / Category" pill | Minimal visual cost. Slightly less obvious as a toggle. |

**Audit recommendation: (a).** Default Publications preserves muscle memory; Category becomes available without changing the existing default behaviour.

> **Sign-off note:** Q-M11 was answered (a) at kickoff but is **superseded by the Q-M7 refinement** (see §7.2). The rail no longer carries a Publications↔Category toggle; the new design is a single session-grouped feed with pinning. Recorded for completeness; not load-bearing for implementation.

---

### Questions raised by the Q-M7 refinement (deferred to before M-4 opens)

The Q-M7 sign-off introduced a substantively new rail design — session-grouped collapsible feed with pinning, no toggle (see §7.2). Three follow-on decisions surface that need EP resolution before M-4 opens. **Not blocking** M-1 / M-2 / M-3 — the Reports tab work is fully unblocked.

### Q-M12 — Pinned state persistence

The Q-M7 refinement requires pinning a test OR a session-group/battery to the top of the rail. Where does pinned state live?

| # | Storage | Trade-off |
|---|---------|-----------|
| (a) Session/component state | Pins reset on every mount. Cheap; no schema cost. | Annoying — pinning is a "this matters across visits" gesture; resetting defeats it. |
| **(b) `localStorage` keyed on `(user_id, client_id)`** | Per-browser durable across reloads. No schema cost. | Doesn't sync across devices; per-EP-per-client scope matches the use case. |
| (c) DB row keyed on `(user_id, client_id)` — e.g. `practice_pinned_reports` | Multi-device durable. Adds a small schema surface (table + RLS + soft-delete). | Schema-cost for a UI affordance; tracking pin state in DB feels heavy. |

**Audit recommendation: (b)** for v1. Pinning persists across reloads within a browser without a migration. Migrate to (c) at premortem time if cross-device pinning becomes a real need.

### Q-M13 — Pinnable units

The EP's wording was "pin a particular test or test battery", explicitly both.

| # | Units | Trade-off |
|---|-------|-----------|
| (a) Individual test only | Simple. | Doesn't let the EP pin a "currently watching this battery" group. |
| (b) Session-group/battery only | Pinning a whole session at once. | Loses per-test granularity. |
| **(c) Both — pin a single test OR a session-group/battery** | Matches the EP's wording verbatim. | Pinned items render at the top in whatever order pinned (or insertion order). Slightly richer state. |

**Audit recommendation: (c).**

**Sub-question Q-M13.1 — Pin ordering.** When multiple items are pinned, how are they ordered? (a) Insertion order (most recently pinned first), (b) preserve their natural newest-first ordering among pins, (c) drag-to-reorder. **Audit recommendation: (b)** — newest-conducted_at first within pins, same sort as the unpinned feed below. Drag-to-reorder is over-spec for v1.

### Q-M14 — Existing `ReportReader` deep-drill — keep, replace, or fold?

Today `ReportsPanel.tsx` has a `ReportReader` (back-button overlay showing the test plus sibling tests, with the per-card baseline/previous toggle). With inline session-group expansion replacing the flat publications list, the ReportReader's job overlaps with inline expansion.

| # | Treatment |
|---|-----------|
| (a) Replace entirely — inline expansion IS the whole thing; no further drill-in | Simplest. Loses the focused single-test view (current ReportReader's strength). |
| (b) Preserve as an optional deeper view — click an inline-expanded test → opens ReportReader for the test in isolation | Two-tier UX: feed + focused reader. Pattern overhead. |
| **(c) Fold — the inline expansion shows test cards directly, with the existing per-card baseline/previous toggle embedded in each card** | Single tier; comparison toggle migrates from ReportReader into the inline-expanded test cards. Mirrors the portal Phase J pattern (where `PortalTestCard` carries its own per-card toggle). |

**Audit recommendation: (c).** Folds the existing per-card toggle into the inline expansion. Avoids a separate drill-in modal. Aligns the rail's UX with the portal Data tab pattern — same comparison-aware per-card pattern, different chrome.

---

## 6. Stop point

This document is the contract. **No code changes start until Q-M1..Q-M11 are signed off.**

Sign-off format below — drop the table into §7 with your decisions per question.

```
| Q | Decision | Notes |
|---|----------|-------|
| Q-M1  |  |  |
| Q-M2  |  |  |
| Q-M3  |  |  |
| Q-M4  |  |  |
| Q-M5  |  |  |
| Q-M5.1|  |  |
| Q-M6  |  |  |
| Q-M7  |  |  |
| Q-M8  |  |  |
| Q-M9  |  |  |
| Q-M10 |  |  |
| Q-M11 |  |  |
```

Once signed, M-1 opens. Each sub-phase appends its own closure note + EP sign-off in §7 before the next sub-phase opens (per CLAUDE.md polish-pass protocol).

---

## 7. Sign-off log

### 7.1 Phase M kickoff — Q-M1..Q-M11 (chat 2026-05-15)

| Q | Decision | Notes |
|---|----------|-------|
| **Q-M1** | **(a)** Inside Reports tab header strip, left of the buttons | Audit rec accepted. |
| **Q-M2** | **(a)** Own state per surface | Audit rec accepted. |
| **Q-M3** | **(c)** Session/component state only for v1 | Audit (a) `practice_preferences` row kept on the bench for premortem reconsideration. Project memory `project_premortem_view_mode_persistence.md` saved so a future premortem check surfaces this. |
| **Q-M4** | **(c)** Expand-in-place | Mirrors Phase J portal pattern; keeps EP in context. |
| **Q-M5** | **(a)** Reuse `ChartFactory` | `filterPointsBySessions` helper drives the filter. |
| **Q-M5.1** | **(a)** Hide tests with zero points after filter | Keeps Progression view tight. |
| **Q-M6** | **(b)** Collapsible, default expanded | Preserves Q-J12 "visible gap encourages tagging" intent; humane collapse affordance. |
| **Q-M7** | **(a)** Category-only on the rail — **but with substantive refinement** | See §7.2. The rail does NOT get a Category↔Battery toggle. Instead it becomes a session-grouped collapsible feed with pinning. |
| **Q-M8** | **Confirm** sub-phase split | M-1 / M-2 / M-3 / M-4 as drafted. |
| **Q-M9** | **(a)** Render with "Not yet applied" muted state | Discoverability without overwhelming. |
| **Q-M10** | **(a)** Keep "+ Record test" in header | Capture modal already handles battery pre-selection. |
| **Q-M11** | **(a)** — **superseded by Q-M7 refinement** | The rail no longer carries a Publications↔Category toggle; sign-off recorded for completeness, not load-bearing. |

### 7.2 Q-M7 refinement — rail becomes a session-grouped collapsible feed with pinning

Per EP correction (chat 2026-05-15):

> There is no need to switch between category and battery, but if a battery is completed it should show up as one collapsible chevron with all the tests that were completed within it and the heading of the name of the battery. This will still link in with the individual tests and have the newest first. Essentially they are merged together, the most important part is the newest aspect being first, with the ability to pin a particular test or test battery at the top.

**Reframed M-4 design:**

1. **No toggle.** The rail does NOT carry a Publications↔Category switcher. Q-M11's answer (a) is preserved in the sign-off table for completeness but is not implemented.
2. **Single feed, session-grouped.** Replace today's flat publications list with a session-grouped collapsible feed. Each session that applied a battery renders as one collapsible row with the battery name as the header, expanding to show the tests captured in that session. Standalone tests (no battery applied) render as single rows labeled by the test name.
3. **Newest first.** Sort session-groups by `conducted_at desc` — same as Phase J portal `DataView` (Q-J1.1).
4. **Pinning.** Pin a particular test OR a session-group/battery to the top of the feed. Pinned items render above the unpinned feed, sorted newest-first within the pinned section.

**Reuse:** This shape is exactly what `groupHistoryBySession` already produces. M-4 reuses the helper directly — same pivot, different chrome (rail vs portal).

**M-4 implementation surface** still scoped to `ReportsPanel.tsx` (no `SessionBuilder.tsx` touch). Because `ReportsPanel` is also consumed by `CalendarSidePanel.tsx`, the program-calendar side panel inherits the same rail design for free.

**Follow-on decisions surfaced and deferred to before M-4 opens** (recorded in §5 above):

- Q-M12 — Pinned state persistence. Audit recommends localStorage for v1.
- Q-M13 — Pinnable units (test / session-group / both). EP's wording explicitly both.
- Q-M14 — Whether the existing `ReportReader` deep-drill survives, is replaced, or folds into inline expansion. Audit recommends folding (per-card toggle migrates into inline-expanded test cards).

These do not block M-1 / M-2 / M-3 (Reports tab work). Resolve before M-4 opens.

### 7.3 Q-M12..Q-M14 sign-off (chat 2026-05-15, post-kickoff)

| Q | Decision | Notes |
|---|----------|-------|
| **Q-M12** | **(b)** `localStorage` keyed on `(user_id, client_id)` for v1 | DB-backed `practice_preferences` reconsidered at premortem (see `project_premortem_view_mode_persistence` memory). |
| **Q-M13** | **(c)** Both — single test OR session-group/battery | Matches EP wording. |
| **Q-M13.1** | **(b)** Newest-first within pins (no drag-to-reorder for v1) | Same sort as the unpinned feed below. |
| **Q-M14** | **(c)** Fold — per-card baseline/previous toggle migrates into inline-expanded test cards | No separate `ReportReader` modal after M-4; the inline expansion IS the focused view. Mirrors portal Phase J `PortalTestCard`. |

All M-4-specific contracts now signed. M-4 is fully unblocked when M-3 closes.

### 7.4 M-1 — Audit + data shape (closed pending EP sign-off, 2026-05-15)

Pure data-shape sub-phase. No render changes; no UI surface area to verify in the browser yet (per `<when_to_verify>` the helpers don't drive any rendered component until M-2 wires them).

**What shipped:**

- **EDIT** [`src/lib/testing/loader-types.ts`](../../src/lib/testing/loader-types.ts) — `SessionInfo` gains `applied_battery_id: string | null`. Comment-documented: prefer over `battery_name` when grouping (battery names can collide and can be renamed). Field ordering mirrors the legacy `CapturedSessionRow` shape (id before name).
- **EDIT** [`src/lib/testing/loaders.ts`](../../src/lib/testing/loaders.ts) — `loadTestHistoryForClient` extended to carry `applied_battery_id` end-to-end:
  - `RawHistoryRow` interface adds the field.
  - SELECT clause's `test_sessions!inner(...)` sub-select pulls `applied_battery_id` alongside the existing columns.
  - `Joined` flatten-type adds the field on the session object.
  - The `rows.push({...})` body forwards it.
  - `sessionBuckets` Map value-type adds the field, accumulator carries it, final `SessionInfo[]` emit includes it.
  - Net: one column added to one SELECT + four field-additions in the flatten/aggregate pipeline. No new query.
- **EDIT** [`src/lib/testing/comparison.ts`](../../src/lib/testing/comparison.ts) — new public surface:
  - Imports `BatteryRow` from `./loader-types` (alphabetical insertion).
  - New `interface BatteryGroup { battery_id, battery_name, is_orphan, is_archived, sessions }`.
  - New `groupHistoryByBattery(history, batteries): BatteryGroup[]` — pure pivot. Order: active saved batteries (alphabetical by name) → archived batteries (referenced by sessions but absent from `batteries[]`, alphabetical by joined name) → orphan pseudo-group (sessions with `applied_battery_id = NULL`, emitted iff non-empty per Q-J12).
  - Sessions within each group sorted newest-first by `conducted_at` (mirrors Q-J1.1).
  - The `is_archived` flag preserves the historical tagging when an EP archives a battery template later — those sessions stay in their own group rather than collapsing into orphans.
- **EDIT** [`src/app/(staff)/clients/[id]/_components/reports/helpers.ts`](../../src/app/(staff)/clients/[id]/_components/reports/helpers.ts) — new `filterPointsBySessions(points, sessionIds: Set<string>): MetricSeriesPoint[]` sibling to `filterPointsByWindow`. Empty set returns `[]` (cheap short-circuit). Drives the Progression sub-view in M-3.

**Net code:** 4 files modified, ~140 net new lines. No new files.

**Verification:**

- `npm run type-check` — clean, no errors.
- `npm run build` — clean, all 41 routes generated. Compiled in 16.2s, TypeScript in 32.6s. No new warnings.
- Pre-existing `src/types/database.ts` BOM drift stashed for the duration of verify via `git stash push -- src/types/database.ts`, restored byte-identically after via `git stash pop`. Working-tree state pre- and post-verify matches (only intentional M-1 edits + parked drift + untracked docs).
- No browser preview verification — per `<when_to_verify>`, M-1 changes are pure helper / data-shape work with zero UI surface area. `groupHistoryByBattery` and `filterPointsBySessions` are not called by any rendered component yet; the loader-types extension flows through Phase D's existing pipeline without changing any rendered output (the new field is consumed only by Phase M code arriving in M-2). The compile-time gate (type-check + build) is the right verification at this stage.

**What didn't ship (intentional):**

- No render changes. `ReportsTab.tsx`, the `_components/reports/` family, and `ReportsPanel.tsx` are untouched.
- No barrel export change. `comparison.ts`'s existing helpers (`groupHistoryBySession`, etc.) are not re-exported through `src/lib/testing/index.ts`; both `ReportsPanel.tsx` and `PortalTestCard.tsx` import directly from `@/lib/testing/comparison`. The new `BatteryGroup` + `groupHistoryByBattery` follow the same pattern.
- No unit-test file. No JS test runner in `package.json`; pure helpers ride the type system + the M-2 render-time exercise (mirroring J-1's closure pattern).
- No `BatteryRow` re-export from `loader-types.ts` (it's already exported via `loaders.ts` through the barrel — see `index.ts:38`).

**Sign-off note for the EP:**

M-1 is a non-visual sub-phase. The validation surface is "type-check + build clean", which it is. M-2 will exercise these helpers in `ReportsTab.tsx` and surface the Battery view; that's the first sub-phase with a browser-observable change.

Sign off this closure + M-2 opens (add the top-level Category↔Battery toggle on the Reports tab + new `BatteryView` component family that lists saved batteries, orphan pseudo-group at the bottom, per-battery card with header showing battery name + N sessions count; no sub-toggle yet — that's M-3).

### 7.5 M-2 — Category↔Battery toggle + BatteryView (closed pending EP sign-off, 2026-05-15)

Per Q-M1 (a) + Q-M9 (a) + Q-J12 contracts. Pure presentation layer — no schema, no RLS, no loader change beyond M-1.

**What shipped:**

- **NEW** [`src/app/(staff)/clients/[id]/_components/reports/battery/BatteryCard.tsx`](../../src/app/(staff)/clients/[id]/_components/reports/battery/BatteryCard.tsx) — header-only card for M-2. Renders the battery name + subline (session count + most-recent date, or "Not yet applied to this client" for active batteries with zero applications). Orphan pseudo-group uses italic header; archived batteries get a subtle "Archived" tag beside the name; empty (`isEmpty`) cards mute via `opacity: 0.65`. Body is empty pending M-3's sub-toggle + content.
- **NEW** [`src/app/(staff)/clients/[id]/_components/reports/battery/BatteryView.tsx`](../../src/app/(staff)/clients/[id]/_components/reports/battery/BatteryView.tsx) — outer container. Calls `groupHistoryByBattery(history, batteries)` from M-1's helper and renders one `BatteryCard` per group. EmptyState renders when both batteries and orphan sessions are absent — pointer to Settings → Tests → Saved batteries.
- **EDIT** [`src/app/(staff)/clients/[id]/_components/ReportsTab.tsx`](../../src/app/(staff)/clients/[id]/_components/ReportsTab.tsx):
  - New `type ViewMode = 'category' | 'battery'`.
  - New `useState<ViewMode>('category')` — regression-safe default; per Q-M2 (a) + Q-M3 (c) the state is session-only.
  - New file-local `ViewModeToggle` + `ModeSegment` components — segmented control pattern matching `ReportsPanel.tsx`'s comparison toggle (warm-grey pill, white active segment with the single subtle shadow). Sentence-case labels "Category" / "Test battery". 150ms transitions on background/color/shadow per design-system motion.
  - Toggle placed inside the header right-side cluster, leftmost (Q-M1 (a)).
  - Body conditional becomes `viewMode === 'battery' ? <BatteryView /> : (selectedCategoryId ? <CategoryDetail /> : <CategoryGrid />)`. Category path is byte-identical when `viewMode === 'category'`.

**Files changed:**

- NEW: `BatteryCard.tsx`, `BatteryView.tsx`
- MODIFIED: `ReportsTab.tsx`

**Verification:**

- `npm run type-check` — clean.
- `npm run build` — clean, 41 routes (unchanged from M-1).
- Pre-existing `database.ts` BOM drift stashed for verify, restored byte-identically after.
- Browser-verified by EP (chat 2026-05-15): screenshot shared.
  - Header: "Test history · 4 categories · 9 tests" on left; toggle + "Compare sessions" + "Record test" on right.
  - Toggle in Battery mode: "ACL RTR · 2 sessions · last today" card on top; "Not in a saved battery · 7 sessions · last 13 days ago" italic orphan card at the bottom.
  - Implicit regression: Category view must have rendered correctly on landing for the EP to have toggled into Battery view.
  - Console-error sweep returned zero entries.

**What didn't ship (intentional, M-3 territory):**

- No per-battery sub-toggle (Sessions ↔ Progression). Cards are header-only in M-2.
- No session-row drill-in inside a card (Q-M4 (c) expand-in-place — M-3 builds it).
- No filtered-test rendering for the Progression sub-view (Q-M5 (a) `ChartFactory` reuse — M-3 builds it).
- `BatteryCard.tsx` has a `gap: 14` on the article and a placeholder comment where the body will land. Cards look short but the EP confirmed this is the expected M-2 acceptance state.

**Open follow-ups surfaced during M-2:**

- None. The screenshot shows the layout reads well at desktop width; mobile/narrow rendering will be revisited at M-3 close once the body content is in.

Sign off this closure + M-3 opens.

M-3 scope (per §4): inside each `BatteryCard`, add the Sessions ↔ Progression sub-toggle (Q-J13 locked). Sessions sub-view = expand-in-place per Q-M4 (c) (clickable session rows; click expands into the session-group detail mirroring portal Phase J `PortalSessionGroup`). Progression sub-view = per-test charts filtered to this battery's sessions via M-1's `filterPointsBySessions`, rendering through the existing `TestCard` + `ChartFactory` per Q-M5 (a). Hide tests with zero filtered points per Q-M5.1 (a).

### 7.6 M-3 — Per-battery Sessions ↔ Progression sub-toggle (closed pending EP sign-off, 2026-05-15)

Per Q-J13 (locked), Q-M4 (c), Q-M5 (a), Q-M5.1 (a), Q-M6 (b) — and the audit's "mirror collapse-pattern on saved-battery cards for visual consistency" extension.

**What shipped:**

- **NEW** [`src/app/(staff)/clients/[id]/_components/reports/battery/BatterySessionsView.tsx`](../../src/app/(staff)/clients/[id]/_components/reports/battery/BatterySessionsView.tsx) — the "Sessions" sub-view. Renders one row per session in the group, newest-first (order inherited from `groupHistoryByBattery`). Each row is a clickable button with its own expand state; expansion is in-place (Q-M4 (c)) showing the tests captured in that session + per-metric values via Phase J's `valuesAtSession` helper. No comparison toggle inside the expansion — Sessions is the audit-trail/quick-review surface; Progression is the analytical lens. Mirrors the portal Phase J `PortalSessionGroup` collapse animation (grid-template-rows 1fr ⇄ 0fr, 300ms cubic-bezier easing).
- **NEW** [`src/app/(staff)/clients/[id]/_components/reports/battery/BatteryProgressionView.tsx`](../../src/app/(staff)/clients/[id]/_components/reports/battery/BatteryProgressionView.tsx) — the "Progression" sub-view (default sub-mode). Uses M-1's `filterPointsBySessions(points, sessionIds)` to trim each metric's series to ONLY the sessions where this battery was applied. Calls the existing staff Reports tab `TestCard` for each filtered test (Q-M5 (a) — no new chart surface; visual consistency across views). Tests with zero filtered points are hidden per Q-M5.1 (a). Recomputes `total_sessions` + `most_recent_conducted_at` from the filtered metrics so the per-card subline reflects "in this battery", not "across all batteries".
- **REWROTE** [`src/app/(staff)/clients/[id]/_components/reports/battery/BatteryCard.tsx`](../../src/app/(staff)/clients/[id]/_components/reports/battery/BatteryCard.tsx):
  - Cards with applied sessions become collapsible (Q-M6 (b) extended to saved-battery cards for visual consistency). Header is a full-width button with chevron rotating 0deg → -90deg.
  - Default expanded — Q-M6 (b) preserves "visible gap encourages tagging" for orphan; saved cards default expanded too.
  - Cards with zero applied sessions ("Not yet applied" — Q-M9 (a)) remain header-only, no chevron, no body. Muted via `opacity: 0.65`.
  - Body contains a file-local sub-toggle (Progression / Sessions) defaulting to Progression per the handoff brief's "primary lens" framing.
  - Per-card sub-toggle state is independent (Q-J13) — two cards on screen can be in different sub-modes.
  - File-local `SubToggle` + `Segment` primitives match the M-2 `ViewModeToggle` shape but slightly smaller (.74rem vs .78rem) to signal hierarchy.
- **EDIT** [`src/app/(staff)/clients/[id]/_components/reports/battery/BatteryView.tsx`](../../src/app/(staff)/clients/[id]/_components/reports/battery/BatteryView.tsx) — props now thread `clientId` + `publications` through to each `BatteryCard`. Pass through verbatim from `ReportsTab.tsx`.
- **EDIT** [`src/app/(staff)/clients/[id]/_components/ReportsTab.tsx`](../../src/app/(staff)/clients/[id]/_components/ReportsTab.tsx) — `BatteryView` call site passes `clientId` + `publications`.

**Files changed:**

NEW: `BatterySessionsView.tsx`, `BatteryProgressionView.tsx`
REWROTE: `BatteryCard.tsx`
EDIT: `BatteryView.tsx`, `ReportsTab.tsx`

**Verification:**

- `npm run type-check` — clean.
- `npm run build` — clean, 41 routes (unchanged from M-1/M-2).
- Pre-existing `database.ts` BOM drift stashed for verify, restored byte-identically after.
- Browser-verified by EP (chat 2026-05-15): chevron expand/collapse works; sub-toggle Progression ↔ Sessions flips per-card independently; ACL RTR card's Progression shows filtered TestCards (subtitle correctly reads "in this battery" counts); Sessions sub-view expands inline showing tests + per-metric values; orphan group "Not in a saved battery" works the same way.

**What didn't ship (intentional / future polish):**

- The Sessions sub-view's per-test summary duplicates `formatValue` / `formatDate` from `ReportsPanel.tsx` and the rail's TestCard pattern. A `SessionTestSummary` shared component could fold these — P2 polish, not in M-3 scope.
- Four segmented-control instances now exist (`ReportsPanel` comparison, `PortalTestCard` comparison, `ReportsTab` ViewMode, `BatteryCard` SubToggle). A shared `SegmentedControl` primitive is overdue. P2 polish.
- No "newest expanded, older collapsed" pattern (à la portal J-2-α). All saved-battery cards + the orphan default expanded. The EP can collapse what they don't want; revisit if many batteries makes the view too long.

Sign off this closure + M-4 opens.

**M-4 — substantive rail redesign.** Per Q-M7 refinement (§7.2) + Q-M12/Q-M13/Q-M13.1/Q-M14 (§7.3). Replaces `ReportsPanel.tsx`'s flat publications list with a session-grouped collapsible feed mirroring the portal Phase J pattern, plus pinning. Touches only `ReportsPanel.tsx`; `SessionBuilder.tsx` and `CalendarSidePanel.tsx` stay byte-identical. The same `ReportsPanel.tsx` is consumed by both rails (session builder + program calendar side panel) so the improvement lands in both surfaces in one edit.

### 7.7 M-4 — Rail redesign: session-grouped feed + pinning (closed pending EP sign-off, 2026-05-15)

Per Q-M7 refinement (§7.2) and the locked Q-M12 (b), Q-M13 (c), Q-M13.1 (b), Q-M14 (c) sign-offs (§7.3).

**What shipped:**

- **REWROTE** [`src/app/(staff)/clients/[id]/_components/ReportsPanel.tsx`](../../src/app/(staff)/clients/[id]/_components/ReportsPanel.tsx):
  - Removes the previous flat publications list (`ReportRow` + `ReportReader` deep-drill).
  - New layout: single session-grouped collapsible feed mirroring the portal Phase J `DataView` + `PortalSessionGroup` pattern. Calls `groupHistoryBySession(history, publications)` from `comparison.ts` (the same helper the portal uses).
  - One `SessionGroupRow` per session with a live publication. Header label = battery name (when applied), test name (single-test standalone), or date (multi-test no-battery fallback). Subline always carries the date and (when there's a primary label) the tests count.
  - Each group row carries a `PinButton` (right of the chevron, Lucide `Pin` icon, filled when pinned). Click stops propagation so it doesn't trigger expand.
  - Pinned groups surface under a "Pinned" eyebrow at the top; remaining groups under "All sessions" (shown only when at least one pin exists).
  - Pin state persisted via `localStorage` keyed on `odyssey:rail-pins:${clientId}` (Q-M12 (b)). SSR-safe: starts empty, hydrates from localStorage on mount. Storage failures (no `window`, quota exceeded, blocked) fail silently.
  - `clientId` derived via `useParams()` from `next/navigation`. This avoids adding a required prop to `ReportsPanel`'s call sites — particularly `SessionBuilder.tsx` (load-bearing locked file).
  - Expand-in-place inline test cards per Q-M14 (c). Per-card baseline/previous comparison toggle migrates into the inline `RailTestCard`; the previous `ReportReader` modal is gone.
  - Inline framing text renders in italics above the metric block when the publication carries one.
  - Animation: chevron rotates 0deg → -90deg on collapse; body uses `grid-template-rows: 1fr ⇄ 0fr` with overflow:hidden, 300ms cubic-bezier(0.4, 0, 0.2, 1) — matches portal Phase J + M-2/M-3 `BatteryCard` pattern.
  - `SessionReport` export preserved verbatim (same shape as Phase L) — `SessionBuilder.tsx`'s type-only import remains valid.

**Files changed:**

REWROTE: `ReportsPanel.tsx`

**Verification:**

- `npm run type-check` — clean.
- `npm run build` — clean, 41 routes (unchanged from M-1/M-2/M-3).
- `git diff --stat HEAD -- SessionBuilder.tsx` — empty (byte-identical to HEAD, protect-rule preserved).
- `git diff --stat HEAD -- CalendarSidePanel.tsx` — empty (byte-identical, both rails inherit M-4 in one edit).
- Pre-existing `database.ts` BOM drift stashed for verify, restored byte-identically.
- Preview console post-write: zero errors.
- Browser-verified by EP (chat 2026-05-15): both surfaces (session-builder right rail + program calendar side panel) render the new feed; pin/unpin persists across reload; per-card baseline/previous toggle inline; chevron expand/collapse animates correctly.

**What didn't ship (intentional):**

- No cross-tab live pin sync. localStorage doesn't broadcast changes across tabs; pins update on the next mount/reload. The EP rarely runs the rail in two tabs simultaneously; defer broadcast (`storage` event listener) to polish if it surfaces.
- No `user_id`-scoped pin keys — `localStorage` is per-browser anyway, and `useParams` reads `clientId` from the URL without adding a required prop to `ReportsPanel`'s call sites. DB-backed pin storage with `user_id` scoping is on the bench for a premortem reconsideration (see `project_premortem_view_mode_persistence` memory).
- No drag-to-reorder pins (Q-M13.1 (b) explicit — pinned items sort newest-first within the pinned section by `conducted_at`).
- The `RailTestCard` continues to duplicate `formatValue` / `formatShortDate` / `sideLabel` / `MetricBlock` / `MetricRow` / `ComparisonToggle` / `ToggleSegment` (same duplication as pre-M-4; lifted along with the rewrite). A shared `SessionTestCard` primitive remains a P2 polish opportunity — punted to keep M-4's diff focused on Q-M7's behavioural change.

**Open follow-ups surfaced during M-4:**

- The `PinButton` uses `stopPropagation` to avoid triggering the expand button it sits inside. The structure is two sibling `<button>` elements inside a flex `<div>` — not button-in-button. Confirmed no console warnings; clean accessibility tree.
- `RailTestCard` re-renders the framing text on each test card. Slight redundancy when one battery publication carries one framing covering multiple tests (e.g. KOOS subscales). The portal already has this property; staff is now consistent. Worth a polish-pass review if EPs report visual repetition.

---

## Phase M overall — closed pending EP final sign-off (2026-05-15)

All four sub-phases shipped:

| Sub-phase | Scope |
|-----------|-------|
| **M-1** | Data shape + helpers (`SessionInfo.applied_battery_id`, `groupHistoryByBattery`, `filterPointsBySessions`) |
| **M-2** | Top-level Category ↔ Test battery toggle on the Reports tab + `BatteryView` family |
| **M-3** | Per-battery Sessions ↔ Progression sub-toggle with expand-in-place sessions + filtered-points progression |
| **M-4** | Session-builder rail rewrite — session-grouped feed + pinning + inline test cards |

### Acceptance bar (from handoff brief)

- [x] Staff Reports tab `?tab=reports` carries a Category ↔ Test Battery toggle at the top level. (Q-M1 (a) header strip)
- [x] Category view unchanged from pre-M state. (Regression check; toggle defaults to Category; tested implicitly by EP toggling between modes.)
- [x] Test Battery view lists saved batteries with sessions where each was applied; orphan pseudo-group at the bottom. (Q-J12, Q-M9 (a))
- [x] Per-battery sub-toggle Sessions ↔ Progression works. (Q-J13)
- [x] Session-builder rail `ReportsPanel.tsx` gains the agreed surface — Q-M7 refinement: session-grouped feed with pinning instead of the originally-discussed Category mode.
- [x] `SessionBuilder.tsx` byte-identical pre- and post-Phase-M. (Confirmed via `git diff --stat HEAD`.)
- [x] `CalendarSidePanel.tsx` byte-identical (both rails inherit M-4 in one edit).
- [x] `npm run type-check` + `npm run build` pass clean (stashed `database.ts` BOM drift, restored after).
- [x] Each sub-phase's gap-doc closure log lives in §7.4 / §7.5 / §7.6 / §7.7.
- [x] Parent doc `testing-module.md` references this gap doc as closed.

### Cumulative files changed

NEW:
- `src/app/(staff)/clients/[id]/_components/reports/battery/BatteryCard.tsx` (M-2; rewritten in M-3)
- `src/app/(staff)/clients/[id]/_components/reports/battery/BatteryView.tsx` (M-2; props extended in M-3)
- `src/app/(staff)/clients/[id]/_components/reports/battery/BatterySessionsView.tsx` (M-3)
- `src/app/(staff)/clients/[id]/_components/reports/battery/BatteryProgressionView.tsx` (M-3)
- `docs/polish/staff-reports-view-toggle.md` (this gap doc — gap analysis + sign-off log)
- `docs/polish/staff-reports-view-toggle-handoff.md` (the handoff brief that opened Phase M)

MODIFIED:
- `src/lib/testing/loader-types.ts` (M-1 — `SessionInfo.applied_battery_id`)
- `src/lib/testing/loaders.ts` (M-1 — `loadTestHistoryForClient` carries `applied_battery_id`)
- `src/lib/testing/comparison.ts` (M-1 — `BatteryGroup` + `groupHistoryByBattery`)
- `src/app/(staff)/clients/[id]/_components/reports/helpers.ts` (M-1 — `filterPointsBySessions`)
- `src/app/(staff)/clients/[id]/_components/ReportsTab.tsx` (M-2 — `ViewMode` toggle + `BatteryView` wiring; M-3 — thread `publications` + `clientId`)
- `src/app/(staff)/clients/[id]/_components/ReportsPanel.tsx` (M-4 — full rewrite)
- `docs/polish/testing-module.md` (Phase M closure reference)
- `docs/deferred-prompts.md` (Phase M entry removed — change is the record)

PROTECTED (unchanged):
- `src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx`
- `src/app/(staff)/clients/[id]/program/_components/CalendarSidePanel.tsx`

### Suggested next phase

CLAUDE.md's polish-pass order suggests **auth & onboarding** next. However, the **Open gates** in CLAUDE.md remain unclosed:

- External IT advisor review of `auth.md` + `rls-policies.md`
- External review of the schema (`schema.md`)

These are non-negotiable before the first real client onboards. Recommend pausing further polish until the gates close — the polish pass can resume post-review without coordination cost, but RLS holes are unrecoverable post-launch. Surface this with the EP rather than auto-handing off to the next polish phase.
