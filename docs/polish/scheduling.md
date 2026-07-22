# Polish-pass gap analysis — Scheduling (section 9)

**Brief:** `Client_Platform_Brief_v2.1.docx` §6.4 (Session Booking & Scheduling), with §6.1 (the client-profile "Bookings" tab), §6.8.3/§6.8 (dashboard "Today's Sessions" + the named Schedule tab — section 11, boundary only), and §9.1 (Phase 1 build scope). Constrained by §2.1 (progressive disclosure) and the design system.
**Reference prototype:** none specific to scheduling — the prototypes cover the calendar, session builder, client portal, and dashboard. Where the brief and design system are silent, the established booking/availability shipped behaviour is the reference.
**Prior passes (this is a polish pass over already-built code, NOT a greenfield build):**
- [`docs/polish/availability-editor.md`](availability-editor.md) — the `/settings/availability` editor (locked L1–L5, A0–A4; deferred AVL-1..AVL-8). Closed.
- [`docs/polish/client-portal-booking.md`](client-portal-booking.md) — Phase F booking flow (locked L1 email-only, L2 24h cutoff, L3 instant-confirm; deferred F1..F9). Closed.
- [`docs/polish/booking-attribution.md`](booking-attribution.md) — Phase F-5 actor columns (`created_by_role`/`cancelled_by_role`), Odyssey brand mark, cancellation visual (deferred F5-1..F5-7). Closed.
**Carried-in riders this section OWNS** (from CLAUDE.md active-section line + [`docs/go-live-checklist.md`](../go-live-checklist.md) §4): (a) **FM-6** booking slot-range UTC bug (`book/page.tsx` / `book/new/page.tsx`); (b) the **§9 anon-EXECUTE sweep** of `client_available_slots` / `client_book_appointment` / `client_cancel_appointment`; (c) **timezone reconciliation** between the staff side (`PRACTICE_TIMEZONE`, section 6) and the portal device-tz "today" (section 7).
**Current implementation:** staff availability — [`settings/availability/`](../../src/app/(staff)/settings/availability/); staff schedule — [`schedule/page.tsx`](../../src/app/(staff)/schedule/page.tsx), [`WeekView.tsx`](../../src/app/(staff)/schedule/_components/WeekView.tsx), [`actions.ts`](../../src/app/(staff)/schedule/actions.ts); portal booking — [`portal/book/`](../../src/app/portal/book/); reminders — [`send-appointment-reminders/index.ts`](../../supabase/functions/send-appointment-reminders/index.ts) + [`src/lib/email/`](../../src/lib/email/); DB — migrations `20260420102000`–`20260513160000` + the `client_*` RPC family.
**Audit date:** 2026-06-15
**Status:** In progress. **P0 + P1 implemented, verified, and deployed to production** (deploy #1, 2026-06-15) — see §7 (progress log) and §8 (closing commit, P0+P1). The 15 P2 items are the remaining scope ahead of the formal section close + final sign-off. The gap list (§3) remains the contract.

---

## 0. Executive summary

The scheduling subsystem is **already built and largely sound** — it was shipped across three build-phase passes (availability editor, Phase F booking flow, Phase F-5 attribution) before the formal polish pass reached it. The EP can author weekly + one-off availability; clients book through a clean four-step picker backed by a race-guarded `client_book_appointment`; clients self-cancel outside 24h; the staff `/schedule` week grid renders all clients' appointments with session-type colour stripes, the cancelled-state visual, the Odyssey brand mark, and `created_by_role`/`cancelled_by_role` attribution; staff can cancel and drag-reschedule; email confirmation + a T-24h reminder fire via Resend on a 5-minute cron. The core flows work and are individually well-built.

What this section must close is concentrated at the **seams between surfaces** and in **two inherited riders**, not in the core flows:

1. **One security item (P0) — the §9 anon-EXECUTE sweep.** `client_available_slots`, `client_book_appointment`, and `client_cancel_appointment` are confirmed still anon-EXECUTE on the live DB (section-7 probe), deliberately left for this section. Each fails closed today on its in-body `auth.uid()` guard, so this is a defence-in-depth posture gap, not an open hole — but it is the named go-live rider and mirrors the section-6 P0-1 pattern.

2. **One architectural item (P0) — timezone reconciliation.** Five scheduling decision points resolve "today"/"now" through **four different timezone sources** that do not agree. The load-bearing piece: the staff `/schedule` page computes `todayIso` from the **server clock (UTC on Vercel)**, so the highlighted "today" column and week boundary are wrong for the Australian operator every morning between local midnight and ~10–11am — the exact bug class section 6 fixed for the calendar as P0-2, which `/schedule` never adopted. FM-6 (the booking-window edge) and the portal-vs-org display split are downstream of this same fragmentation.

3. **Functional gaps (P1)** that bite at friends-and-family scope: the **§6.1 Bookings tab is missing** from the staff client profile (the appointments are loaded but only feed the note picker); **staff-created appointments bypass the entire email side-effect chain** — no confirmation, no reminder (only portal self-bookings enqueue a reminder), so the dominant booking path defeats the §6.4 "reminders 24h before" deliverable; **reschedule and staff-cancel leave the reminder row stale**; there is **no DB-level double-booking backstop** (the race guard is TOCTOU-only and the staff write paths have zero overlap check); and **there is no way to close a date** (holiday/sick day) — the documented AVL-1 workaround turns out to be non-buildable.

4. **A tail of polish (P2)** — the FM-6 window edge, the portal-vs-org tz display split, three **dead settings controls** (SMS toggle, reminder-lead selector, email toggle all persist but do nothing), failed-reminder retry, a duplicated reminder template, stale "next commit" copy on the empty week, and a design-token sweep of the scheduling surfaces.

The audit method matters here: six parallel deep-readers, each followed by adversarial verification of its security/correctness findings. That pass **corrected two findings** — FM-6's symptom was inverted (it truncates the *far-edge afternoon* slots, not the morning ones) and its severity overstated (→ P2), and the portal-vs-org tz split is dormant for the same-tz beta population (→ P2) — and **reconciled one cross-agent discrepancy**: staff reschedule *does* exist (drag-to-move/resize → `updateAppointmentTimeAction`), it is simply unhardened (no availability re-check, no reminder re-time). Those corrections are reflected in the severities below.

**Operator scope additions (2026-06-15, after the audit).** Reviewing the gap list, the operator added five items now folded in: **per-type session durations + 15-minute slot granularity** (P1-6 — the current grid offers only hourly starts and wastes the part-hour after a shorter session); an **"Unavailable" appointment-type kind** for admin/meeting/note blocks that render on the schedule and may overlap appointments (P1-7); **side-by-side rendering of a cancelled appointment and its replacement, plus a show/hide-cancellations toggle** (P2-8); a **"Repeat" toggle in the appointment composer** for recurring bookings (P2-14); and a **Tools menu** with find-next-available and a **de-identified** .ics calendar subscribe (P2-15). These are operator-directed scope, prioritised by value rather than derived from a premortem failure mode (except P1-6, which closes a real wasted-slot defect). They make the section materially larger.

### 0.1 Sign-off log (2026-06-15)

Operator answered the four consequential open questions; recorded here. Q5 (settings honesty) proceeds as recommended unless overridden. The gap list awaits final approval of the whole contract before code lands. **No code has been changed.**

| Q | Decision | Notes |
|---|---|---|
| Q1 | **(a) — build negative availability now** | "Close a date" as a manual date / date-range action in the availability editor's one-off panel; `is_blocked` negative one-off + slot subtraction (P1-5 rewritten). Operator design note carried forward: a separate **timed "Unavailable / admin" block on the schedule** (for non-client admin time, which could also block days) is wanted — recognised as adjacent-but-distinct (needs the `client_id` relaxation or a `time_blocks` concept), surfaced as a section-9 candidate in §5, NOT folded into P1-5's date-close. |
| Q2 | **Practice timezone governs the staff schedule grid** | `PRACTICE_TIMEZONE` for the staff grid + `todayIso`; org-tz for slot generation/booking labels (already correct); device-tz reserved for the portal's personal "today" only. P0-2 locked. |
| Q3 | **Make `reminder_lead_hours` work** | Wire the org setting into the reminder enqueue (default 24h); P2-3 locked to "wire", not "retire". Reminder *mechanism* (DB trigger vs app-code) is the implementer's call — recommended DB trigger (Q3 second part). |
| Q4 | **Keep week-only; default the staff filter to all practitioners** | Week grid accepted as the beta calendar (no month/agenda build); a 2-EP org sees both columns by default. P2-10 locked. |

**Round 2 (operator, 2026-06-15) — five scope additions accepted:**

| Item | Decision | → |
|---|---|---|
| Slot granularity | **Per-type session durations + 15-minute slot step.** The hourly-only grid wastes the part-hour after a shorter session; decouple session length (per appointment type) from the slot step (15 min) so the next opening follows the real end time. Pulls F1/Q4 in. | **P1-6** |
| "Unavailable" types | **Build as an appointment-type kind.** Settings → Appointment types gains an "Unavailable" sub-section (Meeting, Admin, Note, Break, Travel, Phone call, PD/supervision, Personal/leave); these need no client, render on the schedule, and may overlap a client appointment. | **P1-7** |
| Cancelled side-by-side + toggle | Replacement bookings render **beside** the cancelled appointment (column-split), plus a visible **show/hide cancellations** toggle (default show). Data layer already allows booking over a cancelled slot; this is the rendering + toggle. | **P2-8** |
| Recurring appointments | Not a standalone tool — a **"Repeat" toggle in the appointment composer** (daily/weekly/fortnightly/monthly + occurrences). | **P2-14** |
| Tools menu | **Find next available** + **de-identified .ics calendar subscribe** (no client names — mandatory for an unauthenticated feed). Day sheet dropped; recurring moved to the composer (above). | **P2-15** |

These are operator-directed scope on top of the audit-derived gaps. The section is now materially larger (2 P0, 7 P1, 15 P2) and will move in checkpointed stages, not one push.



---

## 1. §6.4 conformance — line by line

The 2026-06-15 audit snapshot. "Met with hardening gaps" means the surface exists and works but a named gap below tightens it.

| Brief requirement | Status | Evidence / provenance |
|---|---|---|
| **§6.4** Staff manage availability windows — recurring AND one-off | **Partially met** | Weekly + one-off authoring is end-to-end ([`settings/availability/`](../../src/app/(staff)/settings/availability/), RPC materialises both at `20260420102500:472-496`). But one-off is **positive-only** — it can only ADD slots. No "close this date" / negative override exists; the documented workaround is non-buildable (no sentinel client, `appointments.client_id` is `NOT NULL`). → **P1-5** |
| **§6.4** Clients view available slots and book in-clinic sessions | **Met, with granularity gap** | Four-step URL-driven picker ([`book/new/page.tsx`](../../src/app/portal/book/new/page.tsx)) over the `client_available_slots` RPC; race-guarded `client_book_appointment` INSERT, `status='confirmed'`. Clean, restrained, on-voice. **Gap:** slots are offered only at the welded hourly grid step, not per-type duration on a fine granularity — the next opening after a shorter session is the next hour, not the real end time. → **P1-6** |
| **§6.4** Staff can confirm, cancel, OR reschedule bookings | **Met, with hardening gaps** | **Confirm** = instant (locked L3 — no EP-confirm step; `pending` is effectively unreachable). **Cancel** = `cancelAppointmentAction` ([`schedule/actions.ts:128`](../../src/app/(staff)/schedule/actions.ts)). **Reschedule** = drag-to-move + drag-to-resize → `updateAppointmentTimeAction` ([`schedule/actions.ts:155`](../../src/app/(staff)/schedule/actions.ts), [`WeekView.tsx:1256-1305`](../../src/app/(staff)/schedule/_components/WeekView.tsx)) — **exists**, but validates only `start < end`: no availability/overlap re-check (→ **P1-4**) and no reminder re-time (→ **P1-3**). |
| **§6.4** Calendar view shows all upcoming sessions across all clients | **Met** | `schedule/page.tsx:121-133` queries by org+staff (not per-client); all clients render in the week grid. Caveat: week-only view, staff filter defaults to self ([`page.tsx:74-75`](../../src/app/(staff)/schedule/page.tsx)) — a 2-EP org shows one column until toggled. → **P2-10** (accept-or-build) |
| **§6.4** Automated email + SMS reminders 24h before | **Partially met** | Email T-24h reminder is enqueued **only on the portal booking path** (`client_book_appointment`, `20260513130000:228-241`) and drained by the Edge Function on a 5-min cron. **Staff-created appointments enqueue nothing** (→ **P1-2**). The 24h is hard-coded while a `reminder_lead_hours` setting persists and is ignored (→ **P2-3**). SMS consciously deferred per CLAUDE.md §12. |
| **§6.4** Booking confirmations sent via email + SMS | **Partially met** | Portal bookings send a best-effort confirmation email ([`book/new/actions.ts:84`](../../src/app/portal/book/new/actions.ts)). Staff-created appointments send **nothing** (→ **P1-2**). SMS deferred per §12. |
| **§6.1** Staff client profile has a "Bookings" tab (session history, upcoming, management) | **Not met** | `clients/[id]/page.tsx:32` `VALID_TABS = details/notes/program/reports/files` — no Bookings tab. The appointments array IS loaded (`page.tsx:133-140`) but feeds only the NotesTab note-to-session picker. → **P1-1** |
| **Timezone** single source of truth across scheduling | **Not met** | Five decision points, four tz sources (see §2 FM-2). The staff `/schedule` `todayIso` runs server-UTC; the grid positions blocks browser-local; the portal booking surface uses org-tz while the portal "today" uses device-tz. → **P0-2** |
| **CLAUDE.md §12** SMS wired-but-stubbed, no half-active path | **Partially met** | Send path is a **clean stub** (worker filters `provider='resend'`; nothing writes a Twilio row). But [`NotificationsForm.tsx:47-52`](../../src/app/(staff)/settings/_components/NotificationsForm.tsx) ships a **live SMS toggle** ("Twilio costs apply") that persists and does nothing. → **P2-4** |
| **§6.4** Reschedule (client self-service) | **N/A — accepted deviation** | Clients are cancel-and-rebook only (F3 deferred); the field-lockdown trigger forbids client `start_at` changes. The brief grants reschedule to *staff*, not clients. Recorded in §2 (accepted). |
| Audit trail on every scheduling table | **Met** | All three tables carry audit triggers + are registered in `audit_resolve_org_id`; the coverage-guard assertion (`20260513160000`) fails the migration on any missing branch. |

---

## 2. Premortem — ranked failure modes (protocol step 3)

Weighting per protocol: **infrastructure and security at production grade**; **operational, UX, and workflow at friends-and-family scope** (operator + one EP collaborator + small invited circle, no paying clinical clients). A gap closing a high-likelihood failure mode is promoted in priority.

| # | Failure mode | Likelihood | Impact | → |
|---|---|---|---|---|
| **FM-1** | **Booking RPCs are anon-EXECUTE.** `client_available_slots`, `client_book_appointment`, `client_cancel_appointment` retain the Supabase default anon EXECUTE grant on live (`REVOKE … FROM PUBLIC` does not strip the role-specific anon grant; every `CREATE OR REPLACE` re-trips it). Each fails closed today on its in-body `auth.uid()` guard, so there is no live data leak — but `client_book_appointment` is a **write** (INSERT into `appointments`), and the posture is one guardless `CREATE OR REPLACE` away from exposure with no grant-level backstop and no pgTAP tripwire. Weighted production-grade. | Certain (grant present, probe-confirmed) / Low (exploit — guards hold) | High posture risk on a multi-tenant clinical write surface; mirrors the section-6 P0-1 that was treated as P0 | **P0-1** |
| **FM-2** | **The schedule shows the wrong "today" every morning, and breaks entirely off-tz.** `schedule/page.tsx:102,188,234-240` computes `todayIso`, the day-view seed, and the week boundary from `new Date()` on the **Vercel server (UTC)**; `WeekView.tsx` positions every block, the now-line, and the today-ring **browser-local** via `getHours()`/`getDay()` (`1166,1527,2543-2549`). `todayIsoInPracticeTz()`/`PRACTICE_TIMEZONE` (section 6) are never imported. For the AU operator the server-UTC limb mislabels "today" daily between local midnight and ~10–11am (the section-6 P0-2 class); the browser-local limb misrenders the whole grid for any out-of-tz device (travel, the EP collaborator). The slot generator (org-tz) and this grid (UTC/browser) disagree on what "today" is. | High (server-UTC limb fires daily for the operator) / Medium (browser-local limb needs an off-tz device) | Wrong day/time on a clinical schedule = missed-or-double-booked-session class | **P0-2** |
| **FM-3** | **Staff-booked clients get no confirmation and no reminder.** `createAppointmentAction` ([`schedule/actions.ts:104`](../../src/app/(staff)/schedule/actions.ts)) inserts the appointment and writes **no** `appointment_reminders` row and sends **no** confirmation email; only the portal RPC enqueues a reminder. No DB trigger auto-enqueues. When the EP books a client from the composer (the dominant path), the client is never reminded → no-show — the exact failure Cliniko reminders existed to prevent. | High (staff-side is the primary booking path) | Missed reminders → no-shows; defeats a named §6.4 deliverable | **P1-2** |
| **FM-4** | **Reschedule and staff-cancel leave the reminder stale.** `updateAppointmentTimeAction` updates `start_at`/`end_at` but not `appointment_reminders.scheduled_for` — a dragged portal booking keeps its reminder at the old time. `cancelAppointmentAction` does not flip the reminder row to `cancelled` the way the portal RPC does; it relies solely on the Edge Function's status re-check (`index.ts:236`) as the single guard. | Medium (drag-reschedule + staff-cancel are routine) | Wrong-time reminders erode trust; single-guard reliance is fragile | **P1-3** |
| **FM-5** | **Double-booking has no DB backstop.** `appointments` has no EXCLUDE/unique constraint over `(staff_user_id, time-range)`. `client_book_appointment`'s only guard is a `SELECT EXISTS` over `client_available_slots` at insert time — under READ COMMITTED two concurrent transactions both pass before either commits (the migration comment at `20260510120000:121-122` "the second sees the just-inserted appointment" is **false** for concurrent inserts). Staff `createAppointmentAction` and `updateAppointmentTimeAction` write directly with **no overlap check at all**, sharing no lock with the portal path. | Low (two-client race at f&f volume) / Higher (client-vs-staff cross-path collision — no shared guard) | A real double-booking is a clinical/operational failure; the EP arrives to two clients for one slot | **P1-4** |
| **FM-6** | **No way to close a date.** `availability_rules` has no negative/`is_blocked` flag; `client_available_slots` only UNIONs weekly + one-off as **additive** windows. On a public holiday, sick day, or leave, the recurring rule still generates bookable slots and a client can book into a closed clinic. The documented AVL-1 workaround ("book yourself an Unavailable appointment") **cannot be executed** — no sentinel client exists and `appointments.client_id` is `NOT NULL`. The only recourse is soft-deleting the entire weekday rule and re-adding it. | High over a year (holidays certain; ad-hoc closures common for a solo EP) | Client turns up to an empty clinic; no clean recovery; erodes trust on day one | **P1-5** |
| **FM-7** | **The EP can't see a client's bookings on their profile.** §6.1 promises a Bookings tab; it does not exist. To answer "when is this person next in / what's their history / cancel this booking" the EP must cross-reference the global `/schedule` grid by eye. The data is already loaded — only the surface is missing. | Certain (the tab does not exist) | Workflow friction on every profile visit needing booking context | **P1-1** |
| **FM-8** | **The booking picker silently under-shows far-edge slots (FM-6 rider).** `book/new/page.tsx:90-91` passes raw UTC instants (`now()`, `now()+28d`) as the window bounds; the RPC builds a date-based day grid but filters slots by instant (`slot_start … <= p_to`), so the **final day's afternoon slots are truncated by the load time-of-day** (verifier-corrected: it under-shows the far-edge *later* slots, never over-shows, no invalid slot admitted). The window is a rolling 28×24h UTC span, not 28 whole local days. | High (fires on any non-midnight load) / visible only at the edge | Client can't see some legitimately-open slots at the 4-week edge; "why did the 9am disappear at lunchtime?" | **P2-1** |
| **FM-9** | **Portal "today" (device) vs booking day (org) disagree for a cross-tz client.** The portal home screen resolves "today" via the device-tz cookie (section 7); the booking picker buckets and labels slots in org-tz (`book/new/page.tsx:84`, ignoring the cookie). For the same-tz beta population they coincide; for a travelling/interstate tester a slot read as "Saturday" on the home screen can group under "Friday"/"Sunday" in the picker — the mislabel class section 7 set out to kill, reintroduced on the booking surface. | Low at beta scope (same-tz) / High in correctness terms once any cross-tz user exists | Client could book what they read as the wrong day | **P2-2** |
| **FM-10** | **Three settings controls are dead.** `reminder_lead_hours` (2–168h selector) persists but the RPC hard-codes T-24h and the worker never reads it; the **SMS toggle** persists `sms_notifications_enabled` with no send path ("Twilio costs apply" implies a billing consequence that never occurs); `email_notifications_enabled` is never honoured on the reminder path. Each saves "Saved." and does nothing. | Medium (the EP will plausibly try each once) | Trust-eroding dead controls; the SMS one is the §12 stub leaking into the UI | **P2-3 / P2-4 / P2-5** |
| **FM-11** | **A transient blip permanently kills a reminder.** `markFailed` (`index.ts:278`) sets `status='failed'` terminally and the batch selects only `status='scheduled'`; `retry_count` (CHECK 0–5) is written and read nowhere. One Resend rate-limit / 5xx / network blip on the single cron tick covering a reminder kills it silently, though a retry five minutes later would succeed. | Medium (at least one transient failure over a beta lifetime) | Silent single-point reminder loss; the column implies a retry policy that doesn't exist | **P2-6** |
| **FM-12** | **The reminder template can rot out of sync.** The Edge Function inlines its own `renderReminderEmail` (`index.ts:393`) instead of importing the canonical [`booking-reminder.ts`](../../src/lib/email/templates/booking-reminder.ts), which is imported by nothing at runtime. A fix to the canonical template never reaches the shipped email. | Medium over the project life | Maintenance hazard; the shipped email drifts from its spec | **P2-7** |
| **FM-13** | **Lifecycle stalls at "confirmed"; overlapping blocks hide each other.** `no_show`/`completed` are full status values with colour/pill handling but **no action sets them** — the EP can't record a no-show or completion from the schedule. Concurrent appointments are absolutely positioned by time with no column-splitting, so two same-staff same-time blocks fully overlap and the later one obscures the earlier (made reachable by FM-5's missing staff-side clash guard). | no-show: High (every missed session) / overlap: Low at solo scope | Incomplete attendance record-keeping; a hidden double-booking the EP can't see | **P2-8** |
| **FM-14** | **Dead "next commit" copy on the empty week.** `WeekView.tsx:1587-1588` (EmptyWeekHint) reads "New booking dialog lands in the next commit. Hover any 15-minute slot to preview where it lands." — but the composer shipped and slots open it on **click**, not hover. The copy describes a state that no longer exists. | High (whenever a week is empty — common pre-launch and any quiet week) | Reads as unfinished software; factually wrong instruction | **P2-9** |
| **FM-15** | **Multi-staff readiness holes.** `availability_rules.staff_user_id` has no `enforce_same_org_fk` trigger (AVL-5), unlike `appointments` — an owner could author a rule for a non-member `staff_user_id` (ghost slots that can't be booked). The staff filter defaults to self, so a 2-EP org doesn't see both columns by default. Safe by construction today (single EP writes for self). | Low at single-staff scope | Defence-in-depth + multi-tenant integrity when a 2nd EP joins | **P2-10 / P2-11** |
| **FM-16** | **`appointment_type` drifts from `session_types` on staff writes.** The hard CHECK was dropped; the portal RPC validates the name against the org's `session_types`, but `createAppointmentAction` writes `input.appointmentType` with no validation — a typo or a renamed/deleted type mislabels the schedule colour stripe and any type-grouped reporting. | Low-medium (renamed/deleted type is the realistic trigger) | Cosmetic/reporting mis-bucket; not security | **P2-12** |
| **FM-17** | **Design-token drift across the scheduling surfaces.** 25 raw hex/rgba literals in `WeekView.tsx` (+ several in `PractitionerSidebar`), raw rgba notice-chip tints in the portal book surfaces, hardcoded radii in the availability editor, and `#F0EBE5` in `NotificationsForm.tsx:96` — all bypassing `globals.css` tokens (a code-standard violation; the availability-editor pass even grep-gated `borderRadius:[0-9]+`). | Certain (literals present) / cosmetic | Token-discipline erosion; divergence on any palette change | **P2-13** |
| **FM-18** | **The slot grid is as coarse as the session length, wasting bookable time.** `client_available_slots` steps by `slot_duration_minutes` and welds slot length to it, so 60-minute hours offer only hourly starts; a shorter session leaves the part-hour after it permanently unbookable, and the "next available" after an 11:00 booking is 12:00, not 11:30/11:45. The EP loses real bookable capacity, and clients see fewer options than exist. *(Operator-raised, 2026-06-15.)* | High (every booking on a non-hourly-fitting session) | Lost clinic capacity + a visibly wrong "next available" | **P1-6** |
| **FM-19** | **No way to reserve in-day non-client time.** There is no representation for admin/meeting/travel/break time inside a working day — the schedule can't show "admin 2–4pm", that time stays bookable by clients, and there is no home for a quick "ask this client X" note pinned beside an appointment. *(Operator-raised, 2026-06-15.)* | Medium-high (every week has some non-client time) | A client books over the EP's admin time; reminders have nowhere to live | **P1-7** |

### Accepted rather than mitigated (with rationale and re-trigger)

- **Client self-service reschedule stays deferred (F3).** Cancel-and-rebook outside 24h + "call the practice" inside 24h is the intended client path; the RLS field-lockdown forbids client `start_at` changes. Re-trigger: beta feedback surfaces reschedule friction.
- **Instant-confirm, no EP-confirm step (locked L3).** §6.4's "confirm" verb is satisfied by instant-confirm. `pending` status handling is dead-but-harmless. Accepted.
- ~~**Type-specific durations (F1/Q4 = A).**~~ **No longer accepted — pulled into scope as P1-6** (operator asked for it 2026-06-15). `session_types` gains `default_duration_minutes` and slots are offered per-type on a 15-minute step.
- **Buffer between bookings (L5).** Modelled as a slot-duration shape (book 50-min sessions on 60-min rules). Re-trigger: the EP requests an explicit buffer.
- **Upcoming-bookings query relies solely on RLS (no app-level `client_id` self-scope).** CLAUDE.md states "RLS is the security boundary, not application code" — an app-level `.eq('client_id')` is defence-in-depth the project's own doctrine does not require, and the verifier graded this borderline not-a-gap. **Surfaced, not a gap.** Re-trigger: a staff-readable SELECT policy is ever added to the client role path.

---

## 3. Gap list (protocol step 4)

Each gap cross-references the premortem failure mode it closes. Severities reflect the adversarial-verification corrections (FM-6/FM-8 → P2; portal-vs-org tz → P2; reschedule confirmed present-but-unhardened).

### P0 — architectural / security

| # | Gap | Closes | Detail |
|---|---|---|---|
| **P0-1** | **Anon-EXECUTE sweep of the scheduling booking RPCs.** | FM-1 | **Re-probe live first** (`has_function_privilege('anon', …, 'EXECUTE')`, as section 6 did — source-absence ≠ runtime-absence). Then one migration mirroring `20260612150000` / `20260614130000`: `REVOKE EXECUTE … FROM anon` on `client_available_slots(timestamptz,timestamptz)`, `client_book_appointment(uuid,uuid,timestamptz,timestamptz)`, `client_cancel_appointment(uuid)` (authenticated retained). Add a pgTAP `has_function_privilege` grant tripwire for all three — extend [`25_portal_rpc_grants.sql`](../../supabase/tests/database/25_portal_rpc_grants.sql) (which currently excludes them by note) or a new `26_scheduling_rpc_grants.sql` — asserting anon=false / authenticated=true, so a future auto-grant re-trip fails the suite. No guardless internal scheduling helper was found (all three are guarded), but the live probe must confirm no `_`-helper slipped in. Discharges the *scheduling-family* slice of the go-live rider; the platform-wide sweep (`client_accept_invite` pre-auth check §2, `client_cascade_thread_archive` §10) stays indexed in `go-live-checklist.md`. |
| **P0-2** | **Timezone reconciliation foundation.** *(Q2 resolved — practice tz governs the staff grid.)* | FM-2 (+ FM-8, FM-9) | A deliberate, documented governing-tz decision per surface (Q2 = practice/org tz for the staff grid), then route every "today"/"now"/window-boundary computation through it. The load-bearing fix: replace `schedule/page.tsx`'s server-`new Date()` `todayIso`/day-seed/week-boundary math with `todayIsoInPracticeTz()` / `PRACTICE_TIMEZONE`, and make `WeekView.tsx` position blocks + the now-line via tz-aware `Intl` parts rather than browser-local `getHours()`. Architecture-first: this decision also resolves FM-8 (the FM-6 window math → P2-1) and FM-9 (portal-vs-org display → P2-2), which are applications of the same rule. **Recommended governing tz:** org/`PRACTICE_TIMEZONE` for slot generation (already correct) + the staff grid + the staff `todayIso`; device-tz reserved for the portal's *personal* "today" affordance only; the booking picker's day labels stay org-tz so they match the slot grid (the portal-today/booking-day split is then intentional, not accidental). Reminder send-time math (`start_at − interval '24 hours'`) is pure-instant and already tz-safe — leave it. |

### P1 — functional

| # | Gap | Closes | Detail |
|---|---|---|---|
| **P1-1** | **§6.1 Bookings tab on the staff client profile.** | FM-7 | Add a "Bookings" tab to [`ClientProfile.tsx`](../../src/app/(staff)/clients/[id]/_components/ClientProfile.tsx) rendering the already-loaded appointments split into upcoming/past (type, date, time) with a cancel affordance (and reschedule once P1-3/P1-4 land). Reuse the portal `_lib/format` AU-English date/time helpers. Decide tab order against the notes/program adjacency. The data is already on the page — this is a surface, not a new query. |
| **P1-2** | **Staff-created appointments must trigger the email side-effect chain (confirmation + T-24h reminder).** | FM-3 | Today only the portal RPC enqueues a reminder and sends a confirmation. Make the side-effect uniform across **all** booking paths. **Recommended:** an `AFTER INSERT` trigger on `appointments` (gated to `status IN ('pending','confirmed')` and `start_at − 24h > now()`) that enqueues the reminder row, so every path — portal, staff composer, future Bookings-tab create — is covered by one mechanism; plus a confirmation-email send wired into `createAppointmentAction`. pgTAP: a staff-inserted future appointment produces a `scheduled` reminder. Sequence this **before** any staff-side confirmation copy so the "we'll remind you 24h before" line (`booking-confirmation.ts:84`) is universally true (closes FM/REM-5). |
| **P1-3** | **Reschedule and staff-cancel keep the reminder correct.** | FM-4 | On `start_at` change (drag-move/resize), re-time or re-enqueue the reminder to `new_start − 24h`; on staff cancel, mark queued `scheduled` reminder rows `cancelled` (matching the portal RPC), so the Edge Function guard stops being the single point of failure. **Recommended:** fold both into the P1-2 trigger (`AFTER UPDATE OF start_at, status`) so the reminder lifecycle is one DB-owned mechanism rather than scattered across app paths. |
| **P1-4** | **DB-level double-booking backstop + staff-path overlap check.** | FM-5 | `ALTER TABLE appointments ADD CONSTRAINT appointments_no_staff_overlap EXCLUDE USING gist (staff_user_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (status IN ('pending','confirmed') AND deleted_at IS NULL);` (`btree_gist` already installed, `20260503110000:20`; pattern mirrors `programs_no_active_overlap`). `client_book_appointment` catches `exclusion_violation` (23P01) and returns the existing "slot no longer available" error; add a shared overlap pre-check to `createAppointmentAction` and `updateAppointmentTimeAction` so the staff paths surface a clean inline error instead of a raw 23P01. Correct the misleading comment at `20260510120000:121-122`. pgTAP for the concurrent/cross-path case (the current acceptance test only exercises the sequential case). **Two deliberate exemptions baked into the constraint's `WHERE`:** it applies only to `status IN ('pending','confirmed')` (so a replacement booking *can* overlap a cancelled appointment — enables the side-by-side view in P2-8) and excludes **unavailable-kind** rows (P1-7) (so admin/note blocks may sit beside a client appointment). |
| **P1-5** | **Negative availability — "close a date" (AVL-1).** *(Q1 = a, build now.)* | FM-6 | Add `availability_rules.is_blocked boolean DEFAULT false` (a one-off rule with `is_blocked=true` *subtracts* its window — the mirror of the existing positive one-off); teach `client_available_slots` to subtract blocked windows from the grid *before* the appointment-overlap filter; add a **"Close a date"** action to [`OneOffOverrides.tsx`](../../src/app/(staff)/settings/availability/_components/OneOffOverrides.tsx) alongside the existing "add a one-off". **UX (operator-confirmed home):** the availability editor, not the schedule grid. Manual **single date or date range** (range = a leave block, fanned out to one blocked row per day or stored as a ranged rule); **whole-day default** with an optional partial window (close just the morning). No public-holiday auto-detection (AVL-8 stays deferred — the EP closes the days they're closed). The closure list renders distinct from positive exceptions (a quiet "Closed" tag). Avoids the sentinel-client schema relaxation for *whole-day* closures. Promoted from deferred because holidays/sick-days are high-likelihood and the prior workaround is non-buildable. **Whole-day mechanism**; the *timed* in-day equivalent is the Unavailable type (P1-7). |
| **P1-6** | **Per-type session durations + 15-minute slot granularity.** *(Operator-directed, round 2; pulls F1/Q4 into scope.)* | FM-18 | Today the slot grid step is welded to `availability_rules.slot_duration_minutes` ([`client_available_slots`](../../supabase/migrations/20260511120000_availability_rules_audit_and_constraints.sql:297-302)), so 60-minute hours yield only hourly start times and a booking removes the whole hour with no finer re-offer. **Decouple session length from the slot step.** Add `session_types.default_duration_minutes` (per-type: Initial 60 / Review 45 / Standard 30 / Telehealth 30, EP-editable). Rework the RPC to generate candidate starts every **15 min** (a `slot_step_minutes`, default 15) across the availability window, with slot length = the chosen type's duration; the existing `tstzrange` appointment subtraction then frees the exact remainder, so the next start lands immediately after a booking ends (11:30 after a 30-min session, 11:45 after a 45-min one). The 4-step picker already chooses type first, so it passes the type's duration into the slot fetch. Reconcile the meaning of `availability_rules.slot_duration_minutes` (becomes the step default or is superseded). pgTAP: a 30-min type booked at 11:00 offers 11:30; a 45-min offers 11:45. |
| **P1-7** | **"Unavailable" appointment-type kind (admin / meeting / note / …).** *(Operator-directed, round 2; supersedes the §5 timed-admin-block candidate.)* | FM-19 (operator workflow) | Add `session_types.kind` (`'appointment'` default \| `'unavailable'`). Seed unavailable sub-types in **Settings → Appointment types** under an "Unavailable" sub-section: **Meeting, Admin/paperwork, Note/reminder, Break/lunch, Travel, Phone call, Professional development/supervision, Personal/leave** (EP-editable). Schema: relax `appointments.client_id` to **nullable + CHECK** (`NOT NULL` for appointment-kind; may be NULL for unavailable-kind). Unavailable blocks render on the schedule with their type colour, are **staff-only (never client-visible)**, and are **exempt from the double-booking constraint** (P1-4) so they may sit beside a client appointment (e.g. "Note: ask Sarah about her knee" beside her 11:00). The staff composer gains an Unavailable path (sub-type + time + optional note text, no client). Both P1-5 (whole-day close) and P1-7 (timed block) subtract bookable time — at different layers; document the split. |

### P2 — polish

| # | Gap | Closes | Detail |
|---|---|---|---|
| **P2-1** | FM-6 booking-window edge. | FM-8 | Compute `p_from`/`p_to` from local-calendar-day boundaries in the governing tz (start-of-today … end-of-day+27), not raw UTC instants, so "next 4 weeks" is a stable whole-day set independent of load time. Folds into the P0-2 decision. Add a unit test at a late-evening offset. Named go-live rider — closes it explicitly even at P2. |
| **P2-2** | Portal booking surface tz. | FM-9 | Route [`book/new/page.tsx`](../../src/app/portal/book/new/page.tsx) and [`book/page.tsx`](../../src/app/portal/book/page.tsx) through the portal tz resolver (`resolvePortalTimeZone`) instead of reading `org.timezone` directly, OR consciously record the org-tz booking-day vs device-tz home-today split as intentional (per the P0-2 decision). Either way, make it deliberate. |
| **P2-3** | Wire `reminder_lead_hours`. *(Q3 = wire it.)* | FM-10 | Read `organizations.reminder_lead_hours` at reminder enqueue time (fall back to 24h) so the selector's value actually drives the send. The reminder_type label is currently `reminder_24h_email` — generalise it (e.g. `reminder_email`) or keep it cosmetic. Folds into the P1-2 enqueue mechanism. |
| **P2-4** | Honest SMS stub in settings. | FM-10 | Disable the [`NotificationsForm.tsx:47-52`](../../src/app/(staff)/settings/_components/NotificationsForm.tsx) SMS toggle with a "Coming soon — SMS reminders are not active in the beta" helper (or hide it). Keep the `sms_notifications_enabled` column for section-12 forward-readiness. This is the §12 stub leak. |
| **P2-5** | Honour or retire `email_notifications_enabled`. | FM-10 | Either gate the reminder/confirmation send on the org flag, or remove the email toggle for the beta (email is the sole active channel). Keep the three notification controls all-live or all-honestly-disabled, not silently inert. |
| **P2-6** | Failed-reminder retry. | FM-11 | On a retryable failure (5xx / rate-limit / network) increment `retry_count` and leave `status='scheduled'` so the next tick retries to the cap, then flip `failed`; treat 4xx as terminal. The column already exists with a 0–5 CHECK. |
| **P2-7** | De-duplicate the reminder template. | FM-12 | Extract the shared reminder template + date helpers into a Deno-importable module the Edge Function imports, or add a drift check diffing the EF copy against [`booking-reminder.ts`](../../src/lib/email/templates/booking-reminder.ts). Document the canonical source. |
| **P2-8** | Status lifecycle + side-by-side overlap rendering + cancellations toggle. *(Operator-directed, round 2.)* | FM-13 | **(a) Side-by-side column-splitting** for concurrent blocks — a cancelled appointment and its replacement, or an unavailable block and a client appointment, both render without hiding each other (today the later block obscures the earlier). **(b) A visible "Hide cancellations" / "Show cancellations" toggle** on the schedule, **default = show** (operator values seeing cancelled rows beside their replacements). **(c)** No-show / mark-complete actions on the popover (lifecycle past `confirmed`). Together these turn the existing "cancelled rows stay visible" behaviour into a usable cancelled-vs-replacement view. |
| **P2-9** | Rewrite the empty-week copy. | FM-14 | Replace the "next commit / hover to preview" `EmptyWeekHint` text with quiet, factual design-system voice describing the real click-to-create interaction, e.g. "No bookings this week." + "Click any time to add one." |
| **P2-10** | Multi-staff default on the schedule. *(Q4 = keep week-only.)* | FM-15 | Week view accepted as the beta calendar (no agenda/month build — recorded accepted deviation from a literal reading of "all upcoming"). Default the staff filter to **all org practitioners** ([`schedule/page.tsx:74-75`](../../src/app/(staff)/schedule/page.tsx)) so a 2-EP org sees both columns without toggling. |
| **P2-11** | Same-org FK trigger on `availability_rules` (AVL-5). | FM-15 | Add a `BEFORE INSERT/UPDATE` `enforce_same_org_fk('user_profiles','staff_user_id','organization_id')` trigger so the multi-staff path is safe before AVL-1b/owner-on-behalf ships. One line, zero behaviour change at single-staff. |
| **P2-12** | Validate `appointment_type` on staff writes. | FM-16 | Validate `appointmentType` against the org's live `session_types` in `createAppointmentAction` (or constrain the composer to a select of live types) — the cleanest form is the type-select the composer needs anyway once P1-6 (`default_duration_minutes`) and P1-7 (the kind selector) land, so this largely folds into those. |
| **P2-13** | Design-token sweep of the scheduling surfaces. | FM-17 | Replace literals that map to existing tokens (accent, alert, charcoal, card `#fff`, `#F0EBE5`→border-subtle) with `var(--…)` across `WeekView.tsx` (25 literals), `PractitionerSidebar.tsx`, the portal book notice chips, the availability editor radii, and `NotificationsForm.tsx:96`. For the pending/no-show amber and the grid hairline, introduce named tokens (`--color-warning` exists; consider `--color-grid-line`) rather than ad-hoc hex. Centralise the per-status tone colours (`toneToColors`). Batch — do not do one-off. Any value needing a *new* design-system token is surfaced for an operator/design decision, not invented. |
| **P2-14** | **Recurring appointments — "Repeat" in the composer.** *(Operator-directed, round 2.)* | new feature | In the staff appointment composer, after client + type, a **"Repeat" toggle** → frequency (**daily / weekly / fortnightly / monthly**) + occurrences (count or end date). On save, generate concrete appointment rows on the cadence (not an abstract recurrence rule — concrete rows let the EP cancel/move a single session of the series), each respecting the P1-4 constraint (a clashing instance is surfaced/skipped, not silently dropped) and each enqueuing its own reminder via the P1-2 trigger. Per-instance result summary on save. |
| **P2-15** | **Schedule "Tools" menu — Find next available + Calendar subscribe (.ics).** *(Operator-directed, round 2.)* | new feature | A quiet "Tools" dropdown on `/schedule`. **Find next available:** pick a session length/type → server scans the slot engine for the soonest open slot → snaps the grid to it (the "when's your next opening?" phone moment). **Calendar subscribe (.ics):** a **de-identified** private feed — events carry **session type + time + location only; NO client name, NO clinical detail** (mandatory: an .ics subscription URL is unauthenticated, so PHI must never enter it). Per-practitioner **unguessable, revocable** token; surfaced as a "Subscribe in your calendar" link + a regenerate-token control. Printable day sheet **dropped per operator**; `.ics` *import* into availability (AVL-7) stays deferred — this is *export/subscribe* only. |

---

## 4. Open questions — resolved 2026-06-15 (see §0.1 sign-off log)

**Q1 — Negative availability (AVL-1 / P1-5): build now or accept with a working workaround?** The original availability-editor pass *deferred* AVL-1 (locked) with a workaround that this audit found **non-buildable** (no sentinel client; `appointments.client_id` is `NOT NULL`). Options:
- **(a) Recommended — build it now (P1-5, option B):** `is_blocked` one-off + subtraction in `client_available_slots` + a "Close this date" affordance. Closes a high-likelihood failure (holidays/sick days are certain) and the workaround is genuinely unavailable. Modest, well-bounded change while pre-launch advantages hold.
- **(b)** Accept for the beta with a *buildable* workaround: a sentinel "Practice closed" client row to book against (needs a schema decision — nullable `client_id` + a CHECK, or a seeded sentinel). More moving parts than (a) for a worse UX.
- **(c)** Defer again, document, expect the EP to hit it within weeks.
Recommend **(a)** — it is the cleanest fix and removes a day-one trust failure.
**Resolved: (a) — build now.** Home = the availability editor's one-off panel ("Close a date"), manual single-date or date-range, whole-day default with optional partial window, no auto-holidays. Operator also flagged a separate timed "Unavailable/admin" block (§5 candidate) — adjacent, not part of P1-5.

**Q2 — Governing timezone per surface (P0-2).** The section owns picking one and routing through it. Recommended:
- Slot generation → **org-tz** (already correct).
- Staff `/schedule` grid + `todayIso` → **org/`PRACTICE_TIMEZONE`** (a single-clinic surface; fixes the daily-wrong-today + off-tz misrender).
- Booking picker day labels → **org-tz** (so they match the slot grid).
- Portal *personal* "today" (week strip/greeting) → **device-tz** (the section-7 decision, unchanged).
- Reminder send-time → **pure instant** (already correct, leave it).
This makes the portal-today (device) vs booking-day (org) split intentional. Confirm, or choose device-tz for the staff grid (not recommended for a fixed-location clinic).
**Resolved: practice timezone governs the staff schedule grid** (and `todayIso`); the rest of the map stands as recommended.

**Q3 — Reminder side-effect mechanism (P1-2/P1-3).** Recommended: a **DB trigger** on `appointments` (`AFTER INSERT` to enqueue, `AFTER UPDATE OF start_at, status` to re-time/cancel) so reminders are one DB-owned mechanism covering every booking path, present and future — rather than duplicating enqueue logic in each app action. Confirm trigger-vs-app-code. And: **wire `reminder_lead_hours`** (read the org setting, default 24h) **or** hard-document 24h and retire the selector (P2-3) — which?
**Resolved: wire `reminder_lead_hours`** (make the selector real, default 24h). DB-trigger mechanism recommended for the enqueue/re-time/cancel lifecycle (implementer's call).

**Q4 — §6.4 "across all clients" (P2-10).** Is the week grid the accepted beta calendar (recommended — agenda/month is a build, low value at solo+1 scope), or do you want a month/agenda surface? Separately: default the staff filter to **all org practitioners** so a 2-EP org sees both columns by default (recommended), or keep self-default?
**Resolved: keep week-only** (no agenda/month build); **default the staff filter to all practitioners.**

**Q5 — Settings honesty (P2-4/P2-5).** SMS toggle → "Coming soon", disabled (recommended). Email toggle → **gate the send on it** (recommended, makes it real) or remove for the beta? The three notification controls should be all-live or all-honestly-disabled, not silently inert.
**Proceeding as recommended unless overridden:** SMS toggle disabled with a "Coming soon" helper (keeps the column for §12); email toggle gates the send so it is real. Flag during the pass if you'd rather hide them.

---

## 5. Out of scope for this pass

- **SMS activation.** Twilio stays installed-but-inactive per CLAUDE.md §12; this section keeps the send path a clean stub and makes the *settings* surface honest (P2-4). SMS activates only with section 12, post-beta, if paying clients onboard.
- **The platform-wide anon-EXECUTE sweep beyond scheduling.** `client_accept_invite` (§2 — verify pre-auth use before revoking) and `client_cascade_thread_archive` (§10) stay indexed in `go-live-checklist.md`, owned by their sections. P0-1 discharges only the scheduling slice.
- **Buffer-between-bookings (L5/F7), owner-on-behalf availability (AVL-1b), drag-to-draw in the Weekly grid (AVL-2), `.ics` *import* into availability (AVL-7 — distinct from the P2-15 *export/subscribe* feed), public-holiday auto-detection (AVL-8 — P1-5 is manual).** Deferred follow-ups with their own re-triggers (see the prior polish docs); not this pass. *(Type-specific durations, formerly deferred here as F1/Q4, are now in scope as P1-6.)*
- **The EP dashboard "Today's Sessions" + the named Schedule tab (§6.8.3/§6.8).** Section 11.
- **Client self-service reschedule (F3).** Accepted as cancel-and-rebook (§2).
- **The non-production test target and Supabase Pro-tier items.** Project-wide gates in `go-live-checklist.md`, not section-9 scope. pgTAP for this section runs against live via `BEGIN … ROLLBACK` per the current standing liability.

---

## 6. Stop point — awaiting contract approval

This document is the contract for section 9. **No code has been changed.** Per protocol step 5, the gap list and premortem above await operator sign-off (and the Q1–Q5 decisions) before any implementation.

Proposed build order (protocol step 6 — architecture before features, features before polish), pending the sign-off:
**P0-1** (anon-EXECUTE sweep: live probe → REVOKE migration → pgTAP tripwire) → **P0-2** (timezone reconciliation foundation: governing-tz decision → staff-schedule + WeekView fixes) → **P1-4** (double-booking EXCLUDE constraint — the DB foundation the booking-model rework and recurring/cancellation work all lean on) → **P1-6 + P1-7** (booking-model rework, grouped because both reshape `session_types`/`appointments` + the slot engine: per-type durations + 15-min granularity, and the Unavailable type kind with the `client_id` relaxation + the P1-4 constraint exemption) → **P1-2 + P1-3** (reminder lifecycle trigger — enqueue on create, re-time on reschedule, cancel on cancel; wires P2-3's lead-time) → **P1-5** (close a date) → **P1-1** (§6.1 Bookings tab) → **P2-1 + P2-2** (window edge + portal tz, riding on P0-2) → **P2-8** (cancellation side-by-side + toggle) → **P2-14** (recurring composer) → **P2-15** (Tools: find-next-available + de-identified .ics) → **P2-3..P2-5** (settings honesty) → **P2-6, P2-7, P2-9..P2-12** (reminder retry, template de-dup, empty-week copy, multi-staff, type validation) → **P2-13** (token sweep, last).

Acceptance tests run at the end of the pass (protocol step 7): the scheduling pgTAP suite (anon-grant tripwire + double-booking constraint + reminder-enqueue + per-type-duration slot assertions + unavailable-overlap exemption) green on live; `type-check` / `eslint` / `next build` clean; and an operator authenticated browser walkthrough of: the booking → schedule → reminder loop; the Bookings tab; a closed-date block; a cross-day reschedule; **a 30-min type offering 11:30 after an 11:00 booking** (P1-6); **an Unavailable block sitting beside a client appointment** (P1-7); **a cancelled appointment and its replacement side-by-side with the show/hide toggle** (P2-8); **a recurring series from the composer** (P2-14); **find-next-available and a de-identified .ics feed** (P2-15, verifying no client name appears in the feed).

---

## 7. Progress log

### P0-1 — Anon-EXECUTE sweep of the scheduling booking RPCs — done 2026-06-15

**Probe (live, SQL Editor).** `has_function_privilege` confirmed the predicted posture: `client_available_slots`, `client_book_appointment`, `client_cancel_appointment` were all anon-EXECUTE=true on live — the auto-grant each function's source `REVOKE … FROM PUBLIC` never strips (memory `project_supabase_default_execute_grants`; source-absence ≠ runtime-absence). The probe surfaced a **fourth** scheduling-family SECURITY DEFINER *write* in the same posture — `soft_delete_availability_rule(uuid)` — folded into the sweep (operator-approved 2026-06-15). **No guardless internal `_`-helper** exists in the scheduling family: the highest-risk bucket (where the anon grant *is* the exposure, not defence-in-depth) is empty — all four are SECURITY DEFINER with in-body `auth.uid()`/org guards that fail closed for anon (`soft_delete_availability_rule`'s `caller_id IS NULL → 42501` is representative). `appointments_client_field_lockdown` (also anon-true in the probe) was left untouched — a trigger function (`RETURNS trigger`, `security_definer=false`), not directly invocable (`0A000: trigger functions can only be called as triggers`), so its grant is meaningless.

**Fix.** Migration [`20260615120000_revoke_anon_execute_scheduling_rpcs.sql`](../../supabase/migrations/20260615120000_revoke_anon_execute_scheduling_rpcs.sql) — grants only, backward-compatible with deployed master (authenticated retained, so every logged-in caller still executes) — `REVOKE EXECUTE … FROM anon` on all four. Applied to live via `supabase db push` (dry-run first confirmed only this migration pending). pgTAP [`26_scheduling_rpc_grants.sql`](../../supabase/tests/database/26_scheduling_rpc_grants.sql) (`plan(8)`) **8/8 green on live** — §A anon executes none, §B authenticated keeps all four — the regression tripwire against a future `CREATE OR REPLACE` re-tripping the auto-grant. Companion to test 25 (section 7), which scoped these §9 functions out by note. No type regen (grants only).

**Discharges** the §9 (scheduling) slice of the go-live anon-EXECUTE rider (recorded in [`go-live-checklist.md`](../go-live-checklist.md) §4). Platform-wide sweep continues — `client_accept_invite` (§2, verify pre-auth use first), `client_cascade_thread_archive` (§10) — owned by their sections.

### P0-2 — Timezone reconciliation foundation — done 2026-06-15

**Decision (Q2):** the staff `/schedule` grid is governed by `PRACTICE_TIMEZONE` (the clinic/org tz), independent of both the Vercel server clock (UTC) and the viewer's browser tz. Slot generation already uses org-tz; the portal's personal "today" stays device-tz (section 7) — so the portal-today vs booking-day split is intentional, not accidental.

**Helpers (`src/lib/dates.ts`).** Added `wallClockPartsInTimeZone(instant, tz)` (instant → `{year,month,day,hour,minute,weekday 0=Mon}` via `Intl.formatToParts`), `zonedTimeToInstant(y,m,d,h,min,tz)` (the inverse — a wall-clock time in a zone → its UTC instant, single-offset-correction; exact outside the ~1h DST window, and Sydney transitions at 02:00–03:00 so clinic hours and midnight boundaries are unaffected), and `startOfDayInstant(isoDate, tz)`. Algorithm verified by a standalone node check for AEST (UTC+10) + AEDT (UTC+11) midnights, a 09:00 clinic time, and a round-trip — 7/7 pass.

**Server (`schedule/page.tsx`).** Re-plumbed onto ISO calendar-date strings resolved in practice-tz: `todayIso = todayIsoInPracticeTz()`; the week default, `?d=`/`?w=` parsing, the day-view seed, and "today in week" are now ISO-string / UTC-day-number math (tz-agnostic). The appointments query window is bounded by `startOfDayInstant(weekStartIso/weekEndIso, PRACTICE_TIMEZONE)` — fixing the prior server-local-midnight (UTC) window that shifted ~10–11h, dropping this week's early-Monday rows while leaking next week's. The old browser-local helpers (`mondayOfWeek`, `parseOptionalIsoDate`, `dayIdxMonBased`, `sameCalendarDay`, `toIsoDate`…) were replaced with ISO equivalents.

**Client (`WeekView.tsx`).** Every instant→wall-clock conversion used for positioning or display now resolves in `PRACTICE_TIMEZONE`: day-column bucketing (`dayIndexInPracticeTz`, replacing the browser-local `dayIndexFromMonday`), the block vertical position, the now-line, the cross-day-drag column index (`dayIndexFromStart`), the `formatTime`/`formatDayDate` display formatters, and `slotToDate` (click-to-create now builds the instant in practice-tz so it lands at the intended clinic-local time on any device). The date-anchor math (`isToday`, the rolodex, month nav) was left untouched — it operates on date-only anchors and is correct once the source ISO strings are practice-tz.

**Verification.** `tsc --noEmit` clean. eslint net −1 error vs master (the edit removed a pre-existing `appointmentsByDay` memoization error and introduced none; the 3 remaining file-level errors pre-date this work and sit in untouched code — the drag-handler `react-hooks/immutability` self-reference + two unescaped JSX quotes — out of P0-2 scope). Node algorithm test 7/7. Browser smoke-test rides on the operator's authenticated `:3000` at the P0/P1 cluster checkpoint (the route is auth-gated; a headless preview can't reach it, and the change is visually identical for a clinic-tz browser — the check is "no regression").

**Deliberate residual (accepted, off-tz only).** The drag *write-path* delta math (`addMinutes` is tz-safe; cross-day `addDaysDate` keeps browser-local wall-clock) is correct for the operator on a clinic-tz browser. A *cross-day drag on a browser whose tz differs from the clinic* could land a day off — the same low-likelihood off-tz class the audit downgraded. The read/display path and click-to-create are fully practice-tz on any device. Re-trigger: a routinely off-tz staff device.

**Downstream.** `startOfDayInstant` is the exact primitive P2-1 (booking-window edge) reuses; the governing-tz map locked here is the basis for P2-2.

### P1-4 — DB double-booking backstop + staff-path overlap check — done 2026-06-15

**Constraint.** `appointments_no_staff_overlap` — `EXCLUDE USING gist (staff_user_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (status IN ('pending','confirmed') AND deleted_at IS NULL)` (migration [`20260615130000`](../../supabase/migrations/20260615130000_appointment_no_staff_overlap.sql), mirroring `programs_no_active_overlap`; `btree_gist` already installed). One DB authority closes the double-booking race for **every** path at once — replacing the portal RPC's TOCTOU-only `SELECT EXISTS` guard (false under READ COMMITTED for concurrent inserts) and giving the previously-unguarded staff write paths a backstop they shared no lock with. A live probe confirmed **zero** existing overlapping pending/confirmed pairs, so `ADD CONSTRAINT` validated cleanly. Two deliberate exemptions in the WHERE: cancelled/no_show/completed rows don't block a booking (a replacement may be booked over a cancelled slot — the **P2-8 enabler**) and soft-deleted rows are ignored. The predicate matches the existing `appointments_reminder_scan_idx`.

**RPC.** `client_book_appointment` recreated to catch the constraint's `exclusion_violation` (23P01) — the genuine concurrent race that beats the in-body slot re-check — and re-surface `"slot no longer available"`, so the portal shows one consistent message. The `CREATE OR REPLACE` re-trips Supabase's anon auto-grant, so the migration re-asserts the P0-1 `REVOKE … FROM anon`; **pgTAP 26 re-ran 8/8** confirming the posture held (A2/B2).

**Staff actions.** `createAppointmentAction` + `updateAppointmentTimeAction` map `23P01` → *"That time overlaps an existing booking for this practitioner."* (clean inline error, not a raw constraint message).

**Tests.** New pgTAP [`27_appointment_overlap.sql`](../../supabase/tests/database/27_appointment_overlap.sql) (`plan(5)`) **5/5 green on live**: overlap rejected · back-to-back (half-open) allowed · cancelled-overlap allowed · different-staff allowed · catalog predicate tripwire. The cross-path guarantee the prior sequential-only acceptance test lacked (the constraint is path-agnostic).

**Backward-compat (shared DB).** Grant- and signature-stable; the only live-frontend behavioural change is that a true race now raises 23P01 instead of creating a double-booking — harmless and rare at f&f scale, cleanly handled once the section-9 frontend deploys. `tsc` clean.

**P1-7 dependency (noted in-migration).** When the Unavailable kind lands, the constraint must be recreated with `AND kind = 'appointment'` so admin/note blocks may overlap a client appointment.

### P1-6 — Per-type session durations + 15-minute slot granularity — done 2026-06-15

**Schema.** `session_types.default_duration_minutes` (smallint, CHECK 5–240, default 60), seeded **Initial 60 / Review 45 / Session 45 / Telehealth 30** (operator confirmed the standard "Session" is 45, not the gap doc's tentative 30). Migration [`20260615140000`](../../supabase/migrations/20260615140000_session_type_durations_and_slot_granularity.sql).

**Slot engine.** New 3-arg `client_available_slots(p_from, p_to, p_slot_minutes)`: candidate starts every **15 min** (decoupled from the slot length), each slot `p_slot_minutes` long, minus pending/confirmed appointments — so the part-hour after a shorter session is bookable. **Deploy-skew bridge:** the welded 2-arg overload is left untouched (the deployed portal still calls it); `p_slot_minutes` has no default so `{p_from,p_to}` and `{p_from,p_to,p_slot_minutes}` never resolve ambiguously. **Post-deploy cleanup (done 2026-06-15, after deploy #1 green):** the dead 2-arg overload was dropped (`20260615190000`) and test 26 trimmed to 8 — a single per-type slot path remains.

**Booking re-check.** `client_book_appointment` recreated ([`20260615140100`](../../supabase/migrations/20260615140100_client_book_appointment_per_type_recheck.sql)) to re-check via the 3-arg form, passing the booking's own length — the 2-arg welded re-check would reject every non-60-min booking as "slot no longer available". Backward-compatible (a deployed 60-min booking re-checks with `p_slot_minutes = 60`). 3rd recreation this section; re-asserts the P0-1 anon revoke (pgTAP 26 A2 confirms anon held).

**Picker.** [`book/new/page.tsx`](../../src/app/portal/book/new/page.tsx) fetches `default_duration_minutes`, resolves the chosen type's duration (shortest type's duration before a type is picked, for the empty-state check), and calls the 3-arg RPC. Now sequential (types → duration → slots) since slots depend on the chosen length.

**Tests.** New pgTAP [`28_slot_granularity.sql`](../../supabase/tests/database/28_slot_granularity.sql) **3/3 on live**: 11:30 offered after an 11:00 booking · 11:00 not offered (overlap) · 30-minute length. Test 26 extended to **10/10** (§C: the 3-arg overload anon-revoked / authenticated-kept). Test 27 still 5/5; `tsc` clean.

**Deferred into P1-7 (same cluster):** the SessionTypesEditor duration-editing field + the `seed_organization_defaults` rewrite (durations + `kind` + the seeded Unavailable types) — consolidated so the editor grid and the seed function are each touched once, alongside the kind work.

### P1-7 — "Unavailable" appointment-type kind — done 2026-06-15

**Migration ([`20260615150000`](../../supabase/migrations/20260615150000_appointment_unavailable_kind.sql)).** `session_types.kind` + `appointments.kind` (text+CHECK, default `'appointment'`); `appointments.client_id` → nullable + CHECK (`appointment` needs a client, `unavailable` may not); `appointments_no_staff_overlap` recreated with `AND kind = 'appointment'` so unavailable blocks may overlap a client appointment; 8 Unavailable sub-types seeded (Meeting, Admin/paperwork, Note/reminder, Break/lunch, Travel, Phone call, Professional development, Personal/leave — muted grey, EP-editable); consolidated `seed_organization_defaults` rewrite (durations + kind + unavailable, so new orgs inherit them). All additive + backward-compatible (kind defaults to `'appointment'`; zero existing overlaps → constraint revalidated clean).

**Behaviour.** Unavailable blocks are written `status='confirmed'`, so the existing slot subtraction already removes their time from client-bookable slots (closes FM-19 — a client can't book over the EP's admin time), while the constraint exemption lets the EP pin them beside a client appointment.

**Frontend.** `createAppointmentAction` sets `kind` + allows a null client for unavailable. The composer's type selector is grouped (Appointment / Unavailable optgroups); picking an unavailable type hides the client field, drops the client requirement, and defaults the duration to the type's. The schedule grid's `client !== null` filter is removed and the block label + popover render null-client blocks (type name + note + a "Remove block" action). [`SessionTypesEditor`](../../src/app/(staff)/settings/session-types/_components/SessionTypesEditor.tsx) reworked: a duration column (P1-6 EP-editable) + Appointment / Unavailable sub-sections + a kind-aware add row.

**Tests.** pgTAP [`27_appointment_overlap`](../../supabase/tests/database/27_appointment_overlap.sql) extended to **6/6** (assertion 6: an unavailable-kind block may overlap a confirmed appointment — the exemption). Types regenerated; `tsc` clean; eslint net-zero new errors (the 4 file-level errors are pre-existing react-compiler / react-hooks rules on code that predates them — confirmed against master — and ship in prod).

**P1-6 + P1-7 cluster complete.** Durations seeded + EP-editable; the slot engine offers per-type slots on a 15-min step; unavailable blocks are bookable, rendered staff-only, and managed in Settings. **Post-deploy cleanup (done 2026-06-15):** the dead 2-arg `client_available_slots` overload was dropped (`20260615190000`); test 26 trimmed 10→8.

### Post-review fixes — 2026-06-15 (:3000 cluster walkthrough)

Two issues from the operator's authenticated `:3000` walkthrough:

- **Clients could select Unavailable types in the booking picker.** The portal read all `session_types` and the client SELECT policy returned every kind. Tightened the client RLS policy to `kind = 'appointment'` (migration [`20260615160000`](../../supabase/migrations/20260615160000_client_session_types_appointment_only.sql) — RLS is the boundary; backward-compatible, the deployed portal only ever showed appointment types) and added an explicit `.eq('kind','appointment')` to the picker query.
- **Overlapping blocks stacked and hid each other** (a note rendered *under* its session). Pulled **P2-8(a)** forward: `computeDayLayout` assigns side-by-side lanes within each overlap cluster (full width when alone; cancelled + unavailable blocks participate, so a replacement sits beside its cancelled original and a note beside its session). Click still opens the full popover; the cross-day drag translate is scaled by lane count. Layout verified by a standalone check (overlap / adjacent / triple / replacement). **P2-8 (b)** show/hide-cancellations toggle and **(c)** no-show/complete actions remain for the P2 phase.

### P1-2 + P1-3 — Reminder lifecycle trigger (+ wired reminder_lead_hours) — done 2026-06-15

**Trigger.** `appointment_manage_reminder()` on `appointments` (`AFTER INSERT OR UPDATE OF start_at, status`, SECURITY DEFINER; migration [`20260615170000`](../../supabase/migrations/20260615170000_appointment_reminder_lifecycle.sql)) owns the single T-lead email reminder for **every** booking path: enqueues at `start_at − reminder_lead_hours` (default 24h) for a live, future, client (`kind='appointment'`) booking; re-times on reschedule (clearing sent/failed state so the cron re-sends for the new time); cancels the queued reminder when the appointment leaves the live set (cancel / no_show / complete / soft-delete / →unavailable). Unavailable blocks get none. Closes **FM-3** (staff-created bookings — the dominant path — were never reminded) + **FM-4** (reschedule/cancel staleness).

**RPC.** `client_book_appointment` recreated (5th, final) to drop its inline enqueue — the trigger now owns it for all paths. Backward-compatible (the deployed portal still gets a reminder, via the trigger; staff bookings now get one too). Re-asserts the P0-1 anon revoke (pgTAP 26 A2 confirms).

**Confirmation (P1-2).** `createAppointmentAction` emails the client a confirmation (best-effort, appointment-kind only) via the shared `sendBookingConfirmationEmail` + the tz-aware booking formatters — staff bookings get the same confirmation the portal sends.

**reminder_lead_hours (P2-3 wired).** The trigger reads `organizations.reminder_lead_hours` (default 24h), so the settings selector now drives the send. The `reminder_24h_email` enum label is left cosmetic.

**Tests.** New pgTAP [`29_reminder_lifecycle.sql`](../../supabase/tests/database/29_reminder_lifecycle.sql) **4/4 on live**: enqueue at start − 24h · cancel on cancel · re-time on reschedule · none for unavailable. pgTAP 26 still 10/10; `tsc` clean. (Browser booking→reminder loop rides on the operator's `:3000` cluster review.)

### P1-5 — Negative availability ("close a date") — done 2026-06-15

**Schema + slot engine.** `availability_rules.is_blocked` (default false; migration [`20260615180000`](../../supabase/migrations/20260615180000_availability_close_a_date.sql)). A one-off rule with `is_blocked=true` **subtracts** its window — the mirror of the positive one-off. The 3-arg `client_available_slots` now excludes `is_blocked` rows from the positive `rules` CTE and adds a `blocks` CTE that subtracts closed windows before the appointment filter. Only the 3-arg is taught this (the dead 2-arg bridge has no closure producer/consumer and is dropped post-deploy). Re-asserts the P0-1 anon revoke. Closes the non-buildable AVL-1 workaround.

**Action.** `createDateClosureAction` — single date or range (fanned out to one blocked one-off per day, cap 90), whole-day default (00:00–23:59:59) or a partial window; already-closed dates (23505) skipped. Positive one-offs keep `is_blocked=false` (column default).

**UI.** `OneOffOverrides` splits positive exceptions from closures: closures render in a distinct **"Closed"**-tagged list (date + "All day"/window + a re-open delete), and a **"Close a date"** button opens an inline form (from · optional to · whole-day toggle → start/end). The availability page threads `is_blocked` through.

**Tests.** New pgTAP [`30_date_closure.sql`](../../supabase/tests/database/30_date_closure.sql) **3/3 on live**: whole-day closure removes the day · morning closure leaves the afternoon · removes the morning. pgTAP 28 still 3/3; `tsc` clean. The partial unique index deliberately excludes `is_blocked` (a positive one-off + a whole-day closure at the identical window is not realistic). Public-holiday auto-detection (AVL-8) stays deferred — closures are manual.

### P1-1 — §6.1 Bookings tab on the staff client profile — done 2026-06-15

A **Bookings** tab on [`ClientProfile`](../../src/app/(staff)/clients/[id]/_components/ClientProfile.tsx) (between Programs and Reports) rendering this client's already-loaded appointments, split into **Upcoming** (future + pending/confirmed, each with a Cancel affordance via `cancelAppointmentAction`) and **Past** (everything else, incl. cancelled rows dimmed) — each showing the AU-English date line, time range, type and status, all in the practice tz. New [`BookingsTab`](../../src/app/(staff)/clients/[id]/_components/BookingsTab.tsx) component reusing the shared booking formatters. **Frontend-only** — the appointments were already loaded on the profile (they fed only the note picker before); both `VALID_TABS` (page + component) gained `bookings`. Reschedule stays on the `/schedule` grid (drag-to-move); this surface is history + quick-cancel. `tsc` clean. (Browser check rides on the operator's `:3000` cluster review.)

**All of P0 + P1 complete** — ready for the P0+P1 cluster review and the first prod deploy (deploy #1).

### P2 phase — started 2026-06-16

The 15 P2 items, worked in the gap-doc §6 build order on `polish/section-9-scheduling` (stacked). Deploy #2 (merge → master) + the formal section-close sign-off follow once P2 is complete and `:3000`-reviewed.

#### P2-1 + P2-2 — booking-window edge + portal booking tz — done 2026-06-16

**P2-1 (FM-8).** The picker's slot-window far edge was `now() + 28×24h` — a rolling UTC span that truncated the final day's afternoon slots by the load time-of-day (the later the page opened, the fewer far-edge slots showed). [`book/new/page.tsx`](../../src/app/portal/book/new/page.tsx) now derives the window from whole calendar days in the clinic tz: `p_from` stays `now()` and `p_to = startOfDayInstant(today + 28, clinicTz)` — a stable whole-day boundary independent of load time (last bookable day = today+27, 28 days). New `addDaysToIsoDate` helper in [`dates.ts`](../../src/lib/dates.ts) (pure UTC-ladder calendar math). **Deliberate deviation from the gap-doc's literal "start-of-today" near edge, surfaced + operator-approved 2026-06-16:** the near edge stays `now()` because the RPC has no internal past-slot filter, so start-of-today would resurface this morning's already-passed slots as bookable — FM-8's diagnosis is the far edge only, so this is a far-edge-only fix.

**P2-2 (FM-9).** [`book/new/page.tsx`](../../src/app/portal/book/new/page.tsx) + [`book/page.tsx`](../../src/app/portal/book/page.tsx) read `org.timezone` directly (correct — the slot engine buckets in org-tz, so the picker labels must match it) but fell back to a hardcoded `'Australia/Sydney'` literal. Now documented as the **intentional** clinic-tz booking-day vs device-tz home-today split (P0-2 / Q2) and falls back to the `PRACTICE_TIMEZONE` constant. **No device-tz routing** — that would reintroduce FM-9 (a slot generated "Sat 9am" clinic-local mislabelled under a travelling client's device "Fri"/"Sun"). Dormant for the same-tz beta population; the change is hardening + honesty.

**Tests.** No unit-test runner ships (same as the P0-2 date-algorithm check), so [`scripts/booking-window-verify.mjs`](../../scripts/booking-window-verify.mjs) is the committed regression proof: **12/12** across AEST + AEDT — the new far edge is identical at an 08:00 vs a 23:30 load (the late-evening offset the gap doc asked for) while the old far edge moved; far edge == clinic midnight of today+28; day+27 23:00 slot fits, day+28 00:00 excluded; near edge == now. `tsc` clean; eslint net-zero new (the lone `book/page.tsx` `Date.now()`-in-render purity error pre-dates this work, present on master, untouched). Frontend-only, no migration — backward-compatible with deployed master. Browser check rides on the operator's authenticated `:3000`.

#### P2-8 (b)(c) — cancellations toggle + lifecycle actions — done 2026-06-16

**(b) Show/hide cancellations.** A `Hide cancelled` / `Show cancelled` toggle (Eye/EyeOff, `.btn outline`) in the [`WeekView`](../../src/app/(staff)/schedule/_components/WeekView.tsx) toolbar, **default show** — the operator values seeing a cancelled row beside its replacement (the P2-8(a) lanes). A `visibleByDay` memo derives the rendered set from the toggle and feeds `computeDayLayout`, so hiding cancellations recomputes lanes and the survivors reclaim the width. Pure client-side (cancelled rows were already loaded; `page.tsx` filters only `deleted_at`).

**(c) Lifecycle past confirmed (FM-13).** The client popover footer gains **Complete** (accent) / **No-show** (warning) for a pending/confirmed booking, plus **Reopen** (→ confirmed) for a mis-marked one — closing the one-way trap (operator-approved as a small addition beyond the literal no-show/complete). One `setAppointmentStatusAction` (mirrors `cancelAppointmentAction`): `no_show` stamps `no_show_marked_at`; `confirmed` re-stamps `confirmed_at` (the CHECK) + clears the stale no-show marker. The `appointment_manage_reminder` trigger (P1-2/P1-3) auto-cancels the queued reminder when status leaves pending/confirmed and re-enqueues on a future reopen — no manual reminder handling. The popover's `onCancelled` prop was renamed `onChanged` (it now fires for any status change); a small `FooterAction` helper centralises the footer buttons.

**Review fix — removing an Unavailable block deletes it, doesn't cancel it.** Operator-raised: a removed admin/note block went through `cancelAppointmentAction` and lingered as a cancelled row (re-surfacing under the toggle, laning beside appointments). It now **soft-deletes** via a new SECURITY DEFINER [`soft_delete_unavailable_block(uuid)`](../../supabase/migrations/20260616120000_soft_delete_unavailable_block.sql) RPC (mirrors the `soft_delete_<table>` family; scoped to `kind='unavailable'` so a client appointment can never be deleted here — those keep cancelling, preserving the record + attribution). The direct `UPDATE deleted_at` route is blocked by the `deleted_at IS NULL` SELECT-policy 42501 trap, hence the RPC; anon EXECUTE revoked (P0-1 discipline). A new `removeUnavailableBlockAction` wires the popover's "Remove block" to it.

**Tests + verification.** pgTAP `26` extended to **10/10** (the new RPC's anon-revoked / authenticated-kept tripwire); full scheduling suite green on live (`26` 10 · `27` 6 · `28` 3 · `29` 4 · `30` 3 · `31` 2). `tsc` clean; eslint net-zero new (the 3 pre-existing file-level errors are the documented drag-handler immutability + unescaped-quote set). Migration `20260616120000` applied to live (additive, backward-compatible — deployed master never calls it); types regenerated. Browser check rides on the operator's `:3000`.

**Done early / remaining:** P2-8(a) lanes shipped at deploy #1; (b) + (c) + the review fix complete here. **P2-8 closed.**

#### P2-14 — recurring appointments ("Repeat" in the composer) — done 2026-06-16

A **Repeat** toggle in the [`BookingComposer`](../../src/app/(staff)/schedule/_components/WeekView.tsx) (after the type/location row) → **frequency** (daily / weekly / fortnightly / monthly) + an **ends** rule (after N sessions — default; or on a date — both, per the gap doc). A live preview line ("Creates 8 sessions · Sat 21 Jun → Sat 9 Aug") and the submit button reflects the count ("Book 8 sessions").

**Concrete rows, not a rule.** `computeRecurrenceDates` (pure, node-verified) builds the occurrence dates in whole **calendar units** on the UTC ladder — so the wall-clock time-of-day is preserved across a DST change (the composer re-attaches the chosen time to each date) — and monthly **clamps** to the last day of the target month (31 Jan + 1mo → 28 Feb), never rolling forward. Capped at 52. The composer passes the concrete start instants to a new `createRecurringAppointmentsAction` (loop + per-row insert), so each instance is an independently movable/cancellable row.

**Overlap + reminders.** Each insert hits the **P1-4** `appointments_no_staff_overlap` constraint; a clashing instance is **skipped and reported** (23P01 → `skipped[]`), not silently dropped or fatal — a post-save summary card shows e.g. "Booked 6 of 8 — 2 skipped (already booked): …". Each created instance auto-enqueues its own reminder via the **P1-2** trigger (no per-instance code). **No confirmation email** for a series (operator decision — a 12-week series would otherwise send 12; the per-session reminders carry the value). Repeat works for **Unavailable** blocks too (kind flows through; they're constraint-exempt, so never clash).

**Incidental fix (flagged):** the submit-disabled guard was `allClients.length === 0` (which blocked adding an Unavailable block to a client-less org); since I was editing that expression for the recurrence guard, corrected it to `!isUnavailable && allClients.length === 0`.

**Tests + verification.** [`scripts/recurrence-verify.mjs`](../../scripts/recurrence-verify.mjs) **9/9** (cadence, month-clamp, year rollover, until-inclusive, until-before-start → none, 52-cap). `tsc` clean; eslint net-zero new. **No migration** — frontend + a server action over the existing appointments table, the P1-4 constraint, and the P1-2 reminder trigger (pgTAP 27/29 already cover that DB behaviour). Browser check rides on the operator's `:3000`.

**Follow-up fix (modal overflow, operator-reported):** the expanded Repeat section pushed the composer taller than the viewport — the header and the Book button were clipped with no way to scroll. Fixed by capping the modal to `calc(100vh - 32px)` as a flex column: header and footer pinned (`flexShrink: 0`), body scrolls (`flex: 1; minHeight: 0; overflowY: auto`). Same treatment applied to the recurring result card (up to 52 skipped dates).

**Follow-up fixes (operator-reported, 2026-06-16):** (1) **Monthly keeps the weekday**, not the day-of-month — it now lands on the same weekday + ordinal ("3rd Thursday"), clamped to the last occurrence in a month with fewer; daily/weekly/fortnightly were already whole-day steps (fortnightly = +14d = same weekday). (2) **The Sessions field accepts free typing** — held as a raw string, clamped to [1, 52] on blur, so clearing it to type "20" no longer snaps to "1"/"120". (3) **The appointment popover shows "Next session · <date>"** for a client — their soonest pending/confirmed booking after the clicked one (`getClientNextAppointmentAction`; "none booked" otherwise). `recurrence-verify` extended to **12/12** (the 3rd-Thursday scenario + a weekday-consistency property across weekly/fortnightly/monthly).

#### P2-15 (A) — Tools → Find next available — done 2026-06-16

A quiet **Tools** dropdown on the `/schedule` toolbar; its first item is **Find next available**: pick a session type → the server returns the EP's soonest open slot → the grid snaps to that day. The client slot engine is client-scoped (resolves the caller via the `clients` table), so this rides a new staff-scoped sibling RPC [`staff_next_available_slot(staff_user_id, from, slot_minutes)`](../../supabase/migrations/20260616130000_staff_next_available_slot.sql) — same availability/closure/overlap logic, owner/staff + target-in-org guarded, returning the single soonest slot (`LIMIT 1`) within a 90-day window. `findNextAvailableSlotAction` calls it for the caller; the `ToolsMenu` navigates via the existing `navigateTo` (reusing the P0-2 practice-tz day math). "No opening in the next 90 days" when the window is dry.

**Migration** `20260616130000` applied to live (additive, backward-compatible — deployed master never calls it; anon EXECUTE revoked per P0-1). pgTAP `26` → **12/12** (the new RPC's anon-revoked / authenticated-kept tripwire). `tsc` clean; eslint net-zero new. Browser check rides on the operator's `:3000`. **De-identified `.ics` subscribe (P2-15 B) lands next.**

#### P2-15 (B) — de-identified `.ics` calendar subscribe — done 2026-06-16

A practitioner can subscribe to their own schedule from Google/Apple/Outlook via a private, revocable URL. **Security design (reviewed + operator-approved):** the public route [`/api/calendar/[token]`](../../src/app/api/calendar/[token]/route.ts) uses an **anon** client — **not** service-role, so the health route stays the only unauthenticated service-role route — and calls the anon-EXECUTE [`calendar_feed_events(token)`](../../supabase/migrations/20260616140000_calendar_feed.sql) RPC. That RPC is the boundary: it validates the token in-body and RETURNS only `appointment_type, kind, start_at, end_at, location` — structurally incapable of returning client_id, notes, or a name. The `.ics` SUMMARY is the session type only (Unavailable blocks labelled; notes omitted for every kind, since an unavailable note can name a client). The token (64 hex, ~244 bits) lives in `calendar_feed_tokens` with **owner-only SELECT RLS** (a co-member can't read it); writes go only through the SECURITY DEFINER `regenerate_calendar_feed_token` / `revoke_calendar_feed_token` RPCs (authenticated-only, anon-revoked). `calendar_feed_events` is the **one deliberate** anon-EXECUTE in the scheduling family — the token is the credential. Tools → **"Subscribe in your calendar"** opens a modal (feed URL + copy · Regenerate · Turn off · the de-identified disclaimer).

**Migration** `20260616140000` applied to live (additive, backward-compatible). pgTAP [`32`](../../supabase/tests/database/32_calendar_feed.sql) **8/8** (feed anon-grant intentional · token RPCs anon-revoked · return type carries no client/notes column · unknown+NULL token → empty). [`scripts/ics-verify.mjs`](../../scripts/ics-verify.mjs) **12/12** (well-formed VCALENDAR · no DESCRIPTION/ATTENDEE · unavailable label · escaping). Full scheduling suite green on live (`26`·`27`·`28`·`29`·`30`·`31`·`32` = 38 assertions). `tsc` clean; eslint net-zero new. Browser check rides on the operator's `:3000`. **P2-15 complete.**

**Follow-up fixes (operator-reported, 2026-06-16, round 2):** (1) the appointment popover grew too tall once "Next session" was added — the no-show/complete footer fell off-screen. Capped to `min(460, 100vh − 16)` with internal scroll, on both popover paths. (2) "Next session" is now a **link** that snaps the grid to that session's day (`onNavigateToSession` → `navigateTo`). (3) the `.ics` feed URL was built from `NEXT_PUBLIC_APP_URL`, which `.env.local` sets to the prod domain (it's defined twice; the prod value wins), so the link pointed at production — where the route isn't deployed until #2 → 404. It's now built from the **request host**, so it resolves wherever the app runs (localhost in dev, prod after deploy #2). *(Heads-up: the duplicate `NEXT_PUBLIC_APP_URL` in `.env.local` is the operator's to reconcile; any other code using that var resolves to prod in local dev.)* **Google Calendar (web) note:** the feed works as a "From URL" subscription, but Google fetches it server-side, so it needs the **public prod URL** (not `localhost`) and polls on Google's own cadence (hours) — confirmed working-by-design, no code change.

#### P2-4 · P2-9 · P2-10 · P2-12 — settings/schedule polish — done 2026-06-16

- **P2-4 (SMS honesty, FM-10):** the SMS toggle in [`NotificationsForm`](../../src/app/(staff)/settings/_components/NotificationsForm.tsx) is **disabled** with a "Coming soon — SMS reminders aren't active in the beta" helper (the `sms_notifications_enabled` column stays for §12). A disabled checkbox submits nothing, which the action reads as off — honest, since SMS is stubbed (CLAUDE.md §12).
- **P2-9 (empty-week copy, FM-14):** the `EmptyWeekHint` "New booking dialog lands in the next commit. Hover…" dead copy → "No bookings this week. / Click any time to add one."
- **P2-10 (multi-staff default, FM-15):** [`schedule/page.tsx`](../../src/app/(staff)/schedule/page.tsx) defaults the staff filter to **all** org practitioners (was `[userId]`), so a 2-EP org sees both columns without toggling; an explicit `?staff=` still overrides.
- **P2-12 (type validation, FM-16):** `createAppointmentAction` + `createRecurringAppointmentsAction` validate `appointment_type` against the org's live `session_types` of that kind via a shared `isValidAppointmentType` guard (RLS-scoped) — the server-side backstop behind the composer's type select.

`tsc` clean; eslint net-zero new. No migration. **Remaining P2:** P2-5 (email-gating), P2-6 (reminder retry), P2-7 (template de-dup) — the Edge Function cluster — then P2-11 (FK trigger, migration) and P2-13 (token sweep, last).

#### P2-5 · P2-6 · P2-7 — reminder Edge Function cluster — done 2026-06-16

- **P2-5 (email gating, FM-10; Q5 = make it real):** every email send now honours `organizations.email_notifications_enabled`. The reminder Edge Function loads the flag with the org and, when off, retires the due reminder (`status='cancelled'`, reason "email notifications disabled by practice") instead of sending; both confirmation paths (`createAppointmentAction`→`sendStaffBookingConfirmation`, `confirmBookingAction`→`sendBookingConfirmationEmailForAppointment`) skip the send when off. Default-true / fail-open if the flag is absent (email is the active channel).
- **P2-6 (failed-reminder retry, FM-11):** a transient send failure (network / 429 / 5xx) now leaves `status='scheduled'` and bumps `retry_count`, so the next 5-min tick retries up to `MAX_RETRIES = 5` (the column's CHECK bound), then fails terminally; a 4xx is a permanent client error → fail now. New `markRetry` / `markCancelled` join `markSent` / `markFailed`, all `WHERE status='scheduled'` (idempotent). The Resend `fetch` is wrapped so a thrown network error is retryable, not a 500.
- **P2-7 (template de-dup, FM-12):** `src/lib/email/templates/booking-reminder.ts` was a copy of the EF's inline template **imported by nothing at runtime** — deleted. The EF's inline `renderReminderEmail` is documented as the single canonical reminder template (Deno can't import `src/lib` — an established constraint), so there's no second copy to drift from. The confirmation template is unrelated and stays in `src/lib`.

`tsc` clean (the `src/` confirmation gates); eslint net-zero new. **No migration** (reads existing `email_notifications_enabled` + `retry_count`). The Edge Function is Deno, outside the Next tsconfig, so it isn't typechecked here and **requires `supabase functions deploy send-appointment-reminders` at deploy #2** + a post-deploy reminder-send smoke test to take effect (added to the deploy-#2 steps).

#### P2-11 — same-org guard on `availability_rules.staff_user_id` — done 2026-06-16

`availability_rules.staff_user_id` had no same-org guard (unlike `appointments.client_id`), so an owner could author a rule for a non-member `staff_user_id` — ghost slots (AVL-5, FM-15). Since `user_profiles` has **no** `organization_id` (membership is in `user_organization_roles`), this is a **bespoke** `BEFORE INSERT/UPDATE` trigger (`enforce_availability_rule_staff_in_org`) asserting the `staff_user_id` is an owner/staff member of `NEW.organization_id`, not the generic `enforce_same_org_fk`. Migration `20260616150000` applied to live; a **pre-push probe confirmed 0 existing violating rows**, so no future UPDATE (e.g. a soft-delete) on existing data can trip it. Zero behaviour change at solo scope (the EP authors rules for themselves). Trigger function (not directly invocable) → no anon concern. pgTAP [`33`](../../supabase/tests/database/33_availability_rule_staff_org.sql) (2/2) is the catalog tripwire. No types regen. **Fixture follow-up:** the new trigger initially broke pgTAP `28`/`30` (their fixtures insert `availability_rules` for a staff member with no membership row); both now grant membership via `_test_grant_membership` first — full scheduling suite **40/40** green on live. **Remaining P2: P2-13 (design-token sweep) — last.**

#### P2-13 — design-token sweep (recurring colours) — done 2026-06-16

Option (a): four tokens added to `globals.css` at the **exact current values** (visually neutral) — `--color-accent-soft-strong` (rgba .22), `--color-warning-soft` (.24), `--color-alert-soft` (.22), `--color-grid-line` (`#f0ebe5`). The **recurring** colour literals now reference them: `toneToColors` (the per-status bubble fill — rendered on every block, the highest-drift surface) is fully tokenised; `#fff → var(--color-card)` across `WeekView`; the grid hairline + the `NotificationsForm` divider → `var(--color-grid-line)`. `tsc` clean; eslint net-zero new; grep confirms zero raw `#fff` / toneToColors rgba remain.

**Surfaced, not invented (per the design-system "don't invent a token" rule) — deferred sub-items:** the one-off colour tints (portal notice chips at per-chip alphas `.08/.4`, `.1/.4`, `.06/.25`; the today-column / now-line / hover / cancelled `.05` tints; the `PractitionerSidebar` selected-staff tint), the modal/popover **elevation shadows** (`0 10px 30px …`, `0 20px 60px …` — shadow values, need shadow tokens), and the availability editor's **off-system `8`/`6` px radii** (no matching token — the system has 7/10/14/999, so rounding is a minor visual change). Each needs an exact-alpha/shadow/radius token or `color-mix()` — a separate visual decision, not a silent value change. **Re-trigger:** a brand palette/radius change, or an operator decision to add those tokens.

**All P2 items complete** — ready for deploy #2 (merge → master, redeploy the reminder Edge Function) and the P2 closing-commit + section-close sign-off ritual.

---

## 8. Closing commit — P0 + P1 (deploy #1, 2026-06-15)

*This is the **P0 + P1 checkpoint** closing commit. P0 and P1 are implemented, verified, and live in production (deploy #1). The 15 P2 items remain; a second closing commit + the formal section-close sign-off follow after the P2 phase. Per §0.1 the section moves in checkpointed stages — this is the first.*

### What changed (by gap)

- **P0-1 — anon-EXECUTE sweep (FM-1).** A live `has_function_privilege` probe confirmed the three booking RPCs **plus a 4th** (`soft_delete_availability_rule`) were anon-executable on live (the auto-grant `REVOKE … FROM PUBLIC` never strips). Migration `20260615120000` revoked anon on all four; authenticated retained. pgTAP `26` is the tripwire. No guardless `_`-helper existed. Discharges the §9 slice of the go-live anon-EXECUTE rider (`go-live-checklist.md` §4).
- **P0-2 — timezone reconciliation (FM-2).** The staff `/schedule` grid resolves today/now/window-boundaries in `PRACTICE_TIMEZONE` (Q2), independent of the Vercel UTC clock and the browser tz. New `src/lib/dates.ts` helpers (node-verified across AEST/AEDT); `page.tsx` re-plumbed onto practice-tz ISO dates + a practice-tz-bounded appointment query; `WeekView` positions blocks / now-line / bucketing / display / click-to-create in practice tz.
- **P1-4 — double-booking backstop (FM-5).** `appointments_no_staff_overlap` EXCLUDE constraint (`20260615130000`); cancelled + unavailable-kind rows exempt. `client_book_appointment` catches `23P01`; staff actions surface a clean inline overlap error. pgTAP `27`.
- **P1-6 — per-type durations + 15-min slots (FM-18).** `session_types.default_duration_minutes` (Initial 60 / Review 45 / Session 45 / Telehealth 30); the 3-arg `client_available_slots` steps every 15 min with slot length = the type's duration (`20260615140000`/`140100`). The welded 2-arg bridge was dropped post-deploy (`20260615190000`). pgTAP `28`.
- **P1-7 — Unavailable kind (FM-19).** `session_types.kind` + `appointments.kind`; `client_id` nullable + CHECK; the constraint recreated to exempt unavailable-kind; 8 Unavailable sub-types seeded; `seed_organization_defaults` consolidated (`20260615150000`). Composer Unavailable path; grid renders null-client blocks; SessionTypesEditor duration column + kind sub-sections. Clients can't see/book unavailable types (RLS tightened, `20260615160000`).
- **P1-2 / P1-3 — reminder lifecycle (FM-3, FM-4).** `appointment_manage_reminder` trigger (`20260615170000`) owns the T-lead reminder for every path — enqueue on insert, re-time on reschedule, cancel on leave-the-live-set. Reads `organizations.reminder_lead_hours` (**wires P2-3**). The inline enqueue moved out of `client_book_appointment` to the trigger. Staff confirmation email wired into `createAppointmentAction`. pgTAP `29`.
- **P1-5 — close-a-date (FM-6).** `availability_rules.is_blocked`; the 3-arg slot RPC subtracts blocked windows (`20260615180000`); `createDateClosureAction` (single date / range, whole-day or partial); OneOffOverrides closures list + "Close a date" form. pgTAP `30`. Closes the non-buildable AVL-1 workaround.
- **P1-1 — Bookings tab (FM-7).** A Bookings tab on the client profile (upcoming / past + cancel), reusing the already-loaded appointments. Frontend-only.
- **Review fixes (operator `:3000` walkthrough).** Clients no longer see Unavailable types (RLS + picker filter); overlapping blocks render side-by-side (**P2-8(a) pulled forward** — `computeDayLayout` lanes).

### Acceptance tests + results
- Scheduling pgTAP green on live: `26` 8/8 · `27` 6/6 · `28` 3/3 · `29` 4/4 · `30` 3/3 (26 assertions).
- `tsc --noEmit` clean; `next build` clean.
- Deploy #1 (`fb84ada`) fast-forward-merged to master + live; operator authenticated `:3000` walkthrough passed.
- Every migration was dry-run-checked, applied to live via `supabase db push` (backward-compatible with the deployed frontend at each step), and types regenerated where signatures/columns changed.

### Deferred — the P2 phase (15 items; not section gaps)
P2-1 (window edge) · P2-2 (portal booking tz) · P2-3..P2-5 (settings honesty — P2-3's lead-hours already wired) · P2-6 (reminder retry) · P2-7 (template de-dup) · **P2-8 (b)** show/hide-cancellations toggle + **(c)** no-show/complete actions [**(a) lanes done early**] · P2-9 (empty-week copy) · P2-10/11 (multi-staff default + AVL-5 FK) · P2-12 (type validation — largely folded into the P1-6/P1-7 selects) · P2-13 (token sweep) · P2-14 (recurring composer) · P2-15 (Tools: find-next-available + de-identified `.ics`). **Trigger:** the P2 phase of this section, before the formal close. Out-of-scope follow-ups (buffer, owner-on-behalf, AVL-7 import, AVL-8 auto-holidays, SMS activation) stay deferred with their own re-triggers (§5).

### Premortem modes
- **Mitigated (P0-P1):** FM-1 (anon grants) · FM-2 (tz) · FM-3 (no staff reminder) · FM-4 (stale reminder) · FM-5 (double-booking) · FM-6 (no closure) · FM-7 (no Bookings tab) · FM-18 (welded slot grid) · FM-19 (no in-day non-client time).
- **Accepted with rationale:** the off-tz cross-day-drag residual (P0-2 — correct for the clinic-tz operator; re-trigger: a routinely off-tz staff device). Client self-service reschedule stays deferred (§2). Instant-confirm (no EP-confirm step) accepted (§2).
- **Addressed in the P2 phase (not yet):** FM-8 (window edge) · FM-9 (portal tz) · FM-10 (dead settings controls) · FM-11 (reminder retry) · FM-12 (template drift) · FM-13 (lifecycle past confirmed — overlap-render done early) · FM-14 (empty-week copy) · FM-15/16 (multi-staff, type drift) · FM-17 (token drift).

---

## 8b. Closing commit — P2 (deploy #2, 2026-06-16)

*The P2 phase is implemented, verified, and live in production (deploy #2). This completes the section-9 polish pass; the final section-close sign-off follows.*

### What changed (by gap)
- **P2-1 / P2-2 (FM-8 / FM-9).** Booking-window far edge → a stable whole-day boundary (`startOfDayInstant(today+28, clinic-tz)`), so the 4-week edge no longer truncates by load time (near edge stays `now()` — far-edge-only fix, operator-approved). `book/new` + `book` document the **intentional** clinic-tz booking-day vs device-tz home-today split (P0-2/Q2) and fall back to `PRACTICE_TIMEZONE`.
- **P2-3 (FM-10).** `reminder_lead_hours` wired (in the P1-2 trigger).
- **P2-4 (FM-10).** SMS toggle disabled + "Coming soon" (the §12 stub made honest; column kept).
- **P2-5 (FM-10).** `email_notifications_enabled` now gates every send — the reminder Edge Function (cancels the due reminder when off) and both confirmation paths.
- **P2-6 (FM-11).** Failed-reminder retry: network / 429 / 5xx leaves `status='scheduled'` and bumps `retry_count` to the CHECK cap (5), then fails; 4xx is terminal.
- **P2-7 (FM-12).** Deleted the dead `src/lib/email/templates/booking-reminder.ts` (imported by nothing); the Edge Function's inline template is the single canonical source.
- **P2-8 (FM-13).** Show/hide-cancellations toggle (default show) + lifecycle actions (Complete / No-show / Reopen) + Unavailable-block **soft-delete** (vs cancel) + side-by-side lanes (shipped early at deploy #1).
- **P2-9 / P2-10 / P2-12 (FM-14 / FM-15 / FM-16).** Empty-week copy rewrite · staff filter defaults to all practitioners · server-side `appointment_type` validation backstop.
- **P2-11 (FM-15 / AVL-5).** Same-org guard trigger on `availability_rules.staff_user_id` (bespoke — `user_profiles` has no `organization_id`).
- **P2-13 (FM-17).** Recurring-colour token sweep — 4 new tokens (`--color-accent-soft-strong`, `--color-warning-soft`, `--color-alert-soft`, `--color-grid-line`); `toneToColors`, `#fff`, and the grid/divider hairlines tokenised. Visually neutral.
- **P2-14 (new feature).** Recurring appointments — a Repeat composer (daily/weekly/fortnightly/monthly + count or end-date) generating concrete rows; monthly keeps the weekday (Nth-weekday-of-month); clashes skipped-and-reported; each instance auto-reminds via the trigger.
- **P2-15 (new feature).** Schedule **Tools** menu — Find next available (new staff-scoped `staff_next_available_slot` RPC) + a **de-identified `.ics` subscribe** (token-authenticated anon RPC `calendar_feed_events` returning type/time/location only — never client identity; a public anon route, **not** service-role, so the health-route invariant holds; per-practitioner revocable token).
- **Operator-reported fixes folded in:** the appointment-popover overflow (cap + scroll) + "Next session" link; the `.ics` URL built from the request host (the prod-pointing `NEXT_PUBLIC_APP_URL` 404); the recurring monthly-weekday + sessions-input + composer-scroll fixes; and the pgTAP 28/30 fixture repair for the P2-11 trigger.

### Acceptance tests + results
- Scheduling pgTAP **40/40 green on live**: `26` 12 · `27` 6 · `28` 3 · `29` 4 · `30` 3 · `31` 2 · `32` 8 · `33` 2.
- Node checks: `booking-window-verify` 12/12 (AEST+AEDT, late-evening edge), `recurrence-verify` 12/12 (cadence, weekday-monthly, clamp, until, cap), `ics-verify` 12/12 (well-formed VCALENDAR, no DESCRIPTION/ATTENDEE, escaping).
- `tsc --noEmit` clean; `next build` clean; eslint **net-zero new** (3 pre-existing file-level errors in `WeekView.tsx` — drag-handler `react-hooks/immutability` + two unescaped JSX quotes — present on master, ship in prod). No debug artifacts in the new code.
- **Deploy #2 live + verified:** branch fast-forward-merged to master (`9fc0dec`) + pushed; the new `/api/calendar/[token]` route returns `200 text/calendar` on prod (a new-build-only signal); the reminder Edge Function redeployed; every migration applied to live and backward-compatible at each step; operator `:3000` walkthrough of all P2 surfaces passed.

### Deferred — with re-trigger
- **P2-13 residual literals** (surfaced, not invented): one-off colour tints (notice chips, today/now-line/hover/cancelled), modal elevation shadows, and the availability-editor off-system `8`/`6`px radii — each needs an exact-alpha/shadow/radius token or `color-mix()`. **Re-trigger:** a brand palette/radius change or an operator decision to add those tokens.
- **Off-tz cross-day-drag residual** (carried from P0-2). **Re-trigger:** a routinely off-tz staff device.
- **Out-of-scope follow-ups** (buffer, owner-on-behalf, AVL-7 `.ics` import, AVL-8 auto-holidays, SMS activation) stay deferred per §5.

### Premortem modes
- **Mitigated in P2:** FM-8 · FM-9 (intentional split documented) · FM-10 (all three settings controls honest) · FM-11 · FM-12 (duplicate removed) · FM-13 · FM-14 · FM-15 · FM-16 · FM-17 (recurring colours).
- **Accepted with rationale:** the P2-13 residual literals (above) and the off-tz drag residual.

---

## 8c. Reviewer response + Edge Function verification (2026-06-16)

The claude.ai interim review of §8/§8b raised four items; addressed here.

### 1. Edge Function verification — a real production bug found (the weakest link)
The reviewer flagged the reminder Edge Function as the only surface with no proof (Deno → outside tsc; not in pgTAP; not in the node scripts) carrying freshly-changed P2-5/P2-6 branching. **Verifying it (a direct authenticated POST to the deployed function) found the reminder system NON-FUNCTIONAL in production** — two pre-existing EF-environment gaps, invisible precisely because the EF is uncovered:
- **`EMAIL_FROM` was unset** in the EF's Supabase secrets → `EmailConfigError` throw → **HTTP 500 on every invoke** → zero reminders ever processed (deploy #2's redeploy activated the EMAIL_FROM-required, no-fallback hardening). **Fixed** — `supabase secrets set EMAIL_FROM` to the verified-domain sender; the EF now returns 200.
- **`RESEND_API_KEY` was INVALID** in the EF's Supabase secrets → with EMAIL_FROM fixed, the EF processed 2 due (stale, past-dated) reminders and both failed **`resend 401 validation_error`** — the key the EF held was unauthorized, the pre-rotation key (the 2026-05-17 rotation updated `.env.local`/Vercel but missed the Edge Function's Supabase secret). **Fixed 2026-06-16 (operator-approved): `supabase secrets set RESEND_API_KEY` from the verified-working `.env.local` value** (the same key the Next confirmation path already uses). Remaining operator hygiene (not blocking the close): revoke the stale key in Resend + audit whether the 2026-05-17 rotation missed other consumers.
- **`NEXT_PUBLIC_APP_URL` was unset** → reminder-email "View booking" links fell back to `'#'`. **Fixed** — set to `https://odysseyhq.com.au`.

This was **FM-3 unmitigated in production** — the headline reminder deliverable had never actually sent. (The P2-6 retry classification behaved correctly throughout: the 401s are 4xx → terminal, not retried; `retry_count` stayed 0.) **RESOLVED + VERIFIED 2026-06-16:** with all three EF secrets correct, a controlled live test — a due reminder to Resend's `delivered@resend.dev` test address (no real inbox) — was processed by the deployed EF (`processed:1, succeeded:1`) and the row reached **`status='sent'` with a Resend `provider_message_id`**; the test rows were then deleted. The EF is functional end-to-end and **FM-3 is mitigated**. The email-off **cancel** branch is covered by `reminder-logic-verify.mjs` (a live cancel test would require toggling the org's email setting, deliberately avoided). The earlier close-gate is **cleared**; see [`go-live-checklist.md`](../go-live-checklist.md) §2 for the remaining rotation-hygiene follow-ups.

**Caution now that the EF is live:** the 5-minute cron will send a reminder for any *due* appointment, including seed appointments whose client emails reach real inboxes. No reminder is imminently due (the upcoming seed reminders are months out), but the operator should confirm the seed client emails are test-only or prune seed reminders before any approach their T-lead.

**Automated coverage added:** [`scripts/reminder-logic-verify.mjs`](../../scripts/reminder-logic-verify.mjs) (11/11) mirrors the EF's per-reminder decision and asserts every branch — sent · no-email→fail · email-off→cancel · 5xx→retry-to-cap · 429→retry · network→retry · 4xx→terminal (incl. the 401 the live failures hit). Closes the "branching with zero automated coverage" gap; the live send remains gated on the key fix.

### 2. Test 31 provenance
`31_client_unavailable_types_hidden.sql` (plan 2) is the **P1-7 RLS confidentiality tripwire** created in commit `f94bc54` during the P0-P1 test-coverage closure (2026-06-16), BEFORE the P2 phase — hence §7's P2 entries reference it in the suite count with no P2 creation entry. Not a miscount: the file is real, green, and part of the 40-assertion total; the missing item was a creation-log line, recorded here.

### 3. NEXT_PUBLIC_APP_URL duplicate — audited
Audited all consumers of the duplicated var: the only ones are the two **confirmation-email** `bookingUrl` builders (`sendStaffBookingConfirmation`, `sendBookingConfirmationEmailForAppointment`), where a prod link is **correct** (email CTAs should point to prod even in local dev), and `required-env.ts` (a name-only list). The one host-sensitive consumer — the P2-15 `.ics` URL — was already changed to build from the request host. The duplicate is cosmetically untidy but **functionally harmless**; de-duping `.env.local` is tidy-up, not a bug fix.

### 4. P1-4 comment — confirmed corrected
The misleading `20260510120000:121-122` comment ("the second sees the just-inserted appointment") was corrected by P1-4's migration `20260615130000`, whose header explicitly states that claim "is FALSE for concurrent inserts" under READ COMMITTED and adds the EXCLUDE constraint as the real guard. The original is preserved as applied history (not edited in place) but is refuted in the superseding migration. §7's omission of this was a logging gap, closed here.

---

## 8d. Section-close follow-ups — deferred-item discharge (2026-06-17)

The claude.ai reviewer returned **Closed — with deferred items** (recorded in §9) and gated a *clean* close on three actions plus one question: sweep the seed reminder addresses, land two checklist items (the rotation consumer-sweep and the standing EF send check), and answer the branch-coverage question. All four are discharged here.

### 1. Branch-coverage question — answered (the reviewer's "by proxy" line is correct)

**Q: what actually covers the reminder Edge Function's P2-5/P2-6 branches?** Three tiers of proof, in decreasing directness:

1. **Enqueue** — pgTAP `29`, run against the live `appointment_manage_reminder` trigger. **Direct.**
2. **Happy-path send** (`scheduled` → Resend → `sent` + `provider_message_id`) — proven **live against the deployed EF** (the 2026-06-16 `delivered@resend.dev` test, §8c). **Direct: it executed the EF's own success branch.**
3. **The non-happy branches** — P2-5 (email-off → cancel) and P2-6 (retry / fail / network / 429 / 4xx classification) — are **not** executed against the live EF. They are covered by [`scripts/reminder-logic-verify.mjs`](../../scripts/reminder-logic-verify.mjs) (**12/12**), which is a **hand-written re-implementation** of the EF's per-reminder decision tree, **not an import** (a Deno EF can't be imported into a node script). So these branches are proven **by proxy**: the decision *logic* is proven correct, but the proof does **not** run the EF's own code. The only thing binding the mirror to the EF is a "keep in sync" comment plus discipline — not the compiler.

**So the "by proxy" characterisation is accurate and should be kept, not upgraded.** It states the limitation honestly. Two things tighten it:

- **A real (dormant) drift was found and fixed.** Auditing the mirror against the EF line-by-line: the EF treats **any 2xx** as success (it checks `send.ok`), but the mirror matched only `sendStatus === 200`. A 2xx-non-200 (e.g. 202) would have been classed `sent` by the EF and `fail` by the mirror. Dormant (Resend returns 200), but it is exactly the drift "by proxy" cannot prevent — the proxy had *already* diverged on the success boundary. Fixed (`>= 200 && < 300`) + a 202 assertion added → 12/12. This makes the proxy faithful again *and* demonstrates why a shared import would be stronger.
- **The upgrade path is named, with a re-trigger.** To move past "by proxy", either (a) extract the pure decision into a module that **both** the EF and the script import — then the test exercises the EF's actual code, no drift possible — or (b) drive the live EF down each branch (toggle the org's `email_notifications_enabled` off for the cancel branch; force a 5xx for the retry branch). Both were deferred: (a) requires touching and redeploying the just-verified critical EF, out of proportion to a dormant-only risk; (b) the live cancel test mutates the org's real email setting (§8c). **Re-trigger: the next time the EF's send loop is modified — do the (a) extraction then**, so the change ships with direct coverage.

### 2. Seed-reminder address safety — DISCHARGED (the cron-relevant window was today)

A live probe found **34 `scheduled` reminders**, org email **on**, **4 due today** — and every address is a **real reachable inbox** (the operator's own + three people's Gmail: `imaansedghi1`, `davidbrowning072`, `tonez.saracino`), attached to **fake** walkthrough bookings. The first friend-bound send was due **14:00 AEST today**. Left alone, the now-live cron would have emailed three real people a "you've got a session tomorrow" reminder for a session that doesn't exist.

**Action:** all 34 `scheduled` reminders flipped to `status='cancelled'` with `failure_reason = 'seed-safety-cancel 2026-06-17: …'`. The cron's batch selects only `status='scheduled'`, so it now returns `{processed:0}` — zero spurious sends. **Fully reversible:** any row can be re-armed with `UPDATE appointment_reminders SET status='scheduled' WHERE failure_reason LIKE 'seed-safety-cancel%' AND scheduled_for > now()` (only useful for future-dated rows). Post-state verified: `scheduled` = 0. *(These are seed/fake bookings — a reminder is wrong regardless of recipient. If a real beta tester later books through the portal, the trigger enqueues a fresh, correct reminder; the send path is proven working.)*

### 3. Stale Resend key revocation + 2026-05-17 rotation consumer sweep — sweep DONE; revocation is an operator dashboard action

**Consumer sweep — complete (recorded in [`secrets-rotation-log.md`](../secrets-rotation-log.md) 2026-06-17 entry).** Enumerated every runtime reader of `RESEND_API_KEY`: exactly **two stores** — Vercel/`.env.local` (`src/lib/email/client.ts`, the Next app's one Resend client behind all invite/confirmation paths) and the Supabase EF secret set (the reminder function). `required-env.ts` lists the name only. **No third consumer; both stores now hold the current key.** The 2026-05-17 rotation's blind spot was the EF's separate secret store — that lesson is now folded into [`rotate-a-secret.md`](../runbooks/rotate-a-secret.md) (enumerate the EF secret set; the EF also reads `EMAIL_FROM`/`NEXT_PUBLIC_APP_URL`/`CRON_SHARED_SECRET` there).

**Still open (operator hygiene, not gating):** confirm in the **Resend dashboard** that the stale pre-rotation key is revoked (the EF's `resend 401` is consistent with it already being revoked). Not doable from the build machine — no Resend access. Tracked in `go-live-checklist.md` §2.

### 4. Standing post-deploy EF synthetic send check — ADDED to the runbooks

The enqueue-vs-send blind spot (a 200 from the EF with `failed:N` looks like success) is now a standing check in [`deploy-an-edge-function.md`](../runbooks/deploy-an-edge-function.md#synthetic-send-check-standing--run-after-every-redeploy-of-send-appointment-reminders): set up a due reminder to `delivered@resend.dev`, POST the function, **assert `succeeded ≥ 1` / row `status='sent'` (not just HTTP 200)**, tear down. The setup/teardown SQL was **validated against live 2026-06-17** (created then removed a throwaway client+appointment+reminder, zero leftovers). [`deploy-the-app.md`](../runbooks/deploy-the-app.md) now points at it for any deploy that rides an EF redeploy, and `rotate-a-secret.md`'s `RESEND_API_KEY` verification points at it too.

### 5. Items that remain deferred (unchanged re-triggers — correctly left alone)

- **P2-13 residual literals** (one-off colour tints, modal elevation shadows, off-system `8`/`6`px radii). Closing these means **inventing design-system tokens**, which the design-system rule forbids without a deliberate decision (CLAUDE.md: "Any value needing a *new* token is surfaced, not invented"). No brand/palette change is in flight. **Stays deferred. Re-trigger: a brand palette/radius change or a decision to add those tokens.**
- **Off-tz cross-day-drag residual (P0-2).** The drag *write-path* keeps browser-local wall-clock on a cross-day drag; read/display/click-to-create are fully practice-tz. Correct for the AU-only operator/collaborator; the fix is non-trivial and the failure needs a routinely off-tz staff device that does not exist at beta scope. **Stays deferred. Re-trigger: a routinely off-tz staff device.**
- **Out-of-scope follow-ups** (buffer-between-bookings, owner-on-behalf availability, AVL-7 `.ics` *import*, AVL-8 public-holiday auto-detection, SMS activation). Explicitly out of scope per §5, each with its own re-trigger. **Stays deferred.**

**The gating close-out actions are complete** — seed addresses swept, consumer sweep done, synthetic send check added, branch-coverage question answered. The section is cleanly closed; CLAUDE.md can advance to section 10.

---

## 9. Sign-off

- **Date signed off:** 2026-06-16 (close-out actions discharged 2026-06-17 — §8d)
- **Reviewer:** claude.ai project chat (section-9 scheduling review)
- **Decision:** **Closed — with deferred items.**

The section-9 polish pass (2 P0, 7 P1, 15 P2) is implemented and live across deploys #1–#2. The reviewer's headline concern — the reminder Edge Function — surfaced a genuine production breakage (`EMAIL_FROM` unset, `RESEND_API_KEY` stale, `NEXT_PUBLIC_APP_URL` unset), broken silently across both prior "verified" deploys because the harness verified reminder *enqueue*, never *send*. Resolved: all three secrets corrected, a controlled live send to Resend's test address confirmed `processed → sent` with a `provider_message_id`, and `reminder-logic-verify.mjs` (now 12/12) added as the EF's first branch coverage. FM-3 mitigated and proven on the send path.

Close certifies: enqueue (pgTAP `29`), happy-path send proven live against the deployed EF, and the P2-5/P2-6 branches proven **by proxy** (parallel logic check — the Deno EF is not node-importable; live branch proof is happy-path only). The branch-coverage answer (§8d.1) confirms "by proxy" is the correct characterisation; the mirror was tightened to remove a dormant 2xx-success drift.

### Deferred (re-triggered)

- **P2-13 residual literals** (one-off tints, elevation shadows, off-system radii) — re-trigger: a brand palette/radius change or a decision to add those tokens.
- **Off-tz cross-day-drag residual (P0-2)** — re-trigger: a routinely off-tz staff device.
- **Stale pre-rotation Resend key revocation** — the consumer sweep is complete (§8d.3); the dashboard revocation remains an operator action, tracked in `go-live-checklist.md` §2.
- **Out-of-scope follow-ups** (buffer, owner-on-behalf, AVL-7 import, AVL-8 auto-holidays, SMS activation) — per §5.

### Discharged at close-out (§8d, 2026-06-17)

- **Seed-reminder address safety** — 34 scheduled seed reminders cancelled before the next cron window; reversible. Done.
- **Standing post-deploy EF synthetic send check** — added to the deploy + EF + rotation runbooks (validated against live). Done.
- **Branch-coverage question** — answered (§8d.1); "by proxy" confirmed correct, mirror tightened to 12/12.

---

## 10. Round-three reopen — booking-modal UX, series archive, deletability, live month (2026-06-30)

Operator-requested reopen of the (signed-off) scheduling surface. Captured from
real use; triaged into the buckets below. The booking-modal items, the
deletability bug, and the live-month-on-scroll are within the existing surface
(four-bucket loop). The **series-archive** item needs a schema column + a new
SECURITY DEFINER RPC → it re-entered the polish protocol (gap list + premortem +
pgTAP + sign-off).

### Gap list

- **RO-1 (papercut) — booking modal defaults to the first client.** `clientId`
  seeded from `allClients[0]`, so a booking could be filed against whoever sorts
  first without a conscious choice. Fix: seed `''` + a disabled "Choose a
  client…" placeholder; the existing required-field + submit guard reject empty.
- **RO-2 (papercut) — start time was a free-minute native `time` input.** Felt
  clunky; the practice books on 15-minute slots. Fix: 15-minute slot `<select>`
  (full-day coverage, 12-hour labels), seed snapped to the nearest quarter.
- **RO-3 (papercut) — Location field removed.** Owner decision: remove the field
  only (stop capturing; emails/.ics omit it). Existing data + display on already-
  booked appointments left intact (field-only, reversible). Type takes the freed
  row width (RO-4).
- **RO-4 (papercut) — Type cramped.** It's the field that decides what's booked;
  it now spans the full row (falls out of RO-3).
- **RO-5 (papercut) — Duration locked to 15-minute spinner steps, couldn't clear
  to type a value.** `min={15} step={15}` blocked free entry. Fix: held as a raw
  string (mirrors `countInput`), `step` dropped, cleared/typed freely, validated
  `> 0` on submit. This was the operator's "type in the length of an unavailable
  note" item — the field already showed for unavailable blocks; the friction was
  the spinner constraint, and it applied to every booking.
- **RO-6 (bug) — some appointments could not be deleted.** Root cause: the popover
  branched on client-presence (`if (!c)`) to decide "unavailable block", and a
  real `kind='appointment'` row whose client was since soft-deleted has a null
  client join → fell into that branch → its Remove called the
  `kind='unavailable'`-scoped RPC → zero rows → silent no-op. Fix: the no-client
  Remove is now kind-aware (archives a real appointment via
  `archive_appointment`), and the card copy/labels are honest ("Client no longer
  on file" / "Remove appointment"). No schema change.
- **RO-7 (structural) — archive a recurring occurrence and all *future* ones.**
  Series rows were concrete + unlinked (no group id). Added nullable
  `appointments.recurrence_group_id` (stamped once per series at creation; no
  backfill — owner decision, new series only), a partial index, and
  `archive_appointment_and_future(uuid)` (SECURITY DEFINER, mirrors
  `archive_appointment`: org + owner/staff + kind=appointment guards; soft-
  deletes the anchor and every later same-group occurrence, never the earlier
  ones; cancels their queued reminders). UI: the archive ConfirmDialog gains a
  "This session only / This and all later sessions" choice when the row is part
  of a series (defaults to the single, less-destructive option).
- **RO-8 (papercut) — month header static while scrolling the date strip.** It
  derived from `weekStart`, committed only on scroll-end (280ms debounce). Fix:
  the rolodex paints the header `textContent` live (same direct-DOM pattern as
  the centred-number paint) as the centred date crosses a month boundary; React
  re-syncs on the settled render.

### Premortem (RO-7, the structural item)

- **Backfill gap (accepted).** Only series booked after the migration are
  linked; existing repeats archive single-row. Accepted per owner decision (no
  fragile heuristic re-grouping). The dialog still works for them — it just
  archives the one occurrence.
- **Over-deletion (mitigated).** The RPC is `start_at >= anchor` within one
  group + org + kind — it can never reach another client's series, another org
  (org guard), an unavailable block (kind guard), or already-delivered earlier
  occurrences.
- **anon reachability (mitigated).** New CREATE auto-grants anon EXECUTE;
  revoked, and the in-body auth guard fails closed. Locked by pgTAP `26`
  (now 8-function family, plan 16).
- **Reminder leak (mitigated).** Soft-delete alone leaves a queued reminder live
  (the trigger fires on start_at/status, not deleted_at); the RPC cancels the
  reminders for exactly the rows it archives, in-transaction.

### Status (pending verification + sign-off)

RO-1..RO-6 and RO-8 are migration-free and pass typecheck + lint. RO-7 ships
migration `20260630130000_appointment_recurrence_group.sql` + the
`archiveAppointmentAndFutureAction` server action + pgTAP `26` extension; it is
gated on `supabase db push` → `npm run supabase:types` → typecheck → pgTAP run →
browser verify. Closing commit + sign-off to follow once verified on a live
authed session.

### Closing commit (RO-1..RO-8)

**What changed (plain language).** A round-three reopen of the Schedule booking
modal, the appointment popover, the date strip, and the recurring-series model:

- **Booking modal (RO-1..RO-5).** No default client — the field reads "Choose a
  client…" and rejects an empty pick. Start time is a 15-minute slot dropdown
  (seed snapped to the nearest quarter). The Location field was removed (field
  only — existing data/display untouched). Type takes the freed width and now
  sits **side by side with Client at the top** of the form (operator follow-up;
  Type is full-width for an Unavailable block). Duration is freely typeable —
  the 15-minute spinner lock is gone, it can be cleared and any positive number
  entered, validated `> 0` on submit.
- **Deletability bug (RO-6).** An appointment whose client was since soft-deleted
  has a null client join, so the popover mis-classified it as an Unavailable
  block and its Remove called the `kind='unavailable'`-scoped RPC → zero rows →
  the "won't delete" symptom. The Remove is now kind-aware (archives a real
  appointment via `archive_appointment`) with honest copy ("Client no longer on
  file"). Confirmed against live data: the two stuck rows were Isaac Fong's
  (client soft-deleted 2026-06-22).
- **Series archive (RO-7, structural).** New nullable `recurrence_group_id`
  stamped once per series at creation (no backfill — new series only). New
  SECURITY DEFINER `archive_appointment_and_future(uuid)` archives the chosen
  occurrence and every later same-group one (never earlier), cancelling their
  reminders. The archive dialog offers "This session only / This and all later
  sessions" when the row is part of a series.
- **Live month header (RO-8).** The month label now paints live as the date
  strip scrolls across a month boundary, instead of waiting for the scroll-end
  commit.

**Tests run — evidence (pre-commit health check, 2026-06-30).**
- **Code hygiene** — `npm run type-check` clean; `npm run lint` (full project)
  clean; `npm run build` exit 0 (all routes compiled, `/schedule` among them).
- **Live DB read-back** (the "SQL editor" health, `supabase db query --linked`):
  `recurrence_group_id` present (`uuid`, nullable); index
  `appointments_recurrence_group_idx` present; function
  `archive_appointment_and_future` present (`SECURITY DEFINER`, returns
  `integer`); grants **anon EXECUTE = false**, **authenticated EXECUTE = true**.
- **pgTAP — grants** `26_scheduling_rpc_grants` **16/16 live** (plan grown
  14→16): anon cannot execute `archive_appointment_and_future` (A8),
  authenticated keeps it (B8).
- **pgTAP — no regression** from the column add: `27_appointment_overlap` 6/6,
  `28_slot_granularity` 3/3, `29_reminder_lifecycle` 4/4.
- **pgTAP — behavioural** `48_archive_appointment_and_future` **10/10 live**
  (new): proves the RPC archives the anchor + every later same-group occurrence,
  keeps the earlier one and other series, returns the right count (3 / 1 single),
  cancels the archived rows' scheduled reminders while keeping the kept row's,
  and is org-scoped (a different org's owner gets `no_data_found`).
- **Operator browser pass** on a live authed session — SCHED-RO-1..8 confirmed
  ("everything looks and works well").

**Deferred / accepted.**
- **No backfill of pre-migration repeats** (RO-7) — accepted per owner decision;
  those archive single-row. Re-trigger: an operator request to retro-group
  historical series. *(This is the one remaining accepted gap — the behavioural
  test originally deferred here is now written and passing, pgTAP `48`.)*

**Premortem mitigations.** Over-deletion bounded by group + org + kind + `start_at
>= anchor` (can't reach another client's series, another org, an unavailable
block, or earlier occurrences); anon reachability revoked + in-body guard, locked
by pgTAP `26`; reminder leak closed in-transaction. The backfill gap is the one
failure mode accepted rather than mitigated, by owner decision.

**Migration.** `20260630130000_appointment_recurrence_group.sql` — additive
(nullable column + partial index + new RPC), backward-compatible with deployed
master; applied to the live DB before this frontend change deploys.

### Review follow-up (2026-06-30) — reviewer's blocking gaps closed

The first sign-off pass was returned with two blocking gaps and one question.
All three are now resolved.

- **RO-6 now has a unit test on the routing decision (second-pass fix).** The
  reviewer was right that pgTAP `49` tests the wrong layer — it proves the two
  *RPCs* behave, but the bug was the popover *routing* a null-client appointment
  to the unavailable RPC, and pgTAP can't reach a TS function. So: the routing
  is moved to a dependency-free module [`_lib/appointment-removal.ts`](../../src/app/(staff)/schedule/_lib/appointment-removal.ts)
  as `removalActionForAppointment(appt)` (routes on KIND; `client` is in the
  signature only to make its irrelevance explicit + testable), and a **JS test
  tier (vitest)** was added with a direct unit test
  [`appointment-removal.test.ts`](../../src/app/(staff)/schedule/_lib/appointment-removal.test.ts)
  (**3/3**): a null-client appointment → `archive` (the exact defect), a normal
  appointment → `archive`, an unavailable block → `remove-unavailable`. Refactor
  the popover now and this test fails. pgTAP `49` (4/4) stays as the
  complementary lock on the two server destinations the route points at.
- **RO-5 duration now has a server + DB guard (was: client-side only).** The
  reviewer is correct that `appointments` has an authenticated INSERT policy, so
  the form cap was bypassable by a crafted request. `end_at > start_at` already
  blocked zero/negative at the DB; the missing ceiling is now
  `appointments_duration_bound CHECK (end_at <= start_at + interval '24 hours')`
  (migration `20260630140000`, the bypass-proof layer), with the product rule
  (whole minutes, 1–480) tightened in **both** server actions on top. Verified
  additive (max existing span 1h, zero rows over 24h). Locked by **pgTAP
  `50_appointment_duration_bound` (3/3)**: normal allowed, over-24h rejected
  (`check_violation`), constraint present.
- **Role granularity — conscious decision + test (was: silent).**
  `archive_appointment_and_future` permits `owner`+`staff`, **identical to every
  other appointment mutation** (cancel, status, single-archive all use the same
  `caller_role IN ('owner','staff')` guard). Appointment management is a staff
  capability in this product, not owner-only; series-archive matching it is
  deliberate and consistent. Now asserted: **pgTAP `48` #11** — a same-org
  staff-role member (not owner) can archive a series.
- **Minor (wording).** The over-deletion bound is `start_at >= anchor` in the
  RPC (`20260630130000` line 97, `start_at >= v_start`), in this doc, and in
  test `48` #1, which explicitly asserts the earlier occurrence is *kept*. There
  is no `= anchor` bound anywhere — the `>=` was misread.

**Updated test evidence.** Code hygiene clean (type-check / lint / build).
**vitest** (new JS unit tier) `appointment-removal.test.ts` **3/3** — the RO-6
routing decision tested directly. pgTAP live: `26` 16/16, `27` 6/6, `28` 3/3,
`29` 4/4, `48` **11/11** (now incl. staff role-gating), `49` **4/4** (RO-6
server contract), `50` **3/3** (duration ceiling). **Second migration**
`20260630140000_appointment_duration_bound.sql` — additive CHECK, validated
against live data (0 violators).

### Review follow-up #2 (2026-06-30) — routing unit test

The second sign-off pass conceded RO-5/role-gating but held RO-6: pgTAP `49`
tests the RPCs, not the TS routing function, so a popover refactor could
regress the bug with `49` still green. Closed by extracting the route to a pure
module and adding the **vitest** tier with a direct unit test on
`removalActionForAppointment` — a null-client appointment asserts `archive`, not
the unavailable path. This is the one remaining gap the reviewer named, now
written. Adding vitest is the project's first JS test tier (pure logic only;
DB stays pgTAP, UI stays the operator browser pass).

## 11. Sign-off — round-three reopen (RO-1..RO-8)

- **Date signed off:** 2026-06-30
- **Reviewer:** claude.ai project chat (schedule round-three review)
- **Decision:** **Closed**

Round-three reopen (RO-1..RO-8) signed off 2026-06-30 after three review passes.
RO-6 routing regression closed by extracting `removalActionForAppointment` to a
pure dependency-free module with a direct **vitest** unit test asserting a
null-client appointment routes to `archive` (first JS test tier in the project).
RO-5 duration ceiling enforced at DB via the `appointments_duration_bound` CHECK
plus product clamp 1–480 in both server actions. Role-gating owner+staff
confirmed deliberate and asserted at pgTAP `48` #11. Full scheduling suite green:
pgTAP `26`/`27`/`28`/`29`/`48`/`49`/`50` plus vitest `appointment-removal` 3/3.
Migrations `20260630130000` and `20260630140000` both additive and live-validated.

---

## Ledger reconciliation — 2026-07-22 (platform drift audit)

One §9 deferred item went stale: the Resend-dashboard revocation of the stale pre-rotation API key, listed above as an open operator action, was **DONE 2026-07-03** (`go-live-checklist.md` §2 — exactly one active key remains, created 2026-05-17). Every other §9 deferral is either checklist-tracked and current or legitimately doc-local. This doc is a historical record per the single-ledger rule; current state lives on the checklist.
