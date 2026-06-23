# Polish-pass gap analysis — Library: Programs tab (program templates)

**Trigger:** Dogfooding capture (operator, 2026-06-23) — "For the sessions, you should be able to create session templates within there, not just from the session builder, same goes for the program templates." This doc covers **only the Programs tab** — phase 1 of the operator's "Programs first, phased" decision (2026-06-23). **Sessions** and **Circuits** are separate phases with their own gap docs.

**Classification:** **Structural** (lights up a dormant Library surface) → full seven-step polish-pass protocol + sign-off ritual. The good news, established in recon: the program-template **engine already exists** — this phase is mostly UI over it plus one small RPC.

**Brief refs:** [`Client_Platform_Brief_v2.1.docx`](../../Client_Platform_Brief_v2.1.docx) §6.6 (Library — building blocks: exercises / circuits / sessions / programs), §5.2 (program templates).
**Current implementation:**
- Library shell — `src/app/(staff)/library/_components/LibraryView.tsx:9-16` (four-tab shell), `:172-179` (Programs **placeholder**), `:116` (header button **disabled**)
- Template engine (already built, 2026-06-12) — tables `program_templates → template_weeks → template_days → template_exercises → template_exercise_sets`; RPCs `save_program_as_template`, `create_program_from_template` ([`20260612120000_program_templates_lifecycle.sql`](../../supabase/migrations/20260612120000_program_templates_lifecycle.sql))
- Save wired — `src/app/(staff)/clients/[id]/program/_components/ProgramToolbar.tsx` → `saveProgramAsTemplateAction` (`program-actions.ts:166-196`)
- Instantiate wired — `src/app/(staff)/clients/[id]/program/new/page.tsx` + `new/actions.ts` (calls `create_program_from_template`)
**Audit date:** 2026-06-23
**Status:** Gap list — awaiting sign-off before any code changes.

---

## 0. Executive summary

The Programs tab is a **disabled placeholder**, but the engine beneath it is fully built and in daily use from two other surfaces:
- **Create** a template — "Save as template" in the program calendar toolbar snapshots a client's training block (weeks, days, exercises, per-set rows) into `program_templates`.
- **Apply** a template — "Start from template" in `program/new` instantiates it for a client on a start date, with overlap handling.

What's missing is the **management surface** the brief promises in the Library: you can mint templates but you can't **see, preview, rename, or delete** them anywhere, and you can only **apply** one while creating a new program (not from the Library). So templates accumulate invisibly and a bad one can never be cleaned up.

This phase lights up the Programs tab as that management surface. It is **not** a from-scratch template authoring tool — a program template is born from a real program via "Save as template" (that's the right model: you build it once for a real client, then reuse it). The misleading disabled **"New program"** button in the tab header should go, replaced with guidance.

**One correction to the capture's mental model:** templates today are *program*-granular and created from the *program calendar*, not the session builder. "Create program templates in the Library" = surface listing/preview/rename/delete/apply here; the authoring act stays "Save as template" from a real program. (Single-session templates are the separate **Sessions** phase.)

---

## 1. What's already correct (preserve)

1. **The full engine.** `save_program_as_template` / `create_program_from_template` clone weeks + days + exercises + **per-set rows** with superset remapping — instantiation reproduces the source exactly. No rebuild.
2. **RLS + audit.** `program_templates` (+ weeks/days/exercises) are org-scoped and registered in `audit_resolve_org_id()` (`20260503100000:207-217`). Reads/writes are already tenant-safe.
3. **FK safety on delete.** `programs.template_id REFERENCES program_templates ON DELETE SET NULL` — soft-deleting a template never orphans or breaks a program instantiated from it.
4. **The four-tab shell + composable atoms** (`CardMenu`, `ConfirmDialog`, the card grid) — reuse the exercise-library patterns wholesale.

---

## 2. Premortem — ranked failure modes

Weighting per protocol: data-integrity/RLS at production grade; EP-facing UX at friends-and-family scope.

| # | Failure mode | Likelihood | Impact | Closed by |
|---|---|---|---|---|
| **FM-1** | **Soft-delete hits the RLS UPDATE trap.** Setting `deleted_at` via a direct UPDATE fails `42501` against the `deleted_at IS NULL` SELECT policy (project memory). No `soft_delete_program_template` RPC exists. | Certain (if delete built as UPDATE) | High — delete silently fails | LPT-1 |
| **FM-2** | **Apply-from-Library drops overlap handling.** `create_program_from_template` returns `status='overlap'` when the date collides with an active block. A naive Library "Use" button that ignores it leaves the EP with an unexplained no-op. | High | Medium | LPT-4 |
| **FM-3** | **Templates accumulate with no management.** Without rename/delete, a mis-saved or duplicate template ("Lower (copy) (copy)") clutters the picker forever and risks being applied by mistake. | Certain over beta life | Medium | LPT-5, LPT-6 |
| **FM-4** | **Delete with no usage context.** Deleting a template that programs were instantiated from is safe (FK SET NULL) but the EP can't see "3 clients started from this" before deciding. | Medium | Low-medium | LPT-6 |
| **FM-5** | **"New program" button lies.** The disabled header button implies you author a template from scratch in the Library; you don't. Mirrors the exercise-library "lying affordance" finding. | Certain (present now) | Low — trust | LPT-7 |
| **FM-6** | **Preview leaks or mis-scopes.** A template preview that re-queries without RLS-safe scoping could show another org's structure. (RLS already covers; the risk is a hand-rolled query bypassing it.) | Low | High | LPT-3 |

---

## 3. Gap list

### P0 — architectural

| # | Gap | Detail |
|---|---|---|
| **LPT-1** | **`soft_delete_program_template` RPC.** (FM-1) | SECURITY DEFINER, in-body owner/staff + org check, soft-delete UPDATE, `NOT FOUND` raise — mirror `soft_delete_exercise` ([`20260505100000`](../../supabase/migrations/20260505100000_soft_delete_library_rpcs.sql)). The children (weeks/days/exercises/sets) stay (the template row's `deleted_at` hides the whole tree from the list/picker queries, which already filter it). pgTAP per LPT-8. |

### P1 — functional

| # | Gap | Detail |
|---|---|---|
| **LPT-2** | **Programs tab — list.** Replace `ProgramsPlaceholder` with a real grid: each template card shows name, structure summary (`N weeks · M days · K exercises`), created date, and how many programs were instantiated from it. Org-scoped, excludes soft-deleted. Server-fetched in `library/page.tsx` (parallel with the exercises fetch). |
| **LPT-3** | **Template preview.** (FM-6) | Read-only structural preview (weeks → days → exercises) via the user's RLS-scoped session — a panel or `/library/programs/[id]` route. No edit in this phase. |
| **LPT-4** | **Apply to a client from the Library.** (FM-2) | "Use template" → pick client + start date → `create_program_from_template`, surfacing `created` / `overlap` (name the colliding block, reusing the `BlockConflict` shape) exactly as `program/new` does. |
| **LPT-5** | **Rename.** | Direct UPDATE of `name` (not `deleted_at`, so no RPC needed — same reasoning as `archiveProgramAction`). Inline edit or a small dialog; dup-name guard consistent with `save_program_as_template`. |
| **LPT-6** | **Delete.** (FM-3, FM-4) | `CardMenu` → confirm dialog quoting the name + instantiation count ("Started by N clients. Deleting hides the template; their programs are unaffected.") → `soft_delete_program_template`. |

### P2 — polish

| # | Gap | Detail |
|---|---|---|
| **LPT-7** | **Kill the lying "New program" button; add guidance.** (FM-5) | Remove the disabled header button. Empty/header copy explains templates are saved from a real program: "Build a block for a client, then **Save as template** from the program calendar — it'll appear here to reuse." |
| **LPT-8** | **pgTAP for `soft_delete_program_template`.** | Cross-org deny / client deny / happy path / invisibility / double-delete, mirroring test 20. |

---

## 4. Decision questions for sign-off

| Q | Question | Recommendation |
|---|---|---|
| **A** | Apply-to-client UX: inline client+date picker in the Library, or deep-link to `program/new` with the template preselected? | **Inline picker** in the Library (fewer hops; reuse `create_program_from_template` + its overlap result). Deep-link is the cheap fallback if the picker proves fiddly. |
| **B** | The disabled "New program" header button — remove it (templates are born from real programs) with guidance copy? | **Remove + guidance.** Authoring a blank template from scratch is a bigger, lower-value surface; defer unless asked. |
| **C** | Show instantiation count ("started by N clients") on the card and in the delete confirm? | **Yes** — same safety affordance as the exercise delete-usage warning. |
| **D** | Edit a template's *content* from the Library this phase, or rename/delete only? | **Rename/delete only.** Editing template internals is a mini session-builder on the template tables — closer to the Sessions phase; defer. |

---

## 5. Sequencing · Acceptance · Out of scope

**Sequencing.** 1) LPT-1 migration (+ pgTAP LPT-8) → push, regen types → 2) `library/page.tsx` fetch + LPT-2 list + LPT-7 copy → 3) LPT-3 preview → 4) LPT-5 rename + LPT-6 delete actions → 5) LPT-4 apply (client+date picker, overlap handling) → 6) full suite.

**Acceptance gates:**
1. Programs tab lists every saved template with an accurate structure summary and instantiation count; soft-deleted ones never appear.
2. Preview shows the template's weeks/days/exercises read-only, RLS-scoped.
3. Apply from the Library creates a program for a chosen client + date and surfaces overlap with the colliding block named.
4. Rename persists and de-dupes; delete soft-deletes (RPC) and the template vanishes from the tab and the `program/new` picker, while programs already instantiated from it are unaffected.
5. No disabled/lying button; guidance copy present.
6. pgTAP green (LPT-8); `type-check` + `build` clean.

**Out of scope (deliberate):** the **Sessions** tab (single-session/day templates — separate phase); the **Circuits** tab (reusable named groups — separate phase); from-scratch template authoring (Q-B); in-Library template content editing (Q-D); the volume-unit work (item 1, its own doc — though templates already carry per-set rows, so the `rep_metric` column will flow through `create_program_from_template` for free once item 1's VU-3 sweep lands).

---

*Per the protocol: this is the gap-list contract for the Programs phase. No code beyond LPT-1..LPT-8 until the operator approves this list. Sessions and Circuits phases get their own audits before they start.*

---

## Implementation log (2026-06-23)

Gap list approved (operator: "begin item 3"; decisions A–D as recommended). Building in §5 order.

- **LPT-1 (P0) — closed.** `soft_delete_program_template(uuid)` — migration [`20260623130000_soft_delete_program_template.sql`](../../supabase/migrations/20260623130000_soft_delete_program_template.sql), SECURITY DEFINER, org/role guard, `deleted_at` UPDATE, `NOT FOUND` raise, anon-revoked + authenticated-granted (mirrors `soft_delete_exercise`). Children left intact; `programs.template_id` (ON DELETE SET NULL) keeps pointing at the soft-deleted row, so instantiated programs are unaffected. Pushed live, types regenerated.
- **LPT-8 (P2) — closed.** pgTAP [`36_program_template_soft_delete.sql`](../../supabase/tests/database/36_program_template_soft_delete.sql) — 5 assertions (cross-org deny P0002, client deny 42501, happy-path invisibility, double-delete raise, soft-delete retention). **5/5 green on the live DB** (`supabase db query --linked -f`).
- **LPT-2 (P1) — closed.** The Programs tab lists real templates ([`ProgramsTab.tsx`](../../src/app/(staff)/library/_components/ProgramsTab.tsx)); each card shows the structure summary (N weeks · M days · K exercises) + "used N×" — counts derived in the loader ([`page.tsx`](../../src/app/(staff)/library/page.tsx) pulls the template tree + reverse-embedded programs, RLS-scoped, soft-deleted children filtered in TS).
- **LPT-5 (P1) — closed.** Inline rename (`renameProgramTemplateAction`) with a case-insensitive duplicate-name guard (mirrors `save_program_as_template`) + zero-row-match honesty.
- **LPT-6 (P1) — closed.** Delete via the card menu → confirm quoting the name + "Started by N clients" usage warning → `deleteProgramTemplateAction` (the LPT-1 RPC).
- **LPT-7 (P2) — closed.** The lying disabled "New program" header button removed; the empty state explains templates are saved from a real block via "Save as template" on the program calendar.

`type-check` clean; `npm run build` green.

- **LPT-4 (P1) — closed.** Apply-to-client: each card's **Use template** opens an inline client + start-date picker → `applyProgramTemplateAction` → `create_program_from_template`, surfacing `overlap` (named — "pick a later date") vs `created` (routes the EP to the new block's calendar). Clients fetched in the loader (active, non-archived, RLS-scoped).

`type-check` + `npm run build` green.

- **LPT-3 (P1) — closed.** Read-only preview route [`library/programs/[id]/page.tsx`](../../src/app/(staff)/library/programs/[id]/page.tsx) — server-rendered, RLS-scoped: weeks → days → exercises with names + a per-set rx summary (via `formatVolume`, so a timed/distance prescription reads "3 × 30s"). Reached from each card's **Preview** menu item. No edit (Q-D).

**All eight gaps (LPT-1…LPT-8) closed.** `type-check` + `npm run build` green; pgTAP `36` 5/5 on the live DB at close (now **7/7** — anon-EXECUTE deny + cross-org SELECT invisibility added at the follow-ups below).

---

## Closing commit (step 7) — 2026-06-23

**What changed, by gap number.** All eight gaps (§3) are closed. The Library **Programs tab** — a disabled placeholder — is now a working management + apply surface over the existing template engine.

- **LPT-1 / LPT-8 (P0).** `soft_delete_program_template` SECURITY DEFINER RPC (migration `20260623130000`), mirroring the library soft-delete trio; pgTAP `36` (cross-org deny, client deny, happy-path invisibility, double-delete, soft-delete retention) — **5/5 green on the live DB at close; now 7/7** (anon-EXECUTE deny + cross-org SELECT invisibility added at the follow-ups below). Children left intact; `programs.template_id` (ON DELETE SET NULL) keeps pointing at the soft-deleted row.
- **LPT-2 (P1).** The tab lists the org's templates ([`ProgramsTab.tsx`](../../src/app/(staff)/library/_components/ProgramsTab.tsx)) with a structure summary (N weeks · M days · K exercises) + "used N×", counts derived in the loader from the RLS-scoped template tree + reverse-embedded programs.
- **LPT-3 (P1).** A read-only preview route (`library/programs/[id]`) — weeks → days → exercises with names + per-set rx summary (`formatVolume`).
- **LPT-4 (P1, Q-A inline picker).** **Use template** → inline client + start-date picker → `applyProgramTemplateAction` → `create_program_from_template`, routing to the new block's calendar on success and naming the colliding window on overlap.
- **LPT-5 (P1).** Inline rename with a case-insensitive dup-name guard (mirrors `save_program_as_template`) + zero-row-match honesty.
- **LPT-6 (P1, Q-C).** Delete via the card menu → confirm quoting the name + "Started by N clients" warning → the LPT-1 RPC.
- **LPT-7 (P2, Q-B).** The lying disabled "New program" button removed; empty-state guidance points to "Save as template" on the program calendar.

Decisions A–D (§4) taken as recommended.

**Acceptance tests run and results.** `type-check` clean; `npm run build` green (the new route + client component compile); pgTAP `36` **7/7** on the live DB (the LPT-1/LPT-8 RPC surface — cross-org SELECT invisibility, cross-org delete deny, client deny, happy-path invisibility, double-delete, soft-delete retention, anon-EXECUTE deny). **Verification honesty — this claim was narrowed at the reviewer follow-up (see below).** What is *proven*: the data-integrity P0 (LPT-1) and the FM-6 cross-org mechanism on the live DB (pgTAP `36`); the apply-overlap return at the data layer (pgTAP `21` §D1 → `status='overlap'`), surfaced by `handleApply` (`setError`, no swallow — ProgramsTab.tsx:76-81). What is *not* browser-verified: the behavioral **render** of gates 2–5 (overlap message painting, the 404 page, list/rename/delete UI) — it rests on `type-check`/`build` + the proven data layer, accepted at friends-and-family scope per the premortem's UX weighting, **not** asserted as production-grade UX verification. Full matrix + the `usedCount` semantics decision are in **Reviewer follow-up** below.

**Deferred, with triggers.** None — all eight gaps closed. Out of scope (per §5, unchanged): the Sessions tab + the Circuits tab (separate phases with their own audits); from-scratch template authoring (Q-B); in-Library template content editing (Q-D). The item-1 `rep_metric` column already flows through `create_program_from_template` (verified by test 35's A5), so applied/previewed templates carry the volume unit for free.

**Migrations:** one — `20260623130000` (soft_delete_program_template), applied live, types regenerated.

---

*Per the section sign-off ritual: Claude Code's work ends at this Closing commit. The section is not closed until the operator records the decision under a Sign-off heading below.*

---

## Follow-up (grant sweep, 2026-06-23)

Surfaced during the prescription-volume-unit reviewer follow-up (which re-ran the grant suites in full). **Correction to LPT-1:** the closing note said `soft_delete_program_template` was "anon-revoked", but that migration only did `REVOKE … FROM PUBLIC`. Because it is a NEW function, the Supabase default-EXECUTE-grant trap had granted `anon` a DIRECT EXECUTE that `REVOKE FROM PUBLIC` does not remove — so anon held EXECUTE (`has_function_privilege` = true). No breach (in-body owner/staff + org guard), but the posture was wrong. Fixed in [`20260623170000`](../../supabase/migrations/20260623170000_revoke_anon_soft_delete_program_template.sql) (`REVOKE … FROM anon`); **LPT-8 / test 36 gained an anon-EXECUTE tripwire** (then renumbered to §A7 when the reviewer follow-up added the §A1 cross-org SELECT check — **test 36 is now 7/7** on the live DB). The clone/template RPCs I `CREATE OR REPLACE`d carried no such regression (`CREATE OR REPLACE` of an existing function doesn't re-trip the trap — `insert_program_exercise_at`/`save_program_as_template` anon = false, **test 23 = 32/32**).

**Flagged, not fixed here (pre-existing):** the rest of the `soft_delete_*` family carries the same latent anon grant (`soft_delete_exercise` confirmed anon = true, created 2026-05-05). That belongs to the platform-wide anon-EXECUTE sweep (`docs/go-live-checklist.md`), not this section — spawned as a separate task.

---

## Reviewer follow-up (2026-06-23)

Reviewer (claude.ai project chat) returned the close **"Not yet"** with one valid structural catch: this is a UI-dominant phase, but the closing commit claimed "§5 acceptance gates met" on the strength of `type-check`/`build` + a pgTAP covering only the RPC. The catch is fair — the claim is now narrowed (Closing-commit "Acceptance tests" paragraph, above) to separate what is *proven* from what is *compile-plus-accepted*. The three specific points, each addressed:

**1. FM-6 — preview cross-org leak (LPT-3). Now evidenced; was asserted.**
The `/library/programs/[id]` route reads `program_templates` through the **RLS-scoped** server client (`createSupabaseServerClient`, *not* service-role) and `notFound()`s on a null row ([page.tsx:25-40](../../src/app/(staff)/library/programs/[id]/page.tsx)). The SELECT policy is org-scoped:

```sql
CREATE POLICY "staff select program_templates in own org"
  ON program_templates FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND deleted_at IS NULL
         AND public.user_role() IN ('owner','staff'));
```

So another org's id is invisible → `null` → 404. **New pgTAP `36` §A1 proves the mechanism on the live DB:** staff in org B get **0 rows** for org A's live template (`ok 1`). The sole browser-only residue is the 404 *page render* — standard Next `notFound()`, unverified only because the preview browser carries no authenticated staff session (every path here is behind `requireRole(['owner','staff'])`). **No leak.**

**2. FM-2 — apply swallows overlap (LPT-4). Now evidenced; was asserted.**
`applyProgramTemplateAction` calls the same engine `program/new` uses (`create_program_from_template`) and maps `status='overlap'` → `{status:'overlap'}` ([program-template-actions.ts:32-46](../../src/app/(staff)/library/program-template-actions.ts)). `handleApply` then **sets a visible error** ("This client already has an active block covering these dates. Pick a later start date.") and returns *before* any `router.push` ([ProgramsTab.tsx:71-84](../../src/app/(staff)/library/_components/ProgramsTab.tsx)) — it does **not** swallow. The RPC's overlap return is pgTAP-proven by **`21` §D1** (`D1: instantiating into an occupied date range returns status=overlap`). Browser-only residue: the literal paint of the error string (code-confirmed, not pixel-confirmed).

**3. `usedCount` semantics — decided, and not a multi-staff liability.**
The reviewer asked whether the count includes archived/soft-deleted programs or is RLS-partial across staff. Findings + decision:

- **Soft-deleted: excluded.** The mapper filters `p.deleted_at === null` ([page.tsx:130-132](../../src/app/(staff)/library/page.tsx)). ✔
- **Archived (`status='archived'`, `deleted_at` null): INCLUDED — deliberately.** The label is *"Started by N clients"* — a historical statement, and an archived program **was** genuinely started by that client. Excluding it would *understate* the footprint and make "Started by N" undercount real starts (the worse error). The reassurance it precedes — "their programs are unaffected" — is equally true for an archived program. **Decision: count = non-soft-deleted instantiations (active + archived).** If the EP later wants "active only", it is a one-line `status !== 'archived'` filter — but the current wording matches the current semantics, so no change.
- **Not a per-staff liability — `programs` SELECT policy quoted, not assumed (reviewer round 2).** The whole conclusion rested on `programs` RLS being org-scoped rather than per-assigned-EP; here is the actual staff branch, not an assertion of it:
  ```sql
  CREATE POLICY "select programs in own org"
    ON programs FOR SELECT TO authenticated
    USING (
      organization_id = public.user_organization_id()
      AND deleted_at IS NULL
      AND (
        public.user_role() IN ('owner','staff')          -- any owner/staff → ALL org programs
        OR (public.user_role() = 'client'                -- client → only their own
            AND status IN ('active','archived')
            AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid() AND deleted_at IS NULL))
      )
    );
  ```
  The owner/staff branch is **purely org-scoped — no per-EP narrowing**; every owner/staff sees every non-deleted org program, so `usedCount` is identical for all org staff and the multi-staff failure cannot arise. The per-client narrowing applies only to the `client` role, who never sees the Programs tab. (And the policy's own `deleted_at IS NULL` excludes soft-deleted programs at the RLS layer *before* the TS mapper's `p.deleted_at === null` filter runs — double-enforced.) Cross-org rows are excluded by the same `organization_id` predicate and are not instantiations of this org's template anyway.

**Verification matrix — the honest reading of the narrowed closing-commit line:**

| Gate | Claim | Verified by |
|---|---|---|
| 1 — list / counts | accurate, soft-deleted excluded | code (page.tsx:130-132) + org-scoped RLS; render browser-unverified |
| 2 — preview RLS | cross-org invisible → 404 | **pgTAP 36 §A1 (live)** + policy + route code; 404 page browser-unverified |
| 3 — apply overlap | surfaced, not swallowed | **pgTAP 21 §D1 (live)** + `handleApply` code; message paint browser-unverified |
| 4 — rename / delete | de-dupe + soft-delete + programs unaffected | **pgTAP 36 (live, 7/7)** for delete; rename code + zero-row honesty; UI browser-unverified |
| 5 — no lying button | placeholder removed | code |
| P0 — data integrity | soft-delete RPC + grant posture | **pgTAP 36 7/7 (live)** |

**Net:** every security- and data-integrity-weighted claim is now pgTAP-proven on the live DB (`36` 7/7, `21` §D1); the remaining residue is purely behavioral *render*, accepted at friends-and-family scope per the premortem's stated UX weighting — and the closing-commit claim is narrowed to say exactly that. The literal two-click browser passes (apply-to-colliding-date renders the overlap line; `/library/programs/<no-access-id>` renders the 404) remain available to run against an authenticated `:3000` session if the reviewer wants pixel confirmation on top of the data-layer proof.
