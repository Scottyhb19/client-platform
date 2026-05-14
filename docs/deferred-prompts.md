# Deferred prompts

A working file of tracked-but-not-yet-resolved scope and design decisions. **Not a contract.** Items here are still under consideration; some will be promoted into a phase plan or closed without action.

When an item is closed:
- If it landed in the codebase, link the commit / PR and remove the entry (the change itself is the record).
- If it was rejected, leave a one-line note here so the decision isn't relitigated.

When an item lands as a phase plan, link the relevant section in `docs/polish/<section>.md` and remove the duplicate detail from this file.

---

## Testing module — practice_custom_metrics (metric-on-existing-test)

**Surfaced:** 2026-05-01 during D.2 polish (negative-value bug + missing path to attach a metric to an existing test like CMJ).

**Problem.** The custom-test builder at Settings → Tests → Custom tests creates whole new tests. There's no path for the EP to add a metric *inside* an existing schema test. Workaround today: create a one-metric custom test for the new metric — but that produces a separate tile in the Reports tab when the metric should sit beside the parent test's other metrics.

**Decisions taken (signed off, not yet implemented):**

| Choice | Decision |
|---|---|
| Architecture | New `practice_custom_metrics` table keyed on `(organization_id, test_id, metric_id)`. `test_id` may point to a schema test (`cmj`) OR a custom test (`custom_xxx`). Resolver and catalog loader merge at read time. |
| UI placement | Mode toggle inside the existing Custom Tests section: "Create new test" vs "Add metric to existing test". Same metric form, different first step. |
| Existing data | User will manually delete the standalone "Eccentric peak velocity" custom test and recreate the metric inside CMJ via the new flow once it lands. No in-place migration tool needed. |
| Scope/sequencing | Bundled after Phase D.4 (publish flow) lands. Hotfix for the negative-value bug shipped first as D.2.1. |

**Implementation outline (when it lands):**

1. Migration — `practice_custom_metrics` table, RLS (same shape as `practice_custom_tests`), unique `(organization_id, test_id, metric_id) WHERE deleted_at IS NULL`, FK soft-delete cascading via the existing audit trigger pattern.
2. Audit register — add to `audit_resolve_org_id()` CASE list (per project memory `audit_register_new_tables`).
3. Soft-delete RPC — `soft_delete_practice_custom_metric` (matches existing pattern in migration `20260429120000`).
4. Resolver — `resolveMetricSettings` and `resolveMetricSettingsBulk` walk: schema seed OR custom test (existing), THEN check `practice_custom_metrics` for an org-level addition keyed on the same (test_id, metric_id). Custom metrics on schema tests use the schema test's labels (category, subcategory, test_name) but their own metric label/unit/hints.
5. Catalog loader — `loadCatalog` joins `practice_custom_metrics` and appends to the appropriate test's metric array.
6. Custom-test builder UI — toggle at top of the section. "Add metric" mode shows a parent-test picker (search across schema + custom tests, force-expand on filter, same UX as the saved-batteries picker), then the metric form below.
7. Test history loader — `loadTestHistoryForClient` already groups by test_id; custom-on-existing metrics will appear inside the parent test card automatically once the resolver returns the right test_name.
8. pgTAP — extend `01_visibility_override.sql` (or new test) to assert custom metrics on a schema test_id resolve correctly and inherit RLS visibility from the parent test.

**Why deferred:**
- D.2 polish-pass scope: ship the IA + charts + publish flow before adding new authoring surfaces.
- The negative-value blocker is unblocked by the D.2.1 fallback hotfix; the architectural change isn't urgent.
- Pre-launch advantage: schema migration cost is still low when this lands. No reason to rush.

---

## Calendar copy/repeat: per-set fan-out fix

**Surfaced:** 2026-05-08 during session-builder Phase I sign-off (Q5).

**Problem.** `copy_program_day` (migration `20260503120000`) and `repeat_program_day_weekly` (same migration) were written before per-set storage landed in session-builder Phase C (`20260507100000_program_exercise_sets`). Both RPCs:

1. Insert into the legacy scalar columns on `program_exercises` (`sets`, `reps`, `optional_metric`, `optional_value`, `rpe`) — fine in itself, those columns are still present.
2. **Do NOT fan out `program_exercise_sets`.** Any day created via the calendar's day-level copy or weekly repeat flow comes out with zero per-set rows in the new shape.

The page loader for the session builder reads `prescription_sets` (the new shape) and ignores the legacy scalars, so the duplicated day renders with **empty set rows** even though the source had non-empty prescriptions. The portal RPC `client_get_program_day_exercises` (v2 from `20260507100100`) returns `prescription_sets jsonb` from the new table, so the client portal also sees an empty day.

The session-builder Phase I duplicate flow (`duplicate_program_day` migration `20260508100000`) does fan out per-set rows correctly — it was a new RPC built on top of the per-set shape. The two calendar RPCs are the gap.

**Fix outline.**

1. New migration that updates `copy_program_day` and `repeat_program_day_weekly` (CREATE OR REPLACE — function signatures don't change). After the existing `INSERT INTO program_exercises ... RETURNING id, sort_order` step in each, add the same per-set fan-out CTE pattern from `duplicate_program_day`'s migration §2:
   ```sql
   INSERT INTO program_exercise_sets (
     program_exercise_id, set_number, reps, optional_metric, optional_value
   )
   SELECT cloned.id, src_set.set_number, src_set.reps,
          src_set.optional_metric, src_set.optional_value
     FROM <cloned-CTE> AS cloned
     JOIN program_exercises src_pe
       ON src_pe.program_day_id = p_source_day_id
      AND src_pe.deleted_at IS NULL
      AND src_pe.sort_order = cloned.sort_order
     JOIN program_exercise_sets src_set
       ON src_set.program_exercise_id = src_pe.id
      AND src_set.deleted_at IS NULL;
   ```
   `repeat_program_day_weekly` runs the loop body once per target date, so the fan-out has to land inside the WHILE loop after each per-date insert.
2. No types regen needed (function signatures unchanged).
3. Backfill consideration: any days already created by these RPCs since per-set storage landed (2026-05-07) currently have zero per-set rows. Pre-launch the practical impact is zero (no real client data yet) — recommend NOT backfilling. The next time the EP opens such a day in the session builder, they'll see empty sets and add the correct prescription, which becomes the new source of truth.
4. pgTAP — add a test that calls `copy_program_day` and `repeat_program_day_weekly` against a fixture with multi-set exercises, then asserts `program_exercise_sets` rows on the cloned day match the source 1:1 (count, set_number, reps, optional_metric, optional_value).

**Why deferred from Phase I.** Phase I was scoped to the session builder's Duplicate button (a new RPC). Touching the calendar's RPCs is out of scope for the session-builder polish pass — it belongs in the programs polish pass (`docs/polish/programs.md`). It's a one-migration fix, ~30 minutes once started.

**Self-contained prompt for a fresh chat:**

> Fix per-set fan-out in `copy_program_day` and `repeat_program_day_weekly`. Both RPCs (defined in `supabase/migrations/20260503120000_program_days_copy_repeat.sql`) clone the day + program_exercises but don't fan out `program_exercise_sets` — so calendar copies/repeats land with empty set rows in the post-Phase-C per-set shape. The session-builder `duplicate_program_day` RPC (migration `20260508100000_duplicate_program_day.sql`) shows the correct pattern: a CTE-with-RETURNING `cloned`, then `INSERT INTO program_exercise_sets SELECT … FROM cloned JOIN program_exercises src_pe ON sort_order JOIN program_exercise_sets src_set ON program_exercise_id`. Apply the same pattern inside `copy_program_day`'s body and inside the per-iteration block of `repeat_program_day_weekly`'s WHILE loop. CREATE OR REPLACE — signatures don't change. No types regen needed. Add a pgTAP test asserting per-set rows clone 1:1. Don't backfill existing data (pre-launch — no real client data). Reference: `docs/deferred-prompts.md` "Calendar copy/repeat: per-set fan-out fix".

---

## Staff Reports — Category ↔ Test Battery view toggle (future Phase M)

**Surfaced:** 2026-05-14 during client-portal Phase J-1 sign-off. **Refined and partially scoped:** 2026-05-14 mid-Phase-J-2 after live test surfaced the design gap.

**Idea.** Add a view-mode toggle on the staff Reports surfaces that flips between two organisations of the same underlying test_results:

- **Category view** (today's staff `ReportsTab.tsx` — category → subcategory → test cards with time-series charts). Primary lens: *"how has this metric trended over time."* Already built.
- **Test Battery view** (new). Primary lens: *"how does this whole assessment shape up over its repetitions?"* Tests grouped by saved battery template (from Settings → Tests → Saved batteries). Each battery is itself the recurring unit; the sessions where the battery was applied are listed underneath chronologically.

**Surfaces in scope:**

1. **Staff client-profile Reports tab** — `src/app/(staff)/clients/[id]/_components/ReportsTab.tsx` + the whole `_components/reports/` family (`CategoryGrid`, `CategoryDetail`, `TestCard`, `MetricBadge`, charts).
2. **Staff session-builder right-rail Reports panel** — `src/app/(staff)/clients/[id]/_components/ReportsPanel.tsx`. Today this is published-per-test list only; adding the Category view would let the EP review a metric's trend from inside the program builder without leaving the session.

**Explicitly NOT in scope:** the client portal. Phase J locks the client portal to session-grouped only — the toggle is an EP-control feature. Adding it to a behaviour-change client surface creates clutter the client doesn't need.

**Decisions signed off** (chat 2026-05-14 mid-J-2):

| Q | Decision | Notes |
|---|---|---|
| Q-J11 | Phase J ships only the minimal session-tagging affordance (J-2-γ, `TestPublishDialog`). The full toggle becomes its own **Phase M**. | Keeps Phase J focused on portal Data tab; toggle gets dedicated gap-doc cycle. |
| Q-J12 | Tests captured outside any saved battery render as a **pseudo-group at the bottom of the Battery view named "Not in a saved battery"** — visually distinct (italic header or lighter weight) so the metaphor stays honest. Same tests also live in Category view. | Avoids the "junk drawer" problem by making the gap visible — EP can fix it by tagging or by creating a new saved battery. |
| Q-J13 | Per-battery card has a **sub-toggle**: **Sessions** (clickable session-row list, drill into per-session detail) ↔ **Progression** (per-test cross-session charts filtered to this battery's applications). | Matches "progression over time of that repeated testing battery" most literally, with a session-list fallback for the audit-trail use case. |

**Decisions still open** (raise in Phase M's gap doc):

- Where the toggle lives on the client profile — page-level vs Reports-tab-local.
- Does the session-builder rail's toggle need its own state or follow the profile's?
- Sticky-per-EP via a `practice_preferences` row, or local state only?
- The Sessions sub-view inside a battery card: drill-in pattern (overlay, route, expand-in-place)?
- The Progression sub-view: reuse `ChartFactory` from existing Category view, or specialised "battery-progression" rendering?
- Should the pseudo-group "Not in a saved battery" be collapsible or open by default?

**Prerequisite (lands in Phase J as J-2-γ):** `TestPublishDialog` gets a "Applied battery" select that UPDATEs `test_sessions.applied_battery_id`. Without this, sessions captured without a battery template stay un-tagged and orphan into the pseudo-group permanently. Phase M's Battery view is meaningful only because sessions can be tagged.

**Why Phase M (not bundled into Phase J):** Phase J's portal scope is the priority; the staff toggle is a structural redesign of the staff Reports tab that warrants its own gap-doc cycle. Bundling would 2x the J effort and dilute the polish-pass focus.

**Self-contained prompt for a fresh chat:**

> Build the staff Reports tab Category ↔ Test Battery view toggle (Phase M). **In scope:** (1) `src/app/(staff)/clients/[id]/_components/ReportsTab.tsx` + the `_components/reports/` family, (2) `src/app/(staff)/clients/[id]/_components/ReportsPanel.tsx` in the session-builder right rail. **Out of scope:** client portal. **Prerequisite:** J-2-γ tagging affordance must be live (so `test_sessions.applied_battery_id` is reliably populatable). **Sign-offs already locked** (see `docs/deferred-prompts.md` "Staff Reports — Category ↔ Test Battery view toggle"): orphan rendering as a pseudo-group at the bottom named "Not in a saved battery" (Q-J12); per-battery sub-toggle Sessions ↔ Progression (Q-J13). **Likely reuse:** `groupHistoryBySession`, `pointAtSession`, `valuesAtSession` from `src/lib/testing/comparison.ts`. **Decisions to surface in Phase M's gap doc** before code: toggle placement on each surface, sticky vs local state, drill-in pattern for the Sessions sub-view, Progression chart reuse vs specialised. Polish-pass protocol: gap doc at `docs/polish/staff-reports-view-toggle.md` before any code.

---
