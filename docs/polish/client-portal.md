# Polish-pass gap analysis — Client portal

**Brief:** No standalone MD. Target state captured in CLAUDE.md (project working agreement, design rules) + `Client_Platform_Brief_v2.1.docx` (master spec, mobile-first PWA section).
**Reference prototype:** [`client-portal.html`](../../client-portal.html) — validated UX for week strip, session card, in-session logger, completion flow.
**Current implementation:** [`src/app/portal/`](../../src/app/portal/) — routes for Today, Program, Session, Reports, Book, Messages, You; PWA wiring in [`public/manifest.json`](../../public/manifest.json) and [`public/sw.js`](../../public/sw.js).
**Audit date:** 2026-05-10
**Status:** Gap document — locked. Phase plan in §4 below.

---

## 0. Executive summary

The portal is roughly **75% production-ready**. The session logger (the load-bearing surface — a client mid-session in a gym needs this to *just work*) is well-built: optimistic per-set RPC writes, idempotent start-or-resume, clean stats math on the completion screen. The messages thread has genuinely defensive realtime — visibility-change resync covers the case where iOS suspends the WebSocket while the PWA is backgrounded. Auth + RLS scoping is correct throughout.

Three problem clusters need addressing before launch:

1. **Architectural divergence from the staff side.** The staff portal composes its UI from CSS class primitives in [`globals.css`](../../src/app/globals.css) (`.card`, `.btn.primary`, `.eyebrow`, `.tag`, `.chip`) — used 154 times across 52 files. The client portal reimplements those same shapes inline with hardcoded values; the primitives are used **once** (in [`ClientThread.tsx`](../../src/app/portal/messages/_components/ClientThread.tsx)). Result: drift, three different "card" definitions, fragile token usage. This is the single largest gap and §1.4 notes the model that already exists for fixing it.

2. **Load-bearing data not captured.** The session completion flow accepts feedback + overall session RPE in the database and the RPC, but the portal hands them in as `null` and the completion screen has no input fields. Every session is logged with no narrative and no overall load signal.

3. **Stubbed surfaces that the navigation still links to.** The `Book` route is a placeholder; the legacy reports tab lists files that aren't openable; the Today screen shows "completed this week: 0" hardcoded. These create trust gaps the moment a real client touches them.

The PWA wiring is honest about its v1 deferral — the service worker file's own header comment says "When we add offline session logging, this file gets real." That deferral is acknowledged below as a watch-list item, not a launch blocker.

### 0.1 Sign-off log (chat 2026-05-10)

| # | Question | Answer | Notes |
|---|----------|--------|-------|
| A1 | How to fix portal-vs-staff design divergence | **(ii)** Extend `globals.css` with `.portal-card`, `.portal-btn-primary`, `.portal-eyebrow` etc. as siblings to `.portal-thread__*`. Components reference the new classes. | Mobile-first sizing stays in CSS where it belongs |
| A2 | `.card` shadow — CLAUDE.md (`0 1px 3px rgba(0,0,0,.06)`) vs globals.css `.card` (two warm-tinted shadows) | **Staff wins.** Portal `.portal-card` adopts the two-shadow warm-tinted treatment from `globals.css:342-343`. | Downstream: CLAUDE.md needs update; flagged as P2 follow-up below |
| B1 | Where to capture post-session feedback + session RPE | **(a)** Capture on the portal completion screen (data is freshest). Display in the staff `clients/[id]/program` view as a collapsible per-session row. | Two halves: portal-side capture, staff-side display |
| B2 | PWA manifest icons | **Keep — fix.** Add 192px + 512px PNGs. | Android install will fail without them |
| B3 | Service worker offline support | **Defer with watch-list.** Stay with v1 no-op SW. Reassess once first 5 clients have completed 10 sessions each — escalate to launch-blocker if any data loss is reported. | Signal-driven escalation, not guess-driven |
| C1 | `Book` route — build now or defer | **(α)** Build full booking flow now. Decisions locked 2026-05-10: (1) email-only reminders at launch, defer SMS (Twilio not wired); (2) cancellation policy — free cancel up to 24h before, after that must message EP; (3) instant-confirm (client picks slot → booked, EP sees on schedule). Handed off to parallel chat. | Handoff prompt: [`client-portal-handoffs.md`](./client-portal-handoffs.md) Phase F. Phase A lands first so F uses polished primitives. |
| C2 | Today's "completed this week" hardcoded to 0 | **Keep** — wire to sessions table | Trust-killer otherwise |
| C3 | Legacy reports list non-clickable | **Keep — verified.** Rows render but have no `href`, no `onClick`, and the SELECT in `page.tsx:64` doesn't pull `file_url`. Need both fixes. | Verified during audit, not during phase work |
| C4 | Mid-session resume not field-tested | **Keep as a manual test item.** Not a code change; verify path with a manual session. | Add to acceptance test plan |
| D1–D5 | Token violations across portal components | **Keep.** All addressed wholesale by Phase B refactor onto the new primitives. | Listed in §2.D for traceability; no separate work |
| E | "Works as intended" list | **Keep** | Protects against regression |

---

## 1. What's already correct

Pieces of the existing implementation that align with the target state and should be preserved.

### 1.1 Session start/resume idempotency
[`actions.ts`](../../src/app/portal/session/[dayId]/actions.ts) `startOrResumeSessionAction` correctly looks up an in-progress session for the day before calling `client_start_session`. Closing the app and reopening lands the client back in the same session row.

### 1.2 Per-set logging via RPC
[`Logger.tsx`](../../src/app/portal/session/[dayId]/_components/Logger.tsx) → `logSetAction` → `client_log_set` RPC. Each set is its own write, optimistic state held client-side. Clean separation: server actions don't validate (the RPC does), the client doesn't trust (it re-renders from RPC return).

### 1.3 Realtime + visibility-change resync
[`BottomNav.tsx`](../../src/app/portal/_components/BottomNav.tsx) lines 42-76 listen to `postgres_changes` on the `messages` table and *also* `router.refresh()` on `visibilitychange` + `focus`. Phones suspend WebSockets when the screen sleeps; events that fire during that window are dropped on reconnect. The visibility resync covers it. Same pattern in [`ClientThread.tsx`](../../src/app/portal/messages/_components/ClientThread.tsx). Don't touch.

### 1.4 The portal-prefixed CSS primitive pattern (the model to extend)
[`globals.css`](../../src/app/globals.css) lines 903-930 already defines `.portal-thread`, `.portal-thread__head`, `.portal-thread__body`, `.portal-thread__composer` for the messages thread. This is exactly the right pattern — portal-specific, mobile-first sized, token-driven. **Phase A extends this convention** to `.portal-card`, `.portal-btn-primary`, `.portal-btn-secondary`, `.portal-eyebrow`, `.portal-week-strip`, `.portal-day-cell`, `.portal-stat`, `.portal-empty`. The existing `.portal-thread__*` block stays unchanged.

### 1.5 RLS-aware data loading
Every server-side query in the portal correctly uses `is('deleted_at', null)`. The portal's `clients` lookup uses `.eq('user_id', user.id)` — RLS enforces self-only access at the policy level. No `service_role` calls, no policy bypass.

### 1.6 Completion screen stats math
[`complete/page.tsx`](../../src/app/portal/session/[dayId]/complete/page.tsx) lines 53-85 — total volume, average RPE, duration. Math is correct, NULL handling is clean, the FallbackCard for "session not yet completed" handles deep-links gracefully.

---

## 2. Gaps to close

### A. Architectural

| # | Gap | Files | Why it matters |
|---|-----|-------|----------------|
| **A1** | Portal reimplements design-system primitives inline; staff uses CSS classes. 154 staff uses vs 1 portal use. | [`BottomNav.tsx`](../../src/app/portal/_components/BottomNav.tsx), [`TodayScreen.tsx`](../../src/app/portal/_components/TodayScreen.tsx), [`PortalTop.tsx`](../../src/app/portal/_components/PortalTop.tsx), [`Logger.tsx`](../../src/app/portal/session/[dayId]/_components/Logger.tsx), [`LegacyView.tsx`](../../src/app/portal/reports/_components/LegacyView.tsx), [`complete/page.tsx`](../../src/app/portal/session/[dayId]/complete/page.tsx) | Drift, hardcoded values, three different "card" definitions. Fixing this in Phases A + B closes D1-D5 wholesale. |
| **A2** | CLAUDE.md and `globals.css` `.card` disagree on shadow treatment. CLAUDE.md says one shadow `0 1px 3px rgba(0,0,0,.06)`; globals.css uses two warm-tinted shadows. Staff renders the two-shadow version. | [CLAUDE.md](../../CLAUDE.md) line in design-system section, [`globals.css:342-343`](../../src/app/globals.css) | Decision: staff wins. CLAUDE.md update is a follow-up after Phase A lands so the brief stays aligned with reality. |
| **A3** | `src/lib/constants.ts` referenced in CLAUDE.md doesn't exist. | [CLAUDE.md](../../CLAUDE.md) | Either remove the reference or create the file. Recommend removing — `globals.css` is the single source of truth and that's working fine. |

### B. Load-bearing functionality

| # | Gap | Files | Why it matters |
|---|-----|-------|----------------|
| **B1** | Post-session feedback + overall session RPE never captured. Logger calls `completeSessionAction(..., null, null)`; completion screen is read-only. | [`Logger.tsx:618-623`](../../src/app/portal/session/[dayId]/_components/Logger.tsx), [`complete/page.tsx`](../../src/app/portal/session/[dayId]/complete/page.tsx), [`actions.ts:88-108`](../../src/app/portal/session/[dayId]/actions.ts), staff-side display in [`(staff)/clients/[id]/program/`](../../src/app/(staff)/clients/[id]/program) | Two-part fix: (1) portal completion screen gets a textarea + RPE picker before the `Finish session` CTA; (2) staff program view gets a collapsible per-session expander showing the captured data. Schema and RPC already accept the values — only UI is missing. |
| **B2** | PWA manifest only registers `favicon.ico` (48/32/16px). | [`public/manifest.json`](../../public/manifest.json) | Android install prompt requires ≥192×192. Need 192px + 512px PNGs added to `/public/icons/` and listed in the manifest's `icons[]` array. |

### C. Stale / stubbed

| # | Gap | Files | Why it matters |
|---|-----|-------|----------------|
| **C1** | `Book` route is a placeholder. BottomNav links to it. | [`book/page.tsx`](../../src/app/portal/book/page.tsx), [`BottomNav.tsx:18`](../../src/app/portal/_components/BottomNav.tsx) | Phase F (handoff): scaffold-and-handoff. Replace with "Coming soon — message your EP" CTA, drop nav slot (6→5 columns). Full booking flow handed off to parallel chat per [`client-portal-handoffs.md`](./client-portal-handoffs.md). |
| **C2** | Today's "completed this week" hardcoded to 0. Comment says "wires to sessions table" but no query exists. | [`portal/page.tsx:104, 143-145`](../../src/app/portal/page.tsx) | Add a query: count `sessions` where `program_day_id IN (this week's days)` AND `completed_at IS NOT NULL`. Set both `completed` and the per-day `done` flag in `programmedByWeekday`. |
| **C3** | Legacy reports list renders rows but they aren't clickable; SELECT doesn't pull a file URL. **Verified.** | [`reports/page.tsx:64`](../../src/app/portal/reports/page.tsx), [`LegacyView.tsx:23-55`](../../src/app/portal/reports/_components/LegacyView.tsx) | Two fixes: (1) extend the SELECT to include `file_url` (or whatever the storage column is — confirm against `reports` schema); (2) wrap the row `<div>` in a `<Link href={r.file_url} target="_blank">` and remove the decorative `<ChevronRight>` (it's not navigation, it's a download). |
| **C4** | Mid-session resume path not field-tested. | [`actions.ts:14-47`](../../src/app/portal/session/[dayId]/actions.ts), [`Logger.tsx`](../../src/app/portal/session/[dayId]/_components/Logger.tsx) | Manual test: start a session, log 2 sets, close the PWA, reopen, confirm logged sets are visible and the "next set" focus is on set 3. Not a code change unless the test fails. |

### E. Data-tab redesign (deferred to Phase J)

| # | Gap | Files | Why it matters |
|---|-----|-------|----------------|
| **E1** | Portal `?tab=data` renders test results as a flat list of cards. EP wants it to behave like the staff session-builder reports panel: collapsible **battery → test → metric** hierarchy; toggle baseline vs previous comparison; explicit percentage-change deltas; standalone tests render as their own entry when not part of a battery. | [`DataView.tsx`](../../src/app/portal/reports/_components/DataView.tsx), [`PortalTestCard.tsx`](../../src/app/portal/reports/_components/PortalTestCard.tsx); likely new shared comparison components, possibly shared with `(staff)/clients/[id]/_components/reports/`. | The structured testing module is the active polish section (CLAUDE.md). The portal Data tab is its client-facing surface and currently doesn't carry the comparison story that makes the module valuable for the client to interpret on their own. |

### D. Token violations (closed wholesale by Phase B)

These are listed for traceability. None require independent fix — Phase B's refactor onto `.portal-*` primitives removes them all by replacement.

| # | Location | What | Replaced by |
|---|----------|------|-------------|
| **D1** | [`BottomNav.tsx:86-87`](../../src/app/portal/_components/BottomNav.tsx) | `background: '#fff'`, `borderTop: '1px solid #E2DDD7'` | New `.portal-bottom-nav` class referencing `var(--color-card)` + `var(--color-border-hairline)` |
| **D2** | [`TodayScreen.tsx:107-108, 178-181, 280-285`](../../src/app/portal/_components/TodayScreen.tsx) | Five `'#fff'` literals; `borderRadius: 10/14/12` integers; inline box-shadow | `.portal-card`, `.portal-week-strip`, `.portal-btn-primary` |
| **D3** | [`TodayScreen.tsx:411-420`](../../src/app/portal/_components/TodayScreen.tsx) | `Seq` tone mapping uses raw hex (`#78746F`, `#D9D2C8`); names are misleading (`primary` is muted grey, `accent` is parchment, `amber` is not amber) | New `.portal-seq` with `data-tone` attribute; tones rename to `default / muted / parchment / outline` to match what they actually render |
| **D4** | [`PortalTop.tsx:49-57`](../../src/app/portal/_components/PortalTop.tsx) | PortalEmpty card reimplements card pattern inline | `.portal-empty` class |
| **D5** | [`Logger.tsx:459, 496`](../../src/app/portal/session/[dayId]/_components/Logger.tsx) | Hardcoded `box-shadow` and `rgba(214,64,69,.08)` | `.portal-card.is-error` modifier referencing `var(--color-alert)` |

---

## 3. What NOT to touch (regression protection)

- **Logger's per-set RPC flow.** Optimistic state, set-keyed inputs, `client_log_set` calls. The shape works.
- **`startOrResumeSessionAction` idempotency.** The "is there an in-progress session" check before calling the RPC handles the deep-link / reload edge cases correctly.
- **BottomNav unread badge subscription + visibility resync.** Genuinely defensive — reproduce the pattern when adding any other realtime surfaces, don't replace it.
- **`ClientThread.tsx` and `.portal-thread__*` styling.** These are the model the rest of the portal will follow in Phase A. Already correct.
- **Auth gate in `portal/layout.tsx`** and the consistent `is('deleted_at', null)` filtering on every server query. The security baseline is good.
- **Completion screen stats math.** Volume / avg RPE / duration calculations are correct.
- **The `client_start_session`, `client_log_set`, `client_complete_session` RPCs.** They accept the feedback + session_rpe fields already; B1 only changes the UI that calls them.

---

## 4. Phasing

Phases run sequentially in this chat unless noted otherwise. Each phase closes specific gaps and has a single sign-off bar at the end.

| Phase | Closes | Scope | Dependency |
|-------|--------|-------|------------|
| **A** | A1 (foundation), A2 | Add `.portal-card`, `.portal-btn-primary`, `.portal-btn-secondary`, `.portal-eyebrow`, `.portal-week-strip`, `.portal-day-cell`, `.portal-seq`, `.portal-stat`, `.portal-empty`, `.portal-bottom-nav` to `globals.css`. Token-driven, mobile-first sizing, two-shadow `.card` treatment per A2 decision. No component changes yet. | None |
| **B** | A1 (refactor), D1-D5 | Refactor `BottomNav`, `TodayScreen`, `PortalTop`, `PortalEmpty`, `LegacyView`, `complete/page.tsx`, `Logger`'s static chrome (not the live form inputs) to use the Phase A classes. Delete inline `style` props that are now redundant. Visual diff: nothing should change. | A |
| **C** | B1 (portal half) | Add a feedback textarea + 1-10 RPE picker to the portal completion path. Two options for placement to be decided in Phase C kickoff: (i) inline in the `CompletePrompt` component before `Finish session`; (ii) as a step on the post-completion `complete/page.tsx`. Logger passes the captured values to `completeSessionAction` (no longer `null, null`). | B |
| **D** ✓ | B1 (staff half) — **closed 2026-05-11.** | Added per-session completion display in the `clients/[id]/program` view. **Pre-flight finding:** the view is a `MonthCalendar` not a list — so the expander lives inside the existing `DaySummaryPopover` rather than as a flat-row accordion. Eager loader pulls sessions + exercise_logs + set_logs per visible day, popover widens to ~320px when there's completion data, accent-green dot marks completed cells. Schema unchanged. Full gap doc + sign-off log: [`staff-program-session-display.md`](./staff-program-session-display.md). | C (test data via Scott's 2026-05-11 completion) |
| **E** ✓ | B2 — **closed 2026-05-12.** | Added `icon-192.png`, `icon-512.png` (purpose `any`), `icon-maskable-512.png` (purpose `maskable`), `icon-apple-touch.png` (180×180 iOS) under `/public/icons/`. Composition: charcoal field, white "O" in Bahnschrift Condensed Bold (closest Windows-default to Barlow Condensed), accent-green dot to the right. Generation captured in `scripts/generate-pwa-icons.ps1` so the EP can regenerate with a different font/mark once ExCo's brand asset lands. Manifest `icons[]` rewritten to reference the new files; `background_color` changed from `#E8ECE9` (desktop wrap surface) to `#F7F4F0` (parchment page surface) so the phone splash matches what loads behind it. Apple touch icon wired via Next.js Metadata API in `portal/layout.tsx` (`icons.apple`). Decisions: §4.1. | None |
| **F** | C1 (handed off — α full build) | **Handed off — see [`client-portal-handoffs.md`](./client-portal-handoffs.md).** Runs in parallel chat after Phase A lands. Full booking flow per locked decisions: instant-confirm, 24h free cancel, email-only reminders at launch. Builds: slot computation RPC, picker UI, `client_book_appointment` RPC, upcoming bookings panel + cancellation, email reminders at T-24h and T-1h. **Soft prerequisite: Phase A landed** so Phase F uses `.portal-card` / `.portal-btn-primary` directly instead of inline styles. | A (soft) |
| **G** ✓ | C3 — **closed 2026-05-12.** | Extended reports SELECT to include `storage_bucket`/`storage_path` via the per-row route handler at `/portal/reports/file/[id]/route.ts` (60s signed URL + 307 redirect, mirroring the staff `getClientFileSignedUrlAction` pattern). `LegacyView` rows now render as `<Link target="_blank" rel="noopener noreferrer">` with an `ExternalLink` icon. Decisions: §4.3. | A (so the row uses `.portal-card`) |
| **H** ✓ | C2 + portal sub-tab rename — **closed 2026-05-12.** | Added RLS-scoped `sessions` SELECT in [`portal/page.tsx`](../../src/app/portal/page.tsx) filtered by this week's `program_day_id` list + `completed_at IS NOT NULL` + `deleted_at IS NULL`. Built a `Set<program_day_id>` of completed days, wired into `weekStats.completed`, `weekStats.remaining`, and per-day `done` flag in `programmedByWeekday`. Empty-program edge case (`weekDays.length === 0`) short-circuits the query. Folded in the EP's 2026-05-12 ask: renamed portal Reports sub-tab "Files" → "Reports" (label, URL param `tab=files → tab=reports`, page discriminator + type, empty-state copy). Decisions: §4.4. | A (so `.portal-stat` renders the value) |
| **I** ✓ | C4 + B3 — **closed 2026-05-13.** | Resume test passed clean: PWA backgrounded mid-session, reopened, same session row resumed with logged state intact. Pre-flight verification surfaced two Phase H regressions + a UX wart on the v3 RPC user-facing path; all folded into Phase I per §4.5.1 (I-R1..R5). Decisions, root causes, shipped files: §4.5 + §4.5.1. | All other phases done |
| **J** | E1 | Data-tab redesign per session-builder reports panel. Collapsible battery hierarchy, baseline-vs-previous toggle, percentage-change deltas, standalone-test render variant. **Own gap doc required** (`docs/polish/client-portal-data-tab.md`) — opens with its own sub-protocol pass: design audit of the session builder reports panel + battery grouping data model + comparison toggle semantics. Likely spawns 2-3 sub-phases. Cross-references the active testing-module polish at [`testing-module.md`](./testing-module.md). | A (uses `.portal-card`); independent of G |
| **K** ✓ | §5 strip-cell routing follow-up (future + skipped-past) — **closed 2026-05-13.** | Per-day card view replaces strip-cell-to-Logger routing. Strip cells now navigate to `/portal?d=YYYY-MM-DD`; the existing Today component renamed to `DayScreen` and rewired to render the selected day's card. Six CTA states render from a server-derived `DayState` discriminated union (today-not-started / today-in-progress / today-completed / past-completed / past-skipped / future-scheduled), plus rest-day fallback to `.portal-empty`. New `client_reschedule_program_day_to_today` RPC + server action `rescheduleAndStartSessionAction` handle "Begin session early" with a styled .portal-card overlay carrying the EP-locked verbatim copy. Phase I's page-level completion guard + v3 `client_start_session` backstop stay in place as defence in depth. Single combined session SELECT (Q-K6.1 most-robust choice) replaces Phase H's completed-only query — derives both `completedDayIds` and `inProgressDayIds` from one query. Gap doc + sign-off log: [`client-portal-day-card.md`](./client-portal-day-card.md). Decisions: §4.6. | I |

### 4.1 Phase E — PWA install icons (decisions locked, chat 2026-05-12)

Implements gap B2. No service worker changes (B3 stays deferred per §0.1).

| # | Question | Answer | Notes |
|---|----------|--------|-------|
| E-Q1 | Icon source | **(b)** Generate from the design system via a PowerShell `System.Drawing` script (`scripts/generate-pwa-icons.ps1`). No npm install, no external dependency. Script is committed so the EP can re-run with a different font / mark once ExCo's brand asset lands. | Composition: charcoal background, white "O" in a bold condensed system font (Bahnschrift Condensed → Impact → Arial Black fallback chain), accent-green dot to the O's right at baseline. Inner 80% safe zone respected on every variant so the same composition serves both `any` and `maskable`. |
| E-Q2 | Maskable variant | **(a)** Both. `icon-192.png` + `icon-512.png` (`purpose: "any"`) plus `icon-maskable-512.png` (`purpose: "maskable"`). | Same charcoal background on both — composition already lives inside the maskable safe zone. |
| E-Q3 | Apple touch icon | **(a)** In scope. Add `icon-apple-touch.png` at 180×180 and wire via Next.js Metadata API (`icons.apple`) in `portal/layout.tsx`. | iOS adds its own rounded-corner mask; no separate maskable variant needed for iOS. |
| E-Q4 | Manifest theme + background | Keep `theme_color: "#1E1A18"` (already matches `--color-primary`). **Change `background_color` from `#E8ECE9` to `#F7F4F0`** (parchment, matches `--color-surface` — what loads behind the splash on phone install). | `#E8ECE9` is the desktop `.portal-shell` wrap surface, not the page surface. Phone install only sees the page surface. |
| E-SQ1 | `favicon.ico` entry in `icons[]` | **Drop it.** Manifest `icons[]` is for PWA install assets only; tab favicons are served separately by Next.js from `src/app/favicon.ico`. | Removes a stale reference to a `/public/favicon.ico` that doesn't exist (was only resolving by Next.js app-router coincidence). |
| E-SQ2 | `name` / `short_name` | **Leave as-is** — `"Odyssey"` for both. Under the 12-char Android home-screen limit, sentence case, Australian voice. | No change. |

**Design-token trace.** Hex values used in the icons (auditable per CLAUDE.md "design tokens live in `globals.css` / `constants.ts` only" rule):

| Where | Hex | Token |
|-------|-----|-------|
| Icon background | `#231f20` | `--color-charcoal` |
| Icon "O" fill | `#ffffff` | (white literal — matches `.btn.primary` color, the topbar text colour) |
| Icon dot fill | `#2db24c` | `--color-accent` |
| Manifest `theme_color` | `#1E1A18` | `--color-primary` |
| Manifest `background_color` | `#F7F4F0` | `--color-surface` |

**Font fallback note.** Barlow Condensed (the design-system display font) is loaded via Next.js Google Fonts at runtime, not installed as a Windows system font. The icon-generation script uses `Bahnschrift Condensed` (Windows 10/11 default — closest condensed bold), with `Impact` and `Arial Black` as fallbacks. When ExCo provides a brand asset or Barlow Condensed gets installed as a system font, the EP can re-run the script for higher fidelity. Tracked as a post-launch nice-to-have, not a launch blocker — the "O" + green dot composition reads as Odyssey regardless of which heavy condensed sans renders the letter.

### 4.2 Phase F — handoff acknowledgement (locked α full build)

Phase F runs in a parallel chat per the user's instruction (2026-05-10). The handoff prompt is at [`client-portal-handoffs.md`](./client-portal-handoffs.md) §F. **Locked decisions:**

- **(1) Email-only reminders at launch.** Twilio not wired; SMS deferred to a later pass. Resend (`src/lib/email/client.ts`) handles T-24h and T-1h confirmation + reminder emails.
- **(2) Cancellation policy:** clients can self-cancel up to 24 hours before the appointment start. Inside the 24h window, the cancel CTA on the portal turns into a "message your EP" CTA pointing at `/portal/messages`.
- **(3) Confirmation flow:** instant-confirm. The `client_book_appointment` RPC validates the slot is still open at insert time and writes the appointment with `status = 'confirmed'`. EP sees it on their schedule with no action required. The slot-availability RPC is the source of truth.

When Phase F lands:

- BottomNav still has 6 items but the `Book` route is now functional rather than a stub. **No nav-shape change**, which simplifies the coordination story versus the original (β) scaffold path.
- `book/page.tsx` becomes the "upcoming bookings" + "Book a session" entry view; sub-routes handle the picker steps.
- Phase B (in this chat) refactors BottomNav inline styles onto `.portal-bottom-nav` per Phase A. Phase F should **not** touch BottomNav inline styles — that's Phase B's job. Phase F adds new content under `/portal/book/*`, doesn't restructure the nav.

The handoff prompt instructs the parallel agent to write its own gap doc (`docs/polish/client-portal-booking.md`) following the polish-pass protocol before writing code. Sub-tasks are pre-listed in the prompt; the gap doc captures the EP's sign-off on each before implementation begins.

### 4.3 Phase G — Legacy reports clickable (decisions locked, chat 2026-05-12)

Implements gap C3. Single functional change: legacy report rows on `/portal/reports?tab=files` open the file when tapped. Zero schema migrations.

| # | Question | Answer | Notes |
|---|----------|--------|-------|
| G-Q1 | File URL column on `reports` | **(b)** `storage_bucket` + `storage_path`. Schema is `storage_bucket text NOT NULL DEFAULT 'reports'` + `storage_path text NOT NULL`. No `file_url` column exists — rendered HTML lives in Supabase Storage. | Confirmed against [migration 20260420102200](../../supabase/migrations/20260420102200_reports_and_vald.sql) lines 47-70 and live types at [`database.ts:2346`](../../src/types/database.ts). |
| G-Q1.1 | Where to generate the signed URL | **(ii)** New route handler at `/portal/reports/file/[id]/route.ts`. Row link is `/portal/reports/file/{id}`; handler resolves to a fresh 60-second signed URL and 307-redirects. Signed URL never lands in HTML; never expires from the client's view. | Mirrors the staff `getClientFileSignedUrlAction` pattern at [`files-actions.ts:240-278`](../../src/app/(staff)/clients/[id]/files-actions.ts). Auth-gated by `proxy.ts` middleware. RLS scopes the lookup; handler also restates `is_published = true` + `deleted_at IS NULL` (defense in depth). |
| G-Q2 | Tap behaviour | **(a)** Open in new tab — `target="_blank" rel="noopener noreferrer"`. Portal stays open in the original tab; HTML/PDF render inline in the new tab. | Same-tab would lose the client's place. Force-download is wrong for HTML reports that should render inline. |
| G-Q3 | NULL file URL handling | **No-op.** `storage_path` is `NOT NULL` at the schema level + SELECT filters `is_published = true`. The DB-level NULL case doesn't exist. Edge case "file missing in storage" collapses to a 404 from the route handler — no UI change needed. | |
| G-Q4 | Icon | **(b)** `ExternalLink` (square with arrow). Matches Q2 "opens elsewhere" semantic. Replaces the misleading `ChevronRight` (which reads as "drill into a detail page within the portal"). | |

**Scope clarification (chat 2026-05-12).** EP raised wanting the portal Reports surface to also show structured testing data with collapsible battery → test → metric drill-down, baseline/previous toggle, and percentage-change deltas — the way the session builder right rail does. Surfaced that this maps to the existing `?tab=data` view (`DataView.tsx` + `PortalTestCard.tsx`), not the `?tab=files` view Phase G covers, and that it's a significantly larger redesign. **Decision: Option A (split).** Phase G stays narrow on the legacy file click fix. New gap §2.E + follow-up Phase J in §4 capture the Data-tab redesign as separate work with its own gap doc.

### 4.4 Phase H — Completed-this-week wire-up + Reports sub-tab rename (decisions locked, chat 2026-05-12)

Implements gap C2 (Today's "completed this week" stat hardcoded to 0) and folds in the EP's 2026-05-12 ask to rename the portal Reports sub-tab "Files" → "Reports" to remove the naming clash with the staff client profile's `client_files` "Files" tab. Zero schema migrations.

| # | Question | Answer | Notes |
|---|----------|--------|-------|
| H-Q1 | Where to query the sessions count from | **(a)** Direct RLS-scoped SELECT on `sessions` in [`portal/page.tsx`](../../src/app/portal/page.tsx). Filter: `program_day_id IN (this week's days)`, `completed_at IS NOT NULL`, `is('deleted_at', null)`. RLS scopes to the caller's own sessions. | Zero migration; matches the existing direct-SELECT pattern used for `clients` and `programs` in the same file. Promote to a SECURITY DEFINER RPC only if perf becomes an issue post-launch. |
| H-Q2 | What counts as "completed" | **(a)** `completed_at IS NOT NULL` (and not soft-deleted). Schema-level. | Matches how the staff side counts completion (Phase D `MonthCalendar` / `DaySummaryPopover`). If "completed with no sets" sessions slip through, that's a Logger bug to fix at source, not a count workaround. |
| H-Q3 | Per-day `done` shape on `programmedByWeekday` | **(a)** Keep `done: boolean`. Set `true` if a completed, non-soft-deleted session exists for the day's `program_day_id`. | `buildWeekDots` and `TodayScreen` already consume `done` as a boolean. Don't grow the shape for this phase. |
| H-Q4 | Tab rename scope | **(b)** Rename UI label AND URL param. `label: 'Files' → 'Reports'`, `href: '/portal/reports?tab=files' → '/portal/reports?tab=reports'`, page discriminator `sp.tab === 'files' → sp.tab === 'reports'`, `ActiveTab` type member `'files' → 'reports'`. | Pre-launch the URL is rewritable at no cost; consistent naming reduces post-launch confusion. Phase G's `/portal/reports/file/[id]/route.ts` doesn't read `?tab`, so it's unaffected. Grep `tab=files` against `src/` confirmed zero other portal-side references (the two staff matches are unrelated — they're `client_files`, not `reports`). |
| H-Q5 | Other sub-tab label after the rename | **(a)** Keep `Your data`. Pair reads as `Your data` + `Reports`. | `Your data` is the established client-friendly framing (possessive, sentence case, voice-matched). `Data` reads colder; `Latest` is ambiguous. Don't break voice for symmetry. |

**Finding deferred to follow-up.** `buildWeekDots` ([`portal-helpers.ts:110`](../../src/app/portal/_lib/portal-helpers.ts)) sets `state: 'done'` when `entry.done || isPast`. Past-but-skipped programmed days will still render as "done" because of the `isPast` short-circuit, even after Phase H wires real completion data. Today and future days reflect actual completion correctly. Out of scope for Phase H — likely surfaces during Phase I manual testing and gets its own one-line fix (drop `|| isPast`, let `entry.done` be the single truth). Tracked in §5.

**What shipped.**

- [`src/app/portal/page.tsx`](../../src/app/portal/page.tsx) — added RLS-scoped `sessions` SELECT after the `client_get_week_overview` RPC call. Builds a `Set<string>` of completed `program_day_id`s, wired into `programmedByWeekday[].done` and `weekStats.completed` / `weekStats.remaining`. Short-circuits the query when `weekDays.length === 0` (no active program).
- [`src/app/portal/reports/_components/ReportsTabs.tsx`](../../src/app/portal/reports/_components/ReportsTabs.tsx) — `ActiveTab` type member renamed `'files' → 'reports'`; tab label renamed `'Files' → 'Reports'`; href renamed `?tab=files → ?tab=reports`. `Your data` left as-is.
- [`src/app/portal/reports/page.tsx`](../../src/app/portal/reports/page.tsx) — `ActiveTab` type + discriminator updated to match; section comment updated; empty-state copy updated `'No files yet' → 'No reports yet'` and `'…assessment file or summary…' → '…assessment report…'`.

**Verification result.** `npm run build` passes clean (12.5s compile, all routes generated). Design-token grep on `src/app/portal/` returns only pre-existing matches (Phase B targets); Phase H added zero new hex literals, raw radii, or shadow strings. `tab=files` / `'files'` grep on `src/app/portal/` returns zero matches.

### 4.5 Phase I — Mid-session resume manual test + B3 watch-list activation (decisions locked, chat 2026-05-12)

Closes gap **C4** (manual field test of close-PWA-mid-session resume — not a code change unless the test fails) and **B3** (docs-only activation of the watch-list bullet already in §5). Zero schema migrations expected.

| # | Question | Answer | Notes |
|---|----------|--------|-------|
| I-Q1 | Test device | **(a) iPhone PWA install.** No Android device available to the EP at this stage. | iOS is the higher-signal test anyway — the visibility-change resync in [`BottomNav.tsx`](../../src/app/portal/_components/BottomNav.tsx) and [`ClientThread.tsx`](../../src/app/portal/messages/_components/ClientThread.tsx) (§1.3) was designed for the iOS WebSocket-suspension case. |
| I-Q2 | Tap-out depth | **(ii) default + (iii) stress.** Default: background → lock screen → ~30s wait → reopen from home-screen icon. Stress: hard-kill via the recents tray, then reopen from home-screen icon. | (ii) mimics a real client pocketing the phone between sets. (iii) forces the OS to throw the page away entirely — the harshest version of the same code path. |
| I-Q3 | Wire test result into §4.5 regardless of outcome | **(a) yes** — pass / pass-after-fix / fail all get recorded. | Polish doc's value is the audit trail. Clean passes get one paragraph; failures + fixes get more. |
| I-Q4 | If `buildWeekDots` skipped-past finding surfaces during the test | **Fix in-phase.** EP-chosen principle (2026-05-12): "best for the software, not rest." One-line change at [`portal-helpers.ts:110`](../../src/app/portal/_lib/portal-helpers.ts) — drop `\|\| isPast`, let `entry.done` be the single truth. | Tracked in §5 since Phase H closed. In-phase fix means Phase I closes with a complete trail rather than punting to a micro-phase. |

**B3 watch-list activation.** The trigger bullet is already in §5 from when Phase H closed: *"Once first 5 real clients have completed 10 sessions each, review session log integrity for data-loss reports. If any, escalate offline queue work to launch-blocker. If none, leave the v1 SW as-is."* Phase I formally activates it — the clock starts the day the first real client logs in. No code change to [`public/sw.js`](../../public/sw.js); v1 no-op SW stays.

**Test sequence (five steps per §4 row I).**

1. EP opens the installed PWA from the iPhone home screen → taps today's session card.
2. Begins the session and logs 3 sets across the first exercise with real numbers + RPE (not zeros / placeholder values).
3. Backgrounds the PWA, locks the phone, waits ~30s with the screen off.
4. Reopens the PWA from the home-screen icon (not Safari).
5. Confirms: same session row resumed (no new in-progress session created), the 3 logged sets are visible with their values intact, and the next-set focus lands on set 4.

**Stress repeat (after step 5 passes).** Hard-kill via the iPhone app switcher (swipe the Odyssey card off the top), reopen from the home-screen icon, run the same five checks.

### 4.5.1 Pre-flight discovery — Phase H regression fixes (decisions locked, chat 2026-05-13)

EP attempted the test setup and surfaced two distinct bugs on the portal Today card. Neither was in §5 follow-ups nor in the original C4 surface — both were Phase H surface-area issues (one latent and only made observable by Phase H, one introduced by Phase H by omission). Folded into Phase I per I-R1 rather than spinning a separate Phase H+1.

| # | Question | Answer | Notes |
|---|----------|--------|-------|
| I-R1 | Phase boundary for these fixes | **(a)** Fold both into Phase I. | ~30 lines diff across 3 TS files + 1 migration; lower ceremony than spinning a separate phase. |
| I-R2 | Bug 1 (week-strip date misalignment) fix direction | **(α)** Align the SET side in [`page.tsx`](../../src/app/portal/page.tsx) to the canonical Mon-first index. | Mon-first is canonical throughout the portal; the SET side was the divergent one. `buildWeekDots`'s contract stays unchanged. Both sides now consume the existing [`weekdayIndex`](../../src/app/portal/_lib/portal-helpers.ts) helper — single source of truth, drift can't recur. |
| I-R3 | Bug 2 (completed-session-repeatable) UI behaviour | **(i)** Conditional CTA. "Session complete · view summary" → `/complete` when today is done; existing "Begin session" → Logger otherwise. | Restrained voice; pairs with the "another one in the bank" framing already on `/complete`. (ii) too quiet, (iii) introduces complexity for an edge case. |
| I-R4 | Bug 2 RPC defence-in-depth | **(p)** Add an `IF EXISTS` refusal to `client_start_session` v3. Refuses when this `program_day_id` already has a completed session for this client. | Body-only change → CREATE OR REPLACE without DROP. Closes the front door on the AM/PM split-session edge case; opens it explicitly via a separate `client_restart_session` RPC if/when needed. |
| I-R5 | Completed-day URL handling (discovered during EP iPhone verification) | **(b)** Server-side redirect in [`/portal/session/[dayId]/page.tsx`](../../src/app/portal/session/[dayId]/page.tsx) before `startOrResumeSessionAction`. RLS-scoped lookup; if a completed session exists for this `program_day_id`, redirect to `/complete`. | Covers every entry to that URL — strip-cell tap, deep link, browser back, shared URL — not just the Today CTA. (a) client-side strip-cell-only is incomplete; (c) both is redundant. v3 RPC stays as defence-in-depth for any path that bypasses the page-level guard. |

**Bug 1 root cause.** [`page.tsx`](../../src/app/portal/page.tsx) set keys on `programmedByWeekday` via native `getDay()` (Sun=0..Sat=6) while [`portal-helpers.ts`](../../src/app/portal/_lib/portal-helpers.ts) `buildWeekDots` looked them up via `(getDay()+6)%7` (Mon=0..Sun=6). Effect: each programmed day rendered one cell forward on the strip — Tue's data appeared on Wed, Thu's on Fri, Sat's on Sun. Pre-existing bug; Phase H was the surface that made it observable (before Phase H, `programmedByWeekday` carried no cross-checkable data). Fix: a single use of the existing `weekdayIndex` helper on both sides.

**Bug 2 root cause.** `TodayScreen` rendered "Begin session" unconditionally; tapping it hit `startOrResumeSessionAction` whose only refusal check filters on in-progress (`completed_at IS NULL`), so a completed session never matched and the RPC created a fresh row each tap. Two-layer fix: UI passes `isCompleted` through and renders a different CTA; RPC adds a defence-in-depth refusal.

**What shipped.**

- [`src/app/portal/page.tsx`](../../src/app/portal/page.tsx) — imports `weekdayIndex`; SET key now uses the helper; `isCompleted` populated on `TodaySession` from `completedDayIds`.
- [`src/app/portal/_lib/portal-helpers.ts`](../../src/app/portal/_lib/portal-helpers.ts) — `buildWeekDots` lookup now uses `weekdayIndex(date)` instead of the inline `(getDay()+6)%7` (no behaviour change in isolation — closes the drift loop with `page.tsx`).
- [`src/app/portal/_components/TodayScreen.tsx`](../../src/app/portal/_components/TodayScreen.tsx) — `TodaySession.isCompleted: boolean`; CTA renders conditionally between "Begin session" → live Logger and "Session complete · view summary" → `/complete`.
- [`supabase/migrations/20260513120000_client_start_session_v3.sql`](../../supabase/migrations/20260513120000_client_start_session_v3.sql) — `IF EXISTS` block refuses a second completed session on the same `program_day_id`. Body-only change, signature unchanged.
- [`src/app/portal/session/[dayId]/page.tsx`](../../src/app/portal/session/[dayId]/page.tsx) — completion guard between the `published_at` redirect and the exercise fetch. RLS-scoped lookup; redirects to `/complete` if a completed session exists for this `program_day_id`. (Added during step-2 verification — EP saw the v3 RPC refusal surface as the `SessionError` card on a past-completed-day tap; the page-level guard is the user-friendly path while v3 stays as defence-in-depth.)

**Verification (TS).** `npm run build` passes clean on both fix rounds — 13.9s compile + 24.3s TypeScript on first round (I-R1..R4); subsequent build with I-R5 added also clean. All 12 static pages, all 40 routes registered.

**Verification (DB).** Migration applied — EP confirmed `supabase db push` clean on 2026-05-13.

**Verification (phone).** Week-strip alignment ✓ verified by EP on iPhone. Completed-day CTA (Today card) ✓ verified — routes to `/complete`. Strip-cell tap on a completed past day initially surfaced the v3 RPC refusal (I-R5 discovery); after the page-level redirect fix, taps land on `/complete` directly. Main five-step resume test still pending — needs a fresh published day to run against.

**Follow-up tracked in §5.** Strip-cell routing on future days (creates a session in advance — pre-existing) and skipped-past days (creates a session for a past date — pre-existing) is unchanged. Both are separate concerns from the completed-day case Phase I closed.

**Result.** Resume test passed clean 2026-05-13. EP backgrounded the session mid-flow and reopened — the same session row resumed with the previously logged sets intact, focus on the next set. Phase I closed; commit lands the I-R1..R5 fixes for production verification on the installed PWA.

Next phases (signed off 2026-05-13): **K** — portal per-day card view, then **L** — staff + dashboard completed-session expander, then existing **J** — Data-tab redesign. Handoff prompts captured in [`client-portal-handoff-phase-k.md`](./client-portal-handoff-phase-k.md) and [`client-portal-handoff-phase-l.md`](./client-portal-handoff-phase-l.md).

### 4.6 Phase K — Portal per-day card view (decisions locked, chat 2026-05-13)

Closes the §5 strip-cell routing follow-up. Strip-cell taps on programmed days previously routed directly to `/portal/session/[dayId]` (the Logger URL), bypassing the rich card surface that today's day gets. Phase K makes the card the canonical surface for every day in the week — the Logger URL becomes the CTA destination, not the strip-cell landing.

Full gap doc + sign-off log: [`client-portal-day-card.md`](./client-portal-day-card.md). Question summary:

| # | Question | Answer | Notes |
|---|----------|--------|-------|
| K1 | URL structure | **(a)** `?d=YYYY-MM-DD` on `/portal`. | EP guidance: "least resistance for the client, good data for the EP." |
| K2 | Component name | **(a)** Rename `TodayScreen` → `DayScreen`. | |
| K3 | Future-day mechanics | **(α)** New `client_reschedule_program_day_to_today` RPC; UPDATE `program_days.scheduled_date` to today. | |
| K3.i | Same-date refusal | **(α.i)** Refuse with a hint when today already has a programmed day for this client. | "Today already has a session — finish or skip it first." |
| K3.iii | Confirmation modal style | **Styled `.portal-card` overlay.** EP-locked verbatim copy renders inside; two stacked CTAs (Yes, move it / Cancel). | Native `confirm()` would corrupt the copy on iOS (system prompt prefixes the page URL). Default call by Claude — flag for revert if EP prefers native. |
| K4 | Past-skipped treatment | **(a)** Muted card (60% opacity on exercise list) + actionable "Move to today" CTA + "message your EP" sub-link. | Initially shipped inert per Q-K4 (a); EP raised the recovery gap 2026-05-13 — past-skipped sessions should be recoverable to today without surrendering a future day. CTA reuses the future-scheduled reschedule mechanism (same RPC, same server action). Refused unilaterally inert framing; clinical-flag pattern still reserved for clinical flags. |
| K5 | Week strip dot semantics | **(a)** Keep single green dot = "session here." Card carries the state. | |
| K6 | RPC data coverage | No change to `client_get_week_overview`. | |
| K6.1 | In-progress detection | Single combined SELECT in `page.tsx` for `program_day_id, started_at, completed_at`. Derive both `completedDayIds` and `inProgressDayIds` from one query. | EP guidance: "do not choose the easy route choose the most effective long term and robust solution." Cleaner than two parallel SELECTs; extensible to future session states. |
| K7 | Rest-day strip cell tap | **(a)** Every cell navigates to `/portal?d=<iso>`. Rest days render `.portal-empty` "Rest day." | Consistency wins. |

**What shipped.**

- [`supabase/migrations/20260513140000_client_reschedule_program_day_to_today.sql`](../../supabase/migrations/20260513140000_client_reschedule_program_day_to_today.sql) — new SECURITY DEFINER RPC. Six refusals stacked: auth, no-active-day, not-future, same-date collision, in-progress-anywhere, this-day-already-completed. Audit captured via the existing `program_days` UPDATE trigger.
- [`src/app/portal/session/[dayId]/actions.ts`](../../src/app/portal/session/[dayId]/actions.ts) — new `rescheduleAndStartSessionAction(programDayId)` server action. Two-step: RPC reschedules `scheduled_date` to today, then `startOrResumeSessionAction` begins the session. RPC error messages surface to the caller verbatim.
- [`src/app/portal/_lib/portal-helpers.ts`](../../src/app/portal/_lib/portal-helpers.ts) — added `DayCompletionEntry` (`done: boolean` + `inProgress: boolean` + ids), `DayState` discriminated union (7 kinds), `deriveDayState()` pure function. `buildWeekDots` signature updated to take the new entry shape — Phase I's `|| isPast` semantics already removed.
- [`src/app/portal/_components/DayScreen.tsx`](../../src/app/portal/_components/DayScreen.tsx) — new component (replaces the deleted `TodayScreen.tsx`). Renders selected-day card via the `DayState` switch. Strip cells now Links (rest days included). `FutureScheduledCta` opens the `ConfirmOverlay` carrying the EP-locked verbatim copy + a server-action transition. Past-skipped renders an inert footer with the "message your EP" path forward.
- [`src/app/portal/page.tsx`](../../src/app/portal/page.tsx) — reads `?d=YYYY-MM-DD` via `resolveSelectedDayIso()` (defaults to today; invalid or out-of-week falls back to today). Single combined `sessions` SELECT replaces Phase H's completed-only query — same set semantics, plus the in-progress derivation. Per-cell hrefs (`/portal?w=…&d=…`) built once server-side and handed to the screen. `composeDayLabel()` switches the eyebrow between "Today · Day C" and "Tue 14 May · Day C" based on whether the selected day is today.
- [`src/app/globals.css`](../../src/app/globals.css) — two stale `TodayScreen` doc comments renamed to `DayScreen`. No CSS changes.

**Verification (TS).** `npm run build` passes clean — 16.6s compile + 35.6s TypeScript, all 12 static pages, all 40 routes registered.

**Verification (DB).** Migration to apply: `supabase db push` from the project root will pick up `20260513140000_client_reschedule_program_day_to_today.sql`. Run `supabase gen types typescript --linked > src/types/database.ts` after push to regenerate types (the action currently casts to `as never` per the project's other client RPCs; the cast becomes optional once types regenerate).

**Verification (manual).** Six CTA states reach via constructed `?d=` URLs:
1. `today-not-started` — default landing for a day with a published program and no session → "Begin session".
2. `today-in-progress` — landing on today with an existing in-progress session → "Resume session".
3. `today-completed` — landing on today after completion → "Session complete · view summary".
4. `past-completed` — `?d=<past iso>` for a day with a completed session → "View summary".
5. `past-skipped` — `?d=<past iso>` for a day without a completed session → inert footer + "message your EP".
6. `future-scheduled` — `?d=<future iso>` → "Scheduled for {date}" label + "Begin session early" button → confirm overlay verbatim copy → confirm → Logger.

**Defence-in-depth check.** Hitting `/portal/session/<completed-dayId>` directly still redirects to `/complete` via the page-level guard (Phase I I-R5). v3 `client_start_session` still refuses a second completed session. Both backstops remain unchanged.

**Phase K addendum — past-skipped recovery (chat 2026-05-13, post initial sign-off).**

EP feedback after the initial Phase K landed: past-skipped sessions shouldn't be inert. "If someone misses their session and wants it to be completed today, they can only take a future session away. Therefore the 'skipped' title, when clicked should come up with a 'Move to today' message when clicked." Without this addition, the only recovery path is to surrender a future day via "Begin session early" — an asymmetric and slightly hostile UX.

The backend operation is identical to future-scheduled's "Begin session early" (reschedule + start). The two states differ only in presentation, so the implementation extracts a shared `RescheduleToTodayCta` component and parameterises:

| Prop | future-scheduled | past-skipped |
|------|------------------|--------------|
| `preLabel` | "Scheduled for {date}" | (none — card eyebrow already states the date) |
| `buttonLabel` | "Begin session early" | "Move to today" |
| `confirmMessage` | EP-locked verbatim (see Q-K3) | "Move this session to today and start it now?" *(default Claude copy — flag for EP revision)* |
| `confirmCtaLabel` | "Yes, move it" | "Yes, move it" |
| `postNote` | (none) | "Or [message your EP] for a different fix." |

**RPC change.** The `client_reschedule_program_day_to_today` function's refusal (c) was relaxed from "must be future" to "must not already be today." Past + future both reschedule freely now. The other five refusals (auth, no-active-day, same-date collision, in-progress, this-day-completed) stay unchanged — the same-date collision refusal is the load-bearing safety net: if today already has a programmed day, the move refuses with a hint surfaced to the user via the `ConfirmOverlay`'s error slot.

**Migration shape.** v1 of the migration was applied to remote Supabase before the EP raised the past-skipped recovery ask, so editing v1 in place would have been silently skipped on next `supabase db push` (filename-based migration tracking; project memory `project_supabase_migration_timestamp_collision`). The relaxation lives in a body-only follow-up migration `20260513150000_client_reschedule_program_day_to_today_v2.sql` — `CREATE OR REPLACE FUNCTION` only, signature unchanged, refusal (c) rewritten, all other refusals identical. v1's header carries a NOTE pointing forward to v2 so future readers see both migrations and understand the audit trail.

**Files touched in the addendum.**
- [`supabase/migrations/20260513140000_client_reschedule_program_day_to_today.sql`](../../supabase/migrations/20260513140000_client_reschedule_program_day_to_today.sql) — v1 header carries a forward-pointing NOTE to v2; function body restored to the as-applied "must be future" form (the in-place edit during the addendum was wrong-shape; reverted).
- [`supabase/migrations/20260513150000_client_reschedule_program_day_to_today_v2.sql`](../../supabase/migrations/20260513150000_client_reschedule_program_day_to_today_v2.sql) — new body-only follow-up. EP needs to run `supabase db push` to land it, then `supabase gen types typescript --linked > src/types/database.ts` (with proper UTF-8 encoding) to refresh types.
- [`src/app/portal/_components/DayScreen.tsx`](../../src/app/portal/_components/DayScreen.tsx) — `FutureScheduledCta` renamed to `RescheduleToTodayCta` and parameterised; past-skipped case calls it with the recovery copy + "message your EP" postNote. The 60% opacity on the exercise list stays (the day was still past).

**Verification.** `npm run build` clean — 11.0s compile + 23.2s TypeScript.

## 5. Open follow-ups

Tracked here so they don't get lost.

- **A2 follow-up:** Update CLAUDE.md design-system section so the `.card` shadow rule matches `globals.css` (two warm-tinted shadows, not the single shadow currently documented).
- **A3 follow-up:** Remove the `src/lib/constants.ts` reference from CLAUDE.md, OR create the file. Recommendation: remove the reference; `globals.css` is the working source of truth.
- **B3 watch-list trigger:** Once first 5 real clients have completed 10 sessions each, review session log integrity for data-loss reports. If any, escalate offline queue work to launch-blocker. If none, leave the v1 SW as-is.
- **Seq tone naming:** When Phase B renames the Seq tones (`primary → muted`, `accent → parchment`), audit the `TodayScreen` consumers to make sure the new names are read at the call sites and produce the intended visual.
- **`buildWeekDots` skipped-past handling:** [`portal-helpers.ts:110`](../../src/app/portal/_lib/portal-helpers.ts) currently marks any past programmed day as `state: 'done'` via the `isPast` short-circuit, regardless of actual completion. Post-Phase-H the data exists to tell "skipped Monday" from "completed Monday"; drop the `|| isPast` and let `entry.done` be the single truth. Likely surfaces during Phase I manual testing.
- ~~**Strip-cell routing on future + skipped-past days**~~ — **closed 2026-05-13 by Phase K.** Strip cells now navigate to `/portal?d=<iso>` (the card view) instead of `/portal/session/[dayId]` (the Logger URL). Future-day cells render the "Scheduled for…" card with a confirm-modal "Begin session early" CTA backed by the new `client_reschedule_program_day_to_today` RPC. Skipped-past cells render a muted card with an inert footer pointing the client at `/portal/messages`. See §4.6.

---

## 6. Acceptance bar

The portal pass is signed off when:

1. All Phase A-E + G + H + J code lands and renders without console errors at `/portal`, `/portal/program`, `/portal/session/[dayId]`, `/portal/session/[dayId]/complete`, `/portal/reports?tab=data`, `/portal/reports?tab=files`, `/portal/messages`, `/portal/you`.
2. A manual session can be started, paused, resumed, and completed end-to-end on a real mobile device. Feedback + RPE are captured. Stats are correct.
3. The staff program view shows captured feedback for that completed session in a collapsible per-session row.
4. The PWA install prompt fires correctly on Android Chrome and the installed app opens to `/portal` with the correct theme color.
5. The legacy reports tab can open at least one published report file.
6. Today's "completed this week" reflects the session count from step 2.
7. No `style={{}}` in any portal component contains a hardcoded hex colour, raw radius integer, or shadow string. Spot-check via grep:
   ```
   grep -nE "'#[0-9a-fA-F]{3,8}'|borderRadius: [0-9]+|boxShadow:" src/app/portal/
   ```
   Should return zero results outside intentional Phase D5 modifier classes.
8. Phase F (handoff) lands separately and its own acceptance criteria are signed off in that chat.
