# Library — Sessions & Programs in-Library editors (gap doc)

**Status: gap list / contract — NO code until the operator approves this doc (protocol step 5).**
Phase: post-polish dogfooding loop, structural new-surface work → full seven-step polish protocol + sign-off ritual.
Date opened: 2026-06-24. Build order (operator, 2026-06-24): **Sessions + Programs together, one stacked branch.**
Sibling docs: [`library-circuits-sessions.md`](library-circuits-sessions.md) (Circuits — shipped; the editor pattern this clones; originator of the apply-focused S-1…S-6, now superseded here) · [`library-program-templates.md`](library-program-templates.md) (Programs engine + tab + preview — shipped; the editor it deferred under Q-D is built here).

---

## 0. Decisions taken before this gap list (operator, 2026-06-24)

Two forks were resolved with the operator before writing this contract (the handover's "resolve FIRST"):

- **Architecture = Hybrid (share safe, clone risky).** Extract the leaf prescription atoms (set table, cells, steppers, save-ticks, the two black-slab dropdowns, autosave plumbing) into **one shared module, sourced from `CircuitEditor.tsx`** — Circuits, Sessions, and Programs all import it. **`SessionBuilder.tsx` is NOT touched** (it keeps its inline copy, exactly as today). **Clone only the grouping engine** (solo/superset/section/insert-bar/group-ungroup) from the builder into a reusable day-editor. Rejected: pure cloning (a 3rd diverging copy of the card) and full `DayEditor` extraction (touches the protected differentiator).
- **Programs editor = edit-existing only (v1).** Edit days/exercises/prescriptions inside templates born from a real program via "Save as template". **From-scratch multi-week authoring (week add/remove/reorder) is deferred** until dogfooding proves it's wanted. **Sessions still gets full from-scratch** (it's one day — cheap). Save-from-program already mints templates, so nothing is blocked.

## 1. Brief intent — and the honest scope flag

- **Sessions** — a standalone session/day template library. **The brief (v2.1) is silent on it** (surfaces list §228–232 names exercises + program templates, never a session library; supersets appear only as a builder grouping mechanic). Per CLAUDE.md ("never build features that aren't in the brief without asking first"), **Sessions is an owner-directed extension** — precedent: Circuits and in-app Messaging. Approving this doc is the conscious scope decision; the close-out records it as a deviation, not brief conformance.
- **Programs** — program templates **are** brief §5.2 ("a named, reusable collection of exercises organised into training days… not tied to any client"). The engine, tab, preview, save, and apply are shipped. **The new bit is the in-Library *editor*** — editing a template's content in place, which [`library-program-templates.md`](library-program-templates.md) Q-D explicitly deferred. This is brief-aligned scope, not a deviation.

**The marginal-value line (carried from the circuits doc §1b, still binding):** each new surface must lean hard on reuse, not parallel machinery. Sessions reuses the program-exercise 3-level shape, the circuit RPC patterns, and the extracted atoms. The Programs editor reuses the already-built tables + RLS (no new tables) and the same day-editor as Sessions. If dogfooding shows program-template + copy/repeat already cover the need, the cheaper close is to enrich those — but the operator has directed "build", right-sized.

## 2. Audit — current state (verified 2026-06-24)

| Surface | State | Consequence for this build |
|---|---|---|
| **Circuits** (the template) | Shipped. `CircuitEditor.tsx` (1,672 LOC) is a carbon-copy of the builder card; leaf atoms already isolated there; 3-level tables; copy-on-apply RPCs; anon revoked at creation; pgTAP `39`/`40`. | **A-1 lifts its leaf atoms into a shared module** (low risk — freshly shipped, not the differentiator). |
| **Sessions** | **Pure placeholder.** `LibraryView.tsx:23` has the `sessions` section → `SessionsPlaceholder`; `SessionToolsMenu.tsx:108` "Add session" is a disabled "Soon" stub. **No tables, no actions, no route, no tab.** | **Full build** — new tables + RLS + trigger + apply/save RPCs + tab + editor + builder wiring. |
| **Programs** | Engine + tab + **read-only preview** shipped. Tables are **5-level with a week model** (`program_templates → template_weeks → template_days → template_exercises → template_exercise_sets`; `template_days.sort_order` = weekday offset 0–6). Copy-on-apply, divergence-safe, `rep_metric` threaded. **RLS already permits INSERT/UPDATE on the template tables.** | **Editor only.** Tables/RLS ready → **less new backend** than Sessions (direct RLS writes for edits; RPCs needed only for the soft-delete `deleted_at` trap + duplicate-day). |

**`SessionBuilder.tsx` (2,796 LOC) coupling:** the day-content logic (exercises, supersets, sections, insert bars, sets, reorder) is generic; the client concern (Notes/Reports right panel, `lastLogged` footer) is the differentiator and is **not** coming to the editors. The editors keep only the right-panel **Library picker** (clone of `CircuitLibraryPanel`), never Notes/Reports — protecting the builder's adjacency by not touching it.

**Inversion to keep in mind:** Sessions = more *backend* (new tables); Programs = more *frontend* (weeks × days) but less backend (tables exist). Drives sequencing.

## 3. Premortem (ranked; infra/security at prod-grade, UX/workflow at f&f scale)

| # | Failure mode | Likelihood | Impact | Closed by |
|---|---|---|---|---|
| **FM-A** | **Cross-org leak on the new `session_templates` tables** — missing/incorrect RLS policy exposes another org's sessions. New multi-tenant RLS surface = highest-impact risk. | Med | **High** | S-1 (mirror `circuits`/`program_templates` RLS) + pgTAP cross-org SELECT/insert/trigger |
| **FM-B** | **New SECURITY DEFINER RPCs re-trip the anon-EXECUTE trap** (tripped ≥3× recently — `client_log_set`, `soft_delete_program_template`, the soft-delete family). | **High** | Med | S-3 / P-2 explicit `REVOKE … FROM anon` **at creation** + pgTAP `has_function_privilege` tripwire |
| **FM-C** | **Apply/save corrupts the differentiator** — `apply_session_to_program_day` mangles `superset_group_id` sequencing or order in an existing day, breaking the core screen. | Med | **High** | reuse `insert_circuit_into_day` fan-out shape (fresh superset ids, append after MAX sort_order); pgTAP round-trip |
| **FM-D** | **Divergence violation** — (i) editing a placed copy after apply, or (ii) editing a session/program template silently mutating already-instantiated programs (brief §5.2 clinical-safety rule). | Med | **High** | copy-on-apply (never reference); template→program is one-way (no trigger link — already true); pgTAP divergence assertion both directions |
| **FM-E** | **`rep_metric` dropped in a copy path** → timed/distance prescriptions revert to reps on apply/save/duplicate. | Med | Med | thread `rep_metric` through every copy; pgTAP |
| **FM-F** | **Orphan/RESTRICT gaps** — deleting an exercise referenced by a session/template. | Low | Med | `exercise_id` ON DELETE RESTRICT (as `template_exercises`/`circuit_exercises`); soft-delete; placed = copies, unaffected |
| **FM-G** | **Scope sprawl / >60s to author** — the editor is fiddlier than building the day inline, failing the design-philosophy 60s line. | Med | Med (f&f) | reuse the proven builder card 1:1; save-from-builder shortcut; usability check at `:3000` |
| **FM-H** | **A-1 extraction regresses the circuit editor** — re-pointing `CircuitEditor` to the shared atoms breaks its autosave/drag. *This is the cost of the hybrid — named, not hidden.* | Med | Med | mechanical move + parameterise atoms over persistence callbacks; pgTAP `39`/`40` (data layer) unaffected; `tsc`+`build` gate; operator `:3000` regression pass on circuits before moving on |
| **FM-I** | **The day-editor clone drifts from `SessionBuilder`** over time. *Consciously accepted — the hybrid's chosen trade.* | Med | Low | accept for now; re-trigger = painful drift → revisit full extraction (Q1 alt) |

## 4. Gap list (P-numbers are the build contract)

### Shared (built first — both depend on it)

| # | Gap | Detail |
|---|---|---|
| **A-1 (P0)** | **Extract shared prescription-atoms module.** [FM-H] | Lift the leaf components from [`CircuitEditor.tsx`](../../src/app/(staff)/library/circuits/[id]/_components/CircuitEditor.tsx) into a shared module (proposed: `src/app/(staff)/library/_components/prescription/`): `SetTable`/`SetRow`/`SetCell` (autosave idle/saving/error + `SaveTick`), `SetStepper`, `ExtrasRow`, `SmallField`, `EditableTextarea`, `ColHeader`, `VolumeColumnDropdown`, `MetricColumnDropdown`, slab styles, `IconButton`, `DragHandle`+`DragHandleContext`, `SaveStatusContext`/`SaveStatusPill`. **Parameterise each over its persistence callback** (`onCommit`/`onAdd`/`onRemove`) so the consumer supplies the action — the real work, and the "looks-free-but-isn't" guard. Re-point `CircuitEditor` to import them. **`SessionBuilder.tsx` untouched.** Gate: `build`+`tsc` green, pgTAP `39`/`40` still pass, operator `:3000` confirms circuits unregressed. |
| **A-2 (P1)** | **Reusable `DayContentEditor` component.** [FM-G, FM-I] | The grouping engine **cloned from `SessionBuilder`** (solo cards + superset spine A1/A2 + section strips + between-card insert bars + group/ungroup + @dnd-kit reorder) composed with the A-1 atoms + a right-side **Library picker** (clone of `CircuitLibraryPanel`; **no Notes/Reports**). Client-agnostic: takes an ordered exercise list + a set of action callbacks + library options. Consumed by the Sessions editor (S-5) **and** the Programs editor (P-1) per day. SessionBuilder untouched. |

### Sessions (full build, first)

| # | Gap | Detail |
|---|---|---|
| **S-1 (P0)** | **`session_templates` + children + RLS + trigger.** [FM-A, FM-F] | `session_templates` (org-scoped, `name`, `notes`, soft-delete; **no type enum** — Q-5, a session is a named day) → `session_template_exercises` (mirror `template_exercises`: `exercise_id` **ON DELETE RESTRICT**, `sort_order`, `section_title`, `superset_group_id`, scalar rx cols, soft-delete) → `session_template_exercise_sets` (mirror `template_exercise_sets`: `set_number`, `reps`, `rep_metric`, `optional_metric`, `optional_value`, soft-delete). RLS = `circuits`/`program_templates` Pattern C (org-scoped staff SELECT/INSERT/UPDATE via parent walks; deny DELETE). `session_template_exercise_enforce_exercise_org` trigger (reject cross-org `exercise_id`). **Not audited** (template library, schema.md §11.2 — as circuits/program_templates). |
| **S-2 (P0)** | **Apply + save + soft-delete RPCs** (SECURITY DEFINER, org/role-guarded). [FM-C, FM-D, FM-E] | `apply_session_to_program_day(p_session_id, p_program_day_id)` — **copy-on-apply into an EXISTING day**: append after existing exercises, remap `superset_group_id`→fresh, copy `section_title`, copy scalar + per-set rows, thread `rep_metric` (multi-group + sections vs. `insert_circuit_into_day`'s one group). `save_day_as_session(p_program_day_id, p_name)` — save-from-builder (S-6): copy a real `program_day`'s content into a new `session_template`, remap supersets, dup-name guard. `soft_delete_session_template` / `_exercise` / `_exercise_set` (the `deleted_at` RLS trap). **From-scratch create + edits are direct RLS writes (no RPC)** — mirrors `createCircuitAction`/`addExerciseToCircuitAction`. |
| **S-3 (P0)** | **anon-EXECUTE revoke at creation + pgTAP grant tripwire** on every S-2 RPC. [FM-B] | `REVOKE … FROM anon` in the same migration that creates each fn; `has_function_privilege('anon', …)` assertions in pgTAP `41`. |
| **S-4 (P1)** | **Library Sessions tab.** [FM-A render] | Replace `SessionsPlaceholder` with `SessionsTab` (mirror `CircuitsTab`): card grid (name + exercise/group-count summary), **New session** → create modal → editor, inline rename, soft-delete, click → editor. Loader in [`library/page.tsx`](../../src/app/(staff)/library/page.tsx) fetches `session_templates` (RLS-scoped, soft-deleted filtered) with counts. |
| **S-5 (P1)** | **In-Library Session editor** `/library/sessions/[id]`. | RLS-scoped loader (cross-org → `notFound()`) + the **A-2 `DayContentEditor`** wired to session-template actions (from-scratch authoring: add/remove/reorder/group/section exercises, per-set prescriptions). |
| **S-6 (P1)** | **Save-from-builder + wire the apply stub.** [FM-G, FM-C] | "Save day as session" in the builder's `SessionToolsMenu` (→ `save_day_as_session`); wire the disabled `SessionToolsMenu.tsx:108` "Add session" stub → session-picker modal → `apply_session_to_program_day`. Additive to the builder (no `SessionBuilder.tsx` body change — menu items only). |
| **S-7 (P2)** | **pgTAP `41_session_templates.sql`.** [FM-A/B/C/D/E] | Grant tripwires; cross-org SELECT/insert/enforce-trigger denies; apply copy-on-apply round-trip + `rep_metric` + fresh superset id; divergence (edit session ≠ mutate placed rows); save-day-as-session round-trip. |

### Programs editor (edit-existing only, after Sessions)

| # | Gap | Detail |
|---|---|---|
| **P-1 (P1)** | **Editor route at `/library/programs/[id]`** — subsume the read-only preview. | Existing weeks/days read view (preview content) + per-day **A-2 `DayContentEditor`** for in-place editing. Card menu "Preview" → "Edit/Open". Day management **within existing weeks**: rename / reorder / **add** / remove / **duplicate** a day. **Week add/remove/reorder is out of scope (v1, deferred).** |
| **P-2 (P1)** | **Programs editor backend.** [FM-B, FM-D, FM-E] | Per-day exercise/set/prescription edits = **direct RLS INSERT/UPDATE** on `template_exercises`/`template_exercise_sets` (RLS already permits — audit-confirmed), grouping = UPDATE `superset_group_id`, section = UPDATE `section_title`. New SECURITY DEFINER RPCs (anon-revoked + tripwire): `soft_delete_template_exercise` / `_exercise_set` / `template_day` (the `deleted_at` trap) + `duplicate_template_day` (copy day+exercises+sets, remap supersets, thread `rep_metric` — mirror the existing `duplicate_program_day`). **Editing a template must NOT touch instantiated programs** — already guaranteed (one-way copy, no trigger); pgTAP asserts it. |
| **P-3 (P2)** | **pgTAP `42_program_template_editor.sql`.** [FM-A/B/D] | Grant tripwires on the new RPCs; cross-org denies; soft-delete invisibility; `duplicate_template_day` round-trip + `rep_metric`; divergence (edit template ≠ mutate a program instantiated from it). |

## 5. Open questions — resolved vs. remaining

**Resolved** (operator 2026-06-24 + this audit): architecture = hybrid (§0); Programs = edit-existing v1 (§0); dedicated `session_templates` tables (Q-4); 3-level shape with `superset_group_id`+`section_title` (Q-3); session has no type enum (Q-5); apply = copy-into-existing-day RPC wired to the "Add session" stub (Q-2 secondary); author-in-Library primary (Q-2).

**Resolved mid-build (operator, 2026-06-24) — full parity (a "looks-free-but-isn't" catch):** S-2's "edits = direct RLS writes (mirror circuit)" under-scoped the cloned grouping engine — circuits are one-group/append-only, but `DayContentEditor` cloned the builder's full engine (insert-between bars, multi-group drag, group/ungroup, sections). Per the handover's "surface, default to full parity" rule this was raised; the operator chose **full parity**. So S-2 additionally **clones the builder's two engine RPCs** for sessions — `insert_session_exercise_at` (slot + group-inherit + set fan-out, mirrors `insert_program_exercise_at`) and `reorder_session_exercises` (group re-derivation + section reconcile + singleton cleanup, mirrors `reorder_program_exercises`) — plus the apply/save/soft-delete RPCs; group/ungroup/section-fan-out are TS direct-RLS actions (mirror `groupAcrossActionBarAction`/`ungroupFromSupersetAction`/`updateSectionTitleAction`). The Programs editor (P-1) reuses the same component, so the same backend serves both.

**Remaining (confirm at sign-off — recommendations stated, will proceed as below unless changed):**
- **Doc location** — this combined doc (`library-sessions-programs.md`) vs. extending the two predecessors. **Recommend: this doc** (built together, shared architecture; supersedes the apply-only S-1…S-6 in the circuits doc).
- **Deploy cadence** — **Recommend: two deploys** (ship Sessions → dogfood → ship Programs), per the dogfooding ethos and the circuits Q-1 precedent. Operator's call at ship time.
- **Programs day-management line** — v1 includes add/remove/reorder/duplicate **days within existing weeks**; **excludes week management**. Confirm this is the right edit-existing boundary.

## 6. Sequencing · Acceptance · Out of scope

**Sequencing.** New stacked branch off `master` (`feat/library-sessions-programs`; stack, don't fan). Backward-compatible migrations (new session tables unused by master; new RPCs/columns additive) → `supabase db push` → `npm run supabase:types` → verify, each cluster. New pgTAP files **41+**; new migrations after `20260624120000`.
1. **A-1** (extract atoms + re-point Circuits) → green + circuits unregressed at `:3000`. **A-2** (`DayContentEditor`).
2. **Sessions:** S-1 → push/types → S-2/S-3 → S-4 → S-5 → S-6 → S-7. **Ship + dogfood.**
3. **Programs:** P-1 → P-2 → P-3. **Ship.**

**Acceptance gates** (per entity): tables RLS-scoped + cross-org pgTAP green; anon revoked + grant tripwire green; apply/save/duplicate **copy** (divergence pgTAP green, both directions) + thread `rep_metric`; builder integration doesn't corrupt sequencing; A-1 re-point doesn't regress circuits (`39`/`40` + build); tabs/editors list/create/edit/apply with no lying button; `type-check`+`build` clean; **render-tier accepted at F&F per [`go-live-checklist.md §5b`](../go-live-checklist.md)** (staff-auth-gated → operator `:3000`).

**Out of scope (deliberate; re-trigger noted):** Programs **from-scratch authoring + week add/remove/reorder** (re-trigger: dogfooding shows abstract template design is wanted); **full `DayEditor` extraction / migrating `SessionBuilder` onto the shared atoms** (re-trigger: the builder-vs-day-editor clone drifts painfully — FM-I); cross-org **sharing/marketplace** (brief "no community library"); **AI-suggested** sessions (Phase 2); **client-portal exposure** (templates are staff authoring tools — clients only ever see the resulting assigned program); **Notes/Reports** in the editors (no client context — protects the builder's adjacency by not touching it).

---

*Per the protocol: this is the gap-list contract. No code until the operator approves it (and confirms the §5 remaining items). Approving it is also the conscious decision to extend beyond brief v2.1 for Sessions (§1).*
