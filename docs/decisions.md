# Architecture decisions log

A frozen record of load-bearing architectural decisions made during the Odyssey build, with the trade-offs considered and a Reversibility tag so future-us knows what's painful to change.

Format: each decision is a short ADR. Decisions are appended in chronological order. Once an entry is logged, do not edit the original — supersede it with a new entry that references the old one.

---

## D-001 — Chart library: Recharts

**Date:** 2026-04-30
**Phase:** Testing module D.1
**Status:** Decided
**Reversibility:** Painful. The data-shaping layer (resolver → chart props) is library-agnostic and survives a swap, but every chart component would be rewritten.

### Context

The testing module Reports tab needs to render five staff chart types (`line`, `bar`, `asymmetry_bar`, `target_zone`, `radar`) and five client portal chart types (`line`, `milestone`, `bar`, `narrative_only`, `hidden`). The choice of charting library affects every chart in the platform — staff Reports tab, comparison overlay, publish flow preview, and the eventual client portal in Phase E.

### Decision

Use **Recharts** (^2.15) as the charting library for both staff and client surfaces.

### Alternatives considered

| Option | Verdict | Reason |
|---|---|---|
| Recharts | **Chosen** | React-native composition; `<LineChart>`, `<BarChart>`, `<RadarChart>` map cleanly onto our types; ~45kB gzipped; React 19 compatible from 2.15 |
| Visx | Rejected | Lower-level d3 primitives — 2–3× more code per chart type; we'd be hand-rolling axes, tooltips, responsive containers. Flexibility we don't need for ten conceptually-standard charts |
| Handwritten SVG | Rejected | 4–5× more code than Recharts. Re-implements solved problems (responsive containers, tick calculation, tooltip positioning). Maintenance burden on a solo-practitioner codebase |

### Trade-offs accepted

- Design-system conformance requires overriding Recharts defaults (tooltip styling, grid colour, font family, no shadows). This is prop/CSS work, not architectural — acceptable cost.
- Two of our chart types are not out-of-the-box and need composition:
  - `asymmetry_bar` — bilateral L/R grouped bars with LSI midline → grouped `<BarChart>` + custom `<ReferenceLine>`
  - `target_zone` — line with shaded clinical bands → `<LineChart>` + `<ReferenceArea>` for the bands
- The client portal `milestone` chart (baseline + latest with delta arc) is custom SVG regardless of library — Recharts does not help, but does not hinder either.
- `radar` is reserved in the schema (no metric currently uses it). `<RadarChart>` is available when we need it.

### Practitioner control over charts (Phase D scope)

In addition to the structural lever already shipped in Phase C (`/settings/tests` per-metric override editor — the EP can change a metric's `default_chart` without a code deploy), Phase D adds these in-chart interactions:

- **Hover tooltip** on data points: exact value, date, session notes (if any).
- **Hover-to-emphasize** on bilateral charts: hovering the L value/series fades the R side; vice versa. Returns to normal on mouse-leave. No toggle.
- **Global time-window selector** at the top of each category view: All time / 12 months / 6 months / 3 months. Applies to every chart in the current category at once. Default: All time.

Deferred to Phase E:
- Click-a-point-to-jump-to-session navigation
- Per-chart annotations (e.g. "Started program block 3" markers)
- PDF / print export

### Reversibility note

If we need to swap libraries later (custom force-angle curves for NordBord, hypothetical future requirement), the data layer (`src/lib/testing/resolver.ts` + the chart-data shaping inside each card component) survives. Only the chart rendering components (`<LineChartCard>`, `<BarChartCard>`, etc.) would need to be rewritten. The cost is "one focused refactor sprint", not "rebuild the testing module."

---

## D-002 — Phase D Reports tab IA: category folder model

**Date:** 2026-04-30
**Phase:** Testing module D.1
**Status:** Decided
**Reversibility:** Moderate. The route shape is `/clients/[id]?tab=reports` regardless of internal navigation; switching from folder model to flat list is a component swap, not a routing change.

### Context

The brief §5 specifies a flat list of per-test cards on the Reports tab with category filter chips at the top. With many tests captured per client (a client with CMJ, IMTP, 4 ROM tests, KOOS, body-comp, biomarkers could easily produce 20+ test cards), the flat list becomes a wall.

### Decision

The Reports tab uses a **two-level folder model**:

1. **Top level (default view):** category tiles. One tile per non-empty category for this client. Each tile shows category name, count of tests captured, most recent capture date, and a small status indicator.
2. **Drilled-in view:** click a category tile → enter that category → see the per-test cards for tests in that category only. Breadcrumb back to the category grid.

Filter chips (originally specified in brief §5.1) move to live *inside* a category — filtering by subcategory (e.g. inside Range of Motion, chips for "Hip", "Knee", "Shoulder", "Ankle") rather than by top-level category.

### Trade-offs accepted

- One extra click to reach a test card. Mitigated by the drill-down matching clinical mental model ("today I'm reviewing their force plate stuff").
- Deviates from a literal reading of brief §5.1 (filter chips at the top). Documented here as the deliberate deviation.

---

## D-003 — Phase D per-test cards: per-metric charts inside

**Date:** 2026-04-30
**Phase:** Testing module D.1
**Status:** Decided
**Reversibility:** Easy. Card layout is local to one component file.

### Context

Each test in the schema has 1–N metrics. CMJ has ~5 metrics (jump height, contact time, peak force, RSI, concentric impulse). Knee Flexion ROM has 1 bilateral metric. KOOS has 5 same-shape subscales. The `default_chart` setting is per-metric, not per-test. The brief §5.2 says "one chart per test" which conflicts with the per-metric resolver.

### Decision

**One card per test. Inside the card, one chart per metric** — except when metrics are structurally identical (same `default_chart`, same `unit`, same `direction_of_good`), in which case they render as one combined chart with the metrics as separate series.

Concrete behaviour:
- **CMJ** (5 line metrics): card has 5 line charts in a 2-column grid.
- **Knee Flexion ROM** (1 bilateral metric, asymmetry_bar): card has one chart.
- **KOOS** (5 same-shape bar subscales, all `0–100`, all `higher`): card has one combined bar chart with 5 series. (See Q6b sign-off.)

### Per-metric baseline + %-change badge

Above each chart inside the card: a small numeric badge showing baseline value, baseline date, and %-change from baseline to most recent. The %-change is coloured **green when the change is in the good direction** (per the metric's `direction_of_good`) and **red when the change is in the bad direction**. `context_dependent` direction stays neutral grey. `target_range` direction is green if current is inside the band, amber in caution zone, red outside.

The baseline is **not drawn on the chart as a reference line** — it lives in the badge. This keeps the chart visually clean and works equally for `line`, `bar`, and `asymmetry_bar` types (where a horizontal baseline line would clash visually).

---

## D-004 — Phase D publish flow: dedicated tab surface

**Date:** 2026-04-30
**Phase:** Testing module D.1
**Status:** Decided
**Reversibility:** Moderate. The publish components are reusable; relocating from a dedicated tab to inline panels is a layout change, not a data change.

### Context

For metrics with `client_portal_visibility = 'on_publish'`, the EP must review and choose to publish (or hold back) before the result reaches the client portal. The publish workflow is fundamentally different from the Reports tab review workflow — it's a "review what the client will see" preview, not a clinical analysis surface.

### Decision

A dedicated **`?tab=publish`** surface on the client page (alongside Overview / Notes / Reports / Programs / Schedule). The tab is only visible when there is at least one unpublished `on_publish` session for this client. Otherwise the tab is hidden.

Per unpublished session, the publish surface shows:
- The numeric result(s) for each `on_publish` metric in the session.
- The chart **as the client would see it** — using `client_view_chart`, not `default_chart`. (`milestone` for most, `narrative_only` for some, `bar` for KOOS-style PROMs.)
- An optional `framing_text` input (max 280 chars). The framing text is what the client sees as a clinician comment alongside the chart.
- A Publish / Hold back toggle per session.

Publishing writes a `client_publications` row. Holding back leaves the session unpublished and surfaces it in the dashboard's needs-attention panel.

### Trade-offs accepted

- One additional tab on the client page. Hidden when not needed, so the cost is zero in the no-publish-pending state.
- The capture modal could include a "Review for publishing" link routing here when an on_publish metric was just captured — UX nicety, not a hard requirement.

---

## D-005 — Phase D comparison view: full-page overlay, all sessions by default

**Date:** 2026-04-30
**Phase:** Testing module D.1
**Status:** Decided
**Reversibility:** Easy. Component swap, no data change.

### Context

The brief §5.3 specifies a "Compare sessions" mode for side-by-side delta tables across two or more sessions — used for reassessment write-ups (e.g. initial vs 12-week).

### Decision

A **full-viewport overlay** triggered by a "Compare sessions" button on the Reports tab category-grid header (or inside a category view's header). The overlay opens with **all sessions for this client pre-selected** so the EP sees the full longitudinal picture immediately. The delta table has metrics as rows, sessions as columns chronologically left-to-right, and a rightmost column showing **total %-change from baseline to most recent**. Deselecting sessions narrows the comparison to a focused subset.

The %-change column is always present, with the same direction-of-good colouring as the per-metric badge inside cards (green / red / amber / grey).

### Trade-offs accepted

- Overlay is more component code than a side panel or modal — but the full viewport width is necessary for multi-session delta tables (3+ sessions don't fit in a 600px side panel).
- "All sessions checked by default" means the initial render has more data than a strict "pick what to compare" UX would. Mitigated by the table being sortable/scrollable; deselection is one click per session to narrow.

---

## Phase D Q1–Q9 sign-off (consolidated)

For traceability, the nine decisions made in the Phase D opening session, in the order they were surfaced:

| Q | Decision |
|---|---|
| Q1 | Recharts (D-001) |
| Q1 follow-up | Hover tooltip + hover-to-emphasize for L/R + global time-window selector. No click-to-jump. Annotations + export deferred to Phase E. (D-001) |
| Q2 | One card per test; KOOS-style same-shape multi-metric tests sit in one combined card (D-003) |
| Q3 | Dedicated `?tab=publish` surface (D-004) |
| Q4 | Full-page overlay; all sessions checked by default; %-change always visible (D-005) |
| Q5 | Folder model: category tiles → drill into category (D-002) |
| Q6 | Per-metric chart inside per-test card (D-003) |
| Q6b | Combined chart for KOOS-style same-shape multi-metric tests (D-003) |
| Q7 | Baseline as numeric badge above chart with green/red %-change colouring per `direction_of_good` (D-003) |
| Q8 | Global time-window selector at top of category view; default All time (D-001) |
| Q9 | Comparison overlay defaults to all sessions checked, %-change column always present (D-005) |
