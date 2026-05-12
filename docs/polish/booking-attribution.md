# Polish-pass gap analysis — Booking attribution + cancellation visual (Phase F-5)

**Brief:** Handoff prompt 2026-05-13. Four small-but-related polish items on the existing booking flow (Phase F, shipped 2026-05-10):
1. Odyssey brand mark on staff-schedule blocks for app-booked sessions.
2. Inside-24h cancel CTA changes from "Message your EP" link to a static "Please call the practice" message (with phone number when set).
3. Visual distinction for cancelled appointments on the staff schedule, with an "App Cancellation" suffix when the cancellation came from the client portal.
4. A `phone` column on `organizations` surfaced in `PracticeInfoForm`.

**Reference UX (already in repo):**
- Phase F gap doc — [`docs/polish/client-portal-booking.md`](./client-portal-booking.md). §3 locked decision L2 (cancellation window CTA) is being amended by this phase.
- Adjacent phase context — [`docs/polish/availability-editor.md`](./availability-editor.md).
- Staff schedule — [`page.tsx`](../../src/app/(staff)/schedule/page.tsx), [`WeekView.tsx`](../../src/app/(staff)/schedule/_components/WeekView.tsx), [`actions.ts`](../../src/app/(staff)/schedule/actions.ts).
- Portal book — [`page.tsx`](../../src/app/portal/book/page.tsx), [`actions.ts`](../../src/app/portal/book/actions.ts), [`CancelButton.tsx`](../../src/app/portal/book/_components/CancelButton.tsx).
- Settings practice info — [`PracticeInfoForm.tsx`](../../src/app/(staff)/settings/_components/PracticeInfoForm.tsx), [`actions.ts`](../../src/app/(staff)/settings/actions.ts).

**Schema / RPCs:**
- Appointments table — [`20260420102000_scheduling.sql`](../../supabase/migrations/20260420102000_scheduling.sql) lines 71–129.
- Organizations table — [`20260420100200_identity_tables.sql`](../../supabase/migrations/20260420100200_identity_tables.sql) lines 18–32. **`phone text` column already exists** (line 27).
- Booking + cancel RPCs — [`20260510120000_client_book_appointment.sql`](../../supabase/migrations/20260510120000_client_book_appointment.sql).
- Client field lockdown trigger — [`20260420102600_rls_enable_and_policies.sql`](../../supabase/migrations/20260420102600_rls_enable_and_policies.sql) lines 1093–1120.
- Audit register — [`20260510120200_audit_resolve_org_id_restore_nested.sql`](../../supabase/migrations/20260510120200_audit_resolve_org_id_restore_nested.sql) — `appointments` and `organizations` (in `audit_resolve_org_id`'s direct branch via `WHEN 'organizations'`) already registered.

**Audit date:** 2026-05-13.
**Status:** Gap document — awaiting sign-off before any code changes.

---

## 0. Executive summary

The audit lands the phase on a noticeably narrower base than the handoff prompt assumed. Three things treated as "to do" are already in place:

1. **`organizations.phone` already exists.** The column was declared in the original identity migration ([`20260420100200_identity_tables.sql:27`](../../supabase/migrations/20260420100200_identity_tables.sql)) and surfaces through generated types ([`src/types/database.ts:1665`](../../src/types/database.ts) and Insert/Update siblings).

2. **`PracticeInfoForm` already renders the phone field.** [`PracticeInfoForm.tsx:61-66`](../../src/app/(staff)/settings/_components/PracticeInfoForm.tsx) shows a `<Field name="phone" label="Phone" type="tel">` alongside email/timezone. The label is `"Phone"` not `"Practice phone"` per the prompt — see open Q4 below.

3. **`updatePracticeInfoAction` already writes phone.** [`actions.ts:25`](../../src/app/(staff)/settings/actions.ts) reads `phone` from FormData and updates the row. No action change required.

So **sub-tasks 4 and 5 of the prompt collapse to nothing**, with one tiny copy question (Q4 below). The reduction is structural — the rest of the phase still stands but is smaller than the handoff implied.

The other audit findings:

4. **Cancelled appointments DO render on the staff schedule.** [`schedule/page.tsx:121-133`](../../src/app/(staff)/schedule/page.tsx) has no `.neq('status', 'cancelled')` filter — confirmed. The query returns cancelled rows.

5. **The cancellation visual treatment is already partially implemented.** [`WeekView.tsx:1144-1156`](../../src/app/(staff)/schedule/_components/WeekView.tsx) overrides the type colour for `status === 'cancelled' || status === 'no_show'` and falls back to `toneToColors('r')` which returns `bg: rgba(214,64,69,.22)` + `border: var(--color-alert)`. The 3px left-border is at line 1321. **The current background tint (.22) is much heavier than the prompt's spec (.05).** This is a deliberate sign-off question — see Q1.

6. **The `appointments_client_field_lockdown` trigger does NOT list `cancelled_by_role`** ([`rls_enable_and_policies.sql:1099-1108`](../../supabase/migrations/20260420102600_rls_enable_and_policies.sql)). It is a deny-list, not an allow-list — fields not in the list are permitted. Adding `cancelled_by_role` to the cancel RPC's UPDATE will pass through cleanly with NO trigger change required. There's a small defensive question — see Q3 — about whether to harden the trigger now anyway.

7. **`appointments` and `organizations` are already in `audit_resolve_org_id`.** Both in the direct-org branch ([`20260510120200_audit_resolve_org_id_restore_nested.sql:64,75`](../../supabase/migrations/20260510120200_audit_resolve_org_id_restore_nested.sql)). No audit-register migration needed for the column additions.

8. **The `appointment_type` text column drives the staff schedule colour stripe.** Lookup at [`WeekView.tsx:125-129`](../../src/app/(staff)/schedule/_components/WeekView.tsx) — case-insensitive name → hex from `session_types`. The Odyssey brand mark needs to coexist with this; my position is bottom-right corner, the stripe is the left-border, no conflict.

9. **There are TWO `cancelAppointmentAction` functions in the repo** (worth flagging — easy to confuse during edits):
   - [`src/app/(staff)/schedule/actions.ts:127-146`](../../src/app/(staff)/schedule/actions.ts) — staff-side direct UPDATE, takes `(id, reason)`. Needs `cancelled_by_role: 'staff'` added to its UPDATE payload.
   - [`src/app/portal/book/actions.ts:20-44`](../../src/app/portal/book/actions.ts) — portal, takes `FormData`, calls the `client_cancel_appointment` RPC. Doesn't need direct change — the RPC update covers it.
   Same pattern applies to create (staff direct INSERT vs portal RPC).

### 0.1 Locked decisions (from this phase's handoff prompt)

These are recorded for traceability — they came in pre-locked from the handoff prompt and are not for re-litigation in this gap doc.

| # | Decision | Notes |
|---|----------|-------|
| **L1** | App-booked appointments show an "Odyssey." brand mark on the staff schedule, bottom-right corner, ~9–11px text height. | Picks out app bookings at a glance. Static (non-interactive). |
| **L2** | Inside-24h cancel CTA becomes static "Please call the practice…" copy — no link, no button. Phone number inserted when `organizations.phone` is set. | Reverses Phase F locked decision L2. The "Message your EP" link goes away. |
| **L3** | Cancelled appointments stay visible on the staff schedule with soft-red treatment. App cancellations get a `Scott Browning · App Cancellation` suffix in the card body. | Soft-red is the existing cancellation visual pattern. |
| **L4** | New columns: `appointments.created_by_role`, `appointments.cancelled_by_role`. Reverses Phase F gap doc §5 Q7 ("don't add columns — audit_log captures it"). Reason: render-time lookup needs a column, not a join. | `created_by_role` NOT NULL DEFAULT 'staff' CHECK enum. `cancelled_by_role` nullable, only set on cancel. |

### 0.2 Sign-off log (questions awaiting answers)

The four below need a yes/no before code lands. Recommendations are mine; the user gets the call.

| # | Question | Recommendation | Status |
|---|----------|----------------|--------|
| **Q1** | Cancelled appointment background tint: keep the current `rgba(214,64,69,.22)` (heavy, what's there today) or change to the prompt's `rgba(214,64,69,.05)` (very subtle, design-system-coded as the "soft-red flag" pattern from clinical notes)? | **Change to .05.** The .22 tint is loud — it competes with the type-colour blocks around it for visual attention. The .05 + 3px solid `var(--color-alert)` left-border is exactly the soft-red flag pattern from the design system, and `WeekView.tsx:1144-1156`'s "cancelled overrides type colour" logic carries the visual weight in the border, not the fill. Cancelled appointments should read as "still here, but quietly faded" — cleaner if the body fill is light. | Awaiting |
| **Q2** | Cancelled-text treatment: the prompt asks for "reduced opacity (~0.72) or strike-through on the time — pick one." Which? | **Reduced opacity 0.72 on the entire block content.** Strike-through on the time alone reads as "this time slot is no longer valid" which is true but small; opacity-on-everything reads as "this whole booking is past tense" which matches the cancelled state better. Cleaner with the soft-red border and tinted background — they already say "look here but not urgently". | Awaiting |
| **Q3** | The `appointments_client_field_lockdown` trigger doesn't currently list `cancelled_by_role` — it's a deny-list, so additions to the row by SECURITY DEFINER RPCs pass through. Should I defensively add `created_by_role` to the lockdown list (so a client can never change it via direct UPDATE) AND add a guard that `cancelled_by_role` may only be set when status is also flipping to cancelled? | **Yes — both.** `created_by_role` should never change post-creation; locking it in the trigger is one extra IF and matches the existing posture for other immutable fields (`staff_user_id`, `client_id`, `organization_id`). The `cancelled_by_role`-only-during-cancel guard is small belt-and-braces — costs nothing, prevents a class of "client did a cancel-then-uncancel weirdness that mislabelled the row" bug we don't have today. | Awaiting |
| **Q4** | The PracticeInfoForm field label is currently `"Phone"`. Prompt says `"Practice phone"`. Change it? | **Leave as `"Phone"`.** It sits inside a section already titled "Practice info" — the surrounding context is unambiguous, and the shorter label sits cleaner in the two-column grid alongside `"Email"`, `"Timezone"`. The prompt's longer label would force a column-width tweak for no information gain. The placeholder gets the format hint instead — a separate small change worth signing off. | Awaiting |
| **Q5** | The PracticeInfoForm phone field has no placeholder today. Add one? | **Yes — `"e.g. (07) 1234 5678"`.** Free-text means the EP could type anything; a placeholder gives them a steer without forcing a format. AU-flavoured. Two characters of friction (`e.g.`) make it clear it's a hint, not the saved value. | Awaiting |

---

## 1. What's already correct

Pieces of the existing implementation that stay as-is.

### 1.1 `organizations.phone` column exists
[`20260420100200_identity_tables.sql:27`](../../supabase/migrations/20260420100200_identity_tables.sql) — `phone text` (nullable). Generated types include it across Row/Insert/Update at [`src/types/database.ts:1665,1682,1699`](../../src/types/database.ts).

### 1.2 `PracticeInfoForm` already wires phone
[`PracticeInfoForm.tsx:61-66`](../../src/app/(staff)/settings/_components/PracticeInfoForm.tsx) — `<Field name="phone" label="Phone" type="tel" defaultValue={info.phone ?? ''} />`. The form `PracticeInfo` type carries `phone: string | null` (line 10).

### 1.3 `updatePracticeInfoAction` already writes phone
[`actions.ts:25`](../../src/app/(staff)/settings/actions.ts) — `phone: nullable(formData.get('phone'))`. The `nullable` helper trims and converts empty string → NULL.

### 1.4 Cancelled appointments are not filtered out of the staff schedule
[`schedule/page.tsx:121-133`](../../src/app/(staff)/schedule/page.tsx) — query is `.is('deleted_at', null)` only; no `.neq('status', 'cancelled')`. Cancelled rows render.

### 1.5 Cancellation visual partially implemented
[`WeekView.tsx:1144-1156`](../../src/app/(staff)/schedule/_components/WeekView.tsx) — `cancelled` and `no_show` override the type colour and fall back to red. 3px left-border at line 1321. The `toneToColors('r')` helper returns `bg: rgba(214,64,69,.22)` and `border: var(--color-alert)`. **The border is correct; the tint is .22 not .05.** See Q1.

### 1.6 The popover/card view also handles cancelled state
[`WeekView.tsx:1719`](../../src/app/(staff)/schedule/_components/WeekView.tsx) — the card hides the "Cancel appointment" footer button when `status === 'cancelled'`. The status pill at [`WeekView.tsx:2437-2456`](../../src/app/(staff)/schedule/_components/WeekView.tsx) already shows `"cancelled"` in `var(--color-alert)`. Both are downstream of the same `appointment.status` field; the suffix-and-tint changes will apply uniformly.

### 1.7 Audit coverage
- `appointments` is in `audit_resolve_org_id`'s direct-org WHEN list ([`20260510120200_audit_resolve_org_id_restore_nested.sql:75`](../../supabase/migrations/20260510120200_audit_resolve_org_id_restore_nested.sql)).
- `organizations` is in the direct branch via `WHEN 'organizations' THEN org_id := NULLIF(p_row ->> 'id', '')::uuid;` (line 64).
- `audit_appointments` trigger is attached at [`20260420102300_audit_log_and_triggers.sql:419`](../../supabase/migrations/20260420102300_audit_log_and_triggers.sql).
- **No audit-register migration needed for the column additions.**

### 1.8 Booking RPC fingerprints
[`20260510120000_client_book_appointment.sql`](../../supabase/migrations/20260510120000_client_book_appointment.sql) — both functions DROP-then-CREATE OR REPLACE per the established arity-evolution pattern (memory note "plpgsql function arity evolution"). Same shape will work for the column-set changes here, even though arity is unchanged.

### 1.9 Two `cancelAppointmentAction` / two booking entry points
Worth restating — these are separate functions in separate files, both legitimate, both kept:
- Staff create — [`src/app/(staff)/schedule/actions.ts:86-125`](../../src/app/(staff)/schedule/actions.ts) — direct INSERT with the staff Supabase client.
- Staff cancel — [`src/app/(staff)/schedule/actions.ts:127-146`](../../src/app/(staff)/schedule/actions.ts) — direct UPDATE.
- Portal create — [`src/app/portal/book/new/actions.ts`](../../src/app/portal/book/new/actions.ts) — calls `client_book_appointment` RPC (DEFINER).
- Portal cancel — [`src/app/portal/book/actions.ts:20-44`](../../src/app/portal/book/actions.ts) — calls `client_cancel_appointment` RPC.

The staff actions need explicit `created_by_role: 'staff'` / `cancelled_by_role: 'staff'`; the portal actions don't change at the action layer (the RPC handles it).

---

## 2. Gaps to close

### P0 — Schema

| # | Gap | File path | Why it matters |
|---|-----|-----------|----------------|
| **P0-1** | **`appointments.created_by_role` column missing.** Need text NOT NULL DEFAULT 'staff' with CHECK enum (`'staff'`, `'client_portal'`, `'system'`). | `supabase/migrations/20260513130000_appointment_actor_columns.sql` (NEW). | The Odyssey brand mark on the staff schedule needs a cheap row-level lookup, not a join to `audit_log`. Default 'staff' is the correct best-guess for existing pre-launch rows. |
| **P0-2** | **`appointments.cancelled_by_role` column missing.** Nullable text with the same CHECK enum, only set when status flips to cancelled. | Same migration. | Same reason — the "App Cancellation" suffix needs a row-level field. NULL on existing test-cancelled rows is correct: we genuinely don't know how those were cancelled. |
| **P0-3** | **`appointments_client_field_lockdown` trigger needs hardening for the new columns.** Add `created_by_role` to the deny-list (clients can never change it). Add a guard that `cancelled_by_role` may only be set when the status field is ALSO flipping to cancelled. | Same migration — `CREATE OR REPLACE FUNCTION public.appointments_client_field_lockdown()`. | Defence-in-depth. The deny-list pattern is the established posture for immutable fields; matching it for the new attribution columns is one extra IF clause. See Q3. |

(There's no `organizations.phone` gap — already exists, see §1.1.)

### P1 — Functional

| # | Gap | File path |
|---|-----|-----------|
| **P1-1** | **`client_book_appointment` RPC INSERT must set `created_by_role := 'client_portal'`.** | Update [`20260510120000_client_book_appointment.sql`](../../supabase/migrations/20260510120000_client_book_appointment.sql) — DROP FUNCTION + CREATE OR REPLACE per the memory pattern, even though arity is unchanged. |
| **P1-2** | **`client_cancel_appointment` RPC UPDATE must set `cancelled_by_role := 'client_portal'`.** | Same file as P1-1. |
| **P1-3** | **Staff `createAppointmentAction` must set `created_by_role: 'staff'` explicitly in INSERT.** Don't rely on the column DEFAULT — explicit-is-auditable. | [`src/app/(staff)/schedule/actions.ts:104-119`](../../src/app/(staff)/schedule/actions.ts). |
| **P1-4** | **Staff `cancelAppointmentAction` must set `cancelled_by_role: 'staff'` in UPDATE.** | [`src/app/(staff)/schedule/actions.ts:127-146`](../../src/app/(staff)/schedule/actions.ts). |
| **P1-5** | **Portal `/book` page inside-24h copy: replace the Link with a static `<p>`.** Read `organizations.phone` in the same SELECT that already pulls `timezone`. Render the conditional copy: with phone if set, without if NULL/empty. Style: `var(--color-text-light)`, 0.86rem, line-height 1.5, no icon, no link. | [`src/app/portal/book/page.tsx`](../../src/app/portal/book/page.tsx) — extend the SELECT at line 36–39, replace the `canCancel ? <CancelButton /> : <Link>` branch at line 153–167. |
| **P1-6** | **Staff `/schedule` query must include the new columns.** Extend the SELECT at [`schedule/page.tsx:122-128`](../../src/app/(staff)/schedule/page.tsx) to add `created_by_role, cancelled_by_role`. Update the `Appointment` mapping at lines 159–176 to carry the new fields through. | Same file. |
| **P1-7** | **`Appointment` type in `WeekView.tsx` extended.** Add `created_by_role: 'staff' \| 'client_portal' \| 'system' \| null` and `cancelled_by_role: 'staff' \| 'client_portal' \| 'system' \| null`. | [`WeekView.tsx:44-59`](../../src/app/(staff)/schedule/_components/WeekView.tsx). |
| **P1-8** | **`AppointmentBlock` renders the Odyssey brand mark when `created_by_role === 'client_portal'`.** Position: `position: absolute, bottom: 2px, right: 4px`. Type: Barlow Condensed 700 + green dot. Size: ~9px text. Colour: `var(--color-charcoal)` text + `var(--color-accent)` dot. Non-interactive. | [`WeekView.tsx:1305-1410`](../../src/app/(staff)/schedule/_components/WeekView.tsx) inside the AppointmentBlock returned JSX. |
| **P1-9** | **Cancellation visual — change tint from .22 to .05** (per Q1 sign-off), keep 3px `var(--color-alert)` left-border. Apply opacity ~0.72 to block content (per Q2). | [`WeekView.tsx:2559-2576`](../../src/app/(staff)/schedule/_components/WeekView.tsx) — modify `toneToColors('r')` OR add a separate cancelled branch in `AppointmentBlock` that doesn't go through the avatar-tone path. **Recommended: add a cancelled branch in `AppointmentBlock`** so we don't break `no_show`'s heavier tint (no_show is a louder failure mode and arguably should stay loud). |
| **P1-10** | **App-cancellation suffix.** When `status === 'cancelled' && cancelled_by_role === 'client_portal'`, render the client name as `{first_name} {last_name} · App Cancellation` in the AppointmentBlock body AND in the popover card. Title-case "App Cancellation"; middle dot `·` separator with single-space padding. | [`WeekView.tsx:1363-1364`](../../src/app/(staff)/schedule/_components/WeekView.tsx) (block) + the popover-card client-name render around line 1620–1660. |

### P2 — Polish

| # | Gap | Notes |
|---|-----|-------|
| **P2-1** | Phone field placeholder `"e.g. (07) 1234 5678"`. | See Q5. Two-char `e.g.` makes it clearly a hint. |
| **P2-2** | Inside-24h copy is one paragraph, no icon, no `→` arrow, line-height 1.5, font-size 0.86rem, colour `var(--color-text-light)`. | Quiet, factual — design system voice. |
| **P2-3** | Brand mark uses the same wordmark glyph pattern as the email-template header. Letterforms in Barlow Condensed 700, dot in `var(--color-accent)`, full text "Odyssey." with the dot baked into the period (like the email mark). | Match exists in email template header for visual consistency. |
| **P2-4** | The Odyssey mark is positioned to NOT overlap with the existing time-pill in the top-right of the block — that's at top, this is at bottom. Tested at 30-min booking length (the smallest practical block height) — at `pxPerQuarter` floor (6px) a 30-min block is ~12px tall, which is too small for both the time and the brand mark. **Brand mark is hidden on blocks shorter than 36px** (~45-min appointment at minimum px). The Odyssey-mark visibility logic checks `liveHeight >= 36`. |
| **P2-5** | Cancelled-block opacity applies to text only, not the border or background. Implementation: wrap the inner content in a div with `opacity: 0.72`, leave the outer `<div>` (which carries the border + bg) at full opacity. | The border is the load-bearing visual signal — keep it crisp. |
| **P2-6** | The popover card's status pill at [`WeekView.tsx:2437-2456`](../../src/app/(staff)/schedule/_components/WeekView.tsx) already says "cancelled" in red — **no change needed**. The "App Cancellation" suffix sits in the client-name area, separate from the status pill. |

---

## 3. Phasing (sequence within Phase F-5)

Architecture before features, features before polish.

### F-5 Phase 1 — Migration lands first
1. Migration `20260513130000_appointment_actor_columns.sql`:
   - `ALTER TABLE appointments ADD COLUMN created_by_role text NOT NULL DEFAULT 'staff' CHECK (created_by_role IN ('staff','client_portal','system'));`
   - `ALTER TABLE appointments ADD COLUMN cancelled_by_role text CHECK (cancelled_by_role IS NULL OR cancelled_by_role IN ('staff','client_portal','system'));`
   - `CREATE OR REPLACE FUNCTION public.appointments_client_field_lockdown()` — body extended per Q3.
2. Same file (or follow-up) — RPC updates:
   - `DROP FUNCTION IF EXISTS public.client_book_appointment(uuid, uuid, timestamptz, timestamptz);` then `CREATE OR REPLACE` with the INSERT extended.
   - `DROP FUNCTION IF EXISTS public.client_cancel_appointment(uuid);` then `CREATE OR REPLACE` with the UPDATE extended.
   - REVOKE/GRANT clauses unchanged.
3. Apply via `supabase db push` (no Docker — memory note "No local Docker"). Fall back to SQL Editor block if push is unavailable in this session.
4. `npm run gen:types` — regen `src/types/database.ts` to surface the new columns + the unchanged RPC signatures.

### F-5 Phase 2 — Code changes (parallel-safe)
1. Staff actions — explicit `created_by_role: 'staff'` and `cancelled_by_role: 'staff'`.
2. Portal `/book` page — extend SELECT, replace inside-24h Link with static copy.
3. Settings — placeholder string only (per Q5).
4. Staff schedule SELECT — add columns.
5. WeekView — type extension, AppointmentBlock brand-mark + cancellation visual + suffix, popover card suffix.

### F-5 Phase 3 — Verification
End-to-end manual flow on the existing dev server at `:3000` (memory note "Use port-3000 dev server only"):
- EP fills in the new phone field via `/settings` → confirm it saves and reloads with the value.
- Test client books a session via `/portal/book/new` → appears on staff `/schedule` with the Odyssey mark.
- Test client cancels >24h away → appears red on staff schedule with `Scott Browning · App Cancellation`.
- Test client tries to cancel within 24h, no phone set → cancel button hidden; copy reads `"Please call the practice to cancel this session as it is within 24 hours."`
- Test client tries to cancel within 24h, phone set → copy reads `"Please call the practice on (07) 1234 5678 to cancel this session as it is within 24 hours."`
- Staff cancels via `/schedule` → appears red without the suffix.
- Staff books a new appointment → appears normally without the Odyssey mark.

---

## 4. Acceptance bar

The phase is signed off when ALL of the following pass:

- [ ] `supabase db push` lands the migration cleanly; types regenerate; `npx tsc --noEmit` clean.
- [ ] `INSERT INTO appointments` without specifying `created_by_role` defaults to `'staff'` (verified via SQL Editor).
- [ ] `created_by_role IN ('staff','client_portal','system')` constraint blocks any other value (verified via SQL Editor with a deliberate bad value).
- [ ] As test client, book a session via `/portal/book/new` → row in `appointments` has `created_by_role = 'client_portal'`, `cancelled_by_role = NULL`.
- [ ] As staff, create a session via `/schedule` composer → row has `created_by_role = 'staff'`, `cancelled_by_role = NULL`.
- [ ] As test client, cancel an outside-24h booking → row has `cancelled_by_role = 'client_portal'`.
- [ ] As staff, cancel a confirmed appointment → row has `cancelled_by_role = 'staff'`.
- [ ] On `/schedule`, the app-booked appointment renders with the Odyssey mark in the bottom-right of the block; the staff-booked one does not.
- [ ] On `/schedule`, the cancelled-by-client appointment renders with red 3px left-border, light pink bg (.05), 0.72 opacity content, and `Scott Browning · App Cancellation` suffix in the card body.
- [ ] On `/schedule`, the cancelled-by-staff appointment renders with the same red treatment but no suffix.
- [ ] Inside-24h copy renders correctly in both states (phone NULL / phone set). No link, no icon, no `→`.
- [ ] EP saves a phone via Settings → it round-trips (page reload preserves the value).
- [ ] Field-lockdown trigger still raises on a client trying to change `start_at` directly (existing behaviour preserved).
- [ ] Client cannot set `cancelled_by_role` to anything other than via the cancel RPC, AND cannot set it without also flipping status to cancelled (verified via direct PostgREST PATCH that omits status).
- [ ] Audit log row for the cancel UPDATE includes `cancelled_by_role` in `changed_fields` (no special handling needed; `audit_appointments` already snapshots all columns).
- [ ] No regression on the existing CancelButton component on `/portal/book` — outside-24h cancel still works end-to-end.

---

## 5. Open questions (need sign-off before code lands)

These are surfaced in §0.2 — repeated here in long form for the user to react to.

**Q1 — Cancellation tint: keep .22 or change to .05?**
The current treatment ([`WeekView.tsx:2559-2576`](../../src/app/(staff)/schedule/_components/WeekView.tsx)) gives cancelled blocks a substantial pink fill (`.22`). The prompt's spec says `.05` — barely more than white, with the 3px red border doing the visual work. .22 reads as "alert"; .05 reads as "softly past tense". Since cancelled appointments stay on the schedule (they're not deleted), .05 is the better long-term posture — they should fade into the background, not compete with active bookings. The 3px border still surfaces the cancellation when the EP looks for it.

If you want both: I could keep .22 for `no_show` (which IS a "this needs your attention" flag) and switch to .05 for `cancelled` only (which is "fyi, was on the books, isn't now"). That's my recommendation either way.

**Q2 — Cancelled text: opacity vs strikethrough?**
Opacity 0.72 on the block content. Strikethrough on the time only would create a focal point ("look at this struck-out time") which is the opposite of what we want — cancellations should be calm. Block-wide opacity says "this is dimmed because it didn't happen" which is the right read.

**Q3 — Defensive trigger hardening for the new columns.**
The trigger today is a deny-list. Adding `cancelled_by_role` and `created_by_role` to the lockdown logic AND adding a "may only be set when status is also flipping" guard for `cancelled_by_role` is small (one extra IF chain) and prevents a class of bugs we don't have today but easily could. No downside; high upside.

**Q4 — `"Phone"` vs `"Practice phone"` field label.**
"Phone" is fine. The form section frames the context.

**Q5 — Phone placeholder.**
`"e.g. (07) 1234 5678"`. Establishes the format hint without forcing it.

---

## 6. Deferred follow-ups

Not blocking this phase. Captured here so they don't get lost.

- **F5-1 — Phone format validation.** None today (deliberate — different practices use different conventions). If real-world usage shows messy entries, add a soft regex helper that flags but doesn't block on save. Out of scope.
- **F5-2 — Click-to-call `tel:` link in the inside-24h message.** Phone is currently rendered as plain text. A `tel:+617123456` link would dial directly on iOS/Android, which is the medium most clients are on. Trivially small; deferred only because format-validation is a prerequisite (for the `tel:` URL to be canonical, the stored value should be normalised). Two-step: first land the field as free-text, then add normalisation + `tel:` linking together.
- **F5-3 — Client-portal cancellation count widget on the EP dashboard.** "3 client-side cancellations this week" panel — uses the new `cancelled_by_role` column. Useful for spotting a pattern (e.g., a client cancelling repeatedly inside their habit window). Phase 8 (EP Dashboard polish) territory.
- **F5-4 — Re-attribute existing cancelled rows.** Currently NULL on `cancelled_by_role` for pre-existing cancelled rows. Pre-launch so the data isn't real, but if any test rows persist past launch they'll be visually indistinguishable from "we don't know who cancelled this". Would need an admin UI to set the field — out of scope; the alternative is "delete the test data before launch".
- **F5-5 — `system` role usage.** `'system'` is in the CHECK enum but not yet used. Reserved for future "EP cancelled this from a script / batch operation / no-show auto-marker" type writes. No-op for now.
- **F5-6 — `cancelled_by_user_id` column.** Could record which specific staff user cancelled (useful in a multi-staff org). The `audit_log` already captures `actor_user_id`, so this is duplicate; deferred unless dashboard widgets need cheap lookups.
- **F5-7 — "App Cancellation" copy alternatives.** E.g., "Cancelled in app", "Self-cancelled", "Client cancellation". Title-case "App Cancellation" matches the brand surface naming and is intentionally short. If real-world feedback says it's confusing, revisit.

---

## 7. Files this phase will touch (preview)

**New files:**
- `supabase/migrations/20260513130000_appointment_actor_columns.sql` — column adds + trigger update + both RPC re-creates. One file (not three) — they all land or roll back together; same approach as the availability-editor sub-pass landed all the audit/constraint work in one migration.

**Edited files:**
- `src/app/(staff)/schedule/actions.ts` — `createAppointmentAction` INSERT explicit `created_by_role`; `cancelAppointmentAction` UPDATE explicit `cancelled_by_role`.
- `src/app/(staff)/schedule/page.tsx` — SELECT extended with the two new columns; mapping passes them through.
- `src/app/(staff)/schedule/_components/WeekView.tsx` — `Appointment` type extension; AppointmentBlock brand mark; cancelled-block visual treatment branch; client-name suffix; popover card client-name suffix.
- `src/app/portal/book/page.tsx` — SELECT extended with `phone`; inside-24h CTA replaced with static `<p>`.
- `src/app/(staff)/settings/_components/PracticeInfoForm.tsx` — phone field gains `placeholder`.
- `src/types/database.ts` — regenerated.

**Files explicitly NOT touched:**
- `src/app/portal/book/actions.ts` — RPC call unchanged; the RPC body change is invisible to the action.
- `src/app/portal/book/new/actions.ts` — same; the RPC body change picks up `created_by_role: 'client_portal'` automatically.
- `src/app/portal/book/_components/CancelButton.tsx` — no change; still only renders outside the 24h window.
- `src/app/(staff)/settings/actions.ts` — already writes phone (§1.3).
- All RLS policies on `appointments` — existing posture is correct.
- BottomNav, the session builder, anything in `src/app/portal/_components/` — out of scope.

---

## 8. Cross-references

- Brief: handoff prompt 2026-05-13.
- Phase F gap doc: [`docs/polish/client-portal-booking.md`](./client-portal-booking.md) — §0.1 L2 (cancellation window CTA) is being amended; §5 Q7 (no actor columns) is being reversed.
- Adjacent phase context: [`docs/polish/availability-editor.md`](./availability-editor.md) — same migration cadence pattern (single migration combining ALTER + trigger + RPC re-create).
- Memory notes consulted:
  - "Schema/migration/push correctness" — migration → push → type regen → verify before declaring done.
  - "No local Docker — work against live Supabase" — `supabase db push` against remote; SQL Editor fallback.
  - "Audit register new tables" — both `appointments` and `organizations` are already in `audit_resolve_org_id`. No register migration needed.
  - "plpgsql function arity evolution" — DROP FUNCTION before CREATE OR REPLACE, defensive even when arity is unchanged.
  - "Supabase migration timestamp collision is silent" — `20260513130000` is unused as of this audit (verified against `ls supabase/migrations/ | sort | tail -15` — most recent is `20260513120000_client_start_session_v3.sql`).
  - "Use port-3000 dev server only" — verification uses the existing dev server.
  - "Calendar stays pristine — completions live on the profile" — this phase touches the staff `/schedule`, NOT the per-client `/clients/[id]/program` calendar. The pristine-calendar invariant is unaffected.
