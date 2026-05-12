# Polish-pass gap analysis — Client portal booking flow (Phase F)

**Brief:** Phase F handoff prompt (chat 2026-05-10). Three product decisions locked at sign-off: email-only reminders at launch (Twilio deferred), 24-hour self-cancellation cutoff, instant-confirm bookings.
**Reference UX (already in repo):** Staff schedule — [`page.tsx`](../../src/app/(staff)/schedule/page.tsx), [`WeekView.tsx`](../../src/app/(staff)/schedule/_components/WeekView.tsx), [`actions.ts`](../../src/app/(staff)/schedule/actions.ts).
**Existing portal pages:** [`page.tsx`](../../src/app/portal/book/page.tsx) (empty stub), [`PortalTop.tsx`](../../src/app/portal/_components/PortalTop.tsx) helpers.
**Schema:** [`20260420102000_scheduling.sql`](../../supabase/migrations/20260420102000_scheduling.sql), [`20260423090000_appointment_type_widen.sql`](../../supabase/migrations/20260423090000_appointment_type_widen.sql), [`20260423100000_session_types.sql`](../../supabase/migrations/20260423100000_session_types.sql).
**RLS:** [`20260420102600_rls_enable_and_policies.sql`](../../supabase/migrations/20260420102600_rls_enable_and_policies.sql) §6, lines 1020–1141.
**Existing RPCs:** [`20260420102500_client_portal_functions.sql`](../../supabase/migrations/20260420102500_client_portal_functions.sql).
**Audit date:** 2026-05-10.
**Status:** Gap document — awaiting sign-off before any code changes.

---

## 0. Executive summary

The booking flow lands on a healthier base than the handoff prompt assumed. Three things that the handoff treated as work-to-do are already in the database:

1. **Slot computation function exists.** `client_available_slots(p_from timestamptz, p_to timestamptz)` is already deployed (migration 20260420102500 §7, lines 411–534). It does exactly what the handoff asks for under a different name (`client_get_open_slots`): SECURITY DEFINER, materialises weekly + one-off availability rules, subtracts existing pending/confirmed appointments via `tstzrange &&`, returns `(staff_user_id, slot_start, slot_end)`, validates 90-day max range, and pins to the caller's org via `clients.user_id = auth.uid()` (defence-in-depth — works even if the JWT claim is stale).

2. **Client INSERT on `appointments` is permitted by RLS.** The handoff prompt said "clients almost certainly don't have INSERT" — but the policy `"insert appointments"` (rls_enable_and_policies.sql line 1054) allows clients to insert when `client_id` is their own. So an RPC is not strictly required for the INSERT itself; we still want one for the **race-condition guard** (re-check the slot is open at insert time) and to look up the `session_types.name` to write into `appointments.appointment_type`.

3. **Client cancel UPDATE is permitted by RLS, with field-level lockdown.** The policy `"client cancels own appointment"` (line 1076) plus the `appointments_client_field_lockdown` BEFORE UPDATE trigger (line 1093) already guarantee a client can ONLY change `status`, `cancelled_at`, and `cancellation_reason` — any other field change raises `insufficient_privilege`. The 24-hour cutoff is the only thing not enforced at the DB layer.

Audit and side-effect plumbing is also already in place: `audit_appointments` trigger is attached (audit_log_and_triggers.sql line 419), and `audit_resolve_org_id` already includes `'appointments'` in its CASE list (line 229). **No audit register migration is needed.**

This means Phase F work is narrower and safer than the handoff implied:

- **Sub-task 2 collapses to nothing:** reuse `client_available_slots` rather than create a duplicate.
- **Sub-task 3 narrows:** one new RPC for booking (race guard + session-type lookup + reminder enqueue) and one for cancel (24h cutoff). Cancel could be a server action against the existing UPDATE policy; we wrap it in an RPC so the 24h check lives next to the data, not in app code.
- **Sub-tasks 4–5** stand as-is: portal picker UI + upcoming bookings view + cancellation CTA.
- **Sub-task 6 changes shape slightly:** the existing `appointment_reminders` table (separate lifecycle per reminder) is the right home, not a `reminder_sent_at` column on `appointments`. The booking RPC enqueues a row; an Edge Function on a 5-minute cron drains it.

There's a coordination dependency on Phase A in the main chat (which adds `.portal-card`, `.portal-btn-primary`, etc. to globals.css). Phase F UI either waits for Phase A to land or uses the existing inline-style pattern that `PortalEmpty` and the rest of the portal already follow. Recommended: **add the portal-* classes for new patterns we need, mirroring the existing inline styles, so the visual is consistent with neighbouring pages today and the migration to Phase A's classes is a one-time s/style/className/ later**. See open Q1 below.

### 0.1 Sign-off log (chat 2026-05-10)

| # | Question | Answer | Notes |
|---|----------|--------|-------|
| L1 | SMS reminders | **Email-only at launch.** Twilio not wired in this codebase. | Resend confirmation + 24h reminder email. SMS deferred — see §6 follow-ups. |
| L2 | Cancellation policy | **24-hour cutoff.** Inside that window, the cancel CTA becomes "Message your EP" linking to /portal/messages. The cancel button is hidden inside 24h. | Enforced at the RPC layer. |
| L3 | Confirm flow | **Instant confirm.** Client picks slot → booked. `appointments.status = 'confirmed'` on insert. RPC re-checks slot availability at insert time. EP sees the booking on their schedule with no action required. | No "EP must confirm" step in v1. |

These three are not for re-litigation in this gap doc — they're recorded for traceability.

---

## 1. What's already correct

Pieces of the existing implementation that align with the target state and stay as-is.

### 1.1 Schema — `availability_rules` + `appointments` + `appointment_reminders`
Migration 20260420102000 lays out the full scheduling shape:
- `availability_rules`: weekly + one-off recurrence, `slot_duration_minutes` per rule (default 60), `effective_from`/`effective_to` for active windows, `staff_user_id` for multi-practitioner readiness.
- `appointments`: status enum (`pending → confirmed → completed | cancelled | no_show`), `confirmed_at`/`cancelled_at`/`cancellation_reason`/`no_show_marked_at` lifecycle timestamps, `appointment_type` text (label, not FK), `appointments_org_start_idx` + `appointments_client_start_idx` + `appointments_reminder_scan_idx` covering the queries we need.
- `appointment_reminders`: dedicated table with own status (`scheduled / sent / delivered / failed / bounced`), `scheduled_for`, `provider` (`resend` or `twilio`), `provider_message_id`, retry count, `UNIQUE (appointment_id, reminder_type)` so we can't double-enqueue.
- `appointments_enforce_client_org` trigger guarantees `client_id`'s org matches the row's `organization_id` — saves a class of cross-org bug.

### 1.2 Slot RPC — `client_available_slots(p_from, p_to)`
Already does the heavy lift:
- Pins org via `clients.user_id = auth.uid()` (NOT the JWT claim), which works for fresh-invite clients whose claim might still be stale.
- 90-day range cap.
- Uses `tstzrange(start, end, '[)') && tstzrange(...)` for overlap — handles edge cases that hand-rolled comparisons get wrong.
- Returns staff-aware results; `staff_user_id` per row makes us multi-practitioner-ready without changes.
- ISODOW conversion uses `EXTRACT(ISODOW FROM d)::int - 1 = day_of_week`, matching the established Mon=0…Sun=6 convention (see [`schedule/page.tsx:79`](../../src/app/(staff)/schedule/page.tsx) `// 0=Mon…6=Sun`).

We will **not** build `client_get_open_slots`. We call `client_available_slots` from the portal directly.

### 1.3 RLS posture for the booking flow
- `appointments` SELECT — clients see own (line 1042–1052).
- `appointments` INSERT — clients can insert their own row (line 1054–1063).
- `appointments` UPDATE — staff full; clients restricted to status→cancelled (line 1076–1090) with field-level lockdown trigger (line 1093–1116).
- `appointments` DELETE — denied; soft-delete only (line 1122).
- `availability_rules` is staff-only — clients reach availability through the SECURITY DEFINER RPC. ✓ matches design doc §4.18.
- `appointment_reminders` is staff SELECT + service-role writes. The reminder scheduler must run as service role.

### 1.4 Audit coverage
- `audit_appointments` trigger attached (audit_log_and_triggers.sql line 419).
- `audit_resolve_org_id` includes `'appointments'` in its direct-column branch (line 229).
- `audit_appointment_reminders` trigger attached (line 423).
- `audit_resolve_org_id` walks `appointment_reminders → appointments` for org resolution (line 267).

**No audit register migration needed for Phase F.**

### 1.5 Email infrastructure
- [`src/lib/email/client.ts`](../../src/lib/email/client.ts) — lazy Resend client, `RESEND_API_KEY` env, `EMAIL_FROM` env defaulting to Resend's sandbox sender. Server-only.
- [`src/lib/email/send-client-invite.ts`](../../src/lib/email/send-client-invite.ts) — server action wrapping a template render + `resend.emails.send()`, returning `{ error, messageId }`. The pattern to mirror.
- [`src/lib/email/templates/client-invite.ts`](../../src/lib/email/templates/client-invite.ts) — table-based HTML, escaped inputs, plain-text fallback. The template pattern to mirror.

### 1.6 Portal helpers
- [`PortalTop`](../../src/app/portal/_components/PortalTop.tsx) — eyebrow + h1 page header.
- [`PortalEmpty`](../../src/app/portal/_components/PortalTop.tsx) — empty-state card. Use this for "no upcoming bookings yet".
- [`BottomNav`](../../src/app/portal/_components/BottomNav.tsx) — already has `Book` item routing to `/portal/book`. **Not touched by Phase F.**

### 1.7 Session types are tenant-configurable
[`session_types`](../../supabase/migrations/20260423100000_session_types.sql) is already populated for every org with the four defaults (Session, Initial assessment, Review, Telehealth) at colours `#1E1A18 / #2DB24C / #E8A317 / #3B82F6`. Each row carries a hex colour we can tint the picker step with — small touch, but it ties the portal to the staff schedule visually.

Note: `session_types` has **no `default_duration_minutes` column**. The handoff prompt suggested looking for one. Slot duration in v1 comes from `availability_rules.slot_duration_minutes`. If different durations per type are needed later, that's a separate migration — see §5 follow-up F1.

---

## 2. Gaps to close

### P0 — Architectural

| # | Gap | Why it matters |
|---|-----|----------------|
| **P0-1** | **No `client_book_appointment` RPC.** Direct INSERT via the existing RLS policy works, but the booking action needs three things that belong in one transaction: (a) re-check the slot is still open at INSERT time (race guard against another client booking concurrently), (b) look up `session_types.name` from the supplied `session_type_id` and write that text into `appointments.appointment_type`, (c) enqueue an `appointment_reminders` row scheduled for `start_at - 24 hours`. Doing this in app code makes (a) racy (TOCTOU) and (c) easy to forget on retry. | Atomic RPC closes the race and ties the reminder enqueue to the booking lifecycle. |
| **P0-2** | **No `client_cancel_appointment` RPC.** The existing RLS UPDATE policy already permits a client to flip `status='cancelled'`. What's missing is the 24-hour cutoff. Two homes: (a) an additional CHECK at the RLS layer — fragile (RLS doesn't naturally express "and now() < start_at - 24h"), (b) a BEFORE UPDATE trigger — works, but requires us to edit the existing field-lockdown trigger or add another one, and the error path is awkward to surface to the client UI, (c) wrap the cancel in a SECURITY INVOKER RPC that performs the 24h check with a clear error code, then issues the UPDATE. **Recommended: (c).** Keeps the policy-layer simple, gives the UI an exception with a known SQLSTATE / message it can branch on. The RPC also marks any queued reminder rows as cancelled in the same transaction. | Cleanest separation of concerns; matches the established pattern (see `client_complete_session` for the parallel). |

### P1 — Functional

| # | Gap | File path |
|---|-----|-----------|
| **P1-1** | **Portal picker UI (`/portal/book/new`).** Mobile-first single-column page with URL-driven steps (so back button works): step 1 type pick → step 2 day pick → step 3 time pick → step 4 review-and-confirm. No modals. Calls `client_available_slots` server-side once for the next 4 weeks; filters into days/times client-side as the user navigates. | New: `src/app/portal/book/new/page.tsx`, `src/app/portal/book/new/actions.ts`, `src/app/portal/book/new/_components/StepType.tsx`, `_components/StepDay.tsx`, `_components/StepTime.tsx`, `_components/StepReview.tsx`. |
| **P1-2** | **Upcoming bookings view (`/portal/book`).** Replace the current empty stub. Server-load my upcoming `appointments` (status != cancelled, deleted_at is null, start_at >= now()), order by start_at, render each with date/time/type and a Cancel CTA OR "Message your EP" CTA depending on the 24h cutoff. Empty state when none. CTA at bottom: "Book a session" → `/portal/book/new`. | Update: `src/app/portal/book/page.tsx`. |
| **P1-3** | **Booking confirmation email + 24h reminder enqueue.** The booking server action calls `client_book_appointment`, then sends a Resend confirmation email and (if the start is more than 24h away) the booking RPC has already enqueued the reminder row. | New: `src/lib/email/templates/booking-confirmation.ts`, `src/lib/email/templates/booking-reminder.ts`, `src/lib/email/send-booking-confirmation.ts`. |
| **P1-4** | **Reminder worker.** Drains due rows from `appointment_reminders` and sends them via Resend. Runs as service role (RLS denies authenticated INSERT/UPDATE on this table). Recommended pattern: Supabase Edge Function on a `pg_cron` 5-minute schedule that calls the function. The function reads `WHERE status='scheduled' AND scheduled_for <= now()`, locks each row (`FOR UPDATE SKIP LOCKED`), sends, sets `status='sent' / sent_at=now() / provider_message_id=...` on success or status='failed' / failure_reason on error. | New: `supabase/functions/send-appointment-reminders/index.ts`. **Edge Function live deploy is out of code-review scope — flag in PR description.** |
| **P1-5** | **Cancellation server action + UI.** Calls `client_cancel_appointment` RPC. Surfaces the 24h-cutoff error from the RPC as an inline message + redirect to /portal/messages. | Update: `src/app/portal/book/page.tsx` + a small client-side `CancelButton.tsx`. |

### P2 — Polish

| # | Gap | Notes |
|---|-----|-------|
| **P2-1** | Session-type chip uses `session_types.color` as a 4px left-border, matching the staff schedule's tint convention. | Reuses tenant-configurable colour. |
| **P2-2** | "Days with availability" chip pattern in step 2 — disabled cells for days with no open slots. Don't render an empty list. | Per design system: muted text, no bright disabled red. |
| **P2-3** | Date display: Australian English — `Sat 15 May 2026`, `7:00am – 8:00am`. | CLAUDE.md voice & copy. |
| **P2-4** | Inside-24h CTA copy: "Need to change this? Message your EP." — link to /portal/messages, not a button. | Imperative verb, sentence case. |
| **P2-5** | Confirmation email copy is dense and quiet (mirrors client-invite tone). Includes the `{practiceName}` and the "View or cancel" link to `/portal/book`. | No "Yay!" / no exclamation marks. |
| **P2-6** | Empty state — `PortalEmpty` with title "No bookings yet" and a primary CTA button "Book a session". | Use existing helper. |

---

## 3. Phasing (sequence within Phase F)

Architecture before features, features before polish — the standard pass.

### F-Phase 1 — RPCs land first
1. Migration `20260510120000_client_book_appointment.sql`:
   - `client_book_appointment(p_session_type_id uuid, p_staff_user_id uuid, p_start_at timestamptz, p_end_at timestamptz)` returns uuid (the new appointment id).
   - `client_cancel_appointment(p_appointment_id uuid)` returns void.
   - Both functions REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated.
   - Both pin to `auth.uid()`-resolved client.
2. `supabase db push` → `npm run gen:types` (or `supabase gen types typescript`) → verify TypeScript types regenerated.
3. Verify acceptance manually: open SQL Editor, call both RPCs as a test client, confirm an appointment row + an appointment_reminders row land.

### F-Phase 2 — Upcoming bookings view
1. `/portal/book/page.tsx` — reads my appointments, renders cards or empty state.
2. Cancellation server action.
3. CancelButton client component (only renders if start_at - now() > 24h).

### F-Phase 3 — Picker UI
1. `/portal/book/new/page.tsx` server-loads `client_available_slots` for next 28 days, computes days-with-slots, passes down.
2. URL-driven step state via `?step=type|day|time|review&type=<id>&day=YYYY-MM-DD&start=<iso>` so back button works as expected on mobile.
3. Step components (StepType, StepDay, StepTime, StepReview) are pure; no React state for step navigation.
4. Server action confirms via `client_book_appointment`. On RPC error 'slot no longer available', return user to step 3 with refreshed slots and an inline message.

### F-Phase 4 — Email + reminders
1. `booking-confirmation.ts` template (mirrors `client-invite.ts`).
2. `booking-reminder.ts` template.
3. `send-booking-confirmation.ts` server action — called immediately after `client_book_appointment` succeeds.
4. Edge Function `send-appointment-reminders/index.ts`. **Deployed 2026-05-12** at `https://azjllcsffixswiigjqhj.supabase.co/functions/v1/send-appointment-reminders`. Config: `[functions.send-appointment-reminders] verify_jwt = false` in `supabase/config.toml` (cron auth is by `CRON_SHARED_SECRET` in bearer header, not a Supabase JWT). Secrets set in Supabase: `RESEND_API_KEY`, `CRON_SHARED_SECRET`.
5. pg_cron schedule. **Scheduled 2026-05-12** as job `appointment-reminders-5min`, runs `*/5 * * * *`, jobid 1. Cron command is `SELECT net.http_post(...)` with the function URL and bearer token inlined (the documented `current_setting('app.cron_token')` indirection requires `ALTER DATABASE`, which hosted Supabase blocks — see `MEMORY.md` note). End-to-end verified: cron fires every 5 min (5 consecutive `succeeded` ticks observed), test reminder flipped to `status='sent'` with `provider_message_id` populated, email landed in Resend-verified inbox.

**Pre-launch follow-ups for this phase (parked, not blocking):**
- Verify a sending domain in Resend (`resend.com/domains`) and set `EMAIL_FROM` Supabase secret to a real address (e.g. `Odyssey <bookings@odyssey.com.au>`). Sandbox sender `onboarding@resend.dev` only delivers to the Resend-account-verified email, so this MUST happen before any real client books.
- Set `NEXT_PUBLIC_APP_URL` Supabase secret so the email's "View booking" link resolves to the deployed URL instead of `#`.
- Rotate `CRON_SHARED_SECRET` and `RESEND_API_KEY` — both appeared in chat transcript during deploy. Premortem checklist will surface this (see `feedback_premortem_secret_hygiene.md`).
- Migrate cron credential from inline literal to Supabase Vault for defence-in-depth.

### F-Phase 5 — Polish
1. Session-type colour stripes.
2. Australian English copy passes.
3. PortalEmpty / PortalCard styling matches other portal screens (will switch to `.portal-card` etc. once Phase A merges — see open Q1).

---

## 4. Acceptance bar

A Phase F PR is ready to merge when ALL of the following pass:

- [ ] **Migration applies cleanly.** `supabase db push` lands `20260510120000` without warnings; types regenerate.
- [ ] **Slot is open → I can book.** As test client, navigate `/portal/book/new`, complete all 4 steps, hit Confirm, see the appointment in `/portal/book` AND on the staff `/schedule` view at the same time.
- [ ] **Race guard fires.** Manually mark a slot as taken (insert an appointment via SQL) between Step 3 and Step 4; the RPC raises 'slot no longer available'; the UI returns the user to Step 3 with refreshed slots and a polite inline message.
- [ ] **Confirmation email lands** (Resend dashboard shows 'delivered'; test inbox receives the message; subject + body match the template).
- [ ] **24h cutoff hides the cancel button.** A booking with start_at = now() + 23 hours: the cancel button is not rendered; only the "Message your EP" link.
- [ ] **24h cutoff blocks the RPC.** Direct call to `client_cancel_appointment(<inside-24h-id>)` raises a known SQLSTATE; server action surfaces a clean message.
- [ ] **Cancellation outside 24h works.** Status flips to cancelled; queued reminder row marked cancelled; the booking disappears from `/portal/book` (filtered out); audit_log shows the UPDATE.
- [ ] **Reminder fires at T-24h.** Set a test booking 24h + 5min in the future, run the Edge Function manually, confirm the reminder email lands and `appointment_reminders.status = 'sent'`.
- [ ] **No backend errors on the staff side.** Open the staff schedule, confirm the new client booking renders correctly with the right session-type colour.
- [ ] **BottomNav untouched.** `git diff master -- src/app/portal/_components/BottomNav.tsx` is empty.

---

## 5. Open questions (need sign-off before code lands)

These are not the three locked decisions (those are settled) — they're scope/architecture calls I'd like a yes/no on before I start.

**Q1 — CSS primitives (Phase A coordination).**
Phase A in the main chat will add `.portal-card`, `.portal-btn-primary`, `.portal-btn-secondary`, `.portal-eyebrow`, `.portal-empty`, `.portal-week-strip`, `.portal-day-cell`, etc. to globals.css. Phase F needs all of these to style the picker + bookings list.
- **Option A** — Wait for Phase A to merge before starting Phase F UI. Cleanest, but blocks F on A.
- **Option B** — Phase F adds the classes to globals.css itself, mirroring the inline-style patterns the other portal pages use today. Phase A merges later and either accepts F's definitions or adjusts. Risk: small coordination friction.
- **Option C** — Phase F uses inline styles that mirror the existing `PortalEmpty` / `PortalTop` patterns for now. After Phase A lands, a tiny follow-up PR migrates `style={{ ... }}` to `className="..."`.
- **Recommended: C.** It keeps Phase F unblocked, doesn't pre-empt Phase A's class names, and the migration later is mechanical (about an hour of search/replace). The visual is consistent with the rest of the portal today.

**Q2 — Booking RPC: SECURITY DEFINER vs INVOKER.**
The handoff prompt asked for SECURITY INVOKER. I'd recommend SECURITY DEFINER for two reasons:
- The race-condition guard re-queries `availability_rules`, which clients can't read directly (RLS denies). An INVOKER function would have to delegate the slot check to the existing SECURITY DEFINER `client_available_slots` (extra round-trip, less clean).
- The existing `client_start_session` / `client_complete_session` / `client_log_set` family are all SECURITY DEFINER pinned to `auth.uid()`. Consistency.
- DEFINER does NOT mean "skips authorization" — the RPC's first action will be `IF auth.uid() IS NULL OR <client_id resolves> THEN RAISE EXCEPTION`, identical to what an INVOKER function with explicit RLS check would do. The behaviour is the same; the implementation is cleaner.
- **Recommended: DEFINER, pinned to auth.uid()-resolved client_id.** Cancel RPC stays INVOKER since RLS handles authorization.

**Q3 — Booking RPC parameter list.**
The handoff specifies `client_book_appointment(p_client_id uuid, p_staff_user_id uuid, p_session_type_id uuid, p_start_at timestamptz, p_end_at timestamptz)`. I'd drop `p_client_id` — it's resolved from `auth.uid()`-pinned `clients` row, identical to every other client_* RPC. Passing it in invites the question "what if the client passes someone else's id?" — even though it's blocked by the auth pin, dropping the parameter removes the doubt.
- **Recommended: `client_book_appointment(p_session_type_id uuid, p_staff_user_id uuid, p_start_at timestamptz, p_end_at timestamptz)` returns uuid.**
- Same for cancel: `client_cancel_appointment(p_appointment_id uuid) returns void`. The auth pin on `appointments.client_id` resolves ownership.

**Q4 — Slot duration source.**
`session_types` has no `default_duration_minutes`; slot duration comes from `availability_rules.slot_duration_minutes`. Two interpretations:
- **A** — Every type uses the same slot duration (whatever the EP set on their availability rule). The session_type is just a label.
- **B** — Type-specific durations: an Initial Assessment is 60min, a Review is 30min. Requires a `default_duration_minutes` column on `session_types` AND careful handling when an availability rule's slot is shorter than the type's default.
- **Recommended: A for v1.** The EP authors availability with their preferred slot grid; the client picks a slot and labels it with a type. If type-specific durations come up later (likely), it's a small, isolated migration.

**Q5 — pg_cron + Edge Function vs simpler-but-less-reliable patterns.**
For draining `appointment_reminders`, the cleanest pattern is:
- pg_cron job every 5 minutes calls a Supabase Edge Function (which holds the Resend key as a secret).
- Edge Function reads due rows with `FOR UPDATE SKIP LOCKED`, sends, marks status.

Alternatives:
- **Postgres + http extension** — write a pl/pgsql function that POSTs directly to Resend; pg_cron runs it. Less code, but the http extension is not always available on hosted Supabase, and credential management in Postgres is messier than in EF secrets.
- **Server action + Vercel cron** — adds a Vercel-side dependency for what is fundamentally a database concern.
- **Recommended: Edge Function + pg_cron.** Standard Supabase pattern, isolated credential, idempotent (the row-level status field prevents double-send).

**Q6 — T-1h reminder.**
The handoff prompt allows skipping it for v1. Recommend **skip** — adds a second reminder row per booking, doubles email volume, and the 24h reminder should be sufficient for a clinical context. Document as a possible future addition.

**Q7 — Cancelled-by-role / created-by-role columns.**
The handoff prompt says "if such a column exists" — they don't. The audit_log captures actor_user_id + actor_role per change, so the question "who cancelled this?" is answerable from the audit trail. **Recommend: do not add columns.** The audit trail is the right home.

---

## 6. Deferred follow-ups

Captured here so they don't get lost. None of these block Phase F.

- **F1 — Type-specific durations.** Add `session_types.default_duration_minutes`; if absent, fall back to `availability_rules.slot_duration_minutes`. Open Q4 above.
- **F2 — SMS reminders via Twilio.** Existing `appointment_reminders.provider` enum already includes `'twilio'`. When Twilio is wired, the EF gains a per-row branch on `provider`.
- **F3 — Self-service rescheduling.** Today, clients can cancel-and-rebook, but cannot reschedule directly. The RLS field-lockdown trigger explicitly forbids client-side `start_at` changes. If we add reschedule, it's a new RPC + lockdown trigger update.
- **F4 — Recurring appointment series.** Out of scope for v1; recurring availability rules are; recurring bookings are not.
- **F5 — T-1h reminder.** Skipped per Q6 above.
- **F6 — Booking notes.** The schema has `appointments.notes` — could surface a "anything you'd like the EP to know?" textarea on Step 4. Not in v1; flag as a small future polish.
- **F7 — Buffer minutes between bookings.** No mechanism for "give me 15 min between sessions" exists today. The EP authors availability with the buffer baked in. If buffers become a request, they live on `availability_rules` (e.g., `buffer_after_minutes`).
- **F8 — Staff-pick step.** When the practice grows past one EP, step 1 gains a "who do you want to see?" choice. Today `staff_user_id` is implicit (only one EP per org); the slot RPC already returns it per row, so the migration is UI-only.
- **F9 — Migrate inline portal styles to `.portal-*` classes.** After Phase A merges. See Q1.

---

## 7. Files this phase will touch (preview)

So the user can see the blast radius before sign-off.

**New files:**
- `supabase/migrations/20260510120000_client_book_appointment.sql`
- `src/app/portal/book/new/page.tsx`
- `src/app/portal/book/new/actions.ts`
- `src/app/portal/book/new/_components/StepType.tsx`
- `src/app/portal/book/new/_components/StepDay.tsx`
- `src/app/portal/book/new/_components/StepTime.tsx`
- `src/app/portal/book/new/_components/StepReview.tsx`
- `src/app/portal/book/_components/CancelButton.tsx`
- `src/lib/email/templates/booking-confirmation.ts`
- `src/lib/email/templates/booking-reminder.ts`
- `src/lib/email/send-booking-confirmation.ts`
- `src/lib/email/send-booking-reminder.ts`
- `supabase/functions/send-appointment-reminders/index.ts` (Edge Function — needs separate deploy)

**Edited files:**
- `src/app/portal/book/page.tsx` (replace empty stub with upcoming bookings view)
- `src/types/database.ts` (regenerated — RPC signatures pulled in by `supabase gen types`)

**Files explicitly NOT touched:**
- `src/app/portal/_components/BottomNav.tsx` — handled by Phase B in the main chat.
- All staff-facing files (schedule, dashboard, etc.) — out of scope.
- `auth_resolve_org_id` — already includes `appointments`.
- Any RLS policy on `appointments` / `availability_rules` / `appointment_reminders` — existing policies are correct for the flow.

---

## 8. Cross-references

- Brief: handoff prompt chat 2026-05-10.
- Schema: [`docs/schema.md`](../schema.md) (especially appointments + scheduling sections).
- RLS: [`docs/rls-policies.md`](../rls-policies.md) §4.18, §4.19, §4.20, §6.
- Memory notes consulted: "Audit register new tables" (no action needed — already registered), "plpgsql function arity evolution" (new functions; no DROP needed but I'll document the signatures), "No local Docker — work against live Supabase" (`supabase db push` against remote), "Schema/migration/push correctness" (migration → push → type regen → verify), "Supabase migration timestamp collision" (`20260510120000` is unused; verified against origin/master 2026-05-10).
