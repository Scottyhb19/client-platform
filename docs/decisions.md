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

---

## D-006 — Visibility model: collapse to per-test publish, keep `never` as a single hard wall

**Date:** 2026-05-01
**Phase:** Testing module D.6
**Status:** Decided
**Reversibility:** Easy at the schema-seed level (re-flip JSON values), moderate for the column drop and resolver simplification (would require a recreate-with-data migration to undo). Pre-launch — no production overrides exist on the dropped column, so the drop carries no data loss.

### Context

D.5 shipped per-test publish UI but kept the three-value visibility model the brief introduced: `auto` (always client-visible), `on_publish` (publication-gated), `never` (clinically walled off). In practice, this meant some test cards (CMJ, IMTP — tests whose metrics defaulted to `auto`) had no publish button at all, while others (KOOS, PROMs — `on_publish` defaults) did. The asymmetry was confusing: the user expected to be able to attach framing context to *any* result before it reached the client, not just the ones the schema happened to mark as `on_publish`.

The user's framing: "all card tiles should have the publish button — but per-metric overrides would be overkill."

Two interpretations were on the table:
- **Option A — UI-only flip.** Keep the three-value enum and seed defaults. Just expand the predicate behind the publish button to include `auto` metrics, so every non-`never` test card gets a publish button. For `auto` metrics the publication adds framing decoration without gating visibility.
- **Option B — collapse the model.** Flip every `auto` metric to `on_publish`. The publish button now means "this becomes client-visible the moment you press it; if you don't press it, the client sees nothing." Stricter, simpler mental model.

### Decision

**Option B.** Every non-Tampa metric is `on_publish`. The publish button is the on/off switch for client visibility — not a framing-decoration layer.

Concretely:
- **Schema seed** (`data/physical_markers_schema_v1.1.json`): 47 `auto` metrics flip to `on_publish`. Two `never` metrics (NordBord force_angle_curve, body composition height) flip to `on_publish` with `client_view_chart` raised from `hidden` to `narrative_only` so the EP's framing reaches the client. Tampa Scale `total_score` keeps `never`.
- **`practice_test_settings.client_portal_visibility` column dropped.** Per-EP overrides for visibility no longer exist; the schema (or custom-test definition) is the single source.
- **`test_metric_visibility()` simplified.** Resolution path is custom → schema → never. The override step is removed.
- **Custom-test builder** hides the Visibility control. New custom-test metrics are saved with `client_portal_visibility: 'on_publish'` server-side.
- **Settings → Tests override editor** drops the Visibility column. Four columns remain: direction, chart, compare, client view.
- **Helper rename**: `testHasOnPublishMetrics` → `testIsPublishable` to match what it gates (the publish button on a test card).

### What this preserves and what it changes

**Preserved:**
- The Tampa Scale hard wall. `never` remains in the enum and the resolver and the RLS policies. Tampa results are not client-visible; no publish button surfaces on the Tampa test card.
- The publish-flow UI. `TestPublishButton` and `TestPublishDialog` from D.5 are unchanged in behaviour — they now just appear on more test cards.
- pgTAP 02 (`never_hard_wall`) — the load-bearing security gate still passes.

**Changed:**
- Capture flow now requires an explicit publish step before the client sees any result. Pre-D.6, capturing a CMJ flowed straight to the client portal (the metrics were `auto`). Post-D.6, capture without publish leaves the result hidden. The trade is one extra click per capture for guaranteed EP-curated visibility.
- Existing per-EP overrides on `practice_test_settings.client_portal_visibility` are dropped via the column-DROP in migration `20260501130000`. Pre-launch — no real data loss.

### Alternatives considered

| Option | Verdict | Reason |
|---|---|---|
| Option A — UI-only flip, keep `auto` semantics | Rejected | Doesn't match "EP pure control" — `auto` metrics still bypass the publish step. Two coexisting semantics for the publish button (gate vs. decorate) make the model harder to reason about. |
| Drop `never` entirely, replace with separate `client_safe: boolean` column | Rejected | Tampa is the only metric that needs the wall; adding a boolean column is more schema surface for one row's worth of behaviour. The existing enum value is load-bearing already and the migration cost of dropping it is non-trivial (Postgres `ALTER TYPE … DROP VALUE` is unsupported; recreating the enum is high-risk). |
| Drop `auto` from the enum at the same time | Rejected | Same Postgres-enum recreate-cost objection. No metric uses `auto` post-D.6, so the value is dead but harmless. Cleanup can happen later if it bothers anyone. |

### pgTAP coverage

- `01_visibility_override.sql` (renamed in spirit, filename unchanged) is rewritten to assert the new resolver semantics: schema-seed value for schema test_ids, custom-jsonb value for custom_-prefixed test_ids, fail-closed on unknown tuples, Tampa wall preserved.
- `02_never_hard_wall.sql` continues to gate the Tampa-Scale RLS wall — unchanged.
- `08_publish_gate.sql` continues to gate the per-test publish lifecycle and isolation guarantees — unchanged.

### Reversibility note

Re-flipping the schema-seed JSON to restore `auto` defaults is a one-PR change. Re-introducing the per-EP override column requires a migration to add the column back and a resolver-function rewrite. None of this is destructive pre-launch; once real client data accumulates, a future override mechanism would need to live alongside the publish gate rather than inside it.

---

## D-PROG-001 — `program_days.scheduled_date` becomes authoritative

**Date:** 2026-05-03
**Phase:** Programs polish, Phase A
**Status:** Decided
**Reversibility:** Easy pre-launch (no client program data exists). Painful post-launch — would require migrating every booked program back to a week-relative model.

### Context

Pre-Phase-A the `program_days` table addressed scheduling indirectly: each row carried `program_week_id` (FK into `program_weeks(week_number 1..N)`) and `day_of_week 0..6` (Mon..Sun). The actual calendar date for any day was computed at render time as `program.start_date + (week_number - 1) × 7 + dow_offset`. This worked for the original "12-week strip" UI but breaks the target UX in [docs/polish/programs.md](polish/programs.md):

- "Copy this Tuesday's session to June 15" requires reverse-mapping a target date back to (week_number, day_of_week). The reverse mapping is ambiguous as soon as the target date falls outside the program's existing weeks.
- "Repeat every Tuesday until June 30" produces N target dates; each must resolve to a (week, day_of_week) slot that may not exist yet.
- The new month-view calendar fundamentally addresses days by date, not by week-of-program.

### Decision

`program_days` carries a date as a first-class field:

- **`program_days.scheduled_date date NOT NULL`** — the authoritative date the day is scheduled for.
- **`day_of_week` is dropped.** Display ("Tue") is derived at render time via `scheduled_date.toLocaleDateString('en-AU', { weekday: 'short' })`. No need to store a derived integer.
- **`program_week_id` becomes nullable.** A `program_week` is now an optional periodisation grouping (accumulation/intensification/deload), not a structural requirement. Days created via day-level copy/repeat may sit outside any week.
- **`program_days.program_id uuid NOT NULL`** is added (denormalised). RLS, the audit-log resolver, and the cross-org trigger all walk through this direct FK instead of `program_days → program_weeks → programs`. Same security model, fewer joins, and works when `program_week_id` is NULL.

### Alternatives considered

| Option | Verdict | Reason |
|---|---|---|
| Keep week-relative model; add presentation layer over it | Rejected | Every copy/repeat code path becomes a date↔(week,dow) translation with edge cases at week boundaries. Cumulative complexity in every future calendar feature. |
| Drop `program_weeks` entirely; make days a flat list per program | Rejected (for now) | Periodisation is a real clinical concept (week 1 = accumulation, week 5 = deload). Keeping the table as an *optional* grouping preserves the option without forcing it. See D-PROG-003. |
| `day_of_week` as Postgres `GENERATED ALWAYS AS (extract(dow from scheduled_date))` column | Rejected | One more moving part for a value that's trivial to compute at render. Generated columns can also surprise — e.g. an INSERT … RETURNING * surfaces them but BEFORE INSERT triggers don't see them mutate. |

### Migration shape

Single migration `20260503100000_program_days_scheduled_date.sql`:

1. Add `scheduled_date date` (nullable initially) and `program_id uuid` (nullable initially).
2. Backfill both from the existing week-relative data:
   - `program_id` from `program_weeks → programs`.
   - `scheduled_date` from `programs.start_date + ((pw.week_number - 1) * 7 + ((pd.day_of_week + 6) % 7))::int` — the `+ 6) % 7` rotates Postgres-Mon=0 / Sun=6 onto Mon-first day-of-week order matching what the existing UI assumes.
3. SET NOT NULL on both.
4. Add FK `program_days.program_id → programs(id) ON DELETE CASCADE`.
5. Make `program_week_id` nullable; relax the FK to `ON DELETE SET NULL` (so deleting a periodisation week doesn't cascade-delete the days).
6. Drop `day_of_week` column and its CHECK constraint.
7. Add index `program_days_program_date_idx ON (program_id, scheduled_date) WHERE deleted_at IS NULL` — the calendar's bread-and-butter query.
8. Drop `program_days_dow_idx` (no longer needed).
9. Update `enforce_program_exercise_same_org()` to walk via `program_days.program_id` directly.
10. Update `audit_resolve_org_id()` CASE branches for `program_days` (use direct `program_id`) and `program_exercises` (one-hop walk via `pd.program_id`).
11. Update RLS policies on `program_days` and `program_exercises` to resolve org via the direct FK.

### Reversibility note

Pre-launch — no production program data exists, so any rollback is just `git revert` + `npx supabase db push`. Post-launch, rolling back means recomputing `(week_number, day_of_week)` from `scheduled_date`, which is mechanical for days that fall inside the original weeks but loses semantic information for days that were created outside any week (e.g., copies onto dates with no `program_week_id`).

---

## D-PROG-002 — Multiple active programs per client allowed; "current" computed from date range

**Date:** 2026-05-03
**Phase:** Programs polish, Phase A
**Status:** Decided
**Reversibility:** Easy pre-launch.

### Context

Pre-Phase-A the schema enforced single-active-program-per-client via a partial unique index:

```sql
CREATE UNIQUE INDEX programs_one_active_per_client_idx
  ON programs (client_id)
  WHERE status = 'active' AND deleted_at IS NULL;
```

This worked when a "program" was singular — one mesocycle running at a time, archived when the next one started. The new "Repeat current block" toolbar action ([docs/polish/programs.md](polish/programs.md) Q5c=B) creates a new program starting on the day the current one ends. Both must coexist with `status='active'`; both must be reachable from the calendar; the day after the boundary, "current" is the new block.

### Decision

Drop the unique-active-per-client constraint. Replace it with a Postgres `EXCLUDE` constraint preventing **date-range overlap** on active programs of the same client (uses `btree_gist`):

```sql
ALTER TABLE programs ADD CONSTRAINT programs_no_active_overlap
  EXCLUDE USING gist (
    client_id WITH =,
    daterange(start_date, start_date + (duration_weeks * 7), '[)') WITH &&
  ) WHERE (status = 'active' AND deleted_at IS NULL AND start_date IS NOT NULL AND duration_weeks IS NOT NULL);
```

"Current" is then computed at query time:

1. Try the program where today's date falls within `[start_date, start_date + duration_weeks * 7)` for this client. If exactly one match → that's current.
2. If today is between programs (previous block ended Apr 30, next starts May 12, today is May 5) → most recent past program is current.
3. If no programs exist → null; UI shows "New training block" CTA only.

### Alternatives considered

| Option | Verdict | Reason |
|---|---|---|
| Keep single-active; auto-archive the current when a new one is created | Rejected | "Repeat current" needs both blocks visible on the calendar and reachable for editing. Auto-archive removes the previous block from the active query, breaking the calendar mid-month. |
| Keep single-active; introduce a new `'scheduled'` status for upcoming blocks | Rejected | Adds a status to track in every existing query. The date-range comparison answers "is this active?" without the application code needing to track status transitions. |
| App-level enforcement of non-overlap (no DB constraint) | Rejected | Bypassing the safety net invites silent inconsistencies. `btree_gist` is available on Supabase managed Postgres (verified). |

### Migration shape

Migration `20260503110000_drop_unique_active_program.sql`:

1. `CREATE EXTENSION IF NOT EXISTS btree_gist;` (idempotent — likely already installed for other features).
2. `DROP INDEX programs_one_active_per_client_idx;`
3. Add the EXCLUDE constraint above.

### Reversibility note

Re-instating single-active is a one-line index recreate, but only safe if no client has accumulated >1 active program by then. Post-launch the migration would have to first archive the second-most-recent active program per client; pre-launch it's a no-op.

---

## D-PROG-003 — `program_weeks` retained as optional periodisation grouping

**Date:** 2026-05-03
**Phase:** Programs polish, Phase A
**Status:** Decided
**Reversibility:** Easy.

### Context

D-PROG-001 makes `scheduled_date` authoritative on `program_days` and `program_week_id` nullable. That raises a follow-on question: what does `program_weeks` mean now?

- The original meaning ("week N of an N-week mesocycle") is no longer load-bearing — the calendar reads dates directly.
- Periodisation is a real clinical concept: an EP may want to label week 5 as "deload" or week 1 as "accumulation". The `program_weeks.notes` field carries that intent.
- Days created via day-level copy/repeat may not belong to any periodisation grouping, hence the nullable FK.

### Decision

Keep `program_weeks` as an **optional periodisation grouping**:

- `week_number` stays as a stable integer label (1, 2, 3…) per program. It's an EP-defined ordering for periodisation grouping, not a calendar-week index.
- The new month-view calendar UI does **not surface week numbers** anywhere. The EP sees real calendar months only.
- `program_weeks.notes` carries periodisation intent (text that the EP can tag/use however they like).
- Days inserted via day-level copy or repeat default to `program_week_id = NULL` (not part of any periodisation grouping). The EP can later assign them to a week via a future periodisation editor (deferred — not Phase A scope).
- `program_days.program_week_id` FK becomes `ON DELETE SET NULL` (deleting a periodisation week leaves the days intact, just unassigned).

### Alternatives considered

| Option | Verdict | Reason |
|---|---|---|
| Drop `program_weeks` entirely | Rejected | Forecloses the option of clinical periodisation labelling. Cheap to retain; no UI surface required in Phase A; future-proof. |
| Auto-compute `week_number` from `scheduled_date` (week-of-program) | Rejected | Disallows EP-defined periodisation that doesn't match calendar weeks (e.g. a 5-day "intro" week). |

### Reversibility note

Dropping `program_weeks` later is straightforward: `DROP TABLE program_weeks CASCADE` after first migrating any periodisation labels into `program_days` (or another structure). No production data is at stake pre-launch.

---

## D-PROG-004 — Empty calendar cells are first-class click targets ("Add session")

**Date:** 2026-05-04
**Phase:** Programs polish, Phase F.0
**Status:** Decided
**Reversibility:** Easy. The change is one component (`MonthCalendar.tsx`) plus a single SECURITY DEFINER RPC; both can be reverted without schema impact.

### Context

Through Phases B–E, the calendar's interaction model treated empty in-month cells as decorative — they rendered as static `.day-cell.empty` divs with no click handler. The only path to add an ad-hoc session was via Copy day, which presupposed an existing source. To insert a one-off session on a previously-blank date, the EP had to: open a programmed day → Copy → pick the blank date as target. Two clicks of indirection for a primary action.

User feedback in Phase F: "you should be able to click any blank date to get the same popover, but with 'Create Session' instead." Direct insertion is a more honest model — every in-month cell on the calendar represents a date the EP can act on.

### Decision

Every in-month cell is interactive in idle mode:

- **Programmed cells** open the existing `DaySummaryPopover` (Open / Copy / Repeat / Delete).
- **Empty in-month cells** open a new `EmptyCellPopover` with:
  - The long-form date (e.g. "Mon, 4 May").
  - If an active block covers the date: "Adds to <BlockName>" + a primary "Add session" button.
  - If no active block covers the date: a quiet "No active training block covers this date." caption (no CTA).

Clicking "Add session" calls a new SECURITY DEFINER RPC `create_program_day(p_client_id, p_target_date)` (migration `20260504100000_create_program_day.sql`) which:

1. Validates caller org/role.
2. Resolves the active program covering the target date via the existing `_program_for_date` helper.
3. Inserts a fresh `program_day` with `day_label = 'A'` and `sort_order = 0`. No exercises.
4. Returns `{status: 'created', new_day_id}` (or `no_program` / `conflict`).

On `created`, the UI navigates straight to `/clients/[id]/program/days/<new_day_id>` so the EP can fill exercises immediately.

### State machine impact

The previous `openDayId: string | null` state in `MonthCalendar` is replaced by a discriminated union `openCell: { kind: 'day', id } | { kind: 'empty', iso } | null`. Single-popover invariant preserved. Past dates remain unrestricted at the cell level — the RPC accepts any date inside an active block, which lets the EP back-fill a missed session on a covered past date if needed.

### Day label default

The new day is created with `day_label = 'A'`. The EP renames it inside the session builder (the label is editable there). Alternatives considered:

| Option | Verdict | Reason |
|---|---|---|
| Default `'A'`, EP renames in builder | **Chosen** | Keeps click-to-create one click. Consistent across split patterns; renamable. |
| Derive next letter from surrounding programmed days | Rejected | Adds complexity (which scope: same week? same program? overall?); ambiguous with multi-block months. |
| Prompt for label in the popover | Rejected | One extra interaction in the primary path. The EP doesn't always know the label until they're filling exercises. |
| Inherit from the most recent prior day | Rejected | Semantically wrong — copying a label without copying intent invites confusion. |

### Alternatives considered (interaction model)

| Option | Verdict | Reason |
|---|---|---|
| Empty cells stay non-interactive; "Add session" lives in toolbar with a date picker | Rejected | Two clicks to reach the date. The calendar IS the date picker — the cell IS the date. Direct manipulation wins. |
| Hover-reveal "+" icon on empty cells | Rejected | Discoverable but visually noisy across 30+ cells. The popover-on-click pattern matches the day-cell behaviour; consistency over signalling. |
| Disable click on past empty cells | Rejected | Constraints on past dates belong in the RPC if anywhere. The EP may legitimately want to back-fill a missed session within an active block. |

### Reversibility note

The RPC, server action, and `EmptyCellPopover` component can be removed and the empty-cell render can revert to its pre-Phase-F static `<div>` shape without schema impact (no column drops needed). The state-machine union can collapse back to `openDayId` mechanically.
