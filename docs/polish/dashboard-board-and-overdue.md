# Polish doc — dashboard: cancelled on the board, recent-activity colour, overdue follow-up

**Status: IMPLEMENTED 2026-06-25; acceptance verified 2026-06-26 (operator render-pass + pgTAP `46` + threshold proof) — CLOSED 2026-06-26 (reviewer: claude.ai project chat; Approved — see Sign-off).** Three dashboard
dogfooding captures, batched. Items 1–2 are contained fixes inside the
already-signed-off dashboard surface; item 3 touches the schema (one nullable
column) so it re-enters the polish protocol per CLAUDE.md "Current operating
mode". The **Closing commit** at the bottom is for the claude.ai review chat if
the owner wants the sign-off ritual on item 3.

Captures (2026-06-25, operator):
1. *"A cancelled appointment should show up on the session board, but obviously
   say that it has been cancelled — like when a session has been completed or a
   no-show."*
2. *"Add some colour to the recent activity drop down, it is quite bland."*
3. *"For sessions not being completed, if they never complete it, you cannot
   mark it off. There should be a button … 'program checked and message sent' …
   to have it go off the screen and then the timer resets."*

Clarifications (asked + answered 2026-06-25):
- **#3 surface** = the **Overdue** item in Needs-attention (not Today's board).
  The "timer" = the overdue counter ("Last session N days ago").
- **#3 reset** = **reset the clock (~10 days)** — re-surfaces only if still
  silent after the normal cadence; *not* "hide until they log again".
- **#3 button** = **acknowledgement only** (records "I checked the program +
  messaged them"); it does **not** send a message. Owner rationale: "just an
  action complete button … there is currently no way of removing it" — Ending /
  New self-clear when the EP drafts a program, Overdue has no natural exit.
- **#2 colour** = **meaningful, kept restrained** — colour carries information,
  stays inside the clinical-tool brand.

## Triage
| # | Bucket | Why |
|---|---|---|
| 1 | Bug-ish / UX | Cancelled slots silently vanished from the board; the EP had no signal the slot ever existed. Contained — within the signed-off dashboard surface. |
| 2 | UX papercut | Fails no hard design line, but the panel had **zero** colour (only avatar tones). On-brand fix uses *sanctioned* green (completion) + meaningful clinical colour (RPE). |
| 3 | Structural | Needs a stored acknowledgement → 1 nullable column on `clients`. Re-enters the polish protocol. |

## #3 — audit + security (the structural one)
- **Precedent:** `clinical_notes.flag_reviewed_at` + `markClinicalFlagReviewedAction`
  — the flag "Mark reviewed" 14-day snooze. #3 is the same shape for Overdue.
- **Column:** `clients.overdue_followed_up_at timestamptz` (nullable, additive,
  no backfill). Migration `20260625140000`.
- **Security:** written through the existing **"staff update clients in own org"**
  RLS UPDATE policy (role-scoped: owner/staff, own org). Clients/portal have
  **no** UPDATE policy on `clients` → cannot write it. No *new* security surface,
  but that inherited denial was **previously untested**: `17_cross_tenant_isolation`
  proved only the org predicate (staff-in-wrong-org → 0 rows), never the role
  predicate. Item 3 adds pgTAP `46_clients_update_role_anon_denial` — a
  client-role UPDATE and an anon UPDATE of `clients` each asserted to affect 0
  rows, with a staff-can-update control.
- **Suppression logic** (`buildAttentionList`): an acknowledgement within the
  overdue cadence (`overdue_followed_up_at >= tenDaysAgo`) suppresses the Overdue
  trigger. After ~10 days it re-fires with the *real* "Last session N days ago"
  figure — honest, not hidden.
- **Side effect (accepted, not mitigated):** the `clients_bump_version`
  BEFORE-UPDATE trigger bumps `version` + `updated_at` on the stamp. At f&f scale
  (one EP) the OCC-collision window with a concurrently-open client edit form is
  negligible; the flag-review precedent has the same property.

## What changed
- **#1** `dashboard/page.tsx`: dropped `.neq('status','cancelled')` from today's
  query; the stat count + next-session cue now filter to live rows
  (`activeToday`) so a cancelled slot doesn't inflate "Sessions today".
  `bookingStatus()` gains `cancelled` → a new neutral-grey `.tag.cancelled` pill
  (`globals.css`). Cancelled rows render struck-through + muted with no
  Now/Done/Upcoming cue.
- **#2** `RecentlyCompletedPanel.tsx`: a green completion check per row
  (sanctioned structural green — each row *is* a completed session); RPE ≥ 8
  rendered as the amber `.tag.overdue` pill (legible dark-amber on light-amber;
  bright `--color-warning` text fails contrast on white) — colour = clinical
  signal, not decoration.
- **#3** new `clients.overdue_followed_up_at`; new
  `acknowledgeOverdueFollowupAction` (`dashboard/actions.ts`); new
  `OverdueFollowUpButton` client component; the `buildAttentionList` suppression
  clause; the Overdue row gets the button **plus** an "Open" link pointed at the
  program calendar (`/clients/[id]/program`) so the EP can check the program
  first (the client-name link still opens the profile).

## Pass criteria (Maintenance rule)
All boxes verified 2026-06-26 (render = operator pass on the live `:3000`
dashboard; pgTAP 46 = green on prod; threshold = date-math proof; code = diff
inspection).

**#1 — cancelled on the board**
- [x] An appointment with `status='cancelled'` dated today **appears** on Today's
      sessions: struck-through + muted, grey "Cancelled" pill, **no**
      Now/Done/Upcoming cue. — render (Imaan Sedghi 2:00pm)
- [x] The "Sessions today" stat and the "Next: …" cue **exclude** that cancelled
      slot. — render ("3 sessions today" omitted the cancelled 2pm)
- [x] A non-cancelled appointment is unchanged (pill + live cue as before). — render

**#2 — recent-activity colour**
- [x] Each completed row shows a green completion check beside the timestamp. — render
- [x] A completion with `session_rpe >= 8` shows an amber "RPE n" pill; `< 8`
      stays neutral text; no RPE → no badge. — render
- [x] No new shadows/gradients; restraint holds (visual). — code (only a Lucide
      check + reused `.tag.overdue`) + render

**#3 — overdue follow-up**
- [x] An Overdue client shows an "Open" link (→ program calendar) **and** the
      "Program checked & message sent" button; the name still links to the
      profile. — render (Antonio)
- [x] Clicking it removes the client from Needs-attention on the next render. — render (clicked Antonio, dropped off)
- [x] The same client does **not** re-appear as Overdue for ~10 days, then
      **does** re-appear (with the real "Last session N days ago") if still
      silent. — threshold proof (suppressed through ack-date+10, re-fires from +11;
      `>=` midnight practice-tz boundary) + render (ack -9d off, -11d re-appears)
- [x] Logging a session in the meantime clears it the normal way (unaffected). —
      unchanged base Overdue path (a recent last-completed fails the `< tenDaysAgo`
      test, independent of the ack gate)
- [x] A client/portal token cannot write `overdue_followed_up_at` (RLS) — backed by pgTAP `46_clients_update_role_anon_denial`. — green on prod

## Acceptance / verification run (2026-06-25; pgTAP + threshold + render-pass 2026-06-26)
- `npm run type-check` — **pass** (clean).
- `npm run build` — **pass** (exit 0; `/dashboard` compiles; server/client action
  boundary for `OverdueFollowUpButton` → `acknowledgeOverdueFollowupAction` OK).
- Migration `20260625140000` applied to the linked DB (`supabase db push`); types
  regenerated (`npm run supabase:types`); `overdue_followed_up_at` present in
  `src/types/database.ts`.
- **pgTAP `46_clients_update_role_anon_denial`** — green on prod via BEGIN/ROLLBACK
  (client-role UPDATE 0 rows, anon UPDATE 0 rows, staff control 1 row).
- **Suppression firing threshold — 10 days, proven.** Ran the real `dates.ts` math
  against the predicate: an ack on practice-tz date D suppresses Overdue through
  D+10 and re-fires from D+11 (boundary `overdue_followed_up_at >= midnight(today-10,
  practice tz)`, inclusive). Same cadence as the base trigger, so a fresh ack resets
  one full window.
- **Operator render-pass (live `:3000`, 2026-06-26) — all green.** #1 cancelled row
  (struck-through, grey pill, excluded from the count); #2 green completion check +
  amber RPE pill; #3 Open+button, click-removes (Antonio dropped off), and the
  re-fire boundary exercised against the real dashboard (ack -9 days suppressed,
  -11 days re-appears).

---

## Closing commit (for the sign-off ritual — item 3)
**What changed (by capture):** #1 cancelled appointments now render on the
dashboard board (neutral struck-through "Cancelled" pill; excluded from the live
stat/next-session counts). #2 the Recently-completed panel gained meaningful,
restrained colour (sanctioned completion-green check per row; amber RPE pill for
hard sessions ≥ 8). #3 added an "action complete" exit for Overdue clients
(`clients.overdue_followed_up_at`, `acknowledgeOverdueFollowupAction`,
`OverdueFollowUpButton`) that resets the overdue clock ~10 days — the manual
clear Overdue lacked (Ending/New self-clear, Overdue did not).

**Tests:** `type-check` pass; `build` pass (exit 0); migration applied + types
regenerated. Pass criteria above are written; live render verification is
operator-side (auth wall).

**Added / accepted:** #3 adds pgTAP `46_clients_update_role_anon_denial`, closing
the previously-untested clients-UPDATE denial for the client and anon roles — the
suite had proved only the staff-wrong-org org-isolation case
(`17_cross_tenant_isolation`), never the role/anon predicate of the same policy.
`version` / `updated_at` bump on the stamp accepted at f&f scale (matches the
flag-review precedent). Today's-board inline action for incomplete sessions was
**not** built — #3 was scoped to the Overdue attention item per the owner's
clarification.

**Premortem modes mitigated:** cancelled slot inflating the live count (filtered
via `activeToday`); RPE colour contrast (reused the legible amber tag, not bright
warning text); overdue item never re-surfacing after ack (clock-reset model, not
hide-until-logged). **Accepted:** OCC version bump on ack.

---

## Sign-off
- **Date signed off:** 2026-06-26
- **Reviewer:** claude.ai project chat (challenger role)
- **Decision:** Approved — **CLOSED**

Evidence basis (reviewer): the `clients.overdue_followed_up_at` acknowledgement
path is closed end-to-end — pgTAP 46 green on prod (client-role 0 rows, anon 0
rows, staff control 1 row, confirming the denials are role/anon-driven, not a
locked fixture); the suppression mechanic proven (ack on date D suppresses through
D+10, re-fires from D+11, inclusive boundary, verified against `dates.ts` and the
live -9d/-11d render); the operator render-pass green for all three captures. The
turn-one waiver that claimed non-existent clients-UPDATE coverage is resolved, with
pgTAP 46 as the named proof.

**Conditions on the stamp** (standing platform liabilities, *not* item-3 defects;
neither blocks closure):
1. Anon-out-of-`clients` tightening remains parked — pgTAP 46 proves anon is denied
   by RLS today (acceptable default-grant posture), but not the intended end state
   before identifiable client health data enters. Tracked: `go-live-checklist.md` §4b.
2. No non-prod test target — pgTAP 46 ran against prod under `BEGIN/ROLLBACK` as the
   sole safety net. Tracked: `go-live-checklist.md` §5.
