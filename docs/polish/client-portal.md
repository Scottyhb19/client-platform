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
| **E** | B2 | Add 192px + 512px PNG icons to `/public/icons/`, update `manifest.json` `icons[]` array, smoke-test Android install via Chrome DevTools' application panel. | None |
| **F** | C1 (handed off — α full build) | **Handed off — see [`client-portal-handoffs.md`](./client-portal-handoffs.md).** Runs in parallel chat after Phase A lands. Full booking flow per locked decisions: instant-confirm, 24h free cancel, email-only reminders at launch. Builds: slot computation RPC, picker UI, `client_book_appointment` RPC, upcoming bookings panel + cancellation, email reminders at T-24h and T-1h. **Soft prerequisite: Phase A landed** so Phase F uses `.portal-card` / `.portal-btn-primary` directly instead of inline styles. | A (soft) |
| **G** | C3 | Extend reports SELECT to include `file_url` (verify column name against `reports` schema first). Wrap `LegacyView` rows in clickable `<Link>` to the file URL. Replace decorative `ChevronRight` with `Download` or `ExternalLink` icon. | A (so the row uses `.portal-card`) |
| **H** | C2 | Add a `sessions` count query to `portal/page.tsx`. Filter by current week's `program_day_id` IN list, `completed_at IS NOT NULL`, RLS-scoped to the client. Wire into `weekStats.completed` and per-day `done` flag in `programmedByWeekday`. | A (so `.portal-stat` renders the value) |
| **I** | C4, B3 watch-list activation | Manual test pass: (1) close-PWA-mid-session resume; (2) load session card; (3) log 3 sets; (4) close PWA; (5) reopen, confirm state. Plus: add B3 watch-list to follow-up tracking — note the trigger ("first 5 clients × 10 sessions, monitor for data-loss reports"). | All other phases done |

### 4.1 Phase F — handoff acknowledgement (locked α full build)

Phase F runs in a parallel chat per the user's instruction (2026-05-10). The handoff prompt is at [`client-portal-handoffs.md`](./client-portal-handoffs.md) §F. **Locked decisions:**

- **(1) Email-only reminders at launch.** Twilio not wired; SMS deferred to a later pass. Resend (`src/lib/email/client.ts`) handles T-24h and T-1h confirmation + reminder emails.
- **(2) Cancellation policy:** clients can self-cancel up to 24 hours before the appointment start. Inside the 24h window, the cancel CTA on the portal turns into a "message your EP" CTA pointing at `/portal/messages`.
- **(3) Confirmation flow:** instant-confirm. The `client_book_appointment` RPC validates the slot is still open at insert time and writes the appointment with `status = 'confirmed'`. EP sees it on their schedule with no action required. The slot-availability RPC is the source of truth.

When Phase F lands:

- BottomNav still has 6 items but the `Book` route is now functional rather than a stub. **No nav-shape change**, which simplifies the coordination story versus the original (β) scaffold path.
- `book/page.tsx` becomes the "upcoming bookings" + "Book a session" entry view; sub-routes handle the picker steps.
- Phase B (in this chat) refactors BottomNav inline styles onto `.portal-bottom-nav` per Phase A. Phase F should **not** touch BottomNav inline styles — that's Phase B's job. Phase F adds new content under `/portal/book/*`, doesn't restructure the nav.

The handoff prompt instructs the parallel agent to write its own gap doc (`docs/polish/client-portal-booking.md`) following the polish-pass protocol before writing code. Sub-tasks are pre-listed in the prompt; the gap doc captures the EP's sign-off on each before implementation begins.

---

## 5. Open follow-ups (post-polish-pass)

Tracked here so they don't get lost.

- **A2 follow-up:** Update CLAUDE.md design-system section so the `.card` shadow rule matches `globals.css` (two warm-tinted shadows, not the single shadow currently documented).
- **A3 follow-up:** Remove the `src/lib/constants.ts` reference from CLAUDE.md, OR create the file. Recommendation: remove the reference; `globals.css` is the working source of truth.
- **B3 watch-list trigger:** Once first 5 real clients have completed 10 sessions each, review session log integrity for data-loss reports. If any, escalate offline queue work to launch-blocker. If none, leave the v1 SW as-is.
- **Seq tone naming:** When Phase B renames the Seq tones (`primary → muted`, `accent → parchment`), audit the `TodayScreen` consumers to make sure the new names are read at the call sites and produce the intended visual.

---

## 6. Acceptance bar

The portal pass is signed off when:

1. All Phase A-E + G + H code lands and renders without console errors at `/portal`, `/portal/program`, `/portal/session/[dayId]`, `/portal/session/[dayId]/complete`, `/portal/reports?tab=data`, `/portal/reports?tab=files`, `/portal/messages`, `/portal/you`.
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
