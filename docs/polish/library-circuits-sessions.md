# Library — Circuits & Sessions (gap doc)

**Status: gap list / contract — NO code until the operator approves this doc (protocol step 5).**
Phase: post-polish dogfooding loop, structural work (new surface) → full seven-step polish protocol.
Date opened: 2026-06-23. Build order (operator, 2026-06-23): **Circuits first, then Sessions.**
Sibling doc: [`library-program-templates.md`](library-program-templates.md) (the Programs tab — already shipped).

---

## 0. Context

The Library is a building-blocks container with four tabs: **Exercises** (live), **Circuits** (placeholder), **Sessions** (placeholder), **Programs** (live — item-3 pass). `LibraryView.tsx:110-111` renders `CircuitsPlaceholder` / `SessionsPlaceholder` — static cards with **disabled** "New circuit" / "Save session" buttons (`:134-138`). There is **no backing engine for either**: no `circuits`, `circuit_exercises`, `session_templates`, or `session_*` tables exist (verified against migrations); no "save as session/circuit" affordance exists anywhere in the session builder.

This is the deferred two-thirds of the original item-3 ask ("session/program templates creatable in the Library, **with circuits creatable too**"). Programs shipped because its engine pre-existed (`program_templates` + `save_program_as_template` / `create_program_from_template`, built in the section-5 pass). Circuits and Sessions have nothing underneath, so they are full builds.

## 1. Brief intent — and the honest scope flag

**The brief (v2.1) does not specify Circuits or standalone Session templates.** It specs:
- **§5.1 / §6.6 Exercise Library** — exercises as first-class entities (done).
- **§5.2 Program Templates** — "a named, reusable collection of exercises organised into **training days** (Day A, Day B…), not tied to any client," divergence-safe (done — Programs tab).
- Surfaces list (§ lines 228–232): client profiles, clinical notes, exercise library, program templates, program engine. **No circuits. No session library.**
- Supersets/tri-sets appear *only* as a session-builder/portal **grouping mechanic** (`superset_group_id`), never as a reusable Library object.

**Per CLAUDE.md ("Never build features that aren't in the brief without asking first"), this doc IS that ask.** Circuits and Sessions are an **owner-directed extension** beyond the brief's explicit scope (precedent: in-app Messaging was an owner-approved deviation from brief §6.7). They are not silently absorbed — approving this gap list is the conscious scope decision, and the close-out will record it as a deviation, not a brief conformance.

### 1b. Overlap & marginal-value challenge (the ruthless-mentor part)

Before building two engines, each must earn its existence against what already exists:

| New entity | Already covers most of it | The *genuine* uncovered job (why it earns its place) |
|---|---|---|
| **Circuit** | `superset_group_id` groups exercises inline; `section_titles` stores reusable names | A reusable named group carrying its **exercises + prescriptions**, dropped into any session by name. Reduces repetitive entry (brief principle §"reduces repetitive data entry") for warm-ups/finishers/standard circuits reused across clients. |
| **Session** | A 1-week/1-day **program template** is functionally a saved day; copy/repeat reuse a day *within* one client | Dropping **one** saved day onto an **existing** client's program calendar cell, **cross-client**, pre-filling prescriptions. Program templates only create whole new blocks; copy/repeat never cross clients. |

**Recommendation:** both gaps are real but narrow. Worth building *if* right-sized — and the design must lean hard on reuse (the program-template engine, `insert_program_exercise_at`, the prescription columns incl. the new `rep_metric`) rather than inventing parallel machinery. If in real use the program-template + copy/repeat flows turn out to cover the need, the cheaper close is to enrich those rather than ship two new engines. That call is yours; this doc assumes "build, right-sized."

## 2. Audit — what has to be built

Nothing exists, so the gap is the whole stack for each. Reuse anchors are called out.

**Circuits**
- **Data model:** `circuits` (org-scoped, `name` unique-per-org, `circuit_type`, `notes`, soft-delete) + `circuit_exercises` (mirror `template_exercises`' prescription columns: `sets/reps/rest_seconds/rpe/rep_metric/optional_metric/optional_value/tempo/instructions`, `sort_order`, `exercise_id` **ON DELETE RESTRICT**). Mirror `program_templates` RLS verbatim (org-scoped staff-only SELECT/INSERT/UPDATE, deny DELETE).
- **Create:** Library authoring UI (pick exercises, set prescriptions, name) — and/or "save selected group as circuit" from the builder (Q-2).
- **Use:** an `insert_circuit_into_day(circuit_id, program_day_id, position)` SECURITY DEFINER RPC that **copies** the circuit's exercises into `program_exercises` under a **fresh** `superset_group_id` + seeds `program_exercise_sets` (copy-on-apply, never a live reference — §3 FM-D). Session-builder "Add circuit" entry point next to "+ Add Exercise" / "Superset".
- **Grants:** explicit `REVOKE … FROM anon` + a pgTAP grant tripwire **from day one** (we tripped this trap 3× this session — `client_log_set`, `soft_delete_program_template`, the whole soft_delete family).

**Sessions**
- **Data model — open (Q-4):** **(A, recommended)** dedicated `session_templates` + `session_template_exercises` (clean separation; a session never pollutes the Programs tab), or **(B)** reuse `program_templates` as a 1-week/1-day row flagged `is_session` (max engine reuse — save/clone/`rep_metric`/divergence all free — but sessions leak into program-template queries unless filtered everywhere). Both still need a new **apply** RPC.
- **Create:** "Save day as session" from the builder/calendar (mirrors Programs' save-from-a-real-block) — and/or author from scratch (Q-2).
- **Apply:** `apply_session_to_program_day(session_id, program_day_id)` SECURITY DEFINER — **copies** exercises+sets into an existing `program_day`, threading `rep_metric`, fresh superset ids. Distinct from `create_program_from_template` (which makes a *new program*); this drops into an *existing* day.
- **Grants:** same anon-revoke + tripwire discipline.

**Shared/UI**
- Wire `library/page.tsx` loader to fetch circuits + sessions (RLS-scoped) with usage counts; replace the two placeholders with real tabs (mirror `ProgramsTab` patterns: list, preview, rename, soft-delete, apply).
- `rep_metric` must thread through every copy path (the lesson from this very session — pgTAP 35).

## 3. Premortem (ranked; infra/security at prod-grade, UX/workflow at f&f scale)

| # | Failure mode | Likelihood | Impact | Closed by |
|---|---|---|---|---|
| **FM-A** | **Cross-org leak on the new tables** — a hand-rolled query or missing policy exposes another org's circuits/sessions. New RLS surface = highest-impact multi-tenant risk. | Med | **High** | C-1/S-1 (mirror `program_templates` RLS) + pgTAP cross-org SELECT (like `36 §A1`) |
| **FM-B** | **New SECURITY DEFINER RPCs re-trip the anon-EXECUTE trap** (proven recurrent this session). | **High** | Med | C-3/S-3 explicit anon revoke + pgTAP grant tripwire at creation |
| **FM-C** | **Builder integration corrupts the differentiator** — insert-circuit / apply-session mangles `superset_group_id` sequencing or a day's order, breaking the core screen. | Med | **High** | reuse `insert_program_exercise_at` fan-out + per-set pairing; pgTAP round-trip (like `21`/`35`) |
| **FM-D** | **Divergence violation** — editing a library circuit/session mutates already-placed instances (the brief §5.2 clinical-safety rule: retroactive changes to active programs are dangerous). | Med | **High** | copy-on-apply (never reference); pgTAP divergence assertion (like `21 §E1`) |
| **FM-E** | **`rep_metric` dropped in the copy paths** → timed/distance prescriptions silently revert to reps when applied. | Med | Med | thread `rep_metric` everywhere; pgTAP (extend `35`) |
| **FM-F** | **Orphan/RESTRICT gaps** — deleting an exercise referenced by a circuit, or a circuit that's been placed. | Low | Med | `exercise_id` ON DELETE RESTRICT (as `template_exercises`); soft-delete circuits; placed = copies, unaffected |
| **FM-G** | **Scope sprawl / >60s to author** — the create flow is fiddlier than just building the day inline, so the feature adds complexity without saving time (fails the design-philosophy 60s line). | Med | Med (f&f) | right-size; "save from builder" path; usability check at review |

## 4. Gap list (grouped; P-numbers are the build contract)

**Circuits (built first)**
- **C-1 (P0)** `circuits` + `circuit_exercises` tables + org-scoped RLS (mirror `program_templates`). [FM-A]
- **C-2 (P0)** `insert_circuit_into_day` SECURITY DEFINER copy-on-apply RPC (fresh superset id, seed sets, thread `rep_metric`). [FM-C, FM-D, FM-E]
- **C-3 (P0)** anon-EXECUTE revoke + pgTAP grant tripwire. [FM-B]
- **C-4 (P1)** Library Circuits tab: list + structure summary + usage count + soft-delete + rename (reuse `ProgramsTab` patterns). [FM-A render]
- **C-5 (P1)** Create-a-circuit flow (per Q-2). [FM-G]
- **C-6 (P1)** Session-builder "Add circuit" entry point → `insert_circuit_into_day`. [FM-C]
- **C-7 (P2)** pgTAP suite: cross-org SELECT, grant, copy-on-apply round-trip, divergence, rep_metric. [FM-A/B/C/D/E]

**Sessions (after Circuits)**
- **S-1 (P0)** session storage + RLS (Q-4: dedicated tables vs program_templates reuse). [FM-A]
- **S-2 (P0)** `apply_session_to_program_day` copy-on-apply RPC. [FM-C, FM-D, FM-E]
- **S-3 (P0)** anon revoke + pgTAP tripwire. [FM-B]
- **S-4 (P1)** Library Sessions tab (list/preview/rename/soft-delete/apply). [FM-A]
- **S-5 (P1)** "Save day as session" from the builder/calendar (per Q-2). [FM-G]
- **S-6 (P2)** pgTAP suite (mirror C-7). [FM-A/B/C/D/E]

## 5. Open questions (the brief is silent — these gate the build)

- **Q-1 — Build both, or validate Circuits first?** Recommend: build Circuits fully, ship it, *use it*, and let real use confirm Sessions is still wanted before building S-*. (Dogfooding ethos; avoids two speculative engines at once.)
- **Q-2 — Create path.** Author-from-scratch in the Library, "save from the builder" (mirrors Programs), or both? Recommend: **save-from-the-builder first** (you're already in the flow; lowest new UI; matches the Programs pattern), author-from-scratch later if needed.
- **Q-3 — What a circuit stores.** Exercises + grouping only, or + default prescriptions (sets/reps/rest/RPE/rep_metric)? Recommend: **+ prescriptions** (that's the repetitive-entry it saves).
- **Q-4 — Session storage.** Dedicated `session_templates` tables (recommended — clean) vs reuse `program_templates` as 1-day (max reuse, but bleeds into Programs queries)?
- **Q-5 — Circuit type.** Fixed enum (superset/tri-set/circuit/finisher/warm-up) or free? Affects how it groups on insert.

## 6. Sequencing · Acceptance · Out of scope

**Sequencing.** Circuits: C-1 → C-2 → C-3 (migration + RPC + grants, push, regen types, pgTAP) → C-4/C-5/C-6 (UI + builder) → C-7. Then **stop, ship, dogfood** (Q-1) before Sessions S-1…S-6. Stacked branch off `master`; backward-compatible migrations (shared dev/prod DB).

**Acceptance gates.** Per-entity: tables RLS-scoped + cross-org pgTAP green; anon revoked + grant tripwire green; apply **copies** (divergence pgTAP green) and threads `rep_metric`; builder insert doesn't corrupt sequencing; Library tab lists/creates/applies with no lying button; `type-check`+`build` clean; render-tier accepted at F&F per [`go-live-checklist.md §5b`](../go-live-checklist.md).

**Out of scope (unless raised):** circuit/session **marketplace** or sharing across orgs (brief §"no community library"); AI-suggested circuits (Phase 2); reordering/editing a *placed* instance differently from the library copy beyond what the builder already allows; client-portal exposure (circuits/sessions are authoring tools — the client only ever sees the resulting program).

---

*Per the protocol: this is the gap-list contract. No code until the operator approves it (and resolves Q-1…Q-5). Approving it is also the conscious decision to extend beyond brief v2.1's explicit scope (§1).*
