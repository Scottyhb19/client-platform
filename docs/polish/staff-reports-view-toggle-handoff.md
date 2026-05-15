# Phase M handoff — Staff Reports Category ↔ Test Battery view toggle

You're picking up the Odyssey project to start **Phase M** — add a view-mode toggle on the staff Reports surfaces that flips between two organisations of the same underlying test_results:

- **Category view** (today's staff `ReportsTab.tsx` — category → subcategory → test cards with time-series charts). Primary lens: *"how has this metric trended over time."* Already built.
- **Test Battery view** (new). Primary lens: *"how does this whole assessment shape up over its repetitions?"* Tests grouped by saved battery template; each battery's repeated applications shown chronologically with a sub-toggle for Sessions ↔ Progression.

Phase M was scoped during the Phase J live-test in chat 2026-05-14/15. Key decisions are pre-locked in [`docs/deferred-prompts.md`](../deferred-prompts.md) "Staff Reports — Category ↔ Test Battery view toggle (future Phase M)". Phase J's portal-side polish closed 2026-05-15 (commit `0f9b434`); Phase M's prerequisite (sessions can be tagged with battery names visible client-side) is now live via the RLS migration `20260515120000_client_select_test_batteries.sql`.

Project root: `C:\Users\scott\Desktop\Client Software Platform` (Windows; bash via Bash tool, PowerShell native).

## Read first, in this order

1. **CLAUDE.md** — project working agreement, design rules, code standards. **Critical:** the session builder (`src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx`) is the load-bearing differentiator and must not be modified. Phase M touches `ReportsPanel.tsx` which is *consumed by* the session builder's right rail — modifying `ReportsPanel.tsx` itself is fair game; modifying `SessionBuilder.tsx` is not.
2. **[`docs/deferred-prompts.md`](../deferred-prompts.md)** — Phase M entry. Carries the locked sign-offs (Q-J11/12/13) and the still-open decisions list. **This is the contract.** Don't re-litigate the locked decisions without a written reason.
3. **[`docs/polish/client-portal-data-tab.md`](./client-portal-data-tab.md)** — Phase J gap doc. §9.5 / §9.6 describe how the portal-side session-grouped renderer works. The "by-session"/"by-battery" mental model is now production code on the portal side; Phase M brings it to the staff side as a *toggle option* alongside the existing Category view.
4. **[`docs/polish/testing-module.md`](./testing-module.md)** — active parent polish for the testing module. Phase M is the staff-side complement to Phase J's portal redesign; coordinate with this doc (read what's open, fold findings back if you discover something that affects the testing module itself).
5. **Helpers already shipped by Phase J** in [`src/lib/testing/comparison.ts`](../../src/lib/testing/comparison.ts) — Phase M reuses these:
   - `ComparisonMode` type (`'baseline' | 'previous'`)
   - `pickPreviousBefore(points, anchorConductedAt, side)`
   - `pointAtSession(points, sessionId, side)`
   - `valuesAtSession(metric, sessionId)`
   - `SessionGroupTest` interface, `SessionGroup` interface
   - `groupHistoryBySession(history, publications)` — pivots `ClientTestHistory` into session-groups. Phase M will likely write a sibling `groupHistoryByBattery(history, publications, batteries)` that produces a similar shape but groups by saved-battery id with a per-battery sessions[] inside.
6. **Current staff Reports tab implementation** — the surface Phase M extends:
   - [`src/app/(staff)/clients/[id]/_components/ReportsTab.tsx`](../../src/app/(staff)/clients/[id]/_components/ReportsTab.tsx) — top-level Reports tab, drives CategoryGrid ↔ CategoryDetail navigation.
   - [`src/app/(staff)/clients/[id]/_components/reports/CategoryGrid.tsx`](../../src/app/(staff)/clients/[id]/_components/reports/CategoryGrid.tsx) — category tiles.
   - [`src/app/(staff)/clients/[id]/_components/reports/CategoryDetail.tsx`](../../src/app/(staff)/clients/[id]/_components/reports/CategoryDetail.tsx) — drilled-in subcategory chips + per-test cards.
   - [`src/app/(staff)/clients/[id]/_components/reports/TestCard.tsx`](../../src/app/(staff)/clients/[id]/_components/reports/TestCard.tsx) — per-test card with `MetricBadge` + `ChartFactory` (Recharts).
   - [`src/app/(staff)/clients/[id]/_components/reports/helpers.ts`](../../src/app/(staff)/clients/[id]/_components/reports/helpers.ts) — `TimeWindow`, `sortTestsByRecency`, `groupMetricsByShape`, `pickBaseline`, `pickLatest`, the comparison-overlay pivot, `latestUnpublishedSessionForTest`, etc.
   - [`src/app/(staff)/clients/[id]/_components/reports/ChartFactory.tsx`](../../src/app/(staff)/clients/[id]/_components/reports/charts/ChartFactory.tsx) — Recharts dispatcher (`LineChartCard`, `BarChartCard`, `AsymmetryBarChartCard`, `TargetZoneChartCard`).
   - [`src/app/(staff)/clients/[id]/_components/reports/ComparisonOverlay.tsx`](../../src/app/(staff)/clients/[id]/_components/reports/ComparisonOverlay.tsx) + `ComparisonSessionPicker.tsx` + `ComparisonTable.tsx` — full-page session-comparison overlay. Useful precedent for the "view sessions side-by-side" pattern; Phase M's Battery view's Sessions sub-view may want to reuse some of this.
7. **Current session-builder right-rail Reports panel** — the second surface:
   - [`src/app/(staff)/clients/[id]/_components/ReportsPanel.tsx`](../../src/app/(staff)/clients/[id]/_components/ReportsPanel.tsx) — flat list of publications → ReportReader on click. **Phase M adds the Category view as a new mode here** (today it's effectively by-publication/by-session only). Touch this file; DO NOT touch the session builder file itself.
8. **Loader types and shape:**
   - [`src/lib/testing/loader-types.ts`](../../src/lib/testing/loader-types.ts) — `ClientTestHistory`, `PublicationRow`, `BatteryRow`, `CatalogCategory`, `LastUsedBatteryHint`, `SessionInfo`.
   - `BatteryRow` (`id, name, description, metric_keys`) is loaded already (per ReportsTab's `batteries` prop). Phase M needs to surface a list of saved batteries on the staff Reports tab; this data is already plumbed.
   - **No loader change anticipated for Phase M** — `ClientTestHistory.sessions[]` already carries `(session_id, conducted_at, battery_name, result_count)`, and `applied_battery_id` is on the underlying `test_sessions` row. Verify during audit.

## Phase M scope

Two staff surfaces, one toggle:

### Surface 1 — Staff client-profile Reports tab

Add a top-level view-mode toggle that switches the body of the Reports tab between:

- **Category view** (existing): `CategoryGrid` → `CategoryDetail` → `TestCard`. Unchanged.
- **Test Battery view** (new): list of saved batteries (cards or tiles) where each battery is expandable to show its applications over time + a sub-toggle.

Under the new view:

- **Each battery is a top-level card** keyed on the saved battery id. Header: battery name + count of sessions where this battery was applied.
- **Per-battery sub-toggle (Q-J13 (c)):** Sessions ↔ Progression.
  - **Sessions:** clickable session rows for the applications of this battery. Each row drills into per-session detail — pattern to be decided in M's gap doc (overlay vs route vs expand-in-place).
  - **Progression:** per-test cards filtered to only the sessions where THIS battery was applied. Time-series charts via `ChartFactory` (existing Recharts) showing the battery's repeated applications as data points.
- **Orphan tests (Q-J12 (α)):** tests captured outside any saved battery render as a **pseudo-group at the bottom named "Not in a saved battery"**, visually distinct (italic header or lighter weight). Same tests remain available in Category view.

### Surface 2 — Session-builder right-rail `ReportsPanel.tsx`

Today this is read-only by-publication list → ReportReader on click. Phase M adds the Category view as a new mode here:

- **Category mode (new):** condensed version of the staff Reports tab's CategoryGrid — single-level, narrow-column friendly. Lets the EP review a metric's trend without leaving the program builder.
- **Publications mode (existing):** unchanged. The current ReportReader is the canonical "by-session" lens in this panel.

Open question for Phase M's gap doc: does the rail get BOTH new modes (Category + Battery), or just Category? The narrow column may not accommodate a battery-level view well; defer the decision.

## Locked decisions (do not re-litigate)

From [`docs/deferred-prompts.md`](../deferred-prompts.md) Phase M entry:

| Q | Decision | Notes |
|---|---|---|
| Q-J11 | Phase M is its own phase, own gap doc | Phase J's minimal tagging affordance (J-2-γ) already live |
| Q-J12 | Orphan tests render as a pseudo-group at the bottom named "Not in a saved battery", visually distinct (italic header or lighter weight) | Avoids the "junk drawer" problem; visible gap encourages tagging |
| Q-J13 | Per-battery card has a **sub-toggle** Sessions ↔ Progression | Sessions = clickable session-row list; Progression = per-test cross-session charts filtered to this battery's applications |

## Open decisions (raise in Phase M's gap doc)

| # | Decision |
|---|---|
| Q-M1 | Where the toggle lives on the client profile Reports tab — page-level (above the tab strip) vs Reports-tab-local (inside the existing header) vs replacing the existing "+ Record test" / "Compare sessions" header strip |
| Q-M2 | Does the session-builder rail's toggle have its OWN state, or follow the profile's? (Per-surface state vs sticky shared) |
| Q-M3 | Sticky-per-EP via a `practice_preferences` row or local state only? |
| Q-M4 | Sessions sub-view drill-in pattern — overlay (mirror `ComparisonOverlay`), dedicated route, or expand-in-place inside the battery card |
| Q-M5 | Progression sub-view chart approach — reuse `ChartFactory` from existing Category view (Recharts), or specialised "battery-progression" rendering with the cross-session-comparison overlay's pivot logic |
| Q-M6 | Pseudo-group "Not in a saved battery" — collapsible (and if so, default collapsed?) or always open |
| Q-M7 | Session-builder right-rail scope — does it get Category mode only, or also Battery mode? Battery mode at ~320px column is potentially cramped |
| Q-M8 | Sub-phase scoping — confirm or refine the suggested split (below) |

## Why multi-sub-phase

Phase M is more structural than Phase J. The whole-tab IA changes (Reports tab is currently driven by category-first navigation; adding a top-level mode toggle reshuffles where things live). Suggested split, refine in the gap doc:

- **M-1 — Audit + data shape.** Read both surfaces in detail. Confirm `groupHistoryByBattery` is feasible without a loader change (likely yes — `applied_battery_id` is on `test_sessions`, names join via batteries). Write the helper. No render changes. Maybe a small staff page-level state for the toggle position.
- **M-2 — Category ↔ Test Battery toggle on the staff client-profile Reports tab.** New toggle component. New "Battery view" body that lists saved batteries + the orphan pseudo-group at the bottom (Q-J12 (α)). Per-battery card starts simple — just shows the battery name + sessions count.
- **M-3 — Per-battery Sessions ↔ Progression sub-toggle (Q-J13 (c)).** Inside each battery card. Sessions sub-view (drill-in pattern per Q-M4). Progression sub-view rendering per-test charts filtered to this battery's applications.
- **M-4 — Session-builder rail mirror.** Add Category mode to `ReportsPanel.tsx` (per Q-M7 scope decision). Touch only `ReportsPanel.tsx` — DO NOT touch `SessionBuilder.tsx`.

Each sub-phase has its own build → test → sign-off cycle. The gap doc opens all of M-1..M-4; each closes its own bar.

## Decisions to surface BEFORE writing code (polish-pass protocol)

Write a gap doc at `/docs/polish/staff-reports-view-toggle.md` before any code change. Mirror Phase J's structure:

1. §0 executive summary — what's already correct, what changes, what stays the same.
2. §1 what's already correct (existing Category view, ChartFactory, ComparisonOverlay, the Phase J comparison.ts helpers).
3. §2 gaps to close (grouped P0/P1/P2 by severity).
4. §3 what NOT to touch (`SessionBuilder.tsx`, RLS, the portal Data tab, the testing-module schema).
5. §4 sub-phase plan (M-1..M-4 confirmation or refinement).
6. §5 questions to surface (Q-M1..Q-M8 above + anything found during audit).
7. §6 stop point.

Wait for EP sign-off on Q-M1..Q-M8 before implementing. Then sub-phase-by-sub-phase sign-off per CLAUDE.md polish-pass protocol.

## Working norms (non-negotiable, inherited from project memory)

- User is an Exercise Physiologist in Australia, not a developer. Plain language, Australian English. Sentence case for UI labels.
- Prefix any user-facing PowerShell with `cd "C:\Users\scott\Desktop\Client Software Platform"`. Use `;` not `&&` (Windows PowerShell 5.1).
- No local Docker. Don't try `supabase db reset` / `supabase test db`. Audit live DB via Supabase SQL Editor or `supabase gen types` against remote.
- Port-3000 dev server only — never spin up new previews from worktrees; verify via `localhost:3000`.
- Schema/migration/push correctness if any RPC or new column is needed (likely none for Phase M — verify during audit).
- Configuration is read at runtime — schema files load at server start, per-EP overrides via the resolver. Never read schema files directly in components.
- Design tokens only — `src/app/globals.css` and `src/lib/constants.ts`. No raw hex, no raw radii, no inline `boxShadow` strings.
- **The session builder is the load-bearing differentiator.** Read from `SessionBuilder.tsx` only. `ReportsPanel.tsx` (consumed by the session builder) is OK to modify.
- Use `Edit` over `Write` for existing files. Never commit without explicit EP sign-off.
- `database.ts` has parked BOM working-tree drift — out of scope. Stash it during type-check + build verification, restore after.

## Coordination notes

- **Phase J just closed (commit `0f9b434` on master, 2026-05-15).** Master should be clean for Phase M to branch from / land on. Confirm with `git status` and `git log` on chat start.
- **The testing module polish at [`testing-module.md`](./testing-module.md)** is the parent polish section. If Phase M's audit discovers gaps that belong to the testing module itself (schema-level, resolver-level, capture-flow-level), surface them there rather than overloading Phase M.
- **Phase J's portal Data tab is now the reference** for what session-grouped UX feels like on the client side. The staff side's Battery view is a denser, analytics-y cousin — same data, different lens.
- **The pre-existing `src/types/database.ts` working-tree drift is not in scope.** Stash during verification, restore after.

## Acceptance bar (whole phase)

- Staff Reports tab `?tab=reports` carries a Category ↔ Test Battery toggle at the top level.
- Category view unchanged from the pre-M state (regression protection).
- Test Battery view lists saved batteries with sessions where each was applied; the orphan pseudo-group renders at the bottom.
- Per-battery sub-toggle Sessions ↔ Progression works (per Q-J13 (c)).
- Session-builder rail `ReportsPanel.tsx` gains the agreed Category-mode surface (per Q-M7).
- `SessionBuilder.tsx` is byte-identical pre- and post-Phase-M.
- `npm run type-check` + `npm run build` pass clean (stash `database.ts` for verification, restore after).
- Each sub-phase's gap doc / sign-off log lives in `docs/polish/staff-reports-view-toggle.md`.
- Parent doc `docs/polish/testing-module.md` (or a new `staff-reports-view-toggle.md` referenced from the testing module doc) marked with closure date.

## End-of-phase output

When the work is done:

- Files changed list with 1-line summary each (per sub-phase).
- Screenshots of the staff Reports tab in both modes (Category and Battery).
- Any deferred items surfaced during implementation tracked in the gap doc's §5.
- `docs/deferred-prompts.md` Phase M entry removed (the change itself is the record per the file's convention).
- Suggested next phase: CLAUDE.md's polish-pass order suggests auth & onboarding next. But the open gates (external IT advisor review of `auth.md` + `rls-policies.md`) are the priority before any further polish work — flag this with the EP rather than auto-handing-off.

Wait for explicit EP sign-off on Q-M1..Q-M8 before writing code. Wait for explicit EP sign-off on any commit.
