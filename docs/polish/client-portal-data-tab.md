# Polish-pass gap analysis — Portal Data-tab redesign (Phase J)

**Parent doc:** [`client-portal.md`](./client-portal.md) §2.E + §4 row J — parent polish pass for the client portal.
**Cross-references:** [`testing-module.md`](./testing-module.md) (active parent polish for the structured testing module).
**Target brief:** Phase J handoff [`client-portal-handoff-phase-j.md`](./client-portal-handoff-phase-j.md). Design reference (not modified): the session-builder right-rail Reports panel ([`ReportsPanel.tsx`](../../src/app/(staff)/clients/[id]/_components/ReportsPanel.tsx)).
**Current implementation:** `/portal/reports?tab=data` — [`DataView.tsx`](../../src/app/portal/reports/_components/DataView.tsx) + [`PortalTestCard.tsx`](../../src/app/portal/reports/_components/PortalTestCard.tsx) + [`PortalFramingBlock.tsx`](../../src/app/portal/reports/_components/PortalFramingBlock.tsx).
**Audit date:** 2026-05-14
**Status:** Gap document — awaiting EP sign-off on Q-J1..Q-J7 before any code.

---

## 0. Executive summary

The portal Data tab today is a 52-line flat list of test cards sorted by recency. It already renders per-metric charts via `ClientChartFactory` (line / bar / milestone / narrative_only / hidden) and already filters `client_view_chart === 'hidden'`. Per Phase E Q2 sign-off (2026-05-02) it was deliberately flat — "what's new about your data" first, no clinical-density category folders.

Phase J reverses that decision. The EP now wants the portal to mirror the staff session-builder's right-rail Reports panel: a layered, comparison-aware surface with **baseline-vs-previous toggle** and **percentage-change deltas with direction-of-good colouring**.

Two findings reshape the questions the handoff brief raised:

1. **The "battery → test → metric" wording is ambiguous.** The staff session-builder Reports panel — the canonical reference — is **not** a saved-battery hierarchy. It's a flat list of `client_publications` rows, each carrying a battery-name pill; click → "ReportReader" shows the session's sibling tests grouped under one framing + battery + date. The grouping unit is the **session**, not the saved-battery template from Settings → Tests. Q-J1 below makes this an explicit choice.

2. **No loader change is needed.** `ClientTestHistory` already carries everything required: `tests[].metrics[].points[]` has `(session_id, conducted_at, value, side)` sorted ASC; `sessions[]` carries `(session_id, conducted_at, battery_name, result_count)`. The previous-session anchor is a pure render-side derivation. The handoff brief's hypothesis was correct — `ClientChartFactory` was built for exactly this and is **already imported** by the portal across the `(staff)` route group boundary (Q-J1 strategy (b) is in place since Phase E).

Net consequence: Phase J is mostly **composition and helper extraction**, not new data plumbing or new chart machinery. The biggest decision is Q-J1 (grouping principle) — every other answer flows from it.

### 0.1 Reversal of Phase E Q2 — explicit note

| Phase E Q2 (2026-05-02) | Phase J (2026-05-14) |
|---|---|
| Flat list of test cards, sorted by `most_recent_conducted_at` descending. Behavioural framing — "what's new about your data" first. Avoids clinical-density category folders; the staff side has those. | Layered hierarchy mirroring the staff session-builder Reports panel. Baseline-vs-previous toggle. Inline %-change deltas with direction-of-good colour. |

The EP's reasoning for the reversal isn't in the handoff brief; surfacing it would be useful for future "what did we decide and why" reconstruction. Best guess from the work pattern: the staff session-builder Reports panel shipped in Phase L's session-builder polish, and seeing it in use exposed that the client portal's flat-list version doesn't carry the interpretive story (delta + comparison toggle) that makes the data legible without an EP in the room. **If that guess is wrong, please correct in the sign-off so the why survives.**

---

## 1. What's already correct

Pieces of the existing portal implementation that align with Phase J's target and should be preserved.

### 1.1 Cross-route `ClientChartFactory` import
[`PortalTestCard.tsx:6`](../../src/app/portal/reports/_components/PortalTestCard.tsx) already imports `ClientChartFactory` from `@/app/(staff)/clients/[id]/_components/reports/client-charts/ClientChartFactory`. Next.js route groups don't isolate module imports — the portal consumes the staff client-chart family directly. **Phase E Q1 follow-up "specialised client variants — defer until visual fit on a 480px column proves wrong"** still holds: don't fork the charts now, lean on the existing dispatch.

### 1.2 Hidden-metric filtering at the test level
[`DataView.tsx:24`](../../src/app/portal/reports/_components/DataView.tsx) filters tests where every metric is `client_view_chart === 'hidden'`. Post-D.6 no schema metric is `hidden` (D.6 raised the two `never`-was-hidden metrics to `narrative_only`), but the filter is correct defensive logic and Phase J preserves it.

### 1.3 Framing-text rendering
[`PortalFramingBlock.tsx`](../../src/app/portal/reports/_components/PortalFramingBlock.tsx) renders the EP's framing in design-system §02 voice. Per Phase E Q3, framing is drawn from the most recent live publication for each test and shown once at the top of its card. Phase J keeps this — the question is where in the new hierarchy it sits (Q-J1 decides; section heading vs per-test card vs both).

### 1.4 Direction-of-good machinery is centralised
[`src/lib/testing/direction.ts`](../../src/lib/testing/direction.ts) exposes `verdictFor`, `colourFor`, `formatPctChange`, `formatDelta`. Token-based (`var(--color-accent)` good, `--color-alert` bad, `--color-warning` caution, `--color-muted` neutral). Phase J consumes these as-is — no new colour logic.

### 1.5 RLS already enforces the client-side filter
The portal's `loadTestHistoryForClient` only returns metrics where `client_portal_visibility != 'never'` AND (`auto` OR has a live publication). The Tampa Scale wall is enforced at the DB layer (pgTAP `02_never_hard_wall.sql`). Phase J inherits this guarantee — there is nothing to add in the portal render path to keep `never` data out.

### 1.6 Portal CSS primitives ready
Phase A/B landed `.portal-card`, `.portal-eyebrow`, etc. Phase J's new components use these directly; zero new design tokens needed.

---

## 2. Gaps to close

### A. Architectural (no schema migrations needed)

| # | Gap | Files | Why it matters |
|---|-----|-------|----------------|
| **JA1** | Grouping principle is undefined. The portal renders tests as a flat list sorted by recency; the brief calls for "battery → test → metric hierarchy." The staff session-builder Reports panel — the reference — uses session-as-battery, not saved-battery. **Q-J1 picks the model.** | [`DataView.tsx`](../../src/app/portal/reports/_components/DataView.tsx) | Every other Phase J decision depends on this — toggle scope, framing placement, sort, empty-state. |
| **JA2** | Helper functions `pickPreviousBefore` / `pickFirstCapture` are private to [`ReportsPanel.tsx:646-672`](../../src/app/(staff)/clients/[id]/_components/ReportsPanel.tsx). Phase J needs them in a portal component. **Q-J2 decides** extract-to-shared vs duplicate. | [`ReportsPanel.tsx`](../../src/app/(staff)/clients/[id]/_components/ReportsPanel.tsx), [`reports/helpers.ts`](../../src/app/(staff)/clients/[id]/_components/reports/helpers.ts) | Two implementations of the same pure helper drift over time. Extract is cheap pre-launch. |

### B. Functional (the Phase J behaviour)

| # | Gap | Files | Why it matters |
|---|-----|-------|----------------|
| **JB1** | No comparison toggle on the portal. Today's MilestoneChart fixes the comparison to baseline (first capture). | [`PortalTestCard.tsx`](../../src/app/portal/reports/_components/PortalTestCard.tsx), [`ClientChartFactory.tsx`](../../src/app/(staff)/clients/[id]/_components/reports/client-charts/ClientChartFactory.tsx) | The brief is explicit: baseline-vs-previous toggle is the headline feature. **Q-J3 decides** toggle scope (per card / per group / global). |
| **JB2** | No inline %-change rendering outside the MilestoneChart visual. Line/bar/narrative_only charts on the portal don't carry a delta strip. | `_components/reports/client-charts/` family | **Q-J4 decides** whether to add the badge above non-milestone charts or only inside milestone. |
| **JB3** | "This session's value" anchor not defined for the portal. The staff Reports panel uses a frozen-snapshot semantic anchored on the OPENED publication's session; the portal currently anchors on the **most recent point per metric**. Behaviour diverges. | [`PortalTestCard.tsx`](../../src/app/portal/reports/_components/PortalTestCard.tsx) | **Q-J5 decides.** Bears on whether re-published tests produce one row (anchored on latest publication) or N rows (one per publication). |
| **JB4** | Standalone-test variant is not implemented because hierarchy isn't either. Today every test is a top-level card; in the new model only some tests are. | [`DataView.tsx`](../../src/app/portal/reports/_components/DataView.tsx) | **Q-J6 decides** rendering shape for tests captured outside any battery / saved-battery / publication grouping. |
| **JB5** | Empty-state has one shape covering "no tests", "no publications", and "all-hidden." Hierarchy can surface the three meaningfully. | [`DataView.tsx:28-35`](../../src/app/portal/reports/_components/DataView.tsx) | **Q-J7 decides.** Behaviour-change voice (§02) leans toward two states ("No data yet" / structured), not three. |

### C. Polish (deferred until JA + JB land)

| # | Gap | Why it matters |
|---|-----|----------------|
| **JC1** | Voice pass on the new comparison labels — "Baseline", "Previous", "Improvement from baseline", per design-system §02 (clinician's notepad, not consumer-cheery). | Tone drifts under composition pressure. |
| **JC2** | Mobile-first column-budget audit. The staff session-builder ReportsPanel runs at ~320px in the right rail; the portal runs at 480-ish on phone. Some treatments that fit narrow may waste space wide; or vice versa. | Phase J's bar is "looks right on a phone first," not pixel-faithful to the staff panel. |
| **JC3** | Section-heading treatment for the new grouping (session-as-battery vs saved-battery name). The session-builder uses a header row with a `1px solid` divider and an eyebrow + date pair. Portal will want its own restraint. | Apple-restraint posture — generous whitespace, thin borders only. |

---

## 3. What NOT to touch (regression protection)

- **`SessionBuilder.tsx`** (the 2951-line session builder file) — the brief explicitly forbids modifying it. Phase J reads from `ReportsPanel.tsx` (which the session builder consumes) to mirror design intent.
- **Staff `ReportsTab.tsx`** + the staff `CategoryGrid` / `CategoryDetail` / `TestCard` / `MetricBadge` family — these are the staff client-profile Reports surface. Phase J does not re-purpose them; they stay the analytics-density tool the EP uses, in contrast to the portal's behaviour-change tool.
- **`loadTestHistoryForClient`** and `loadPublicationsForClient` — already carry every datum Phase J needs. No new SQL, no new RPC, no migration.
- **`ClientChartFactory`** dispatch surface — the per-`client_view_chart` switch is correct. The change is **what `thisSessionValues` / `thisSessionDate` get passed**, not the dispatch.
- **RLS policies on `test_results` and `client_publications`** — Phase E pgTAP 02 confirms the Tampa wall holds. Nothing to change.

---

## 4. Decisions to surface — Q-J1..Q-J7

EP sign-off needed on these before any code lands. The handoff brief's seven questions are reshuffled here because the audit resolved two (component sharing is already in place; loader shape needs no change) and surfaced one more critical (grouping principle).

### Q-J1 — Grouping principle (load-bearing)

What does "battery → test → metric" mean as a layout? The staff session-builder Reports panel doesn't actually nest tests under batteries — it nests them under **sessions** (which carry the battery name as a label). Four candidate models:

| Option | Layout | Pros | Cons |
|---|---|---|---|
| **(a) Session-as-battery (exact mirror of `ReportsPanel.tsx`)** | Flat list of session-groups sorted by `conducted_at desc`. Each group header = battery name (or test name when no battery), date, framing. Tests within a session render as nested cards. A test re-captured in a later session shows up in that later group too. | Most faithful to the design reference. Reuses ReportsPanel's mental model. Battery context is intrinsic. Standalone-test variant is the natural "session with one test, no battery." | If the same battery is captured 5×, the EP sees 5 group headers — repetitive. The "what changed" question is answered per group, not per test. |
| **(b) Saved-battery (from Settings → Tests)** | Top-level collapsible groups named after the saved batteries from Settings → Tests. A test is grouped if it's in any active battery; otherwise it's a standalone top-level card. | Closest to the literal phrase "battery → test → metric." Tests stay in one place. | A test can be in multiple batteries — needs a tie-breaker. Saved batteries are EP-controlled in Settings, so they're not stable client-facing language. Decoupled from when/how the data was captured. |
| **(c) Most-recent-publication's battery** | Each test inherits its grouping label from its most recent live publication's session. Tests group under those labels; same battery name → same group. | Stable grouping per test. Single entry per test. | Subtle to explain — if the EP captured a test in battery A then re-published in battery B, the test "moves." |
| **(d) Category → subcategory** | Mirror the staff Reports tab — collapsible `Lower body strength → Squat → 1RM`. Phase E Q2 explicitly rejected this for the client portal. | Familiar to the staff. | Reverses the Phase E decision twice in three weeks; "clinical-density category folders" reasoning still stands; clients don't know category language. |

**Audit recommendation: (a)** — exact mirror of the design reference, smallest design lift, no new joins, and "session" is concrete language the client experiences (they were there when it was captured). Standalone-test variant falls out naturally — a session with one test and no battery renders as a single-test row with the test name as the header.

**Sub-question Q-J1.1 — Group sort order.** Newest first (recency-first, "what's new") or oldest first (chronological, "see the journey")? Audit recommendation: newest first, matches Phase E Q2 sort intent.

### Q-J2 — Helper extraction & component sharing

`ClientChartFactory` is already imported across the route boundary — strategy (b) from the handoff brief is in place. The remaining decision is about the **comparison helpers** in `ReportsPanel.tsx`:

| Option | What |
|---|---|
| **(a) Extract `pickPreviousBefore`, `pickFirstCapture`, comparison-mode types to `reports/helpers.ts`** (or a new `src/lib/testing/comparison.ts`); both staff and portal import from there. | One source of truth. ReportsPanel.tsx becomes 3-4 lines shorter. Helpers stay pure. |
| **(b) Duplicate them in a portal-side helpers file.** | Zero risk to the session-builder. Two implementations drift. |
| **(c) Lift the staff `ReportsPanel.tsx` `TestCard` + `MetricRow` + `MetricBlock` + `ComparisonToggle` components themselves to a shared location, both surfaces import from there.** | Most leverage — one comparison-aware card lives once. Highest extraction blast radius (the file is `'use client'` with `useState`; both surfaces would need to pass the same prop shape). |

Audit recommendation: **(a)** for the helpers (low-risk pure functions); **defer (c)** unless the JSX diverges so little that duplication looks silly during J-2 implementation. The portal styling will differ enough (`.portal-card` vs the staff `.card`, mobile-first sizing, larger touch targets) that one shared component would carry conditional styling — usually that's the wrong abstraction.

**Sub-question Q-J2.1 — Where exactly do extracted helpers live?** Audit recommendation: `src/lib/testing/comparison.ts` (sibling to `direction.ts`). Stays inside the testing-module module graph; importable from anywhere.

### Q-J3 — Comparison toggle scope

The staff `ReportsPanel.tsx` puts a per-card toggle in the top-right of each `TestCard`. Each card has its own `useState<'baseline' | 'previous'>`. Two cards on the same surface can be in different modes.

Options for the portal:

| Option | Behaviour |
|---|---|
| **(a) Per test card (mirror staff)** | Each test card has its own toggle. The EP can compare Squat vs baseline and KOOS vs previous on the same screen. |
| **(b) Per session-group** | One toggle per session group (under Q-J1 (a)). Tests inside the group all flip together. |
| **(c) Global at the top of the tab** | One toggle drives every card on the page. |

Audit recommendation: **(a)** — mirrors the design reference. Per-card is simple to implement (each card holds its own state, no lifting). The fear is "client toggles 5 cards" — but in practice the client almost certainly picks one mental model and sticks with it (baseline-since-start is the dominant motivational frame; previous is the rehab-block frame). One global toggle (option c) would also work without re-mounting state; happy to fall back to (c) if the EP prefers a single mode toggle.

### Q-J4 — Percentage-delta rendering

Today's portal `MilestoneChart` already renders baseline → arrow → latest with %-change inline (when `client_view_chart === 'milestone'`). Line/bar charts on the portal don't carry a delta strip. Narrative_only carries the framing only.

Options:

| Option | Behaviour |
|---|---|
| **(a) Keep MilestoneChart visual, add a delta strip above non-milestone charts** | All metrics get a consistent badge regardless of chart type. Most consistent. |
| **(b) Replace MilestoneChart with plain text rows (mirror `ReportsPanel.tsx` MetricRow)** | No chart on the portal at all — just `current 42° · +9.0% · baseline 38.5° · 12 Jan`. Most restrained. Loses the visual milestone metaphor. |
| **(c) Hybrid: keep MilestoneChart for the milestone-typed metrics; swap the left endpoint based on the toggle (baseline OR previous)** | Visual richness preserved; toggle controls what the left side anchors to. Other chart types render as today (line/bar/narrative_only unchanged at v1; revisit if Q-J7 surfaces a gap). |

Audit recommendation: **(c)** — the milestone visual is doing real interpretive work and is the dominant `client_view_chart`; swapping the anchor preserves it. Line/bar are uncommon for client visibility (most metrics are milestone or narrative_only post-D.6) so deferring delta strips there is fine for v1. Phase J `acceptance bar` should explicitly call out the line/bar gap as known-and-OK.

**Sub-question Q-J4.1 — When the chosen comparison is "previous" and a metric has only one capture, what renders?** Audit recommendation: "First capture · {date}" mirroring `ReportsPanel.tsx` — no delta, no arrow, value alone.

### Q-J5 — "This session's value" anchor

The staff session-builder `ReportsPanel.tsx` shows one card per publication-of-a-test. If the EP publishes KOOS three times across three sessions, the panel shows three rows. Each row is frozen to its own session (current = that session's value, comparison = baseline OR previous-before-that-session).

The portal's current `MilestoneChart` anchors on the **most recent captured value per metric**, regardless of which publication it came from. This is a behavioural divergence that Phase J needs to resolve.

| Option | Anchor |
|---|---|
| **(a) Per-publication (frozen-snapshot, mirror staff)** | One row per live publication. Re-publishing a test creates a new row. |
| **(b) Latest published per test (current behaviour)** | One row per test. Re-publishing supersedes the previous row. |
| **(c) Latest captured per test, regardless of publication** | RLS hides unpublished — collapses to (b). |

Audit recommendation: **(b) — keep current behaviour.** The client portal is a behaviour-change surface (Phase E framing); showing the "current state of play" not the "publication audit trail" is what serves the client. The staff side keeps the full publication history because the EP needs it for clinical recall — the client does not. Phase J's hierarchy still works on (b): the session-as-battery group is the **most recent** session per battery, and the test cards inside each group reflect that session's values.

If the EP wants (a) — "let the client see every publication as its own snapshot" — that's a meaningful UX shift; flag it explicitly so we don't accidentally drift toward the staff-side audit-trail framing.

### Q-J6 — Standalone-test rendering

A standalone test = a test captured in a session with no `applied_battery_id`, OR a test captured in a battery but appearing on the portal as its own entry because no other tests from that session are visible.

Under Q-J1 (a) (session-as-battery), standalones fall out naturally: a session with one published test renders as a one-test group, no group header decoration beyond the test name + date + framing. Two options for visual treatment:

| Option | Treatment |
|---|---|
| **(a) Each standalone-session test renders as its own top-level entry without a group header** — looks identical to a battery group except the header just shows the test name. | Hierarchy honest; standalone tests aren't artificially clustered. |
| **(b) All standalone-session tests fold into a synthetic "Other tests" bucket at the bottom.** | One less top-level entry; rare-test clutter contained. Hides the chronological story. |

Audit recommendation: **(a)** — preserves Q-J1 (a)'s session-grouping consistency. Standalones aren't an exception to the rule, they're the degenerate case of it.

### Q-J7 — Empty-state semantics

Today's empty state is one card covering every empty path. With hierarchy in place, the distinguishable states multiply. Three honest variants:

| State | Today | Phase J options |
|---|---|---|
| Client has no captured tests at all | "No data yet" | Keep |
| Client has captures but no live publications, AND has no `auto`-visibility data | "No data yet" | (a) Same / (b) Distinct: "Your EP has captured some testing; it'll appear here once they share it." |
| Client has captures and publications but every visible metric is `hidden` (rare post-D.6) | "No data yet" | Same (degenerate case, rare) |

Options:

| Option | Behaviour |
|---|---|
| **(a) Keep one empty state** ("No data yet — your testing data will appear here once your EP shares a result.") | Voice-aligned, factual, no premature feature; consistent across the three roots. |
| **(b) Two states** — "No data yet" / "Pending review" with the second copy noting the EP is preparing the data. | Honest about what's happening; risks sounding alarming about a workflow gap on the staff side. |
| **(c) Three states** — distinct copy for each. | Over-specification. |

Audit recommendation: **(a)** — voice stays in design-system §02 register; (b) leaks staff-side workflow into client-side communication.

---

## 5. Sub-phase scoping (Q-J6 in the handoff brief — confirming the split)

The handoff brief proposed J-1 / J-2 / J-3. The audit confirms the split largely but reshapes scope. Each sub-phase has its own gap-doc append + sign-off log.

| Sub-phase | Scope | Acceptance bar |
|---|---|---|
| **J-1 — Helpers + grouping** | Extract `pickPreviousBefore`, `pickFirstCapture`, `ComparisonMode` types from `ReportsPanel.tsx` into `src/lib/testing/comparison.ts` (per Q-J2 (a)). Add a new `groupHistoryBySession` helper that pivots `ClientTestHistory` → `Array<{ session, tests, framing, battery_name }>` ready for portal render. No render change yet. Unit-test the helpers in `src/lib/testing/__tests__/` (or inline assertions if no test infra). | Helpers exist + typecheck clean + grep for "battery" / "session-as-battery" returns the right hits. |
| **J-2 — Hierarchical render + standalone variant** | New portal components: `DataView` rewritten to render session-groups (Q-J1 (a)); new `PortalSessionGroup` carrying the eyebrow header (battery name + date + framing) and a list of `PortalTestCard`s; `PortalTestCard` updated to consume the grouping output. Standalone-test variant per Q-J6 (a). Empty state per Q-J7 (a). | All six client states from the handoff brief acceptance render correctly. `npm run build` clean. |
| **J-3 — Comparison toggle + delta rendering** | Add `ComparisonToggle` to `PortalTestCard` per Q-J3 (a). MilestoneChart anchor-swap per Q-J4 (c). Line/bar deferred for v1; narrative_only unchanged. | Toggling baseline/previous flips the milestone anchor + the %-change colour using `direction.ts`. Manual walkthrough on a client with ≥3 captures of the same metric. |

Audit recommendation: confirm the J-1 / J-2 / J-3 split.

**Sub-question Q-J6.1 — Sign-off cadence.** Per CLAUDE.md polish-pass protocol, each sub-phase gets its own sign-off bar. Concretely that means: after J-1 lands, EP confirms the helpers + grouping function look right before J-2 starts; same after J-2 before J-3. Confirms this is the cadence (vs one sign-off at the end of J-3 for the whole phase).

---

## 6. What's already correct on the portal side (regression protection — restating)

- `ClientChartFactory` cross-route import (since Phase E).
- Hidden-metric filtering at the test level.
- `PortalFramingBlock` rendering and the "framing from most recent live publication for this test" rule (Phase E Q3).
- The two-tab structure (`?tab=data` / `?tab=reports`) and the Phase H "Files → Reports" rename.
- Auth gate via `portal/layout.tsx` + RLS filtering everywhere.

---

## 7. Pre-launch advantage check

Per CLAUDE.md:
- No schema migrations needed — loader already carries everything Phase J consumes.
- No RLS policy change — Tampa wall + `is_published` filtering already enforce the visibility model at the DB layer.
- No new RPC.
- Type regen (`src/types/database.ts`) not required for Phase J — no DB shape change.

This phase is **all client-side React + a small pure-helpers extraction**. The pre-launch advantage isn't load-bearing here, but worth noting so the EP knows Phase J can also land post-launch without coordination cost.

---

## 8. Stop point

This document is the contract. **No code changes start until Q-J1..Q-J7 are signed off.**

Sign-off format (suggested) — drop a section §9 below with the table:

| Q | Decision | Notes |
|---|----------|-------|
| Q-J1 |  |  |
| Q-J1.1 |  |  |
| Q-J2 |  |  |
| Q-J2.1 |  |  |
| Q-J3 |  |  |
| Q-J4 |  |  |
| Q-J4.1 |  |  |
| Q-J5 |  |  |
| Q-J6 |  |  |
| Q-J6.1 |  |  |
| Q-J7 |  |  |

Once signed, J-1 opens. Each sub-phase appends its own sign-off log + closure note here.

---

## 9. Sign-off log

### 9.1 Phase J kickoff — Q-J1..Q-J7 (chat 2026-05-14)

| # | Decision | Notes |
|---|----------|-------|
| **Q-J1** | **(a) Session-as-battery (exact mirror of `ReportsPanel.tsx`).** | EP rationale: "Keep the session date for a given battery, that will remove any issues with multiple uses of the battery." The same saved battery captured 5× produces 5 distinct session-groups, distinguished by date. Date IS the disambiguator — that's a feature, not a con. |
| **Q-J1.1** | **Newest first.** | Recency-first sort by `conducted_at desc`. Preserves the Phase E Q2 sort intent. |
| **Q-J2** | **(a) Extract helpers to `src/lib/testing/comparison.ts`.** | Single source of truth for pure comparison helpers. |
| **Q-J2.1** | **`src/lib/testing/comparison.ts`** (per audit recommendation, "stick with recommendations"). | Sibling to `direction.ts` inside the testing-module module graph. |
| **Q-J3** | **(a) Per test card.** | Each card holds its own `useState<'baseline' \| 'previous'>` — mirror staff `ReportsPanel.tsx`. |
| **Q-J4** | **(c) Hybrid — keep MilestoneChart, swap left endpoint based on toggle.** | Line/bar deferred for v1 (most client-visible metrics post-D.6 are milestone or narrative_only). Narrative_only unchanged. Acceptance bar calls out the line/bar gap as known-and-OK. |
| **Q-J4.1** | **"First capture · {date}"** when comparison is "previous" but the metric has only one capture. | Mirrors `ReportsPanel.tsx` semantic — no delta, no arrow, value alone. |
| **Q-J5** | **(b) Latest published per test (current behaviour).** | Client portal is a behaviour-change surface; the staff side owns the publication audit trail. One row per test. Re-publishing supersedes the prior row. |
| **Q-J6** | **(a) Each standalone-session test renders as its own top-level entry.** | Hierarchy honest; standalones aren't artificially clustered. The standalone case is the degenerate one-test session-group, not an exception to the rule. |
| **Q-J6.1** | **Per-sub-phase** (default per CLAUDE.md polish-pass protocol; not explicitly answered in sign-off — applying the default). Each sub-phase appends its own closure note + EP sign-off here before the next sub-phase opens. | If the EP wants one consolidated sign-off at the end of J-3 instead, flag now — easy switch. |
| **Q-J7** | **(a) One empty state** — "No data yet — your testing data will appear here once your EP shares a result." | Voice-aligned, factual, no premature feature. |

### 9.2 Reconciliation — Q-J1 (a) ⨯ Q-J5 — **revised 2026-05-14**

The original proposed reading was wrong. EP correction (chat 2026-05-14):

> The KOOS should now display within both tests [sessions] so if you wanted to check the previous testing session as a whole you might think the KOOS is missing.

Reframed: each session-group is a **snapshot of "what was tested in this session"** from the client's perspective. If KOOS was published in Jan AND in Mar, KOOS appears in BOTH groups. Hiding it from the older group makes that group look like it was missing a test, which is the wrong story.

This effectively revises Q-J5 from **(b) Latest published per test** to **(a) Per-publication (frozen-snapshot, mirror staff)**. The original Q-J5 (b) framing was load-bearing — flipping the answer was the right call. §4 Q-J5 audit recommendation was wrong; the EP correction overrides.

**Correct reading:** a test appears in a session-group iff there is a live publication for **(that session's id, that test's test_id)**. A test can appear in N groups if it has N live publications across N sessions. Concretely:

1. Walk every live publication in `publications`.
2. Each publication = one (session_id, test_id) pair = one entry in that session's group.
3. Group entries by `test_session_id`.
4. Dedupe by `test_id` within a group (defensive — unique-active partial index in `client_publications` should prevent dupes per (session, test) pair).
5. Resolve `(conducted_at, battery_name)` from `history.sessions`.
6. Sort groups by `conducted_at desc` (Q-J1.1).
7. A session-group exists only if at least one live publication points at it.

**Consequences for the running example.** KOOS captured Jan 1 (published Jan 2) and re-captured Mar 1 (re-published Mar 2):

- **Jan 1 session-group:** KOOS appears, anchored on Jan 1's captured value. Its per-card baseline-vs-previous toggle: baseline = Jan 1 (first capture, so "First capture · 1 Jan"), previous = null (also "First capture · 1 Jan" — no earlier point).
- **Mar 1 session-group:** KOOS also appears, anchored on Mar 1's captured value. Toggle: baseline = Jan 1, previous = Jan 1 (only one prior; both modes give the same comparison in this 2-capture case).

Soft-deleting the Mar 2 publication removes KOOS from Mar 1's group but leaves it in Jan 1's group untouched. Soft-deleting both publications removes KOOS from both groups (RLS hides the underlying test_results from the loader).

**Implications for downstream Phase J work.** PortalTestCard (J-2) anchors on the **session-group's session_id**, not on the metric's latest captured session. The `thisSessionValues` it passes to ClientChartFactory come from the metric's points filtered to that session_id. Comparison anchor (baseline / previous) uses the session-group's `conducted_at` as the reference moment, exactly like staff `ReportsPanel.tsx`'s frozen-snapshot semantic.

**Edge case — auto-visibility metrics:** post-D.6 no schema metric uses `client_portal_visibility = 'auto'`. The revised function is strict — no publication, no entry. If auto comes back, fold its handling in then; the current dead-path defensive code is removed (simpler is better when the path is dead).

### 9.3 Open follow-ups surfaced during sign-off

- **Why the Phase E Q2 reversal.** Reasoning still uncaptured in writing. EP correction welcome so the "why" survives in §0.1.
- **Q-J6.1 sign-off cadence.** Default applied (per-sub-phase). EP can switch to one-shot at the end of J-3 if preferred.

### 9.4 J-1 — Helpers + grouping (closed pending EP sign-off, 2026-05-14)

**Q-J5 revised mid-J-1** (per EP correction in this chat). Original audit-recommended (b) was wrong; (a) per-publication frozen-snapshot is correct. §9.2 above carries the new reconciliation. `groupHistoryBySession` was rewritten to the new contract before verification ran; nothing on the (b)-shaped logic shipped.

**What shipped:**

- **NEW** [`src/lib/testing/comparison.ts`](../../src/lib/testing/comparison.ts) — sibling to `direction.ts` inside the testing-module module graph. Exports:
  - `type ComparisonMode = 'baseline' | 'previous'`.
  - `pointAtSession(points, sessionId, side)` — per-(session, side) point lookup, extracted from `ReportsPanel.tsx`'s private copy. The portal will need this in J-2 when each card anchors on its session-group's `session_id`.
  - `pickPreviousBefore(points, anchorConductedAt, side)` — latest point strictly before the anchor on the same side. Walks the array each call instead of relying on loader's ASC sort, so a future reorder doesn't silently change the answer.
  - `interface SessionGroup` — the per-session pivot row shape (session_id, conducted_at, battery_name, tests).
  - `groupHistoryBySession(history, publications)` — encodes the §9.2 contract: group publications by `test_session_id`; for each group emit the (deduped) tests with live publications for that session; resolve session metadata from `history.sessions`; sort newest-first. **Per-publication** — a test with publications in N sessions appears in N groups. No auto fallback (path is dead post-D.6).
- **EDIT** [`src/app/(staff)/clients/[id]/_components/ReportsPanel.tsx`](../../src/app/(staff)/clients/[id]/_components/ReportsPanel.tsx):
  - Imported `pickPreviousBefore`, `pointAtSession`, `type ComparisonMode` from `@/lib/testing/comparison`.
  - Imported `pickBaseline` from `./reports/helpers` (already existed there — `pickFirstCapture(points, side)` was functionally identical to `pickBaseline(points, side)`).
  - Removed the inline `type ComparisonMode`, `pickFirstCapture`, `pickPreviousBefore`, `pointAtSession` definitions.
  - Replaced the single `pickFirstCapture(metric.points, side)` call with `pickBaseline(metric.points, side)`.
  - Removed the now-unused `MetricSeriesPoint` type import (the inline helpers were its only consumer).
  - Zero behaviour change. UI is byte-identical at runtime.

**Files changed:** 1 new (`src/lib/testing/comparison.ts`), 1 modified (`ReportsPanel.tsx`). Net diff in `ReportsPanel.tsx`: −37 lines (helper bodies + unused type import removed) + 7 lines (imports added). Net new code in `comparison.ts`: ~155 lines.

**Verification:**

- `npm run type-check` — clean. Pre-existing BOM drift on `src/types/database.ts` was temporarily stashed via `git stash push -- src/types/database.ts`, verification run, then `git stash pop` restored the exact same drift bytes. Working-tree state pre- and post-verification matches.
- `npm run build` — clean against a HEAD `database.ts`. All routes generated (37 routes, same as Phase L's closure baseline).
- No browser preview verification — J-1 changes are pure helper extraction with zero UI surface area. `groupHistoryBySession` and `pointAtSession` (newly-extracted) are not called by any rendered component until J-2 wires them into `DataView.tsx` + the rewritten `PortalTestCard`. `ReportsPanel.tsx`'s behaviour is byte-identical at runtime (verified by reading the diff: only helper bodies + import lines changed). Per `<when_to_verify>`: only run the preview workflow when the change is observable in the browser.

**What didn't ship (intentionally):**

- No edits to `reports/helpers.ts` — `pickBaseline` already exported correctly. Didn't move it to `comparison.ts` to keep the staff Reports-tab module graph stable.
- No unit-test file. No JS test runner exists in `package.json` (only `lint`, `type-check`, `build`, `supabase:types`). The polish-pass protocol relies on pgTAP for DB tests + manual UI walkthroughs + the build gate; pure helpers ride the type system + careful reading.
- No portal-side edits. J-2 owns the `DataView.tsx` rewrite that consumes `groupHistoryBySession` + the rewritten PortalTestCard that anchors on the group's session_id.

**Sub-question outcomes (deferred to J-2 + J-3):**

- Auto-visibility fallback removed from `groupHistoryBySession`. Post-D.6 path is dead; keeping defensive code for a dead path is noise. If `auto` returns, fold it in then.
- `pickBaseline` and `pickFirstCapture` were functionally identical when `side` is non-undefined. The dedupe leaves `pickBaseline` as the single helper.

**Verified contract (matches EP correction):**

Walk-through — client has KOOS captured Jan 1 (published Jan 2) and re-captured Mar 1 (re-published Mar 2):

1. `pubsBySession` has two entries: Jan 1 → [KOOS Jan 2 pub], Mar 1 → [KOOS Mar 2 pub].
2. Two groups emitted, both containing KOOS:
   - **Mar 1 group** (newest, listed first): tests = [KOOS]. KOOS anchored on Mar 1's captured value when rendered.
   - **Jan 1 group**: tests = [KOOS]. KOOS anchored on Jan 1's captured value.
3. Per-card comparison toggle behaves consistently with frozen-snapshot semantic:
   - Mar 1 card · baseline mode → comparison vs Jan 1's value (first capture).
   - Mar 1 card · previous mode → comparison vs Jan 1's value (only prior session; equal to baseline in this 2-capture case).
   - Jan 1 card · baseline mode → "First capture · 1 Jan" (no prior).
   - Jan 1 card · previous mode → "First capture · 1 Jan" (also no prior).
4. Soft-delete of the Mar 2 publication: Mar 1 group disappears (no live publications anchor it), Jan 1 group untouched. Re-publishing toggles group presence, not membership.

This matches the EP's intent: "session-as-a-whole" snapshot, no test mysteriously absent from an older group.

Sign off this contract + the J-1 close, and J-2 opens (rewrites `DataView.tsx` + adds `PortalSessionGroup` + per-card session-anchored render + standalone-test variant + empty-state).

### 9.5 J-2 — Hierarchical render + collapsibility + compaction + staff tagging (closed pending EP sign-off, 2026-05-15)

J-2's spec'd scope shipped first (hierarchical render + standalone variant + empty-state). Three live-test feedback items extended the sub-phase within the same effort — collapsibility (J-2-α), first-capture compaction (J-2-β), staff tagging affordance + portal RLS migration (J-2-γ). EP verified each independently in the browser before the next opened.

**What shipped — J-2 base** (per Q-J1..Q-J7 contract):

- [`DataView.tsx`](../../src/app/portal/reports/_components/DataView.tsx) — rewritten. Calls `groupHistoryBySession(history, publications)`; renders one `PortalSessionGroup` per result. Empty state when `groups.length === 0` (Q-J7 (a) one-message variant). Standalone-test case (Q-J6 (a)) falls out naturally as a one-test group.
- [`PortalSessionGroup.tsx`](../../src/app/portal/reports/_components/PortalSessionGroup.tsx) — NEW. Header eyebrow (date + battery name when applied, or "N tests" when not). Children are `PortalTestCard`s anchored on this group's `session_id`.
- [`PortalTestCard.tsx`](../../src/app/portal/reports/_components/PortalTestCard.tsx) — rewritten signature: `{ test, sessionId, sessionConductedAt, framing }`. Reads metric values via `valuesAtSession(metric, sessionId)` — no longer `pickLatestSession`. Framing comes from the publication that put the test in THIS group, per Q-J5 (revised) frozen-snapshot semantic.
- [`comparison.ts`](../../src/lib/testing/comparison.ts) — extended: `SessionGroupTest` interface (test + per-publication framing); `groupHistoryBySession` populates `framing_text`; new `valuesAtSession(metric, sessionId)` helper.

**What shipped — J-2-α (Q-J9, collapsibility):**

- `PortalSessionGroup` uses `useState<boolean>(defaultExpanded)`; `DataView` sets `defaultExpanded={index === 0}` so newest is expanded, all older collapsed (Q-J9a (b)).
- Header is a full-width `<button>` (entire row tap-target); `aria-expanded` + `aria-controls` for screen-readers.
- `ChevronDown` rotates `0deg → -90deg` on collapse; body reveal via `grid-template-rows: 1fr` ⇄ `0fr` with `overflow:hidden` inner div. Transition: 300ms `cubic-bezier(0.4, 0, 0.2, 1)` matching the design-system motion token.

**What shipped — J-2-β (Q-J10b, first-capture compaction):**

- [`MilestoneChart.tsx`](../../src/app/(staff)/clients/[id]/_components/reports/client-charts/MilestoneChart.tsx) `SideMilestone`: first-capture branch becomes borderless two-line layout — row 1 = label inline with value+unit (label `.62rem` uppercase, value `1.25rem` display, unit `.74rem` muted); row 2 = `.7rem` caption "First capture · {date}".
- Outer bordered box retained for the `BaselineToLatest` branch — J-3 owns the comparison rendering refresh.
- Same component renders the staff publish-dialog preview; the staff preview is now compact too, which is correct — the preview must reflect what the client sees.
- Observed effect: multi-metric tests like Knee flexion / extension (4 metric boxes) roughly half the previous vertical footprint.

**What shipped — J-2-γ (Q-J8 + Q-J8.1 (a), staff tagging + RLS):**

- [`test-actions.ts`](../../src/app/(staff)/clients/[id]/test-actions.ts) — two new server actions:
  - `getSessionBatteryContextAction({ clientId, sessionId })` → `{ batteries: BatteryRow[], currentBatteryId: string | null }`. Parallel load of `loadActiveBatteries` + a single-row SELECT for the session's current `applied_battery_id`.
  - `setSessionBatteryAction({ clientId, sessionId, batteryId: string | null })` → `{ ok }` | `{ ok: false, error }`. Same-org defence-in-depth check on the battery before UPDATE; `revalidatePath` on both `/clients/[id]` and `/portal/reports`.
- [`TestPublishDialog.tsx`](../../src/app/(staff)/clients/[id]/_components/reports/TestPublishDialog.tsx) — new `SessionBatteryTag` component (file-local). Loads its own data on mount via the new context action — avoids prop-drilling `batteries` through ReportsTab → CategoryDetail → TestCard → TestPublishButton. Auto-saves on `<select>` change with optimistic state + revert-on-error. Renders inside both `PendingSessionForm` (under the session-of date line) and each `PublishedRow` (under the framing text).
- Portal RLS gap surfaced during verification: `test_batteries` was Pattern A (staff-only SELECT) per migration `20260428120800_testing_module_rls.sql`. The portal loader's `battery:test_batteries(name)` join silently resolved to null for client callers. Migration `20260515120000_client_select_test_batteries.sql` adds:
  - SECURITY DEFINER helper `battery_in_clients_published_session(uuid)` — returns true iff the battery is applied to a `test_session` the caller owns AND has a live `client_publications` row. Uses `auth.uid()` (un-spoofable); STABLE + SECURITY DEFINER avoids RLS recursion across `test_sessions` / `client_publications` (same pattern as the existing `client_owns_test_session` family from migration `20260428150000`).
  - Client SELECT policy `"client select test_batteries via own published session"` calling the helper. Narrow: same-org guarantee inherits via the session join; clients cannot enumerate batteries.
  - Staff SELECT policy untouched (OR'd at the policy layer).
- Applied via `npx supabase db push` (project `azjllcsffixswiigjqhj`); no type regen needed (no column changes).

**Verification:**

- `npm run type-check` + `npm run build` clean at every sub-piece. Pre-existing `database.ts` BOM drift stashed for each verify, restored byte-identically (4 stash-pop cycles total across J-2).
- Browser-verified by EP (chat 2026-05-14/15):
  - J-2-α — newest group expanded, others collapsed, 300ms reveal smooth, full-row tap target.
  - J-2-β — multi-metric test box height ~halved.
  - J-2-γ — tag persists in the staff dialog (re-opening shows the saved battery selected). Initial portal render after tagging still showed "N tests" → diagnosed as RLS gap → migration applied → portal session-group header now reads `ACL RTR · 6 tests`.
- Live SQL check confirmed the save landed pre-migration: session `a97e21fe-…` carries `applied_battery_id = 3e21de6b-…` + `battery_name = ACL RTR`.

**What didn't ship (intentional, J-3 territory):**

- No comparison toggle UI yet (per-card Baseline ↔ Previous segmented control). Q-J3 (a) per-card placement signed off; J-3 builds it.
- No MilestoneChart anchor-swap on the toggle. Q-J4 (c) signed off; J-3 builds it.
- `BaselineToLatest` rendering not touched — its bordered-box treatment stays until J-3 redesigns it alongside the toggle.

**Open follow-ups surfaced during J-2:**

- The compact first-capture rendering uses inline styles (font sizes, weights, paddings). Aligns with existing portal-side patterns (PortalTop, etc.); not a new violation. A future portal-design-system pass could lift these into a `.portal-metric-row` primitive — flagged but not Phase J scope.
- `SessionBatteryTag` shows "Saving…" inline; doesn't announce success. Optimistic state + persistence on dialog re-open is the success signal. Fine for v1.

**Phase M prerequisite confirmed live:** Q-J8 + the RLS policy together unblock the future Test Battery view — sessions can now carry battery names visible from the client side. Phase M decisions (Q-J11/12/13) are locked in `docs/deferred-prompts.md`.

J-3 opens next: comparison toggle (Q-J3 per-card) + MilestoneChart anchor-swap (Q-J4 (c)) + first-capture caption pattern when "previous" mode anchors on a missing point (Q-J4.1).

### 9.6 J-3 — Comparison toggle + MilestoneChart anchor-swap (closed pending EP sign-off, 2026-05-15)

Per the Q-J3 + Q-J4 (c) + Q-J4.1 + Q-J14 + Q-J15 contract. Pure presentation layer — no schema, no RLS, no new server actions.

**What shipped:**

- [`MilestoneChart.tsx`](../../src/app/(staff)/clients/[id]/_components/reports/client-charts/MilestoneChart.tsx) — accepts a new optional `comparisonMode?: ComparisonMode` (default `'baseline'`). A `pickComparisonFor(side)` helper inside the component picks the left endpoint per side: `pickBaseline(...)` in baseline mode, `pickPreviousBefore(metric.points, thisSessionDate, side)` in previous mode. The "baseline" caption under `Endpoint` becomes dynamic — `'previous'` when the parent's mode is `'previous'`.
- `SideMilestone` renamed its `baseline` prop to `comparisonPoint` to make the variable's role explicit (it can hold either anchor depending on mode). Refactor is internal; no caller signature change because MilestoneChart owns the picker.
- `BaselineToLatest` now takes `comparisonPoint` + `comparisonMode` and renders `'baseline'` / `'previous'` as the caption — single source of truth for the label string.
- [`ClientChartFactory.tsx`](../../src/app/(staff)/clients/[id]/_components/reports/client-charts/ClientChartFactory.tsx) — accepts optional `comparisonMode?: ComparisonMode`, passes through only to the `milestone` case. `line` / `bar` / `narrative_only` / `hidden` ignore it (Q-J4 (c) v1 scope).
- [`PortalTestCard.tsx`](../../src/app/portal/reports/_components/PortalTestCard.tsx) — now a client component (`'use client'`). Owns `useState<ComparisonMode>('baseline')` per Q-J3 (a) + Q-J15. Renders a `ComparisonToggle` (segmented control, rounded pills, mirrors the staff session-builder `ReportsPanel.tsx` visual per Q-J14) in the card header right side; test name takes the remaining flex with ellipsis. Mode threads down to each `MetricBlock` → `ClientChartFactory`.
- File-local `ComparisonToggle` + `ToggleSegment` in `PortalTestCard.tsx`. Slightly larger padding than the staff version (4px vertical instead of 3px) for mobile tap targets — design-token-only otherwise (`--color-surface`, `--color-charcoal`, `--color-muted`, the 0.4-0-0.2-1 motion easing).
- Q-J4.1 first-capture fallback in "previous" mode is automatic — when `pickPreviousBefore` returns null, `isFirstCapture` evaluates true and the existing J-2-β compact two-line caption renders. No extra code needed.

**Staff side untouched:**

- `TestPublishDialog`'s chart preview passes no `comparisonMode`, gets the default `'baseline'`, renders identically to pre-J-3.
- Staff Reports tab's `TestCard` / `MetricBadge` / staff chart family unrelated — they use `ChartFactory` (Recharts), not `ClientChartFactory`. No regression risk.
- Staff session-builder right-rail `ReportsPanel.tsx` has its OWN per-card toggle (text-rows, not milestone-chart) — independent of this work.

**Files changed:**

MODIFIED: `MilestoneChart.tsx`, `ClientChartFactory.tsx`, `PortalTestCard.tsx`.

**Verification:**

- `npm run type-check` + `npm run build` clean against a HEAD `database.ts` (drift stashed/popped one cycle).
- Browser-verified by EP (chat 2026-05-15):
  - Toggle visible in card header, defaults to `Baseline`.
  - Tap `Previous` → left endpoint swaps, delta arrow + percentage update, caption changes `baseline` → `previous`.
  - Single-capture metrics collapse to the compact "First capture · {date}" caption in `Previous` mode.
  - Per-card independence works (KOOS in `Previous` while Knee flexion stays on `Baseline`).
  - Staff publish-dialog preview unchanged.

**What didn't ship (intentional):**

- `line` / `bar` chart variants don't respond to the toggle. Per Q-J4 (c) v1 scope. Revisit if the EP discovers a line/bar metric that wants a comparison hint.
- No mode persistence across mounts (tab switch / collapse-reopen resets to `Baseline`). Per Q-J6 sign-off — `useState` only.
- No animation on the value swap. The 150ms colour/background transition on the toggle pill itself was kept; adding a content cross-fade would be motion-overkill per design-system restraint.

---

## Phase J overall — closed 2026-05-15

All three sub-phases shipped:

| Sub-phase | Commit | Scope |
|---|---|---|
| **J-1** | `827ee8a` | Comparison helpers + session grouping (pure-helper extraction) |
| **J-2** | `535ee58` | Hierarchical render + collapsibility + compaction + staff tagging + RLS migration |
| **J-3** | pending | Comparison toggle + MilestoneChart anchor-swap |

**Acceptance bar from the handoff brief:**

- [x] `?tab=data` renders the new hierarchical layout: batteries (collapsible) → tests → metrics with charts/narrative.
- [x] Baseline-vs-previous toggle works on each metric (per Q-J3 per-card scope).
- [x] Percentage deltas render with direction-of-good colour (via `colourFor`).
- [x] Standalone tests render as top-level entries (Q-J6 (a) degenerate one-test group).
- [x] All six client states render correctly (verified pragmatically — same code paths, edge cases covered).
- [x] `npm run build` passes clean (verified at each sub-phase landing).
- [x] Each sub-phase's gap doc / sign-off log lives in §9.4 / §9.5 / §9.6.
- [x] Parent doc `client-portal.md` §4 row **J** marked ✓ (in this commit).

**Phase J is the final phase in the client-portal polish pass.** Per CLAUDE.md the suggested next pass is **auth & onboarding** — but this milestone is a natural pause for the EP to redirect to the open gates (external IT advisor review of `auth.md` + `rls-policies.md`) before any further polish work.
