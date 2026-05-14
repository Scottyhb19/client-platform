# Phase J handoff — Portal Data-tab redesign

You're picking up the Odyssey project's client-portal polish pass at Phase J: redesign the portal's `/portal/reports?tab=data` ("Your data") surface so it carries the same **battery → test → metric** hierarchy + baseline-vs-previous comparison story that the staff session-builder's Reports panel already delivers. Today the portal Data tab is a flat list of test cards sorted by recency — functional but it doesn't let the client interpret their own results the way the EP can.

Phase L closed 2026-05-14 (staff completed-session expander). Phase J is the next phase per the signed-off K → L → J order, completing the client-portal polish pass before Phase 1 launch.

Project root: `C:\Users\scott\Desktop\Client Software Platform` (Windows; bash via Bash tool, PowerShell native).

## Read first, in this order

1. **CLAUDE.md** — project working agreement, design rules, code standards. The session builder + clinical notes adjacency is protected (Library + Notes + Reports tabs in the right panel of `SessionBuilder.tsx`); Phase J READS from that surface to mirror its Reports panel design, but does NOT modify it. Design-system rules apply throughout — design tokens only, no raw hex, 14px card radius default, etc.
2. **`docs/polish/client-portal.md`** — parent polish doc. §2.E "Data-tab redesign (deferred to Phase J)" is the gap statement. §4 row **J** is the placeholder row this phase fills in. §4.7 captures the closed Phase L so you have recent context.
3. **`docs/polish/testing-module.md`** — the active parent polish section (per CLAUDE.md). The structured testing module is being built/polished in parallel; the portal Data tab is its client-facing surface. Phase J intersects — coordinate with this doc (read what's open, fold findings back if you discover something that affects the testing module itself).
4. **`CLAUDE_CODE_BUILD_PROMPT_testing_module.md`** — target-state brief for the testing & reports module. Section on client-side rendering is most relevant to Phase J.
5. **`data/physical_markers_schema_v1.1.json`** — the runtime schema. Carries `client_view_chart`, `client_visibility`, `comparison_mode`, `direction_of_good` per metric. The portal renderer is supposed to honour these. Read at runtime via the resolver (per CLAUDE.md "Configuration is read at runtime, never compiled in"); the seeded `physical_markers_schema_seed` table is the runtime artifact.
6. **Current portal Data tab implementation:**
   - [`src/app/portal/reports/_components/DataView.tsx`](../../src/app/portal/reports/_components/DataView.tsx) — 52-line flat list, sorted by `most_recent_conducted_at DESC`, hidden-metric filter.
   - [`src/app/portal/reports/_components/PortalTestCard.tsx`](../../src/app/portal/reports/_components/PortalTestCard.tsx) — per-test card. Today's render unit.
   - [`src/app/portal/reports/_components/PortalFramingBlock.tsx`](../../src/app/portal/reports/_components/PortalFramingBlock.tsx) — supporting block.
   - [`src/app/portal/reports/_components/ReportsTabs.tsx`](../../src/app/portal/reports/_components/ReportsTabs.tsx) — tab switcher (Reports / Your data). Phase H closed the rename Files → Reports.
   - [`src/app/portal/reports/page.tsx`](../../src/app/portal/reports/page.tsx) — loader for both `?tab=data` and `?tab=reports`.
7. **Staff-side reference (DO NOT MODIFY — read for design intent):**
   - [`src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx`](../../src/app/(staff)/clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx) — the 2951-line session builder. The Reports tab in its right panel is the **canonical design reference** — battery → test → metric hierarchy, baseline-vs-previous toggle, percentage deltas. Search for "Reports" tab logic + the right-panel state machine.
   - [`src/app/(staff)/clients/[id]/_components/ReportsTab.tsx`](../../src/app/(staff)/clients/[id]/_components/ReportsTab.tsx) — staff client-profile Reports tab.
   - [`src/app/(staff)/clients/[id]/_components/reports/`](../../src/app/(staff)/clients/[id]/_components/reports/) — shared chart components. Note especially:
     - `charts/ChartFactory.tsx` — staff dispatcher
     - `client-charts/ClientChartFactory.tsx` — **already exists for client-facing rendering**. Likely candidate for portal reuse.
     - `client-charts/MilestoneChart.tsx`, `client-charts/NarrativeOnly.tsx` — existing client-side renderers.
     - `ComparisonSessionPicker.tsx`, `ComparisonTable.tsx`, `ComparisonOverlay.tsx` — comparison UI. Reuse vs portal-specific is a Q-J decision.
     - `TimeWindowSelector.tsx`, `CategoryGrid.tsx`, `CategoryDetail.tsx`, `TestCard.tsx`, `MetricBadge.tsx` — full set worth scanning.
8. **Loader types:**
   - [`src/lib/testing/loader-types.ts`](../../src/lib/testing/loader-types.ts) — `ClientTestHistory`, `PublicationRow`, `BatteryRow`, `CatalogCategory`, `LastUsedBatteryHint`. Phase J needs to confirm `ClientTestHistory` carries (or can be extended to carry) battery grouping + previous-session comparison data. Likely the staff side already loads richer data than the portal currently consumes.

## Phase J scope

The portal Data tab is reshaped from "flat list of cards" to a layered, comparison-aware surface. Specifically:

- **Battery → test → metric collapsible hierarchy.** A battery (e.g. "Lower body strength") contains tests (e.g. "Back squat 1RM", "Single-leg press") which contain metrics (e.g. "1RM", "asymmetry index"). Tests not part of a battery render as their own top-level entry — the "standalone-test variant."
- **Baseline-vs-previous comparison toggle.** Each metric shows current value, a comparison value, and a percentage-change delta. Comparison toggles between *baseline* (first recorded value) and *previous* (most recent prior value).
- **Percentage-change deltas with `direction_of_good` semantics.** A 5% drop in 5km time is positive; a 5% drop in vertical jump is negative. The schema's `direction_of_good` per metric drives the colour + sign treatment.
- **Honour `client_view_chart` per metric.** Some metrics render a chart, others narrative-only, some hidden entirely. Today's DataView already filters hidden — Phase J keeps that and adds the dispatch.

The architectural shift: portal-side renderers should reuse the staff `client-charts/` family where possible. The handoff prompt's working hypothesis is that `ClientChartFactory` was built exactly for this purpose and just hasn't been wired into the portal yet. Confirm during audit.

## Why this is multi-sub-phase

Per parent doc §4 row J: "Likely spawns 2-3 sub-phases." Suggested split, refine in the gap doc:

- **J-1 — Audit + data shape.** Reverse-engineer the staff session-builder Reports panel; confirm `ClientTestHistory` carries (or extends to) battery-grouping + previous-session data; decide Q-J1 (share vs duplicate components) and Q-J2 (data shape changes). Land any loader changes.
- **J-2 — Hierarchical render + dispatch.** Build the battery → test → metric tree on the portal side. Wire `ClientChartFactory` (or portal equivalent) for per-metric rendering honouring `client_view_chart`.
- **J-3 — Comparison toggle + deltas.** Add the baseline-vs-previous switch + percentage-change rendering with `direction_of_good` colouring.

Each sub-phase has its own build → test → sign-off cycle. The gap doc opens all three; each closes its own bar.

## Decisions to surface BEFORE writing code (gap-doc protocol)

Write a gap doc at `/docs/polish/client-portal-data-tab.md` before any code change. Surface the questions below, get EP sign-off in writing, then implement.

**Q-J1 — Component sharing strategy.** The staff `(staff)/clients/[id]/_components/reports/client-charts/` folder already has `ClientChartFactory`, `MilestoneChart`, `NarrativeOnly` — built for client-facing rendering but currently not consumed by the portal. Three paths:
- (a) Move `client-charts/` to a shared location (`src/app/_components/charts/client/` or `src/lib/charts/`) and import from both staff session-builder + portal.
- (b) Keep where they are; portal imports across the `(staff)` route group boundary. Next.js allows this (route groups don't isolate module imports).
- (c) Copy the rendering logic into portal-local components. Worst — drift risk.

*Recommend (a)* if the audit confirms the components are stateless presentation and don't lean on staff-only context. Recommend (b) if a quick move is risky for the testing module's in-flight work.

**Q-J2 — `ClientTestHistory` shape.** Audit whether it already carries:
- Battery grouping (which battery each test belongs to)
- Previous-session values per metric (for the comparison toggle)
- Direction-of-good resolution

If any are missing, J-1 lands the loader changes. Decision: extend `ClientTestHistory` vs add a parallel loader vs RPC for the comparison path?

**Q-J3 — Baseline-vs-previous toggle UI.** Where does the toggle live?
- (a) Top of the Data tab — affects all metrics simultaneously.
- (b) Per metric — each metric has its own toggle.
- (c) Per battery — toggle one level up.

Staff session-builder Reports panel has its own answer; mirror unless EP wants a different framing for clients.

**Q-J4 — Percentage-delta rendering.** Options:
- (a) Inline chip next to the current value (e.g. `82kg ▲4%`).
- (b) Separate column / row.
- (c) Folded into the chart visual itself.

Direction-of-good drives colour: a "good" delta is accent-green, a "bad" delta is alert. Neutral metrics (no direction) render in muted tone.

**Q-J5 — Standalone-test variant.** Tests not in a battery: render as top-level entries that look like single-test mini-cards, or fold into a synthetic "Other tests" battery? Recommend the former — keeps the visual hierarchy honest.

**Q-J6 — Sub-phase scoping.** Confirm the J-1/J-2/J-3 split above, OR propose a different split based on what the audit surfaces. Each sub-phase needs its own sign-off bar.

**Q-J7 — Empty-state semantics.** A client with no tests, vs. a client with tests but none published, vs. a client with tests but all hidden. Current implementation has one empty state covering all three. Phase J's hierarchy could surface them differently.

## Working norms (non-negotiable, inherited from project memory)

- Polish-pass protocol — gap doc at `/docs/polish/client-portal-data-tab.md` before any code. EP signs off on gap analysis before implementation begins. Same for each sub-phase.
- User is an Exercise Physiologist in Australia, not a developer. Plain language, Australian English.
- Prefix any user-facing PowerShell with `cd "C:\Users\scott\Desktop\Client Software Platform"`. Use `;` not `&&` (Windows PowerShell 5.1).
- No local Docker. Don't try `supabase db reset` / `supabase test db`. Audit live DB via SQL Editor or `supabase gen types` against remote.
- Port-3000 dev server only — never spin up new previews from worktrees.
- Schema/migration push correctness if any RPC or new column is needed (likely for Q-J2 if `ClientTestHistory` extends).
- Configuration is read at runtime — schema files load at server start, per-EP overrides via the resolver. Never read schema files directly in components.
- Design tokens only — `src/app/globals.css` and `src/lib/constants.ts`. No raw hex, no raw radii, no inline `boxShadow` strings. The portal uses `.portal-*` primitives (e.g. `.portal-card`, `.portal-eyebrow`, `.portal-btn-primary`) per Phase A's work.
- **The session builder is the load-bearing differentiator.** Read from `SessionBuilder.tsx` to mirror its Reports panel; never modify it. The Library + Notes + Reports right-panel adjacency is protected.
- Calendar stays pristine. (Stated for safety; Phase J is not calendar-related.)
- Use `Edit` over `Write` for existing files. Never commit without explicit EP sign-off.

## Coordination notes

- Phase L just closed (commit `15caf3d` on master, 2026-05-14). Master should be clean for Phase J to branch from / land on. Confirm with `git status` and `git log` on chat start.
- The testing module polish at [`testing-module.md`](./testing-module.md) is the active parent polish section. If Phase J's audit discovers gaps that belong to the testing module itself (schema-level, resolver-level, capture-flow-level), surface them there rather than overloading Phase J.
- Phase F-x (booking) runs in parallel chats. Phase J does NOT touch `BottomNav`, `/portal/book`, or any booking surfaces.
- Phase L's `RecentlyCompletedPanel` is now on the dashboard. Phase J is portal-side; staff dashboard not touched. Stated for safety.
- The pre-existing `src/types/database.ts` working-tree drift (BOM + `assert_audit_resolver_coverage`) is not in scope. If the EP regenerates types with proper UTF-8 no-BOM, that lands as its own separate commit.

## Acceptance bar (whole phase)

- Tab `?tab=data` renders the new hierarchical layout: batteries (collapsible) → tests → metrics with charts/narrative.
- Baseline-vs-previous toggle works on each metric (per Q-J3 scope).
- Percentage deltas render with direction-of-good colour.
- Standalone tests render as top-level entries.
- All six client states render correctly:
  1. Client with no tests at all → existing empty state.
  2. Client with tests, none published → empty state (variant TBD by Q-J7).
  3. Client with tests + publications but all metrics hidden → empty (rare).
  4. Client with one standalone test → single mini-card.
  5. Client with one battery → collapsed battery with N tests inside.
  6. Client with mixed batteries + standalones → mixed layout.
- `npm run build` passes clean.
- Each sub-phase's gap doc / sign-off log lives in `docs/polish/client-portal-data-tab.md`.
- Parent doc `docs/polish/client-portal.md` §4 row **J** marked ✓ with closure date.

## End-of-phase output

When the work is done:

- §4 row J marked ✓ with closure date.
- Files changed list with 1-line summary each (per sub-phase).
- Screenshot of the new Data tab in each of the six client states.
- Any deferred items surfaced during implementation tracked in `client-portal.md` §5.
- Phase J is the final phase in the portal-polish pass. Suggested next pass per CLAUDE.md's polish-pass order is **auth & onboarding** — but flag this with the EP rather than auto-handing-off, since Phase J's close marks a major milestone and the EP may want to redirect to the open gates (external IT advisor review of `auth.md` + `rls-policies.md`).

Wait for explicit EP sign-off on Q-J1..Q-J7 before writing code. Wait for explicit EP sign-off on any commit.
