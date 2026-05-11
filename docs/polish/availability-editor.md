# Polish-pass gap analysis — Practitioner hours editor (`/settings/availability`)

**Brief:** Settings sub-pass (chat 2026-05-11). The EP needs to author `availability_rules` rows from a UI; "edit via SQL" is the current workflow. Without it the booking picker (Phase F, landed) has no slots to display, so this is the biggest unlock for "could a real client onboard tomorrow?".
**Reference UX (already in repo):**
- Settings sub-route shell — [`settings/tests/page.tsx`](../../src/app/(staff)/settings/tests/page.tsx) (back link + page-head + Section wrapper).
- Settings embedded editor pattern — [`settings/session-types/_components/SessionTypesEditor.tsx`](../../src/app/(staff)/settings/session-types/_components/SessionTypesEditor.tsx) + [`actions.ts`](../../src/app/(staff)/settings/session-types/actions.ts) (validation, error shape, optimistic UI).
- Staff schedule consumer — [`schedule/page.tsx`](../../src/app/(staff)/schedule/page.tsx) lines 77–95 (already reads `availability_rules.day_of_week`, 0=Mon convention).
- Slot consumer — [`client_available_slots`](../../supabase/migrations/20260420102500_client_portal_functions.sql) lines 411–533.
- Soft-delete RPC pattern — [`soft_delete_test_session`](../../supabase/migrations/20260429120000_soft_delete_rpcs.sql) lines 94–125 (the template).
**Schema:** [`20260420102000_scheduling.sql`](../../supabase/migrations/20260420102000_scheduling.sql) lines 25–65.
**RLS:** [`20260420102600_rls_enable_and_policies.sql`](../../supabase/migrations/20260420102600_rls_enable_and_policies.sql) §6 lines 1020–1038 — staff full CRUD in own org. Confirmed.
**Audit:** Currently NOT registered. See gap A0 below — has to be fixed alongside the editor or every save is unauditable.
**Audit date:** 2026-05-11.
**Status:** Gap document — awaiting sign-off before any code changes.

---

## 0. Executive summary

The `availability_rules` table has been correctly modelled since the original scheduling migration: weekly + one-off recurrence in mutually-exclusive form (a CHECK constraint guarantees only one of `day_of_week` or `specific_date` is set), `slot_duration_minutes` per rule (5–240, default 60), optional date-bounded windows via `effective_from` / `effective_to`, soft-delete, time-ordering CHECK, partial indexes for both the staff-rules-list and the slot-generation queries. RLS is staff-only, audit-tight in design. The slot consumer RPC already materialises rules correctly with the established 0=Mon convention. Phase F (booking picker) is wired up and waiting on this data.

What's missing is **the surface that lets the EP put rows in the table**. Today the only way to set hours is `INSERT INTO availability_rules ...` in the SQL Editor — fine for testing, unshippable for production. The schedule page renders nothing meaningful because the table is empty (the schedule's "work-week" derivation falls back to Mon-Fri); the booking picker renders nothing at all.

Three problems also need fixing alongside the editor — none of them visible until you start writing rows in volume:

1. **`availability_rules` has no audit trigger and isn't in `audit_resolve_org_id`.** Privacy Act 1988 healthcare data audit-trail gap. Today writes succeed (no trigger to fail), but every change to who-can-be-booked-when is invisible after the fact. The fix is a one-line trigger + a one-branch addition to `audit_resolve_org_id` — same patch shape as [`20260428110000_audit_register_client_files.sql`](../../supabase/migrations/20260428110000_audit_register_client_files.sql).

2. **Soft-delete via direct UPDATE is broken on this table for the same PostgREST reason it's broken everywhere else.** Setting `deleted_at = now()` returns 42501 because the SELECT policy filters `deleted_at IS NULL` and PostgREST re-selects after the UPDATE. Fix: add `soft_delete_availability_rule(p_id uuid)` to the established `soft_delete_<table>` family.

3. **Two overlapping rules generate duplicate slot rows in `client_available_slots`.** The RPC's `slots` CTE runs `generate_series` per rule independently then UNION ALL — there's no DISTINCT on the final SELECT (lines 509–525). If the EP authors 7am–1pm and 8am–12pm on the same day with 60-minute slots, the picker gets 8:00/9:00/10:00/11:00 listed twice. Today nobody has done this because nobody has authored two rules at all; the moment the editor exists this becomes a real failure mode. Two complementary fixes: a UNIQUE constraint to prevent identical-rule duplication at the data layer, and a `DISTINCT` clause in the RPC to handle the legitimate overlapping-but-different case (e.g., a recurring 8am–5pm weekly + a one-off 10am–11am exception that produces a coincident 10am slot row).

The editor itself is a known shape: settings sub-route at `/settings/availability` (mirrors `/settings/tests`), weekly grid as the primary author surface, secondary panel for one-off exceptions. No new design language. The Steve Jobs bar is "the EP's hours render in the same shape they think about them" — a 7-day grid, not a list of rule rows.

### 0.1 Sign-off log (chat 2026-05-11)

The five locked decisions from the handoff are recorded for traceability. The four audit findings (A0–A3) need explicit yes/no before I write any code.

| # | Question | Recommendation | Status |
|---|----------|----------------|--------|
| **L1** | Primary author surface | **Weekly grid, 7 day columns × time-of-day rows.** One-off exceptions in a secondary panel below — not merged into a unified UI for v1. | Locked |
| **L2** | Slot duration scope | **Per-rule, not per-day.** Default 60 min; override per rule. Matches existing schema column. | Locked |
| **L3** | Multi-staff readiness | **Schema-aware, per-user UI for v1.** Schema + slot RPC already support multi-practitioner; multi-tenant (multi-practice) is already in place at the org boundary. Each user authors their own hours (no owner-on-behalf selector in v1). **Adds A4 below (RLS tightening) so non-owners can't modify another staff member's rules.** | Locked (2026-05-11) |
| **L4** | Effective dates | **Optional in v1.** Default `effective_from = today`, `effective_to = null`. Hide behind a "More options" disclosure unless the EP needs to publish a future schedule. | Locked |
| **L5** | Buffer between bookings | **No explicit buffer for v1.** It's a slot-duration shape (book 50min sessions with 60min rules → effective 10min buffer). Add explicit `buffer_after_minutes` later if requested. | Locked |
| **A0** | `availability_rules` has no audit trigger and isn't in `audit_resolve_org_id`. **Add both in this phase, or defer?** | **Add in this phase.** The migration already exists in scope; this is a one-line trigger + one-branch addition. Deferring leaves a healthcare audit-trail hole. | Awaiting |
| **A1** | Add UNIQUE constraint `(organization_id, staff_user_id, recurrence, day_of_week, specific_date, start_time, end_time) WHERE deleted_at IS NULL`? | **Yes.** Prevents the EP from accidentally creating two identical rules (e.g., double-click on Save). Doesn't block legitimate overlapping-but-distinct rules. NULLs in `day_of_week` / `specific_date` compose correctly with the existing recurrence CHECK. | Awaiting |
| **A2** | Add `DISTINCT` to `client_available_slots` for the legitimate-overlap case? | **Yes.** Tiny patch (`SELECT DISTINCT s.staff_user_id, s.slot_start, s.slot_end ...`); doesn't break anything; means an 8am–5pm weekly rule + a 10am–11am one-off exception produce one 10am slot row, not two. Lands in the same migration as the UNIQUE constraint. | Awaiting |
| **A3** | Settings sub-route at `/settings/availability` (mirrors `/settings/tests`) vs embedded list on the main settings page (mirrors `session-types`)? | **Sub-route.** The weekly grid is a richer canvas than fits inside an embedded list — same reasoning that put `/settings/tests` on its own route. Add a "Practitioner hours" Section on the main settings page with a "Manage hours" link button (mirroring the "Manage tests" pattern at [`page.tsx:222`](../../src/app/(staff)/settings/page.tsx)). | Locked (2026-05-11) |
| **A4** | **Tighten `availability_rules` RLS so non-owners can only modify their own rules.** Currently any staff in the org can UPDATE/DELETE/INSERT any rule. Multi-practitioner correctness gap surfaced when L3 confirmed multi-staff readiness is in scope. | **Yes.** One additional policy clause: `(public.user_role() = 'owner' OR staff_user_id = auth.uid())` on INSERT/UPDATE/DELETE. SELECT stays open within the org (staff seeing colleagues' working hours is benign). Lands in the same migration as A0–A2. | Locked (2026-05-11) |

**Locked 2026-05-11:** A0–A4 yes. Q1 defer (workaround: book yourself an "Unavailable" session-type appointment for blocked days — see `appointments.client_id NOT NULL` note in §6 deferred). Q2 yes, copy as recommended. Q3 click-only. Q4 soft-warn. Q5 Mon→Sun confirmed. Q6 one file.

---

## 1. What's already correct

Pieces of the existing system that align with the target state and stay as-is.

### 1.1 Schema shape — `availability_rules`
[`20260420102000_scheduling.sql`](../../supabase/migrations/20260420102000_scheduling.sql) lines 25–65. The column set, defaults, and constraints are the right shape:

- `recurrence` enum (`weekly` / `one_off`) with the `availability_recurrence_fields` CHECK guaranteeing exactly one of `day_of_week` (weekly) or `specific_date` (one-off) is set. Saves a class of "rule has both day-of-week AND specific-date" bug.
- `slot_duration_minutes smallint NOT NULL DEFAULT 60 CHECK (… BETWEEN 5 AND 240)` — server-side guard on the slider in the form.
- `start_time` / `end_time` of type `time` (not `timestamptz`) is correct: the rule is "every Monday 8am–5pm in the org's local time", not "every Monday 8am–5pm UTC". The slot RPC handles the conversion via `AT TIME ZONE caller_tz` (lines 462–477).
- `effective_from date NOT NULL DEFAULT CURRENT_DATE` and `effective_to date` (nullable) with `availability_effective_range CHECK (effective_to IS NULL OR effective_to >= effective_from)`. The form's date validation just needs to mirror the CHECK.
- `availability_time_ordering CHECK (end_time > start_time)`. Form mirrors.
- Soft-delete column + partial indexes filtering `WHERE deleted_at IS NULL`.

### 1.2 RLS posture
[`20260420102600_rls_enable_and_policies.sql`](../../supabase/migrations/20260420102600_rls_enable_and_policies.sql) lines 1020–1038. Staff full CRUD inside own org, denied to clients. Server actions running as authenticated EP automatically pass — no additional checks needed at the policy layer. The `requireRole(['owner','staff'])` call at the top of every action is a UX gate (which screen renders), not the security boundary; RLS is the security boundary, as documented in [`require-role.ts`](../../src/lib/auth/require-role.ts) lines 13–17.

### 1.3 Slot consumer RPC
[`client_available_slots(p_from, p_to)`](../../supabase/migrations/20260420102500_client_portal_functions.sql) lines 411–533. The materialisation logic is correct:
- Pins to caller's org via `clients.user_id = auth.uid()` (defence-in-depth — works even if JWT claim is stale).
- 90-day range cap.
- `EXTRACT(ISODOW FROM d.d)::int - 1 = day_of_week` resolves the 0=Mon convention.
- `tstzrange(start, end, '[)') && tstzrange(...)` for overlap subtraction — handles boundary edge cases hand-rolled comparisons get wrong.
- Returns `(staff_user_id, slot_start, slot_end)` ordered by `slot_start`.

We will **not** add a v2 alongside it. If A2 lands (DISTINCT), it's a `CREATE OR REPLACE FUNCTION` of the same signature — no client-side change.

### 1.4 Staff schedule already consumes the rules
[`schedule/page.tsx`](../../src/app/(staff)/schedule/page.tsx) lines 77–95 derives the visible work-week from `availability_rules.day_of_week`, falls back to Mon–Fri when no rules exist (which is today's state). Once the EP authors a Tue/Thu/Sat schedule, the schedule grid auto-collapses to those columns. **No change needed in the schedule page** — the data flows in automatically.

### 1.5 Settings shell pattern
[`settings/tests/page.tsx`](../../src/app/(staff)/settings/tests/page.tsx) lines 52–113 — `<ChevronLeft /> Settings` back link, `page-head` block with `eyebrow / h1 / sub`, multiple `<Section title desc>` wrappers each rendering an editor. The local `Section` helper (lines 116–158) is duplicated between this page and `/settings`; we'll duplicate it again in `/settings/availability`. Not worth extracting in this pass — the duplication is shallow and three sites is the threshold for a shared component, not two.

### 1.6 Soft-delete RPC family
[`20260429120000_soft_delete_rpcs.sql`](../../supabase/migrations/20260429120000_soft_delete_rpcs.sql) — `soft_delete_test_session`, `soft_delete_test_result`, `soft_delete_client_publication`, `soft_delete_clinical_note`, `soft_delete_practice_custom_test`, `soft_delete_test_battery`. The pattern is uniform: SECURITY DEFINER + auth check + org check + `UPDATE ... SET deleted_at = now() WHERE id = p_id AND organization_id = caller_org`. We add `soft_delete_availability_rule` following the same shape; no novelty.

### 1.7 Audit-register migration shape
[`20260428110000_audit_register_client_files.sql`](../../supabase/migrations/20260428110000_audit_register_client_files.sql) — the established way to add a new direct-org table to `audit_resolve_org_id`: add the table name to the first WHEN list, leave everything else verbatim. **The latest version of this function is [`20260510120200_audit_resolve_org_id_restore_nested.sql`](../../supabase/migrations/20260510120200_audit_resolve_org_id_restore_nested.sql)** — that's the body to extend, not the original. Memory note: "Audit register new tables".

### 1.8 Phase F booking picker is the consumer that's waiting
The picker at [`portal/book/new`](../../src/app/portal/book/new/) calls `client_available_slots` once and renders. **No change needed in the picker as long as the RPC's signature stays the same.** A2 (DISTINCT) is a body-only change. If A1 (UNIQUE constraint) raises an error on a save attempt, the editor's error path catches it — the picker never sees that error. The two surfaces stay decoupled.

---

## 2. Gaps to close

### P0 — Architectural

| # | Gap | File path | Why it matters |
|---|-----|-----------|----------------|
| **P0-1** | **`availability_rules` has no audit trigger.** [`20260420102300_audit_log_and_triggers.sql`](../../supabase/migrations/20260420102300_audit_log_and_triggers.sql) lines 375–437 lists every audited table; `availability_rules` is absent. AND the table is missing from `audit_resolve_org_id`'s CASE list (latest version: [`20260510120200`](../../supabase/migrations/20260510120200_audit_resolve_org_id_restore_nested.sql) lines 67–82). Two-part fix: attach the trigger AND add the table to the direct-org branch. If we attach the trigger without registering, every save raises `unknown audited table availability_rules` and aborts (this is exactly the failure mode that bit `client_files` and prompted [`20260428110000`](../../supabase/migrations/20260428110000_audit_register_client_files.sql)). | Healthcare audit trail. Privacy Act 1988 expects who-changed-what for any PHI-adjacent record. Hours don't contain PHI directly but they shape the booking surface and an EP changing them silently to "decline this client" is exactly the kind of question the audit log answers. |
| **P0-2** | **No `soft_delete_availability_rule` RPC.** The settings UI's Trash button has to call something. Direct UPDATE returns 42501 by the well-documented PostgREST + soft-delete + RLS interaction (memory note: "Soft-delete UPDATE + RLS gotcha"). | Mirrors the existing `soft_delete_<table>` family. One function, ~30 lines. Without it, the delete button doesn't work and we're back to SQL Editor for removal. |
| **P0-3** | **Duplicate slot rows in `client_available_slots` if rules overlap.** The RPC's `slots` CTE generates one stream per rule then UNION ALL; no `DISTINCT` on the final SELECT (lines 509–525). Today this never fires because there are zero rules; with the editor it becomes a real failure mode. | The picker would render two identical 10:00am tiles. Confusing at best, race-condition-suspect at worst. Cheap fix (one keyword); high confidence boost. |
| **P0-4** | **RLS on `availability_rules` is too permissive for multi-practitioner.** Current policies ([`20260420102600_rls_enable_and_policies.sql:1026-1038`](../../supabase/migrations/20260420102600_rls_enable_and_policies.sql)) let any staff in the org INSERT/UPDATE/DELETE any rule, including another practitioner's. Today this is invisible (single-staff practice); the moment a second practitioner joins it's a foot-gun — they could accidentally delete the owner's hours. SELECT is fine as-is (cross-staff visibility within the practice is benign). | Surfaced when L3 confirmed multi-staff readiness is part of v1. Tighten to: non-owners can only modify rows where `staff_user_id = auth.uid()`; owners stay able to modify anyone's (cleanup / onboarding hand-off). Same migration as A0–A2. |

### P1 — Functional

| # | Gap | File path |
|---|-----|-----------|
| **P1-1** | **Server actions don't exist.** Need `createAvailabilityRuleAction`, `updateAvailabilityRuleAction`, `deleteAvailabilityRuleAction`. Validation: `end_time > start_time`, `slot_duration_minutes ∈ [5,240]`, `effective_to >= effective_from` (when both set), recurrence-fields mutual exclusion. All revalidate `/settings/availability`, `/schedule`, `/portal/book/new` (so the picker refreshes). | New: `src/app/(staff)/settings/availability/actions.ts`. |
| **P1-2** | **Page + components don't exist.** Server-component page that loads existing rules + renders the editor. `WeeklyGrid` is the primary surface — 7 day columns × time-of-day rows; click a cell to start a rule, drag to extend (post-MVP — see Q3 below). `RuleForm` is the per-rule field editor (start/end/duration/effective-dates/notes). `OneOffOverrides` is the secondary list panel for `recurrence='one_off'` rules. AU English copy throughout. | New: `src/app/(staff)/settings/availability/page.tsx`, `_components/WeeklyGrid.tsx`, `_components/RuleForm.tsx`, `_components/OneOffOverrides.tsx`. |
| **P1-3** | **No entry point on the main settings page.** Mirror the "Manage tests" pattern at [`settings/page.tsx:205-226`](../../src/app/(staff)/settings/page.tsx) — add a `Section` titled "Practitioner hours" with a `<Link href="/settings/availability" className="btn outline">Manage hours</Link>`. | Edit: `src/app/(staff)/settings/page.tsx`. |
| **P1-4** | **TypeScript types don't include `availability_rules`'s server-action shape.** The generated `database.ts` already includes the row type, but our `Created/Update Input` types aren't defined. Standard pattern: declare them in `actions.ts` next to the action functions (mirrors `SessionTypeRow` / `CreateSessionTypeInput`). | New types in `actions.ts`. |

### P2 — Polish

| # | Gap | Notes |
|---|-----|-------|
| **P2-1** | Day-column headers use sentence case ("Monday", "Tuesday", …) in Barlow Condensed at the eyebrow size — matches the rest of the design system. Time labels at the row gutters use lowercase `am`/`pm` (`7am`, `1pm`) per CLAUDE.md voice rules. | Sentence case for UI labels rule. |
| **P2-2** | Empty-state when no rules: a quiet `Section`-card body reading "No hours set yet — add your first below." and a primary "Add hours" button. Mirrors the SessionTypesEditor empty state. | "Hours" not "schedule" per AU English glossary in handoff prompt. |
| **P2-3** | Trash icon on a saved rule confirms via `confirm()` ("Delete Mon 8am–5pm? Existing bookings inside this window stay scheduled."). Honest about the consequence — soft-delete doesn't cancel existing appointments. | Plain `confirm()` matches the SessionTypesEditor pattern; modal would be nicer but isn't worth a custom dialog primitive in this pass. |
| **P2-4** | Inline error messages use `var(--color-alert)` at 12px below the offending field. Top-of-section error for non-field-specific failures (e.g., DB connectivity). | Token-driven; mirrors existing pattern. |
| **P2-5** | The "More options" disclosure (effective dates, notes) starts collapsed. Chevron indicator. | Progressive disclosure rule from CLAUDE.md. |
| **P2-6** | Slot-duration field is a numeric input + `min` unit suffix, not a slider. Sliders are imprecise for clinical times; numeric inputs with the CHECK boundary as `min`/`max` are clearer. | "Sensible defaults with override". |

---

## 3. Phasing (sequence within the availability sub-pass)

Architecture before features, features before polish — same pass shape as Phase F.

### Sub-pass 1 — Migration lands first
1. Migration `20260511120000_availability_rules_audit_and_constraints.sql`:
   - Attach `audit_availability_rules` trigger.
   - `CREATE OR REPLACE FUNCTION public.audit_resolve_org_id` with `availability_rules` added to the direct-org WHEN list. **Body extended from [`20260510120200`](../../supabase/migrations/20260510120200_audit_resolve_org_id_restore_nested.sql)** — that's the canonical version, not the original.
   - `CREATE UNIQUE INDEX availability_rules_uniq` partial index `(organization_id, staff_user_id, recurrence, day_of_week, specific_date, start_time, end_time) WHERE deleted_at IS NULL`. (NULLs in `day_of_week`/`specific_date` compose: weekly rule has day_of_week-only, one_off has specific_date-only — never both — so the UNIQUE distinguishes them naturally. Index, not ADD CONSTRAINT, because partial indexes can't be expressed via the constraint syntax.)
   - `CREATE OR REPLACE FUNCTION public.client_available_slots` with the body unchanged except for the final `SELECT DISTINCT` and a comment noting why DISTINCT is there.
   - **DROP** the existing INSERT/UPDATE/DELETE policies on `availability_rules` and recreate them with the per-staff clause: owners can modify anyone's; non-owners only their own. SELECT policy stays untouched.
2. Migration `20260511120100_soft_delete_availability_rule.sql`:
   - `CREATE OR REPLACE FUNCTION public.soft_delete_availability_rule(p_id uuid)` — SECURITY DEFINER, mirrors `soft_delete_test_session`.
3. `supabase db push` against remote (no Docker — see memory note "No local Docker"). User-driven via the prepared SQL Editor block per memory note "SQL Editor copy-paste default" if `db push` is unavailable in this session.
4. `npm run gen:types` (or `supabase gen types typescript`) — regenerate `src/types/database.ts` so the new RPC signatures appear.
5. Verify in SQL Editor: `INSERT INTO availability_rules (...) RETURNING *` succeeds, audit_log row lands with the right org_id, second identical INSERT raises 23505.

### Sub-pass 2 — Server actions
1. `actions.ts` — `createAvailabilityRuleAction`, `updateAvailabilityRuleAction`, `deleteAvailabilityRuleAction` (calls the RPC).
2. Validation helpers (mirrors `normalizeInputs` in `session-types/actions.ts`).
3. `revalidatePath('/settings/availability')`, `revalidatePath('/schedule')`, `revalidatePath('/portal/book/new')`.

### Sub-pass 3 — Page + components
1. `page.tsx` — server component, `requireRole(['owner','staff'])`, query `availability_rules` filtered by `staff_user_id = userId AND deleted_at IS NULL`, group by `recurrence`, pass to client editor.
2. `WeeklyGrid.tsx` — client component, 7 columns × hour rows. v1 interaction: click a cell to open the inline `RuleForm` for a new rule on that day at that hour. Drag-to-extend deferred to v1.1 — clicking the start cell + entering an end time in the form is enough for the EP's first run.
3. `RuleForm.tsx` — start_time, end_time, slot_duration_minutes (default 60), notes, "More options" disclosure for effective_from/effective_to. Inline within the grid cell or below the grid (decided in implementation; both are valid).
4. `OneOffOverrides.tsx` — list of `recurrence='one_off'` rules sorted by specific_date asc. Each row shows date + time range + slot duration + delete. Add-row at the bottom. UI explicitly framed as "exceptions" — overrides the weekly grid for that one date.
5. Add the "Practitioner hours" Section + "Manage hours" link to `/settings/page.tsx`.

### Sub-pass 4 — Verification
1. Open `/settings/availability`, set Mon–Fri 8am–5pm, save.
2. Open the existing dev server at `:3000` (memory note: "Use port-3000 dev server only" — no new previews from worktrees).
3. Navigate to `/portal/book/new` as the test client (per Phase F manual test path); confirm slots render correctly.
4. Add a one-off override: "not available 2026-05-23 9am–10am" (encoded as a one_off rule that *removes* slots is NOT how the schema works — see Q1 below). The intended test is adding a one-off positive rule (e.g., "available 2026-05-23 9am–12pm" for an extra Saturday clinic) and confirming those slots appear in the picker.
5. Inspect audit_log: `SELECT * FROM audit_log WHERE table_name = 'availability_rules' ORDER BY occurred_at DESC` should show the create/update rows with the right org_id.
6. Close the existing rule (delete via the trash icon), refresh `/portal/book/new`, confirm the corresponding slots disappear.

---

## 4. Acceptance bar

The sub-pass is signed off when ALL of the following pass:

- [ ] **Migration applies cleanly.** `supabase db push` lands `20260511120000` and `20260511120100` without warnings; types regenerate.
- [ ] **Audit trail works.** `INSERT INTO availability_rules` writes an audit_log row with non-NULL `organization_id`. `UPDATE` writes a row with `changed_fields` populated. `soft_delete_availability_rule(...)` writes the UPDATE row.
- [ ] **UNIQUE constraint blocks duplicate identical rules.** Insert two identical rows → second raises 23505. The action surfaces a clean message ("That rule already exists").
- [ ] **DISTINCT works in the slot RPC.** With two overlapping rules (8–12 weekly Mon + 9–13 weekly Mon, both 60min slots), call `client_available_slots(monday_morning, monday_evening)` and assert no duplicate `(slot_start, slot_end)` pairs.
- [ ] **RLS tightening blocks cross-staff modification.** SQL Editor test: as a staff (non-owner) user, attempt `UPDATE availability_rules SET end_time='18:00:00' WHERE staff_user_id <> auth.uid()` — returns "0 rows" (silent RLS deny). Same staff updating their own row succeeds. Owner can update either. The action surfaces "no row found" cleanly if it's hit (which it shouldn't be via the UI).
- [ ] **Editor renders correctly at desktop widths (1440px and 768px).** No layout drift, no horizontal scroll.
- [ ] **Save/edit/delete round-trips work.** Edit a rule → page reflects change after `router.refresh()`. Delete → row disappears.
- [ ] **Validation surfaces errors inline, not in console.** `start_time > end_time` shows "End time must be after start time" below the field.
- [ ] **The booking picker still renders.** Open `/portal/book/new`, navigate the steps, confirm slot tiles match the rules just authored.
- [ ] **Schedule view auto-collapses to the new work-week.** If the EP authors Tue/Thu/Sat only, `/schedule` shows three columns instead of five (the existing query at [`schedule/page.tsx:77-95`](../../src/app/(staff)/schedule/page.tsx) already does this).
- [ ] **`grep -nE "'#[0-9a-fA-F]{3,8}'|borderRadius: [0-9]+|boxShadow:" src/app/\(staff\)/settings/availability/` returns zero results** outside of intentional `var(--color-alert)` usage (token compliance — same gate as Phase B used).

---

## 5. Open questions (need sign-off before code lands)

These are not in the locked list. Each needs a yes/no.

**Q1 — Negative one-off overrides ("close this Tuesday").**
The current schema models one-off rules as **positive** ("I am available on this specific date"). There's no `is_blocked` column to model "I am NOT available, override the weekly rule" for a specific date. Three interpretations:
- **A** — Don't model negative overrides in v1. The EP needs to remove their entire weekly rule for that day, then add a one-off positive rule for the surrounding days. Crude but uses zero new schema.
- **B** — Add `is_blocked boolean DEFAULT false` to `availability_rules`; one-off rule with `is_blocked=true` means "subtract this window from the weekly grid". Requires updating `client_available_slots` to handle the subtraction. Modest change.
- **C** — Defer entirely; document as a follow-up; expect the EP to ask for it within a week of launch.
- **Recommended: C for v1, escalate to B as soon as the EP says "I'm closing on the King's Birthday".** Public holidays are the obvious case. But adding it now means a schema migration + RPC change + UI for "block" vs "add"; that's another phase. The polish-pass spirit is "get the editor in, polish the next layer with real EP feedback".

**Q2 — Settings page entry point copy.**
Section title and link button text. Recommend:
- Section title: **"Practitioner hours"** (matches AU English "hours not schedule" rule).
- Section description: **"When you're available for client bookings. Edit the weekly grid and one-off exceptions."**
- Button label: **"Manage hours"** (mirrors "Manage tests").
- Sub-route page title: **"Hours"** (eyebrow "Practice configuration", h1 "Hours", sub "Your availability for client bookings.").

If you'd prefer "Availability" or "Practice schedule" or anything else, say so before sub-pass 3 — copy is cheap to change but easier to write once.

**Q3 — Click-only or click-and-drag in the WeeklyGrid?**
- **Click-only** — clicking a cell opens the RuleForm with start_time pre-filled to that cell's hour. The EP types the end_time. Simpler, mobile-friendlier (though staff is desktop-first), zero pointer-event complexity.
- **Click-and-drag** — drag from a start hour to an end hour to draw the rule visually. Nicer UX, more code, more edge cases (drag past the bottom of the grid, drag to a different day, etc.).
- **Recommended: click-only for v1.** The EP authors hours once a quarter, not daily. Drag is a feature, not a foundation.

**Q4 — Validation: warn on overlapping rules at save time?**
Even with the UNIQUE constraint, two non-identical rules can overlap in time (8am–12pm and 9am–1pm both on Mon). The DISTINCT in the RPC dedupes the slot output, so this isn't a data-integrity bug — but it's almost certainly a user intent bug ("I meant to edit the existing rule, not add a second"). Two paths:
- **A** — Silent: trust the DISTINCT to clean up; let the EP author what they author.
- **B** — Soft-warn at save: "This overlaps with Mon 8am–12pm. Continue?" — non-blocking, lets the EP override.
- **Recommended: B with a "Don't show this again" later if it's annoying.** Surface intent mismatches early, but never block.

**Q5 — Day-of-week display order.**
The convention in the codebase is 0=Mon…6=Sun (Australian + clinical, Sundays as week-end). The grid renders Mon → Sun. Confirm this matches the EP's mental model. (Note: the prototype `program-calendar.html` and the staff schedule WeekView both render Mon→Sun, so this is consistent.) **Recommended: Mon → Sun, no change.**

**Q6 — Where does the migration that includes A0–A2 live in the file tree?**
Three migrations or one? Options:
- **One file** (`20260511120000_availability_rules_audit_and_constraints.sql`) — audit register + UNIQUE + DISTINCT in one transaction. Easier to review, easier to roll back together.
- **Three files** (audit / unique / distinct each on their own timestamp) — small atomic commits, easier to git-blame.
- **Recommended: one file.** They're all "make the editor safe to author rules through". They land or roll back together. The `soft_delete_availability_rule` RPC stays in its own file (`20260511120100`) because it's a separate concern (a function, not a constraint).

---

## 6. Deferred follow-ups

Captured here so they don't get lost. None of these block this sub-pass.

- **AVL-1 — Negative one-off overrides ("close this date").** See Q1. Locked: deferred for v1. Workaround locked 2026-05-11: EP creates an "Unavailable" `session_types` row and books themselves an appointment of that type to cover the unavailable window — the slot RPC's `tstzrange &&` subtraction already removes any overlapping pending/confirmed appointment from the picker. **Implementation note for whoever builds this:** `appointments.client_id` is `NOT NULL REFERENCES clients(id)`. The workaround needs either a sentinel "Practice closed" client row to book against, OR a schema relaxation (nullable `client_id` + a CHECK constraint allowing NULL only for internal/blocking types). Not this phase.
- **AVL-1b — Owner-on-behalf staff selector.** Out of v1 scope per L3. If the owner ever finds themselves wanting to author an employee's hours from their own login (e.g., onboarding a new staff member who isn't tech-confident), add a dropdown at the top of `/settings/availability` visible only to `user_role() = 'owner'`. Staff list query: `SELECT user_id, full_name FROM user_organization_roles JOIN user_profiles USING (user_id) WHERE organization_id = … AND role IN ('owner','staff') AND deleted_at IS NULL`. Schema and RLS already support this — only the UI is missing.
- **AVL-2 — Drag-and-drop in the WeeklyGrid.** See Q3. Defer to v1.1 once the EP has used the click-only UI.
- **AVL-3 — Buffer-between-bookings.** Locked decision L5: not in v1. If requested, add `availability_rules.buffer_after_minutes smallint DEFAULT 0` and update the slot RPC to subtract from the grid generation, not just the appointment subtraction.
- **AVL-4 — Multi-staff staff-selector.** Schema is ready (per L3). UI v1.1+ when a second EP is invited.
- **AVL-5 — `enforce_same_org_fk('user_profiles', 'staff_user_id', 'organization_id')` trigger on availability_rules.** Today there's no DB-side check that the staff_user_id is in the row's org. v1 single-staff UI always sets it to the calling user (which IS in their own org), so safe by construction. v2 multi-staff needs this trigger.
- **AVL-6 — Bulk operations.** "Set Mon-Fri 8-5 in one click" — a template button on first run. Worth having if the EP keeps re-creating the same five-rule set per quarter (effective_from/to). Defer until effective dates are actually being used.
- **AVL-7 — Calendar import (.ics).** Way out of scope for v1; flag as v2-or-later if the EP asks.
- **AVL-8 — Public-holiday-aware defaults.** Auto-block Australian public holidays. Lovely; not v1.

---

## 7. Files this sub-pass will touch (preview)

**New files:**
- `supabase/migrations/20260511120000_availability_rules_audit_and_constraints.sql`
- `supabase/migrations/20260511120100_soft_delete_availability_rule.sql`
- `src/app/(staff)/settings/availability/page.tsx`
- `src/app/(staff)/settings/availability/actions.ts`
- `src/app/(staff)/settings/availability/_components/WeeklyGrid.tsx`
- `src/app/(staff)/settings/availability/_components/RuleForm.tsx`
- `src/app/(staff)/settings/availability/_components/OneOffOverrides.tsx`

**Edited files:**
- `src/app/(staff)/settings/page.tsx` — add the "Practitioner hours" Section + Manage hours link.
- `src/types/database.ts` — regenerated; gains the new RPC signatures + the unchanged `availability_rules` row type.

**Files explicitly NOT touched:**
- `src/app/portal/book/new/**` — Phase F's picker. As long as `client_available_slots` keeps its signature (it does — A2 is a body-only DISTINCT addition), the picker doesn't change.
- `src/app/(staff)/schedule/**` — already consumes the rules correctly.
- All RLS policies on `availability_rules` — staff full CRUD already works.
- `BottomNav.tsx`, `ClientThread.tsx`, anything in `src/app/portal/_components/` — out of scope.

---

## 8. Cross-references

- Brief: handoff prompt chat 2026-05-11.
- CLAUDE.md polish-pass protocol — gap doc is the contract; await sign-off before code.
- Memory notes consulted:
  - "Schema/migration/push correctness" — migration → push → type regen → verify.
  - "No local Docker — work against live Supabase" — `supabase db push` against remote; SQL Editor fallback.
  - "Audit register new tables" — every new tenant table needs adding to `audit_resolve_org_id`'s CASE list, not just a trigger.
  - "Soft-delete UPDATE + RLS gotcha" — direct UPDATE to `deleted_at` returns 42501; RPC family is the fix.
  - "plpgsql function arity evolution" — `client_available_slots` keeps the same signature; no DROP needed for A2.
  - "Supabase migration timestamp collision is silent" — `20260511120000` and `20260511120100` are unused as of this audit (verified against `supabase/migrations/2026051*` glob).
  - "SQL Editor copy-paste default" — if `supabase db push` isn't available in the user's session, the migration is delivered as a fenced SQL block to paste into the Supabase SQL Editor.
  - "Use port-3000 dev server only" — verification uses the existing dev server, no new preview from the worktree.
- Phase F gap doc: `docs/polish/client-portal-booking.md` — sets the picker context this editor unblocks.
- Parent polish pass: `docs/polish/client-portal.md` — the booking picker is row C1 / Phase F there.
