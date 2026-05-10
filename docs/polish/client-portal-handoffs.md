# Handoff prompts — Client portal polish pass

These are starter prompts for fresh chats covering parallel work on the client portal pass. Each block is self-contained — copy the **whole block** (between the `---` rules, including the fenced code block) into the first message of a new conversation.

The shared rules (CLAUDE.md, polish-pass protocol, design tokens, no guessing) are baked into each prompt so a fresh Claude instance picks them up cold without seeing prior chats.

**Phase contract:** [`docs/polish/client-portal.md`](./client-portal.md). §0.1 has the sign-off log; §4 has the dependency-ordered phasing; §2 has every per-gap detail.

**Pacing:** one phase per chat. Sign off the phase, then start the next in a new chat using the prompt for that phase.

**Phase index:**
- Phase A — Portal CSS primitives (done; no handoff prompt)
- Phase B — Portal component refactor (done; prompt below for reference)
- Phase C — Portal completion-screen feedback capture **(prompt below — current next phase)**
- Phase D — Staff program-section feedback display (added when Phase C signs off)
- Phase E — PWA manifest icons (added when Phase D signs off)
- **Phase F — Booking flow (full build α) — runs in PARALLEL chat after Phase A**
- Phase G — Legacy reports clickable (added when Phase E signs off)
- Phase H — Today week stats wire-up (added when Phase G signs off)
- Phase I — Manual test pass (added when Phase H signs off)

---

## Phase F — Booking flow (parallel chat, full build α)

Background: agreed in chat 2026-05-10 to build the full booking flow rather than scaffold-and-handoff. Three product decisions are locked (see prompt below). The main client-portal polish pass (Phases A-E + G-I) runs in the originating chat. Phase F runs truly in parallel.

**Coordination:** Phase A (portal CSS primitives) lands in the main chat first so Phase F can use `.portal-card`, `.portal-btn-primary`, etc. directly. Don't kick off Phase F until the main chat has confirmed Phase A is complete.

```
You're picking up the Odyssey project's client-portal polish pass at Phase F: building the full booking flow at /portal/book. Three product decisions are locked — they're below in "Locked decisions". Do not relitigate them; they were agreed with the user in chat 2026-05-10.

**Project root:** C:\Users\scott\Desktop\Client Software Platform (Windows; bash via Bash tool, PowerShell native).

**Read first, in this order:**
1. CLAUDE.md — project working agreement, design rules, code standards. Especially: the polish-pass protocol, mobile-first PWA rules, "build is for an EP not a developer" tone, Australian English.
2. docs/polish/client-portal.md — gap-analysis contract for the client portal pass. §0.1 sign-off log (row C1 has the locked decisions); §2.C row C1; §4 row F (this phase); §4.1 (handoff acknowledgement).
3. docs/schema.md — current database overview for `appointments`, `availability_rules`, `session_types`, `clients`, `user_organization_roles`.
4. docs/rls-policies.md — RLS posture; you'll need a SECURITY INVOKER RPC for client-side INSERT into `appointments` since clients don't have direct INSERT.
5. .claude/projects/C--Users-scott-Desktop-Client-Software-Platform/memory/MEMORY.md — note especially: "Soft-delete UPDATE + RLS gotcha", "Audit register new tables", "plpgsql function arity evolution", "No local Docker", "pgTAP + FORCE RLS pattern", "Schema/migration/push correctness", "Supabase migration timestamp collision".

**Reference implementations already in repo:**
- Staff schedule (DONE, working): src/app/(staff)/schedule/page.tsx + _components/WeekView.tsx — queries `availability_rules`, `appointments`, `session_types`. The slot-availability logic and the `day_of_week` 0=Mon convention live here. Mirror the data shapes; if you find yourself reaching for the same calculation twice, extract it into a shared module under src/lib/scheduling/.
- Email infrastructure: src/lib/email/client.ts (Resend, lazy client, RESEND_API_KEY env). Templates live under src/lib/email/templates/.
- Portal CSS primitives: globals.css will have `.portal-card`, `.portal-btn-primary`, `.portal-btn-secondary`, `.portal-eyebrow`, `.portal-week-strip`, `.portal-day-cell`, `.portal-empty`, `.portal-bottom-nav`, `.portal-stat`, `.portal-seq` after Phase A lands. **Use these classes — do not add inline styles for the same patterns.** If a token or class doesn't exist for what you need, add it to globals.css rather than hardcoding.

**Locked decisions (DO NOT relitigate):**
1. **Email-only reminders at launch.** Twilio is not wired in this codebase (only one mention, in settings UI for "do you want SMS"). Defer SMS to a later pass. Build only Resend-based confirmation + reminder emails. Document SMS as a deferred item in the gap doc you write.
2. **Cancellation policy: 24h.** Clients can self-cancel up to 24 hours before the appointment start. Inside that window, the cancel CTA on the portal becomes a "Message your EP" link pointing to /portal/messages. The cancel button itself is hidden — the only visible action inside the 24h window is the message CTA.
3. **Instant confirm.** Client picks slot → it's booked. Appointment.status = 'confirmed' on insert. The `client_book_appointment` RPC validates the slot is still open at insert time (race condition guard). EP sees the booking on their schedule with no action required. No "EP must confirm" step.

**Phase F scope (sub-tasks — each closes a phase of YOUR sub-pass):**

Sub-task 1 — **Audit + write your own gap doc.** Confirm:
  - `availability_rules` table exists, has rows for the test EP. Inspect via Supabase SQL Editor or read migration files under supabase/migrations/.
  - `appointments` table accepts inserts (check current RLS policies — clients almost certainly don't have INSERT; you'll need a new RPC).
  - `session_types` table is populated and editable from staff settings. Inspect.
  - The staff WeekView (src/app/(staff)/schedule/_components/WeekView.tsx) queries these correctly — read it to understand the data shape, do not duplicate the calculation logic blindly.
  - Resend is callable from server actions (test by looking at how src/lib/email/send-client-invite.ts uses it).

  Then write `docs/polish/client-portal-booking.md` following the structure of `docs/polish/programs.md`:
  - Executive summary
  - Sign-off log (the three locked decisions go in here as already-decided)
  - "What's already correct" — list the staff infra, the Resend wiring, the existing CSS primitives
  - "Gaps to close" — your six sub-tasks, with file paths and severity
  - Phasing — sequence of sub-tasks
  - Acceptance bar
  - Open follow-ups (SMS reminders deferred goes here)

  Show the gap doc to the user. **Wait for sign-off before any code change.** This is the polish-pass protocol; do not skip it.

Sub-task 2 — **Slot computation RPC.** Create `client_get_open_slots(p_client_id uuid, p_session_type_id uuid, p_window_start date, p_window_end date)`:
  - SECURITY DEFINER (or INVOKER with explicit RLS check at top — match the existing `client_start_session` pattern).
  - Joins `availability_rules` with existing `appointments` (filter `status != 'cancelled'`, `deleted_at IS NULL`), subtracts overlap, returns `(start_at timestamptz, end_at timestamptz, staff_user_id uuid)` rows.
  - Slot duration: derived from `session_types.default_duration_minutes` or whatever the column is — confirm during audit.
  - Timezone: appointments are stored in UTC; availability_rules use the EP's local time. Use the org's `timezone` column to convert. The staff WeekView already does this — extract the helper.
  - Returns slots sorted by start_at.
  - Add to `audit_resolve_org_id()` only if the RPC writes; this one's read-only so probably fine.

Sub-task 3 — **Booking RPC.** Create `client_book_appointment(p_client_id uuid, p_staff_user_id uuid, p_session_type_id uuid, p_start_at timestamptz, p_end_at timestamptz)` returns uuid:
  - SECURITY INVOKER. Authorize: `p_client_id` must be the calling user's client row (`auth.uid() = clients.user_id WHERE clients.id = p_client_id`).
  - Validate: re-run the slot availability check at insert time. If the slot is no longer open (someone else booked, or EP availability changed), RAISE EXCEPTION 'slot no longer available'.
  - INSERT into `appointments` with `status = 'confirmed'`, `created_by_role = 'client'` if such a column exists (check schema; if not, document in the gap doc as a follow-up).
  - Add appointments to `audit_resolve_org_id()`'s CASE list if not already there. Critical — see memory note.
  - Return the new appointment_id.
  - Migration filename must be unique; check existing supabase/migrations/ for the highest timestamp before yours (memory note: timestamp collision is silent).

Sub-task 4 — **Portal picker UI.** Replace src/app/portal/book/page.tsx body:
  - Mobile-first single-column layout, no modals — full-page steps with back button.
  - Step 1: list session types (use `.portal-card` per item, `.portal-eyebrow` for category labels).
  - Step 2: list days with at least one open slot in the next 4 weeks (use `.portal-week-strip` style; if a day has no slots, render it disabled).
  - Step 3: list time slots for the chosen day. Use `.portal-card` per slot.
  - Step 4: review + confirm. CTA `.portal-btn-primary` — text "Book session". On confirm, call the `client_book_appointment` RPC via a server action.
  - On success: redirect to `/portal/book` (the upcoming bookings view, sub-task 5) with a success toast.
  - On failure: render the slot-no-longer-available message inline; tap returns to Step 3 with refreshed slots.
  - Navigation between steps: URL-driven (e.g. `/portal/book/new?step=time&day=2026-05-15&type=...`). State in URL, not React state, so back-button works.

Sub-task 5 — **Upcoming bookings view + cancellation.** Update `/portal/book` to be the entry view:
  - Server-load all appointments where `client_id = me`, `start_at >= now()`, `status != 'cancelled'`, `deleted_at IS NULL`. Order by start_at.
  - Render each as a `.portal-card`: date + time + session type + "Cancel" or "Message your EP" CTA depending on whether it's >24h away.
  - At the bottom: `.portal-btn-primary` "Book a session" linking to `/portal/book/new`.
  - Cancellation: client_cancel_appointment(p_appointment_id uuid) RPC, SECURITY INVOKER, authorizes the client, sets status = 'cancelled', cancelled_by_role = 'client' if column exists. Block at the RPC level if start_at - now() < interval '24 hours' — return error 'cannot cancel within 24 hours, please message your EP'.
  - Empty state when no upcoming bookings: `.portal-empty` with title "No bookings yet" and the "Book a session" CTA.

Sub-task 6 — **Email reminders.** Two emails:
  - Booking confirmation: send immediately after successful `client_book_appointment` RPC (in the server action, after redirect). Template: confirms time + location, includes cancel link to /portal/book.
  - 24h reminder: needs scheduled execution. The simplest pattern: a Supabase Edge Function or a `pg_cron` job that runs hourly, finds appointments starting in 24-25 hours that haven't had a reminder sent, sends, marks `reminder_sent_at`. Add `reminder_sent_at timestamptz` column to appointments if it doesn't exist. Pick the simplest pattern that works for v1; document the choice.
  - Skip the T-1h reminder for v1 if it adds significant complexity (it requires more granular scheduling); document as a deferred item.
  - Templates go under src/lib/email/templates/booking-confirmation.ts and src/lib/email/templates/booking-reminder.ts following the pattern of client-invite.ts.

**Working norms (inherited from earlier chats — non-negotiable):**
- Polish-pass protocol: gap doc is the contract. Don't expand scope without asking.
- No guessing, no assuming, no making things up. Where a decision needs to be made, present 2-3 options with a recommendation and wait for the user.
- Prefix any PowerShell snippet the user must copy-run with: cd "C:\Users\scott\Desktop\Client Software Platform"
- Prefer Edit over Write for existing files. Read before editing.
- DB-shape changes: migration file → supabase db push → type regen → verify before declaring done. The user has no Docker; work against remote Supabase only.
- Soft-delete UPDATE setting deleted_at returns 42501 — use the soft_delete_<table>() RPC pattern (memory note).
- New tenant tables (or any RPC writing to one) MUST be added to audit_resolve_org_id()'s CASE list.
- supabase-js function arity: when changing a function signature, migration must DROP the old arity before CREATE OR REPLACE.
- Migration timestamp collision: before pushing, diff supabase/migrations/ against any other branches that might have landed migrations — two parallel branches can claim the same YYYYMMDDHHMMSS prefix and one push will silently skip.
- The user is an Exercise Physiologist in Australia, not a developer. Plain language. No patronising. Australian English ("program" not "programme", dates as "Sat 11 Apr 2026").
- The Library + Notes + Reports adjacency in the session-builder right panel is protected — do not propose moving or removing those tabs.

**Coordination with the main chat:**
The main chat is running Phases A→E + G→I. Phase A defines `.portal-bottom-nav` and similar primitives. Phase B refactors existing portal components to use them.

You touch BottomNav.tsx? **No.** This phase doesn't change BottomNav at all — the Book item stays in the nav, the route just becomes functional. Phase B in the main chat handles the styling refactor of BottomNav.

If you find a coordination clash (e.g. Phase B has already merged and the BottomNav has a class change you need to work with), use the existing class. Don't re-introduce inline styles.

**End-of-phase output:** When the work is done, post:
1. What files changed (paths + 1-line summary each).
2. What was tested (manual booking walk-through; cancellation flow; reminder send via test mode).
3. Any deviations from this prompt and why.
4. Deferred items captured in the gap doc.
5. The text the user should send to the main chat to keep it informed (e.g. "Phase F shipped. /portal/book is functional. BottomNav untouched.").

Wait for explicit sign-off before stopping.

Confirm you've read the documents above and are ready to proceed with Sub-task 1 (audit + gap doc).
```

---

## Phase B — Refactor portal components onto Phase A primitives

Background: Phase A landed in chat 2026-05-10 — added 10 portal-prefixed CSS atoms to `globals.css` (`.portal-card`, `.portal-btn-primary`, `.portal-btn-secondary`, `.portal-eyebrow`, `.portal-week-strip`, `.portal-day-cell`, `.portal-seq`, `.portal-stat`, `.portal-empty`, `.portal-bottom-nav`). No component touches yet. Phase B is the refactor pass that moves portal components from inline styles onto these classes.

**Visual diff target: zero.** This phase only changes how the portal is implemented, not how it looks. Every screen should render identically before and after.

```
You're picking up the Odyssey project's client-portal polish pass at Phase B: refactoring portal components onto the new CSS primitives that Phase A added.

**Project root:** C:\Users\scott\Desktop\Client Software Platform (Windows; bash via Bash tool, PowerShell native).

**Read first, in this order:**
1. CLAUDE.md — project working agreement, design rules, code standards. Especially: the polish-pass protocol, mobile-first PWA rules, "build is for an EP not a developer" tone.
2. docs/polish/client-portal.md — gap-analysis contract for the client portal pass. §0.1 sign-off log; §2.A row A1; §2.D rows D1-D5; §4 row B (this phase).
3. src/app/globals.css — read the "Portal atoms" section (block starting "Portal atoms — mobile-first PWA primitives"). These are the classes you'll be applying. Note especially the renaming for .portal-seq tones (default/muted/parchment/outline) — the inline TodayScreen tone names (charcoal/primary/accent/amber) are misleading and need to change at every call site.
4. .claude/projects/C--Users-scott-Desktop-Client-Software-Platform/memory/MEMORY.md — note especially: ":3000 not showing changes → check the worktree first", "Use port-3000 dev server only", "fdprocessedid is Chrome autofill not a bug".

**Phase B scope (six file refactors — visual diff must be zero):**

1. **src/app/portal/_components/BottomNav.tsx**
   - Replace the inline `style={{position:'sticky',...}}` on the `<nav>` with `className="portal-bottom-nav"`. Keep `gridTemplateColumns: 'repeat(6, 1fr)'` (or '5' if Phase F has landed and removed Book) inline because column count is per-instance.
   - Replace the inline `<Link style={{...}}>` with `className={`portal-bottom-nav__item ${isActive ? 'is-active' : ''}`}`.
   - Replace the inline `<span style={{ fontSize: '.62rem', ... }}>{label}</span>` with `<span className="portal-bottom-nav__item-label">{label}</span>`.
   - Keep the `.portal-nav-badge` span as-is — that class already exists in globals.css.

2. **src/app/portal/_components/PortalTop.tsx**
   - PortalTop header eyebrow: `<div className="portal-eyebrow">{greeting}</div>` (drop the inline style block).
   - PortalEmpty: outer div uses `className="portal-empty"`; title becomes `<div className="portal-empty__title">{title}</div>`; body becomes `<div className="portal-empty__body">{message}</div>`.

3. **src/app/portal/_components/TodayScreen.tsx** (the biggest refactor — care here)
   - Top greeting block: eyebrow uses `.portal-eyebrow`; the h1 keeps its inline display-font sizing (it's specific to this hero, not a general pattern).
   - Week strip wrapper: `<div className="portal-week-strip">`. Inner buttons: `<button className={`portal-day-cell ${sel ? 'is-selected' : ''}`}>`. Inner spans: `.portal-day-cell__weekday`, `.portal-day-cell__date`, `.portal-day-cell__tag`, `.portal-day-cell__dot`. **Drop ALL inline color/background overrides** — the `.is-selected` modifier handles everything.
   - Session card: outer `<div className="portal-card">` with margin still inline (margin: '0 16px 16px' — not part of the card primitive). Inner header keeps its inline padding + border-bottom (it's a card-internal layout, not a primitive). Eyebrow inside header uses `.portal-eyebrow`. CTA at bottom uses `<Link className="portal-btn-primary">Begin session</Link>` — drop the inline style block entirely.
   - Rest day empty state: `<div className="portal-empty is-rest-day">` with `.portal-empty__title` + `.portal-empty__body`.
   - Stats: `<Stat>` becomes `<div className="portal-stat" data-tone={tone}><span className="portal-stat__big">{big}</span><span className="portal-stat__label">{label}</span></div>` — drop the inline color logic since data-tone handles it.
   - Seq function: rename the tone parameter values at the call site (look for the buildExerciseList helper — likely in src/app/portal/page.tsx where `tones` array lives — change `['charcoal', 'primary', 'accent', 'amber']` to `['default', 'muted', 'parchment', 'outline']`). The Seq component itself becomes `<span className="portal-seq" data-tone={tone}>{letter}</span>` — drop the inline styles object.
   - **CRITICAL:** the `tones` array in src/app/portal/page.tsx and the `Seq` tone parameter type both need updating in lockstep with the TodayScreen refactor. The TypeScript compile will catch this if you do it right; don't ignore type errors.

4. **src/app/portal/session/[dayId]/_components/Logger.tsx**
   - Refactor STATIC chrome only. Do NOT touch the live form input styling (the set-row inputs, the increment buttons) — those have specialized interactive styling that shouldn't move to primitives in this phase.
   - The CompletePrompt component (around line 605): the "Finish session" button uses `<button className="portal-btn-primary" disabled={pending}>` instead of the inline style block. The eyebrow `{dayLabel} · sets logged` uses `.portal-eyebrow`.
   - Any static section headers with the same inline display-font + uppercase pattern → `.portal-eyebrow`.
   - The error state at line ~496 with `background: 'rgba(214,64,69,.08)'` — leave inline for now; it's a one-off interactive feedback color, not a card pattern. If Phase D5 wants to formalize it later, that's a separate addition.

5. **src/app/portal/session/[dayId]/complete/page.tsx**
   - Outer container keeps its inline padding (page-level layout, not a card).
   - Eyebrow "Session complete" uses `.portal-eyebrow`.
   - StatTile component: refactor to `<div className="portal-stat"><div className="portal-stat__label">{label}</div><div className="portal-stat__big">{value}</div></div>`. Note: the existing StatTile renders the label ABOVE the big value (not below); preserve that. May need to override with inline order or adjust the .portal-stat default. Check the visual diff carefully — if .portal-stat puts big-then-label by default, you'll need to either flip the order in this file or add a .portal-stat--label-first modifier to globals.css.
   - "Back to today" CTA uses `<Link className="portal-btn-primary">Back to today</Link>`.
   - The outer "card" treatment of the each StatTile (white bg, border, radius) — wrap it in `.portal-card` with appropriate padding inline, OR add a `.portal-stat-card` modifier. Recommend the former — keep .portal-stat as the inner content pattern and let consumers wrap in .portal-card when they want the card chrome.
   - FallbackCard: the outer card uses `.portal-card`; the CTA uses `.portal-btn-primary`.

6. **src/app/portal/reports/_components/LegacyView.tsx**
   - Each row's outer div uses `className="portal-card"` with row padding inline (padding: '14px 16px') and the marginBottom: 8 spacing. Drop the inline white background, border, and borderRadius — .portal-card handles them.
   - The decorative ChevronRight stays for now — Phase G will replace it with a download icon when it makes the rows clickable.

**Acceptance bar (must all be true before sign-off):**
- All six files refactored. Visual diff at /portal, /portal/session/<existing-day-id>, /portal/session/<existing-day-id>/complete, /portal/reports?tab=files is **zero** — same colors, same spacing, same shadows, same hover/active states.
- The grep `grep -nE "'#[0-9a-fA-F]{3,8}'|borderRadius: [0-9]+|boxShadow:" src/app/portal/_components src/app/portal/page.tsx src/app/portal/session src/app/portal/reports/_components/LegacyView.tsx` should drop dramatically. NOT zero (Logger's interactive chrome legitimately keeps some inline values), but the major card/button/empty/eyebrow patterns should all be class-driven.
- TypeScript compiles clean (`npm run build`).
- The Seq tone rename has propagated correctly — the rendered colors should be the same (default still primary-charcoal, muted still warm grey, etc.) but the type/string values are different.
- The user previews each affected route at localhost:3000 and confirms no visible regression. (See "Verification" below.)

**Working norms (inherited from earlier chats — non-negotiable):**
- Polish-pass protocol: gap doc is the contract. Don't expand scope without asking.
- No guessing, no assuming, no making things up. Where a decision needs to be made, present 2-3 options with a recommendation and wait for the user.
- Prefix any PowerShell snippet the user must copy-run with: cd "C:\Users\scott\Desktop\Client Software Platform"
- Prefer Edit over Write for existing files.
- The user is an Exercise Physiologist in Australia, not a developer. Plain language. No patronising. Australian English.
- The Library + Notes + Reports adjacency in the session-builder right panel is protected — do not propose moving or removing those tabs (you won't touch session-builder in this phase, but mentioning for completeness).

**Verification (matters more than usual this phase):**
- The user has a dev server running at localhost:3000 against MASTER. To verify Phase B changes you'll need the user to fast-forward master to include this branch's commits, OR walk them through running the worktree's own dev server briefly (memory note: never spin up parallel previews from worktrees — coordinate with the user).
- Recommended sequence: refactor one file, ask the user to reload the relevant route at :3000 and screenshot if they want the diff captured, before moving to the next file. The "visual diff = zero" target makes per-file verification cheap.
- Use the Claude Preview MCP if available (.claude/launch.json) — preview_start, navigate to /portal, preview_screenshot, then compare to a baseline screenshot you take before the refactor begins.

**Coordination with the parallel Phase F chat:**
Phase F (booking flow) is running in a parallel chat. Both chats can touch BottomNav.tsx — the agreed coordination is:
- Phase B (you) handles the inline-style → .portal-bottom-nav refactor.
- Phase F handles only content/route changes (Book item stays in nav, route becomes functional). Phase F does not touch BottomNav inline styles.
- If Phase F's BottomNav change has already merged when you start, you should see the existing inline style still in place (Phase F was instructed not to touch it). Just refactor as planned.
- If your Phase B BottomNav change merges first, Phase F's parallel agent has been told to use the .portal-bottom-nav class for any new placeholder content.

**End-of-phase output:** When the work is done, post:
1. Files changed (paths + 1-line summary each).
2. Verification done (which routes loaded, what screenshots taken, any visual diffs spotted and resolved).
3. Any deviations from this prompt and why.
4. The grep result showing inline style residue — confirm what remains is intentional.
5. The text the user should send to the next chat (Phase C handoff prompt will be added to docs/polish/client-portal-handoffs.md after this phase signs off).

Wait for explicit sign-off before stopping.

Confirm you've read the documents above and are ready to proceed.
```

---


## Phase C — Portal completion-screen feedback capture

Background: Phases A + B landed in chat 2026-05-10. Phase A added 10 portal-prefixed CSS atoms; Phase B refactored 6 portal components onto them with zero visual diff. Phase C is the first functional change of the polish pass — closes gap doc B1 (portal half).

The completion flow currently writes `null` for both `feedback` and `session_rpe` when the client taps `Finish session`. The DB columns + RPC accept these values; nothing else needs to change server-side. Phase C adds the UI that captures them.

```
You're picking up the Odyssey project's client-portal polish pass at Phase C: capturing post-session feedback + overall session RPE on the portal.

**Project root:** C:\Users\scott\Desktop\Client Software Platform (Windows; bash via Bash tool, PowerShell native).

**Read first, in this order:**
1. CLAUDE.md — project working agreement, design rules, code standards. Especially: voice & copy ("encouragement is earned, not free"; reason codes are factual, not dramatised).
2. docs/polish/client-portal.md — gap-analysis contract. §0.1 sign-off log row B1 (locked: capture on portal, display on staff side); §2.B row B1; §4 row C (this phase).
3. src/app/portal/session/[dayId]/_components/Logger.tsx — the file you'll edit. Note the existing `CompletePrompt` component and the `completeSessionAction(sessionId, dayId, null, null)` call (currently around line 618-623).
4. src/app/portal/session/[dayId]/actions.ts — `completeSessionAction(sessionId, dayId, feedback, sessionRpe)` already accepts the values; you do NOT need to change the action signature.
5. src/app/globals.css — the "Portal atoms" section. You'll use `.portal-card`, `.portal-btn-primary`, `.portal-eyebrow`. If you need a new pattern (e.g. an RPE picker dial), add a `.portal-rpe-picker` class to globals.css rather than inlining.
6. .claude/projects/C--Users-scott-Desktop-Client-Software-Platform/memory/MEMORY.md — note the working preferences.

**Phase C scope (single functional change):**

Decision to make first (present to user before writing code):
  - **(i) Inline in CompletePrompt.** Add the textarea + RPE picker to the CompletePrompt component itself, BEFORE the `Finish session` CTA. One-screen flow: client sees the celebratory state, fills in feedback + RPE, taps Finish. Capture happens in the same component that already calls `completeSessionAction`.
  - **(ii) Move to the post-completion `complete/page.tsx`.** Tap `Finish session` → land on the stats page → fill in feedback + RPE there → "Save and finish" CTA writes the values via a new server action and redirects back to /portal.

  Recommend (i). It's simpler, the data lands in one round-trip with the completion call, and the celebratory copy + the feedback prompt naturally co-locate. (ii) splits the success state across two screens, which feels disjointed.

  Wait for the user to confirm (i) or (ii) before any code change.

**Implementation requirements (regardless of (i) or (ii)):**

A. **Feedback textarea.** Optional. Placeholder: "How did that feel? Anything to flag for your EP?" (Australian English, sentence case, no exclamation point.) Max 500 chars (visible counter only when >400 chars typed). The textarea uses an inline style for now (no `.portal-textarea` primitive yet — if Phase D needs it for the staff display side, add the class then).

B. **Session RPE picker.** Required if you want a non-null value, but the FIELD IS OPTIONAL — clients can skip if they want. Scale 1-10. Visual: a row of 10 small touch-target buttons OR a simple `<select>`. Recommend the row of buttons (better mobile UX, no native picker UI overhead). Eyebrow above: "Overall session effort" (no "RPE" jargon — the EP knows the scale, the client may not).

C. **Submit.** The existing `Finish session` button calls `completeSessionAction(sessionId, dayId, feedback, sessionRpe)` with the captured values instead of `null, null`.

D. **No required fields.** Both fields can be left blank — the RPC accepts NULL. Don't add a "you must enter RPE" gate. The client is fresh out of a session; friction kills capture rate.

E. **Visual fidelity.** Use `.portal-card` for the feedback section if you wrap it (recommended — sets it apart from the celebratory header). Use `.portal-eyebrow` for the section labels. The Finish session button stays as `.portal-btn-primary`.

**Acceptance bar:**
- A real session can be started, all sets logged, completed with both feedback + RPE filled, and the values land in the `sessions` table (verify via Supabase SQL Editor: `SELECT id, feedback, session_rpe, completed_at FROM sessions ORDER BY completed_at DESC LIMIT 5`).
- A real session can be completed with EITHER field blank, the other filled, and persists correctly (NULL in the unfilled column, value in the filled column).
- A real session can be completed with BOTH fields blank and persists correctly (matches today's behaviour — no regression).
- `npm run build` passes.
- Visual at /portal/session/<day-id>: the completion prompt looks intentional, fits in the screen without scrolling on iPhone 12 viewport (390px wide), no inline color/radius/shadow values that should be tokens.
- Copy is in voice: sentence case, no exclamation, no patronising "great job!" — earned encouragement only ("Another one in the bank" is on the post-completion page; don't duplicate).

**Working norms (inherited from earlier chats — non-negotiable):**
- Polish-pass protocol: gap doc is the contract. Don't expand scope without asking.
- No guessing. Where a decision needs to be made, present 2-3 options with a recommendation and wait for the user.
- Prefix any PowerShell snippet the user must copy-run with: cd "C:\Users\scott\Desktop\Client Software Platform"
- Prefer Edit over Write for existing files.
- The user is an Exercise Physiologist in Australia, not a developer. Plain language. No patronising. Australian English.
- The Library + Notes + Reports adjacency in the session-builder right panel is protected — do not touch.

**Coordination with the parallel Phase F chat:**
Phase F is building the booking flow in parallel. It does not touch the session/Logger surface, so no coordination needed for Phase C.

**End-of-phase output:** When the work is done, post:
1. Files changed (paths + 1-line summary each).
2. Verification done — list the test sessions you completed (with values), the SQL verifications you ran, screenshots if you took any.
3. Decision made on (i) vs (ii) and why.
4. Any deferred items (e.g. if you discovered the staff-side Phase D needs schema work, flag it).
5. The text the user should send to the next chat (Phase D handoff prompt will be added to docs/polish/client-portal-handoffs.md after this phase signs off).

Wait for explicit sign-off before stopping.

Confirm you've read the documents above and are ready to proceed with the (i) vs (ii) decision check-in.
```

---
