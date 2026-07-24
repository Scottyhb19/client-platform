# Odyssey — Build Project

## How you work on this project
You are the lead engineer and design partner. You think like Steve Jobs: every screen must justify its existence, every interaction must feel effortless, and complexity must be hidden behind simplicity. Simplicity is sophistication.

Be a kind but ruthless mentor. Challenge assumptions, stress test everything, and never be validating just to appease. If something is wrong, say so directly and explain why. When you make a decision, explain the trade-off — what you chose, what you rejected, and why. This is a learning project — teach as you build.

When something breaks, diagnose the root cause, don't just patch the symptom. Explain what went wrong so it doesn't happen again. Never install packages without explaining what they do. Never create files without explaining where they fit in the architecture. Never skip error handling. Never build features that aren't in the brief without asking first.

## What this is
**Odyssey** is a unified Exercise Physiology practice management platform combining clinical case management (replacing Cliniko) with exercise programming (replacing TrainHeroic). Built for a solo EP practitioner in Australia with an architecture that scales to multi-practitioner.

**Scope (2026-05-18):** Personal tool plus one trusted EP collaborator — a friends-and-family beta. No paying clinical client is routed through this system; the existing 40–50 clinical clients stay on Cliniko. **The long-term destination was committed 2026-07-21 — see "Product roadmap (locked 2026-07-21)" below.** The architecture stays multi-tenant and multi-practitioner-ready.

## Product roadmap (locked 2026-07-21)

The three-way fork ("joint clinic tool / SaaS / permanent personal tool") is resolved: the destination is SaaS, reached in four gate-sequenced steps. Steps are gates, not dates — each opens only when its named gates close.

1. **Own practice on Odyssey.** The operator's own paying clinical clients migrate off Cliniko; Odyssey becomes their primary clinical record. **Gated by the hard rule** (see Open gates). This step also fires every paying-client-gated item indexed in `docs/go-live-checklist.md` §8 (DB write-immutability triggers, G-6 auth audit log, PITR, invite-at-POST, Safe Links re-run, §12 Part B Comms tab, pen-test decision) plus the Cliniko data migration itself — budget it as its own project, not a switch-flip.
2. **Solo EP/practitioner SaaS.** Sell Odyssey to other solo EPs, with **add-a-colleague** (staff-invite-into-shared-org — the build queued next) so a growing solo practice adds practitioners without re-platforming. Step-2 prerequisites beyond step 1: environment separation (the work-against-live-prod-DB dev workflow ends before any other EP's client data enters), subscription billing (a conscious amendment to "What NOT to build" — practitioner billing, still no client payment processing), ToS/privacy/data-processing terms (customer EP = record holder, operator = platform), Pty Ltd + insurance review completed. **The stranger-validation gate.** Step 2 does not open until there is evidence of willingness to pay from exercise physiologists with no prior personal relationship to the operator. Friends and family paying does not satisfy it — the standing warning that friends pay for the relationship, not the product ("The financial number is a readiness note", Open gates) is the reason this gate exists. No specific number is set here: the threshold is set before step-2 planning begins, and setting it is itself a required step. The gate binds in kind now and in magnitude later.
3. **Clinic SaaS.** Multi-practitioner UI for private clinics (currently architect-only, per "What NOT to build"). Distant milestone; do not build toward it beyond what multi-tenancy already provides.
4. **AI integration (Phase 2).** Gated as Open gates and the Phase 2 note specify (see those sections — the roadmap tracks them, it does not restate them). AI features stay off until that gate closes, regardless of which earlier step the business has reached.

**Entity:** Sole trader (accountant-advised 2026-05-17). Conversion to a Pty Ltd company is a future option, gated on whether paying clients ever enter the picture (see Open gates).

Two surfaces:
- **Staff platform** — desktop-first. Dashboard, client list and profile, program calendar, session builder (the core differentiator), exercise library, schedule, settings.
- **Client portal** — mobile-first PWA. Program week strip, session card preview, guided in-session logging (sets × reps × weight × RPE), bookings, reports.

## Project state

**Latest (2026-07-23) — the friends-and-family beta is OPEN and the paying-client technical runway is CLEAR.** The Beta-entry hardening gate closed 2026-07-21 (Supabase Pro cutover: DR drill, HIBP, G-4 time-box; environment separation operative; staging seeded). Real f&f users have been live since 2026-06-10. On 2026-07-23 a **paying-client parity pass** then ran (operator directive: "complete parity for paying clients bar the external reviewing process; do not spend money"): it closed **every buildable paying-client-gated item** in `docs/go-live-checklist.md` §8 — the G-6 auth-audit register (F-4 TRUNCATE revoke, F-2 client-IP capture + the auth.md §11 alerting Edge Function, F-1 org snapshot, B-4 captureException routing), the §12 unbounded-resend latent, the completed-session RPC-only-unassign hard gate, the CN-7 archived-record residuals (FM-8 in-app message + attachment history producible on the archived profile; P2-3 archived-portal closed-door end-state), G-15 staff deep-link survival, the origin-idiom/Flag E consolidation, clinical_notes client-deny test coverage, and the R-4 request-path cross-tenant probe. All four sign-off reviews are recorded Closed in their owning polish docs (commits `944ca62`–`c7fa930`); the reviews themselves hardened four more things (alert sampling 4×/hour, unassign GUC disarm + cross-org negative test, attachment rows in the archived transcript, platform-attested `x-vercel-forwarded-for` client-IP provenance + constant-time EF bearer compare). Eight parity migrations `20260723120000`–`20260723190000` are applied on **both staging and prod**; prod health `200 db:ok config:ok`; full pgTAP suite green on staging; e2e harness green.

**What that leaves open at the paying-client threshold is EXACTLY the exclusions register** (`go-live-checklist.md` §8 "exclusions register" + the status header): nothing buildable remains. The remaining gates are **(a) external** — the hard-rule IT security review, the Anthropic BAA, the entity/Pty-Ltd review, the pen test, and the M365/enterprise Safe Links re-run (needs a mailbox that doesn't exist here); **(b) money** — PITR + the S3-export/monthly-drill backup posture, and the pen test; and **(c) at-onboarding operator actions, neither external nor money** — the client session-duration decision (a shared-device dashboard call made once real device profiles are known) and the Cliniko data migration itself (its own project, needs the operator's Cliniko export). The §12 connected-account email *compose* feature remains a deliberate owner-deferred *feature* (not a gate), and the standing tripwires (staging-to-prod parity drift, the GUC-boundary residual, R-4 re-run on any JWT-hook change, the npm-audit re-trigger) fire on events — they are not open work. **Net: the next material movement on the paying-client threshold is the operator engaging an external reviewer; no internal build blocks it.**

**Phase 1 is functionally complete and the polish pass is complete.** All 14 steps from the original build order have working code in the repo, and all 12 locked polish sections are closed. The platform is operational. It is now **in the friends-and-family beta** — real friends-and-family users with real health data are in the system (since 2026-06-10). The **Beta-entry hardening gate** below is CLOSED (2026-07-21); it is retained as the record of what that gate required.

**Launch shape: friends-and-family beta only.** When this opens, it opens to the operator, one trusted EP collaborator, and a small friends-and-family circle — never to paying clinical clients, and never as anyone's primary clinical record system. The existing 40–50 clinical clients remain on Cliniko. The hard rule, and the only conditions under which this can ever change, are in Open gates below.

**Current mode: Phase 1.5 dogfooding loop** (see "Current operating mode" below). The polish pass elevated each surface from "working" to "superior"; real use now drives what changes next. The polish-pass protocol and sign-off ritual are **not retired** — they remain the canonical method for any structural rework (new surface, schema change, new security surface). They are just no longer the day-to-day driver.

**Pre-launch advantages — use them while they last:**
- Schema migrations are cheap (no production data to migrate).
- RLS policy changes are reversible without coordination.
- Breaking API changes don't break clients.
- Acceptance tests can be re-run end-to-end without consequence.

These advantages disappear the day the first real user — including a friends-and-family beta tester — logs in and creates data. Anything load-bearing should be hardened *before* that day.

## Beta-entry hardening gate (must be true before the first real f&f user logs in)
A friends-and-family beta tester is a real user with real health data. "Friends and family" lowers the *social* stakes and the *validation* value — it does **not** lower the *legal or technical* floor. A friend's leaked injury history is a notifiable breach the same as a stranger's. These items are not deferrable to the go-live pipeline; they gate the beta itself:

- **Rotate the secrets that appeared in a chat transcript** — `SERVICE_ROLE_KEY`, `ANON_KEY`, `RESEND_API_KEY`, `CRON_SHARED_SECRET`. **DONE — closed 2026-07-02.** `RESEND_API_KEY` + `CRON_SHARED_SECRET` were rotated 2026-05-17; the highest-priority `SERVICE_ROLE_KEY` was neutralised 2026-07-02 by migrating the app + reminder worker onto the new `sb_secret`/`sb_publishable` API keys and **disabling the legacy JWT-based keys** — the gateway now rejects the leaked key. (Supabase removed legacy-key rotation, so this was the only path; `ANON_KEY`→`sb_publishable` came along because the single disable toggle covers both legacy keys.) Verified in production: private-window login + reminder-worker send, both with legacy disabled. Recorded in `docs/secrets-rotation-log.md` (2026-07-02 entry), `docs/secrets-inventory.md`, and `runbooks/rotate-a-secret.md`. *(This was the one item not waivable by convenience — now satisfied.)*
- **R-4 cross-tenant isolation verified manually** before the first real f&f user, or at second-account creation at the latest. **DONE.** Manually verified 2026-06-07 (two ephemeral orgs; read + write isolation across the eight core tenant tables). The automated pgTAP test `supabase/tests/database/17_cross_tenant_isolation.sql` **has since landed** — it did *not* stay deferred — and is now the per-migration tripwire; re-run green 8/8 on 2026-07-02 after the API-key migration. Log: `runbooks/verify-cross-tenant-isolation.md`.
- **A backup restore actually exercised once** — not "PITR is available on the plan," but a restore proven on a scratch project, documented in `docs/disaster-recovery.md`, even at f&f scale. **DONE — closed 2026-07-21.** The Supabase Pro upgrade landed and the first DR drill ran the same sitting: restore to a scratch project from a Pro daily backup, row census matched production (RLS policies intact), real-content spot-check passed, scratch torn down. Logged in `docs/disaster-recovery.md` (run log). Because real f&f users had logged in from 2026-06-10 while the drill was plan-blocked, the ~41-day gap is recorded as an exposure window in `docs/incident-response.md` §10 per the rule below — recorded, not waved. Backup posture: Pro daily backups (7-day retention); PITR deliberately deferred to the paying-client gate (`docs/slos.md` §2.2). **With this, all four Beta-entry hardening gate items are closed — the gate is CLOSED (2026-07-21).**
- The remaining technical pre-beta riders indexed in `docs/go-live-checklist.md` either closed or consciously accepted with a recorded re-trigger. **DONE — both named riders closed:** the post-deploy compat-shim removal closed 2026-06-14 (checklist §8), and the `client_accept_invite` anon-EXECUTE verification closed 2026-07-02 — verified never-called-pre-auth (sole caller is the post-session `/welcome` action), then anon revoked in migration `20260702130000`, pgTAP `52` tripwire; the same migration discharged the whole §4 candidate bucket (checklist §4 gate now CLOSED). The same-day pass also closed the §8 CN-6 now-active item (`client_medical_history` OCC version column, migration `20260702120000`, pgTAP `51`).

If a real f&f user has *already* logged in and any of the above is not yet done, that is not a reason to skip it — it is a reason to do it now and record the exposure window in `docs/incident-response.md`.

## Environment separation

Three rules govern every database touch:

1. **Staging (`odyssey-staging`) is the default target for all database work** — migrations, queries, pgTAP, and the local dev server.
2. **Production is touched only on explicit instruction from the operator in that session** — never for exploratory or diagnostic work.
3. **Before any database operation, state which environment is being targeted and how that target was resolved** (which file, flag, or config decided it), so the operator always knows where the work is landing without asking.

**Operative (2026-07-21).** The defaults match the rules. The app (`.env.local` default keys), the CLI (linked project ref in `supabase/.temp/project-ref`), type generation (`scripts/gen-types.mjs`, which resolves the linked ref and prints its target), and the pgTAP runner all resolve to **staging**. Production is reached only through explicit opt-in channels — the `PROD_*` keys in `.env.local`, the `--prod` flag on the verify scripts, and the prod workdir channel for CLI/pgTAP — all documented in `runbooks/use-the-staging-project.md`. Staging carries **synthetic data only** (`scripts/seed-staging.mjs`: two orgs mirroring production's org names so org-targeting scripts run unchanged; every client, note, and program is fake; every seeded email address is a `@resend.dev` sink). The deployed Vercel app carries its own production env and is unaffected by any of this. Historical record: until 2026-07-21 the defaults resolved to production and production data routinely entered development sessions — including a same-day census that returned real client names and emails; that practice ended with this flip.

## Current operating mode — Phase 1.5 dogfooding loop
The Phase-1 polish pass is complete (all 12 locked sections closed; the sign-off log is in "Active section" below). The platform is functionally operational and works well. The mode is no longer "polish a section toward a bar in the abstract" — it is **use the tool for real work and let real use drive the next changes.** Changes flow from friction encountered in actual use, not from a pre-planned section order.

This mode has its own failure modes and its own loop. The discipline that governed the polish pass — ruthlessness, scope control, evidence before assertion — does not relax here; it just points at a different target.

**The dogfooding loop:**
1. **Capture, don't fix mid-session.** Friction noticed while using the tool gets dumped to the **Notion capture board** in one line — not diagnosed, not solved, not context-switched into. The operator will not stop mid-consult to write a bug report; the discipline is a five-second capture, nothing more. Notion is the canonical capture surface when code cannot be run. Anything not captured is lost — the capture habit *is* the system.
2. **Triage in a batch, with the old ruthlessness.** Back at the code, each captured item is sorted into exactly one of four buckets:
   - **Bug** — does the wrong thing. Fix it; it ships with a regression test (see Maintenance rule).
   - **UX papercut** — works, but the workflow drags. Fix only if it fails a stated design-philosophy line (60-second adjustment; zero-instruction client; progressive disclosure). Name the line it fails. "Feels off" without a named line is a feature-wish, not a papercut.
   - **Feature-wish** — "wouldn't it be nice." **Logged, not built.** Goes to `docs/deferred-prompts.md` with the friction that motivated it. Real use generates a flood of these; the flood is exactly what this gate exists to hold back. A wish is not a mandate.
   - **Scope-creep** — outside the brief. Refused, or escalated to an explicit brief amendment — never silently absorbed. Same rule as the polish pass: no opportunistic changes.
3. **Anything structural re-enters the polish protocol.** A capture that turns out to need a new surface, a schema change, or a new security surface is not a quick fix — it runs the full seven-step polish-pass protocol and the sign-off ritual, exactly as a section did. The four-bucket loop above is only for changes *within* the existing, signed-off surfaces.

**Maintenance rule (carried from `test_scenarios_template.md`).** Every new behaviour — bug fix or feature — adds or updates a scenario in `test_scenarios_template.md` *before* it is considered done. A behaviour without a written pass criterion is untested, and untested behaviour does not ship. This is the polish protocol's step 7 generalised to the post-polish world.

The **handover pattern is unchanged**: this chat reasons and produces verbatim BEGIN/END prompt blocks; Claude Code stages by explicit path, shows full diffs, commits one "go" per commit; the operator runs the actual `git commit`.

## Active section
**No section is in active polish — the Phase-1 polish pass is COMPLETE (all 12 locked polish-order sections are closed). Email and SMS (section 12) — Closed with deferred items 2026-06-22** under the section sign-off ritual (reviewer: claude.ai project chat / challenger role; Decision: Closed with deferred items; Closing commit + Sign-off in `docs/polish/email-and-sms.md`; merged to master + deployed to production — Vercel new-build operator-confirmed green and the reminder Edge Function send-verified). As the final section of the locked order, its close **completes the Phase-1 polish pass.** The operator **split** the section: **Part A** (polish needing no new surface) shipped; **Part B** (the connected-account email *compose* feature + the client-profile **Comms tab** + system-send log-wiring) was **deferred to the go-live pipeline** as an owner scope decision (indexed in `docs/go-live-checklist.md` §8). Part A delivered: **P1-3** send-failure observability (booking-confirmation portal+staff + invite send errors, previously *discarded* silently, now `captureException`'d at source — honest scope: the helper is still the `console.error`/Sentry-seam stub, so this is **ops/log-observable, not EP-facing**; EP-facing surfacing of a failed send rides with Part B's Comms tab); **P2-1** template tone + branding (the "24 hours before" hard-code → lead-agnostic; all four client/EP-facing email headings moved off the Georgia serif onto the logo's `'Helvetica Neue'` sans; the booking footer's "reply to this email" → "open the portal" because inbound to the sending address is not yet received); **P2-3** dropped the non-existent "program updates" from the email-notifications toggle; **P2-2** verified the SMS toggle honest — **SMS stays stubbed-and-wired but NOT activated** for the friends-and-family beta per Open gates (unchanged). **Migration-free, no new security surface → no new pgTAP gate** (consistent with the security-surface-only rule). The reviewer's pre-sign-off catches (FM-6 double-claim → P1-3 closes FM-5 only; FM-5/FM-14 honestly relabelled "partially closed"; deploy-status split into merged / Vercel-confirmed / EF-send-verified; the WHAT-CHANGED-P1-3 wording synced to the `console.error`-stub disclosure) were all resolved before the stamp. **EP Dashboard (section 11) — Closed 2026-06-22** under the section sign-off ritual (reviewer: claude.ai project chat; Decision: Approved/Closed; Closing commit + reviewer follow-up + Sign-off in `docs/polish/ep-dashboard.md` §6/§7/§8; merged to master `0ee8d15`→`4a03564` + deployed, prod green). It delivered the brief §6.8 clinical-briefing scope across 1 P0, 2 P1, and the P2 tail: the **practice-tz "today" foundation** (P0-1 — the one correctness-critical change, proven on the live UTC server, which localhost ≈ Sydney masks), the **four needs-attention triggers** (Flag / Overdue / Ending / New) deduped per client with **per-trigger action routing** (Ending→program calendar, New-no-program→new-program builder, Overdue/Flag→client details), **programs-ending bounded** to the next 7 days, **confirmed/pending** on today's sessions, **archived-client exclusion** from the panels, a **regrouped recently-completed expander** (the shared `SessionExerciseSummary`, so the client-profile rail improved too), and quiet-voice copy. **Owner-approved deviations from brief §6.8, recorded as decisions (not gaps): the §6.8.5 client list (P1-1 withdrawn) and the responsive layout (P2-4 withdrawn).** The reviewer caught a relocated **FM-4 inflation** — fixed pre-sign-off, Overdue now excludes past-end programs. Accepted-with-re-trigger: FM-7 (recent-completions nested query at f&f scale), FM-11 (no new pgTAP — read-only over already-tested RLS surfaces). **No new DB surface** (read-only projection) → no migration, no new pgTAP gate. **Messaging (section 10) — Closed with deferred items 2026-06-20** under the section sign-off ritual (reviewer: claude.ai project chat / challenger role; Decision: Closed with deferred items; Closing commit + Sign-off in `docs/polish/messaging.md` §5/§6; merged to master + deployed to production, operator-confirmed end-to-end on prod). In-app messaging is an **owner-approved deviation from brief §6.7** (which excludes it); the §10 pass hardened the already-built feature toward the condition that approval rested on — health-adjacent message content staying inside the RLS/audit perimeter. It delivered across 4 P0, 2 P1, 5 P2 + a reviewer follow-up: **P0** — the anon-EXECUTE sweep of the messaging SECURITY DEFINER trigger functions (the named §10 go-live rider); **DB-enforced message immutability** (`message_enforce_immutability` BEFORE UPDATE freezes every column but `read_at`, closing the hole where a client could edit/delete the EP's messages or forge attribution via raw PostgREST — RLS `WITH CHECK` cannot express column immutability); the **audit trail** (`audit_messages`/`audit_message_threads` triggers + resolver registration, brief §7.4); and the **RLS regression suite** (pgTAP `34`). **P1** — email-to-EP on a new client message (best-effort `after()` send, debounced to the first unread, no message body, to the org owner — a deliberate operator-approved deviation from the gap-doc's DB-trigger recommendation); the in-app indicator resolved to the **existing** nav badge + TopBar bell (a redundant portal-home bell was added then reverted at the :3000 review); web push deferred after a viability spike; realtime tenant-isolation discharged via pgTAP `34` + setup verification. **P2** — a first-open clinical-safety disclosure on the portal thread, copy/token polish, and the messaging RLS documented in `rls-policies.md` §4.27/§4.28. The reviewer-gated follow-up fixed a real integrity gap before sign-off — `read_at` was writable by any party (a sender could forge a read receipt); migration `20260620120000` made it **recipient-only** (a client stamps `read_at` only on staff-sender rows, staff only on client-sender rows), locked by pgTAP `34` (now 17/17, assertions #15-17). **Deferred with re-triggers** (`docs/polish/messaging.md` §5/§6, indexed in `docs/go-live-checklist.md` §8): P1-1(c) email send-failure observability (→ queue+cron with a `succeeded≥1` assertion — re-trigger: any reported missed notification, or before identifiable client health data enters); P1-1(b) web push (re-trigger: email + in-app shown insufficient, or operator wants desktop OS notifications); P1-2 live realtime two-session probe (first f&f test accounts); P2-2 thread-restore distinguishability (re-trigger: a thread-level archive action is added). The **§10 slice of the platform-wide anon-EXECUTE sweep** (`client_cascade_thread_archive`, swept alongside `message_update_thread_last` + `message_enforce_immutability`) is **discharged** — only `client_accept_invite` (§2) remains open in that sweep. **Client portal PWA (section 7) — Closed 2026-06-14** under the section sign-off ritual (reviewer: claude.ai project chat; Decision: Closed; Closing commit + Sign-off in `docs/polish/client-portal-pwa.md` §8/§9; deployed to production on the section-7 branch merge to master). It delivered the named §6.3/§6.3.1 scope: device-timezone "today" (client/server/reschedule RPC — closes the AM "today = yesterday" CTA mislabel + the reschedule false-collision), the portal anon-EXECUTE sweep (pgTAP `25_portal_rpc_grants.sql` 22/22 on live), the in-session light/dark theme (default dark) over the **open-form logging core** (any-order set logging, Back/Next skip, "Log all" carry-forward, per-device autofill cookie), superset/tri-set grouping, one-tap video, the "Great work, {name}" end screen + per-group notes, honest inline completion errors, the Program-tab removal (nav 6→5), and the P2 polish (Avg-RPE weekly stat wired, completion stats, brief-aligned copy, "Book"→"Bookings" incl. page headers). All gaps **P0-1..P2-5** mitigated or consciously accepted with re-triggers. **Live re-triggers carried forward** in `docs/go-live-checklist.md`: the post-deploy **compat-shim removal** (§8 — drop the 1-arg `client_reschedule_program_day_to_today(uuid)` overload + trim its pgTAP `25` assertions immediately after this merge deploys, never before); the **FM-4 offline-queue** trigger (5 real clients × 10 sessions, escalate on any data-loss report) with the per-set-completeness trade folded alongside; and the still-open platform-wide **anon-EXECUTE sweep** (§4 — `client_accept_invite` pre-auth verification, the §9 booking RPCs, `client_cascade_thread_archive`). **Program calendar (section 6) — Closed 2026-06-14** under the section sign-off ritual (reviewer: claude.ai project chat; Decision: Closed; Closing commit + Sign-off in `docs/polish/program-calendar.md` §8/§9; shipped to production from commit `4b34797`). It delivered the month-view calendar (§6.2): collapsible weeks and days, week-level Copy/Repeat batch operations (collapsed-week-row affordances, per Q1 — *not* toolbar buttons; the day-level repeat-weekly flow is the brief's "Repeat Specific"), clinical-notes side-panel pinning, "Today" snap-back; the calendar stays prescription-and-scheduling only — completion data lives on the client profile, never overlaid on calendar cells (amended 2026-07-15 — a single binary status glyph IS now allowed on a cell: the green "Completed" tick, plus a deferred red "missed" mark, as scheduling legibility; detailed adherence data — logged sets/reps/load/RPE, feedback, summaries — stays profile-only. See `docs/polish/program-calendar.md` §10). **Scheduling (section 9) — Closed with deferred items 2026-06-16** under the section sign-off ritual (reviewer: claude.ai project chat; Decision: Closed with deferred items; Closing commits + Sign-off in `docs/polish/scheduling.md` §8/§8b/§8c/§8d/§9; shipped to production across deploys #1–#2, section branch → master). Section 8 (Testing and reports module) was already complete and not re-polished this cycle, so scheduling was the section-9 pass. It delivered the §6.4 scope across 2 P0, 7 P1, 15 P2: the anon-EXECUTE sweep of the scheduling booking RPCs (pgTAP `26`); practice-tz reconciliation of the staff schedule grid (fixes the daily-wrong-"today"); a DB double-booking EXCLUDE constraint; the booking-model rework (per-type session durations + 15-minute slot granularity, and an **"Unavailable" appointment-kind** for staff-only admin/note blocks that may overlap a client appointment); a single **DB-trigger reminder lifecycle** (`appointment_manage_reminder` — enqueue on create, re-time on reschedule, cancel on leave-the-live-set, across every booking path; wires `reminder_lead_hours`); negative availability ("close a date"); the §6.1 Bookings tab; recurring appointments (a "Repeat" composer generating concrete rows); a schedule **Tools** menu (find-next-available + a **de-identified, revocable `.ics` subscribe** — type/time/location only, never client identity); settings honesty (SMS "coming soon", email-gating, failed-reminder retry); and a recurring-colour design-token sweep. The discharged section-9 riders: the **FM-6** booking slot-range UTC bug (P2-1) and the **§9 booking-RPC slice** of the anon-EXECUTE sweep (P0-1, pgTAP `26`). **The close-out (§8c/§8d) caught and fixed a live production breakage the harness had missed:** the reminder Edge Function had never actually *sent* — its Supabase secret set (separate from Vercel) was missing `EMAIL_FROM`/`NEXT_PUBLIC_APP_URL` and held a stale `RESEND_API_KEY`, so **FM-3 was unmitigated in prod**, invisible because every prior check stopped at *enqueue*, never *send*. Now corrected, a live send verified (`status='sent'` + `provider_message_id`), with a standing post-deploy **synthetic send check** added to the runbooks (assert `succeeded≥1`, not just HTTP 200), the 34 seed reminders swept before the next cron window, and the `RESEND_API_KEY` consumer sweep closed (two stores — Vercel + the EF secret set — both current). **Deferred with re-triggers** (`docs/polish/scheduling.md` §9, indexed in `docs/go-live-checklist.md`): P2-13 residual literals (re-trigger: a brand palette/radius change); the off-tz cross-day-drag residual (a routinely off-tz staff device); the Resend-dashboard revocation of the stale pre-rotation key (consumer sweep done — operator dashboard action only); and the out-of-scope follow-ups (buffer, owner-on-behalf, AVL-7 `.ics` import, AVL-8 auto-holidays, SMS activation). The still-open **platform-wide anon-EXECUTE sweep** continues — `client_accept_invite` (§2 — verify pre-auth use before any revoke) — owned by its section in `go-live-checklist.md` (the §10 `client_cascade_thread_archive` slice is now discharged; see Messaging above). **Section 12 — Email and SMS — Closed with deferred items 2026-06-22** (the final polish section; brief §6.7 / polish-order §12 — email taken end-to-end via Part A, SMS stubbed-and-wired but **not** activated during the friends-and-family beta per Open gates; Part B — connected-account compose + Comms tab — deferred to the go-live pipeline). Its summary is at the top of this Active-section note; **with it, the Phase-1 polish pass is complete.** The previous active section, **Program engine and session builder — the differentiator — is closed** under the formal section sign-off ritual (signed off Closed 2026-06-12; all ten gaps G-1..G-10 closed, no section gaps deferred); its Closing commit and Sign-off live at `docs/polish/program-engine-session-builder.md`. Three things from that pass feed this section: (a) the calendar toolbar's Copy/Repeat affordances should re-verify against the G-1-fixed clone RPCs — per-set fan-out now lands on all four (`copy_program_day`, `repeat_program_day_weekly`, `copy_program`, `repeat_program`); (b) the day-level copy/repeat UI (the calendar day-cell surface) is where the three operations substituted with pgTAP coverage at section-5 sign-off get their browser pass; (c) the view-mode / pin-state persistence question (localStorage vs `practice_preferences`) was surfaced for this section's premortem. Section-5 riders carried forward (not section gaps): the `SessionTypesEditor` stale-add fix (rider to closed section 1, spawned task); the go-live SECURITY DEFINER anon-EXECUTE sweep — prioritise guardless internal helpers (`_program_for_date` locked definer-only in `20260612150000` — anon + authenticated EXECUTE revoked, verified not anon-reachable in the 2026-07-09 health-check live probe; `_clone_program` fixed in `20260612130000`); the test 05 fixture repair (testing-module-owned, spawned task) — tracked in `docs/go-live-checklist.md` per the technical gate index rule. Earlier closed sections: Exercise library (Closed clean 2026-06-12, `docs/polish/exercise-library.md`); Client profile and clinical notes (Closed with deferred items, `docs/polish/client-profile-clinical-notes.md`, riders in `docs/go-live-checklist.md` / `docs/rls-policies.md`).

## Polish-pass protocol (mandatory)
Before modifying any section, follow this sequence:

1. **Read the target brief** for the section. Treat it as the desired end state, not a greenfield spec.
2. **Audit the existing implementation** in the repo. Identify what is there, what works, what does not.
3. **Run a focused premortem.** Given the audit results and the friends-and-family beta scope, ask: what is most likely to fail when a real user touches this section? Weight infrastructure and security failure modes at production-grade. Weight operational, UX, and workflow failure modes at friends-and-family scope. Explicitly include a configuration-and-environment-drift lens alongside the code, UX, and security lenses — env vars, deploy config, dashboard/plan settings, secrets, and dev-vs-prod parity. This is the class that lives between the code and the running deployment, and a premortem that models only code/UX/security failure modes will miss it (the Auth-and-Onboarding-client section shipped clean and was then hit by two production outages of exactly this class — see `docs/polish/auth-onboarding-client.md`, "Post-hoc reviewer pass discharged"). Output a ranked failure-mode list. Append it to the polish doc for the section.
4. **Produce a gap list** in `/docs/polish/[section].md`, grouped by severity (P0 architectural, P1 functional, P2 polish) and cross-referenced against the premortem failure-mode list. A gap that closes a high-likelihood failure mode is automatically promoted in priority.
5. **Wait for approval** of the gap list before changing code. The list is the contract.
6. **Address gaps in dependency order.** Architecture before features, features before polish. Each gap closes with a brief note in the polish doc.
7. **Run acceptance tests** at the end of the section pass. The test suite is the gate, not "looks fine."

Do not start by writing migrations. Do not start by deleting files. Do not assume the existing code is wrong without auditing it. The existing code may already be correct in places where the brief is silent.

## Section sign-off ritual (mandatory)
Claude Code implements. The operator's claude.ai project chat reviews. External advisors review code-level later. These three tiers are deliberately separate.

When the seven-step polish-pass protocol is complete for a section, Claude Code writes a closing commit to the bottom of `/docs/polish/[section].md` under a "Closing commit" heading. The closing commit contains:

- What was changed, in plain language. Reference the gap list items by number.
- What acceptance tests ran and their results.
- What gaps from the gap list were deliberately deferred and why, with the trigger that would re-activate them.
- What premortem failure modes were mitigated, and what failure modes were deliberately accepted rather than mitigated, with rationale.

Claude Code's job ends at writing the closing commit. The section is not closed until the operator pastes the closing commit into the claude.ai project chat and receives a sign-off there. The operator pastes the sign-off response back into `/docs/polish/[section].md` under a "Sign-off" heading at the very bottom. The sign-off entry contains three lines:

- Date signed off
- Reviewer (claude.ai project chat, referenced by chat title)
- Decision (Closed, Closed with deferred items, or Returned for revision)

If the decision is "Returned for revision," the reviewer's gap items are added to the existing gap list as a follow-up section and the seven-step protocol re-engages from step 5. If the decision is "Closed with deferred items," the deferred items are listed beneath the sign-off with rationale and re-trigger.

This review is logical and documentary, not code-level. The reviewer in the claude.ai chat does not have access to the codebase and is reviewing the closing commit's logic, completeness against the gap list, and completeness against the premortem failure modes. Code-level verification is the job of the external security advisor and the IT review gate per the Open gates section.

## The core differentiator — protect it
The session builder with clinical notes adjacent to the programming calendar is the single most important screen in this platform. It is what makes Odyssey different from everything else on the market. When the polish pass reaches the session builder, it gets the most time, the most care, and the highest bar. Everything else can be functional — this must be exceptional.

## Source of truth
The product is specified across a small set of authoritative documents. Read them in this order when picking up new work:

1. `Client_Platform_Brief_v2.1.docx` — the master product spec. Covers all UX decisions, data model, hosting architecture, and compliance requirements for the platform as a whole.
2. `CLAUDE_CODE_BUILD_PROMPT_testing_module.md` — the target-state brief for the testing & reports module. This is the spec the existing module is being polished *toward* — not a greenfield build spec.
3. `data/physical_markers_schema_v1.1.json` — the test schema with rendering hints (direction of good, default chart, comparison mode, client visibility, client view chart) per metric. Read at runtime, not hard-coded. The seeded `physical_markers_schema_seed` table is the runtime artifact; the JSON is the editing source of truth (see `docs/testing-module-schema.md` §14 Q5).
4. `Odyssey_Design_System.pdf` — the visual and brand system. Authoritative for colour, type, spacing, motion, components, voice, copy, and casing. Tokens already in `src/app/globals.css`. Reference layouts in the four root `.html` prototypes.
5. `/docs/` — authoritative architecture decisions. Contents:
   - `schema.md`, `auth.md`, `rls-policies.md`, `slos.md`, `incident-response.md` — the foundation documents. Drafted and self-reviewed during build. **External IT advisor review is parked but not abandoned** — see Open gates below. Treat the docs as the current authoritative position; flag anything that looks wrong.
   - `deferred-prompts.md` — working file for tracked-but-not-yet-resolved scope or design decisions. Consult it for context, but it is not a contract — it captures things still under consideration.
   - `polish/<section>.md` — gap-analysis docs produced during the polish pass (see Polish-pass protocol).

If two documents disagree, the most specific one wins (testing module brief > v2.1 brief > prototypes). Surface the disagreement before resolving — don't silently pick one.

The repo `README.md` (if present) is for newcomers and is **not** authoritative. Defer to CLAUDE.md, the design system, and `/docs/` for any architectural call.

## Open gates (must close before any paying clinical client)
These are flagged here so they do not get forgotten.

**The hard rule.** No paying clinical client may be onboarded to OdysseyHQ as their primary clinical record system until all three of the following are true:

- **(a)** An external IT security review (below) is completed and documented in `/docs/external-reviews.md`.
- **(b)** Anthropic has established a BAA meeting Australian health-privacy standards. Assessed 12–24 month horizon; treat as not-yet-met until documented.
- **(c)** The entity structure has been reviewed against the increased liability surface (sole trader → likely Pty Ltd; see "What this is" → Entity).

Until all three hold, the existing 40–50 clinical clients stay on Cliniko and OdysseyHQ runs as a friends-and-family beta only. This rule is not waivable by convenience, deadline, or "just one client".

**Three tiers, kept distinct.** Do not let a cheaper question gate a more expensive one:

- **Tier 1 — dogfooding.** Gated only by the Beta-entry hardening gate above. The operator's own real data, synthetic clients, and an explicitly-consenting non-paying f&f circle. No third party's clinical-record trust is on the line.
- **Tier 2 — paid friends-and-family.** A commercial-plus-data event, *not* a "primary clinical record" event. The moment a friend pays for a program, real health data is stored against a person **and** money changes hands. This does **not** trip the hard rule (the platform is still not their primary clinical record system; the Cliniko population has not moved) — but the boundary is genuinely fuzzy, so it forces two conscious decisions, not defaults: (i) the Beta-entry hardening gate must already be fully closed — paid or unpaid, the safety floor is *identical*; (ii) it opens a liability/commercial surface — confirm professional-indemnity cover extends to delivering beta software, and handle the income per the accountant's sole-trader guidance. The pen test the backend brief places "before first paying customer" either happens here or is explicitly marked deferred-with-justification. Not deciding is not an option.
- **Tier 3 — paying clinical clients on Odyssey as primary clinical record.** The hard rule. Gated by (a) external IT review, (b) BAA, (c) entity review, all above. Unchanged.

**The financial number is a readiness note, not a safety gate.** "≈4 friends × $20/week covers the go-live infra cost" answers *can I afford to run this?* — a real, useful question, and a sound trigger for completing `docs/go-live-checklist.md`. It does **not** answer *is it safe for a real person's health record to be in here?* (that is the Beta-entry hardening gate) or *is this worth paying for?* (validation). On validation: friends pay for the relationship, not the product. Four paying friends is good cost-recovery evidence and near-useless willingness-to-pay evidence for the SaaS fork. The fork itself was resolved 2026-07-21 (see Product roadmap), but this caveat did not resolve with it — it now applies at roadmap step 2: do not let the cost-recovery number wear the validation question's clothes when deciding to start selling to other EPs.

**Technical gate index.** The hard rule above gates the paying-client threshold. The technical pre-launch and pre-paying-client gates — Supabase Pro-tier items (HIBP, refresh-token lifetime, PITR), auth-config verification cadence, and the deferred-with-trigger riders carried out of closed polish sections (invite link minted at POST, enterprise Safe Links re-run, structured auth audit log) — are indexed in `docs/go-live-checklist.md`, which gates the friends-and-family beta itself. A re-trigger recorded only in a closed section's polish doc does not fire; the checklist is where they live.

**External IT-advisor review of `auth.md`, `rls-policies.md`, and `schema.md`.** The docs were self-reviewed with Claude Code's help. Independent human review by a security-competent reviewer (pentester, AppSec consultant, or healthtech-experienced peer) is:

- **Recommended, not required, for the current friends-and-family-beta scope.** A bounded circle of non-paying users (operator, one EP collaborator, and explicitly-invited friends-and-family beta testers — not a public signup) not relying on this as their clinical record is a materially lower-stakes surface than production healthcare.
- **Required — non-negotiable — before any paying clinical client onboards** (hard rule (a)). RLS holes are the highest-impact failure mode in multi-tenant systems and the hardest to spot without independent eyes; for Privacy Act 1988 clinical data this is mandatory, not advisory.

Do not represent the system as externally reviewed or production-clinical-ready in any context — marketing language, terms of service drafts, or anything client-facing — until that review is documented in `/docs/external-reviews.md`. The downgrade above changes *when* the review is required; it does not permit claiming a review that has not happened.

## Reference prototypes
These prototypes validated the UX decisions captured in the briefs. They are reference for design intent, **not** scaffolding to port code from. The polish pass refers to them when the brief or design system is silent on a flow.

- `program-calendar.html` — EP-facing month-view calendar with collapsible weeks/days
- `session-builder.html` — TrainHeroic-style exercise programming with dynamic sequencing, superset grouping, shared right panel (Notes/Reports/Library). Drag-and-drop in this prototype is shape-only; the production implementation has its own reorder logic.
- `client-portal.html` — Mobile PWA client view with guided session logging
- `dashboard.html` — EP landing page with stat cards, attention panel, client list
- `Isaac_Fong_report.html` — VALD performance report. Validated the report rendering for the testing module. **Not the source of design tokens** — superseded by `Odyssey_Design_System.pdf`.

## Design system
`Odyssey_Design_System.pdf` is the authoritative source. Tokens live in `src/app/globals.css`; the PDF is the documentation that explains the *why* behind each value. Do not duplicate token values into other files. (`src/lib/constants.ts` holds non-design platform constants — e.g. `PRACTICE_TIMEZONE` — not design tokens; corrected 2026-06-12, the file did not exist before that date.)

The load-bearing rules — easy to silently violate, expensive to fix later:

- **Posture is Apple-like restraint.** Generous whitespace, thin 1px borders, one subtle shadow on cards (`0 1px 3px rgba(0,0,0,0.06)`) and nothing else. No shadows on buttons, inputs, chips, menus.
- **Accent green is structural, not decorative.** Reserved for the brand mark dot, success states, completion checkmarks, sequence bubbles, eyebrow accents. Never used for hover effects, gradients, or "pop."
- **No backdrop-filter, ever.** No blur, no glassmorphism. This is a clinical tool, not a consumer app.
- **Type hierarchy comes from scale and family, not colour.** Display = Barlow Condensed 700–900 (decisive, vertical). Body = Barlow 300–600 (open, legible).
- **Weight and colour both drop as size drops.** Never use weight 600+ below 13px. Never use `#1C1917` (text body) below 13px. Smaller text means lighter and softer, always.
- **Single 14px card radius default** (10px in dense panels, 8–10px on session-builder exercise cards). Buttons and inputs 7px. Pills 999px. No other radii.
- **Motion is restrained.** 150ms hover/press, 300ms reveal, easing `cubic-bezier(0.4, 0, 0.2, 1)`. No bounce, no spring, no entrance animations on page load. Pages feel still.
- **No emoji anywhere.** Iconography is Lucide stroke icons (2px, rounded caps). No icon font.
- **The "left-border accent" pattern is restricted** — used only on clinical flag banners (red `#D64045` 3px solid border-left + `rgba(214,64,69,0.05)` background). Do not generalise this pattern to other components.

If something looks wrong, return to the PDF. The system has answers; they're easy to skip.

## Voice & copy
Full treatment in `Odyssey_Design_System.pdf` Section 02. Load-bearing rules:

- **Quiet, dense, confident.** Reads like a clinician's notepad, not a consumer fitness app. The EP knows what RPE 8 means; the UI does not explain it.
- **Sentence case for UI labels, buttons, nav, section titles.** UPPERCASE with 0.04–0.06em tracking is reserved for tiny eyebrow labels and column headers in Barlow Condensed.
- **Imperative for actions.** "Begin Session", "Save", "Add exercise". No "Let's…", no exclamation points on buttons.
- **Encouragement is earned, not free.** Only after session completion: "Another one in the bank. Consistency wins." Nowhere else.
- **Reason codes are factual, not dramatised.** "Last session logged 12 days ago — normally logs 3×/week." No "oops", no "uh-oh".
- **Numbers and units have specific conventions.** Reps with `×` not `x` (`4 × 6`). Each-side work is written out in the exercise cues/notes, not abbreviated in the reps field — the `e/s` shorthand was retired platform-wide 2026-07-13 (data + form + code, and the four `e/s` references in `Odyssey — Design System.pdf` were corrected in place the same day). "Seconds" → lowercase `s` attached to number (`90s rest`). Time-ago is explicit (`9 days ago`, not `recently`).
- **Australian English.** "Program" not "programme". Dates as `Sat 11 Apr 2026` or `12 Jan 2026`.

## Design philosophy
- Every screen must earn its existence. If a feature adds complexity without proportional value, cut it.
- Progressive disclosure: show only what is needed at any moment. Details are always one tap away.
- Sensible defaults with override: the system should remember patterns and reduce repetitive data entry.
- Data density without clutter: show what matters, hide what doesn't.
- If a client needs instructions to use it, the design has failed.
- If the EP cannot adjust a program in under 60 seconds, the design has failed.

## Tech stack
- Next.js with TypeScript (App Router, Server Components by default) — installed
- Tailwind CSS — installed (verify config matches design tokens during polish-pass audits)
- Supabase (Postgres + Auth + Storage + Row-Level Security) in ap-southeast-2 — connected and queryable
- No ORM — raw SQL migrations + Supabase query builder + TypeScript types generated from the live schema via `supabase gen types`
- Supabase Auth (email + password, magic link deferred). NOT Clerk, NOT NextAuth
- Resend for email, Twilio for SMS

See `/docs/` for the authoritative design decisions. Any tech-stack change must be reconciled with those documents.

## Operational state (current)
The following operational infrastructure was landed in Build Prompt 2 and is current as of the date in the active section line:

- Operational runbooks live in `/docs/runbooks/`. Reference these for incident response, deployment procedures, and routine operational tasks.
- Secrets inventory lives in `/docs/secrets-inventory.md`. Every secret used by the platform is documented there with rotation procedure and ownership.
- `EMAIL_FROM` is plumbed end-to-end in code. Both the Next.js send path (`src/lib/email/client.ts` → `defaultFromAddress()`) and the Edge Function path (`send-appointment-reminders`) read `EMAIL_FROM` and fail loud (throw / HTTP 500) if it is unset. The Resend testing-default (sandbox) sender path has been removed — there is no fallback.
- **Email infrastructure is closed end-to-end.** The Resend sending domain `mail.odysseyhq.com.au` is verified at Resend with SPF, DKIM, and DMARC live at VentraIP. `EMAIL_FROM` is set in Vercel across All Environments to the verified-domain address with RFC 5322 display-name formatting intact. Outbound email is deliverable and has been confirmed end-to-end with a real recipient at a third-party Gmail address. The apex domain `odysseyhq.com.au` and the parked defensive domain `theodysseyhq.com` are both live on Vercel with redirects working.

If any of the above is found to have drifted from this stated position, surface it before proceeding with section work. CLAUDE.md drift on operational state is a contamination risk for every subsequent polish-pass prompt.

## Local dev gotchas
- **CSS edits not appearing after a hot reload**: Turbopack's dev cache (`.next/dev/`) sometimes hangs onto a stale CSS chunk that pre-dates a globals.css edit. A plain `npm run dev` restart does NOT invalidate it. Cure: stop the server, `Remove-Item .next -Recurse -Force` (PowerShell) or `rm -rf .next`, then `npm run dev`. Symptom: classes you just added don't appear in the served chunk at `/_next/static/chunks/[root-of-the-server]__*.css`.

## Code standards (non-negotiable)
- TypeScript throughout — no JavaScript files. No `any` types unless absolutely unavoidable with a comment explaining why.
- Component-based architecture. Every component should be reusable and testable.
- Database migrations tracked in code. No manual schema changes ever — never edit in the Supabase dashboard.
- Multi-tenant from commit one. Every tenant-owned table carries `organization_id`.
- Row-Level Security enforced on every tenant-owned table. RLS is the security boundary, not application code.
- Every API route and server action authenticates via Supabase Auth; authorization is enforced by RLS. No exceptions.
- Environment variables for all secrets and configuration. Nothing hardcoded. Service role key is server-only — never ships to the browser.
- **Configuration is read at runtime, never compiled in.** Schema files (e.g. `physical_markers_schema_v1.1.json`) are loaded at server startup. Per-EP overrides live in the database, keyed on a stable identifier. The application reads `override OR default` through a resolver function — never reads schema files directly elsewhere in the code. This rule applies to every configurable surface, not just tests; the EP must be able to change configuration through settings without a code change or redeploy.
- **Design tokens live in `src/app/globals.css` only.** Do not hardcode colours, radii, spacing values, or font weights elsewhere in the codebase. Components reference tokens, never raw values. `src/lib/constants.ts` holds non-design platform constants (e.g. `PRACTICE_TIMEZONE`), not design tokens.
- Responsive: 375px (mobile), 768px (tablet), 1440px (desktop).
- Client portal is mobile-first. Staff portal is desktop-first.
- Clean, readable code that works is better than fast, messy code that works today and breaks tomorrow.

## Communication style
- When presenting options, give no more than three and recommend one with reasoning.
- When something will take multiple steps, outline the plan before starting.
- When you finish a feature, summarise what was built, what works, and what still needs attention.
- Use plain language. The person you're working with is not a developer — they are an Exercise Physiologist learning to build. Explain technical concepts when they come up, but don't be patronising.
- If you think the person is about to make a mistake or go down a wrong path, say so immediately.

## Polish-pass order (locked)
The polish pass works through the platform in foundation-upward order. Each layer's failure modes depend on the layer beneath, so the foundation is polished first. Move on only when the current section meets its bar and has been signed off per the ritual above.

1. **Auth and Onboarding (staff)** — clinic-side setup. Account creation, organisation setup, settings, first-run experience for the EP. Closed 2026-05-27.
2. **Auth and Onboarding (client)** — client-side first contact. Email invite, password creation, first login, day-one experience. Closed 2026-06-11.
3. **Client profile and clinical notes** — note template, flag banners, medical history, history rendering. Closed with deferred items 2026-06-11.
4. **Exercise library** — search, tagging, video preview, default prescription patterns. Closed 2026-06-12.
5. **Program engine and session builder** — the differentiator. Highest care. Drag-and-drop, supersetting, shared right panel, clinical notes adjacency. Closed 2026-06-12.
6. **Program calendar** — collapsible weeks, batch operations, side panel pinning. Closed 2026-06-14.
7. **Client portal PWA** — week strip, in-session logging UX, completion flow. Closed 2026-06-14.
8. **Testing and reports module** — complete. Not for re-polishing in this cycle.
9. **Scheduling** — availability management, booking flow, reminder cadence. Closed with deferred items 2026-06-16.
10. **Messaging** — in-app messaging between staff and client portal. Texting-style feel, privacy preserved. Closed with deferred items 2026-06-20.
11. **EP Dashboard** — stat cards, attention panel, today's sessions strip. Closed 2026-06-22.
12. **Email and SMS** — template tone, delivery reliability, preference handling. Email is in scope for the friends-and-family beta. SMS is in scope but deferred until the friends-and-family beta closes and paying clients are onboarded per the hard rule in Open gates. When this section is polished, email is taken end-to-end and SMS is stubbed and wired but not activated. **Closed with deferred items 2026-06-22** (Part A — reliability + tone/branding + preference honesty + SMS honest-stub — shipped; Part B — connected-account email compose + client-profile Comms tab + system-send log-wiring — deferred to the go-live pipeline, `docs/go-live-checklist.md` §8). **This was the final polish-pass section — the Phase-1 polish pass is now complete.**

This order is locked, not suggested. Deviation requires updating CLAUDE.md first.

## Phase 2 (not yet started)
- AI assistant for personalised client communications
- AI-drafted check-ins based on adherence patterns
- Communication templates with personalisation tokens

Phase 2 begins only when Phase 1 polish is complete.

*Note: Phase 2 introduces a new privacy surface — AI processing of clinical-adjacent data (adherence patterns, drafted clinical communications). It is not gated by the hard rule (it does not elevate stakes to the paying-client threshold), but the AI data flow must be documented before any Phase 2 feature is enabled in the friends-and-family beta — see the runbook README backlog.*

## What NOT to build
- No social features
- No video hosting (YouTube links only)
- No payment processing
- No native mobile app (PWA only)
- No SMS notifications during friends-and-family beta — Twilio stays installed but inactive until SMS is re-activated post-beta per polish-pass section 12. Gmail Send-mail-as for outbound replies from the operator's personal inbox to appear as `scott@mail.odysseyhq.com.au` is wired-and-ready conceptually but not activated — enabling it requires charging for an ImprovMX SMTP relay plan, deferred until a paying client surfaces a reply-threading friction point post-beta. Both SMS and Gmail Send-mail-as activate only if and when paying clients onboard, never before.
- No multi-practitioner UI (architect for it, don't build it)
- No features outside this brief without asking first
