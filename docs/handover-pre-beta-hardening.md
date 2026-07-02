# Handover — pre-beta hardening batch (2026-07-03)

**Purpose.** Four work items to run while the pre-launch advantages still hold (no real data → cheap migrations, reversible RLS, no clients to break). Two are enablers I recommend unconditionally; two are optional early-hardening the operator asked to pull forward from the paying-client gate.

**Strategy note (read first).** The goal is "hardened enough to safely take real friends-and-family health data," NOT "perfect." Items 1–2 are high-ROI enablers. Items 3–4 are marginal at f&f scope (both are paying-client-gated in `go-live-checklist.md` §8) and are being pulled forward deliberately — they are a *bounded* batch, not an open-ended polish. **Set a stop line:** once items 1–2 are done and 3–4 are either done or consciously re-deferred, the only remaining beta blocker is the Supabase Pro DR drill — open the beta then. Do not let "bulletproof" become an infinite target; the beta's value is the learning it generates.

**Owner legend.** `[OP]` = operator dashboard/account action (I cannot do these). `[CC]` = Claude Code (code, migrations, tests, docs, wiring).

**Recommended sequence:** Item 2 (trivial, do now) → Item 1 (enabler, unblocks safe testing for 3–4) → Item 4 (smaller) → Item 3 (largest). Items 3–4 each run the polish-pass protocol because both touch a security surface.

---

## Item 1 — §5 non-prod / staging Supabase project (ENABLER — recommended)

**Why.** Every pgTAP test today runs against live **prod** via `BEGIN…ROLLBACK`. Safe, but there is no staging copy, so anything that can't be rolled back (a real `db reset`, a destructive migration rehearsal, a `pg_dump`/restore trial) can't be tested without risking prod. A staging target is the enabler that makes all future hardening safe. Gate: `go-live-checklist.md` §5, trigger "before identifiable client health data enters the project" — i.e. beta time.

**Split:**
- `[OP]` Create a **second free Supabase project** in the **same region (ap-southeast-2 / Sydney)**, named e.g. `odyssey-staging`. Free tier allows a second project; **caveat: a free project auto-pauses after ~1 week idle** — wake it before a test run. (Supabase *branching* is cleaner but Pro-only; if you go Pro for the DR drill anyway, reconsider branching then.) Send me the project ref.
- `[CC]` Wire it: a documented way to point `supabase db push` / `supabase db query` at the staging ref (a saved `.temp`/linked-project profile or an explicit `--project-ref` runbook), a one-command "sync all migrations to staging" step, and a "run the full pgTAP suite against staging" command. Write it up in `docs/runbooks/` (new: `use-the-staging-project.md`).
- `[CC]` Apply all migrations to staging, regen-verify, and run the full pgTAP suite (56 tests) against it as the canonical test target.

**Acceptance:** all migrations apply clean to staging; the full pgTAP suite runs green against staging; one genuinely-destructive operation (a `db reset` or a DROP-and-reapply) is rehearsed on staging with zero prod impact; the runbook documents the wake-from-pause + sync + run flow. Update `go-live-checklist.md` §5 to CLOSED with the pointer.

**Dependency:** blocked on `[OP]` creating the project. Nothing else can start until the ref exists.

---

## Item 2 — §2 secrets/env hygiene checks (ENABLER — do now, trivial)

**Why.** Two loose ends in `go-live-checklist.md` §2, both dashboard-only, both ~2 minutes.

**Split:**
- `[OP]` **Resend dashboard** → API Keys: confirm **only the current key is active**; delete/revoke the stale pre-rotation `RESEND_API_KEY` if it still shows. (The EF's historical 401 is consistent with it already being gone — this is a confirm, not a fix.)
- `[OP]` **Vercel dashboard** → project → Settings → Environment Variables: confirm **`NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_APP_URL` are both set (all environments) and equal** to the production origin (they are the same logical value under two keys — Flag E). Confirm `.env.local` matches for local dev.
- `[CC]` Pre-checked the **local** side 2026-07-03 — **finding worth acting on:** `.env.local` defines **both keys twice** — `http://localhost:3000` (lines 14–15) *and* `https://odysseyhq.com.au` (lines 21–22). dotenv is last-key-wins, so **locally both `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_APP_URL` resolve to the prod URL** and the localhost lines are dead — i.e. `npm run dev` auth redirects/emails point at prod, not `localhost:3000`. This is a **local-only** papercut (`.env.local` is gitignored; it does NOT affect the production Vercel config, which is the actual §2 gate). `[OP]` decide intent and clean up: keep the localhost pair for real local-dev auth testing, or delete lines 14–15 if you deliberately point local at prod. Once you confirm the Vercel dashboard state, `[CC]` records the outcome in `secrets-rotation-log.md` / `secrets-inventory.md` and ticks §2's tracked tech-debt line.

**Acceptance:** Resend shows exactly one active key (= current); Vercel (production) shows both vars set + in sync; `.env.local` duplicate resolved per intent; `secrets-inventory.md` reflects it. No app code change expected.

**Dependency:** none. Do immediately.

---

## Item 3 — G-6 structured auth-event audit log (OPTIONAL — largest; paying-client-gated)

**Why.** Master brief §7.4 names auth-event audit logging as a requirement; `go-live-checklist.md` §8 defers it to "before any paying clinical client." Owned by `auth-onboarding-staff.md` Revision 4. Pulling it forward is defensible ("bulletproof before anyone's on") but it is the **biggest** of the four and genuinely not needed until real clinical volume.

**This is a NEW security surface → it runs the full polish-pass protocol, not a blind build.**
- `[CC]` Step 1 — produce a gap doc `docs/polish/auth-audit-log.md`: read the brief §7.4 + `auth.md` + `auth-onboarding-staff.md` Rev 4; audit what auth events are already captured (the existing `audit_log`, the `[archive]`/`[restore]`/`[resend-invite]` console-info trail, GoTrue's own logs); premortem; gap list grouped P0/P1/P2. Key design decisions to surface for approval: **which events** (login success/failure, logout, password reset request/complete, invite accept, session revoke), **capture mechanism** (Supabase auth hooks vs GoTrue webhook vs app-layer logging in the auth server actions — each has trade-offs), **storage** (extend `audit_log` vs a dedicated `auth_audit_log` table with its own RLS + retention), and **what's queryable by whom**.
- `[CC]` Step 2 — **wait for operator approval of the gap list** before any code.
- `[CC]` Steps 3–7 — build in dependency order, migration + pgTAP for any new table/RLS, close with the sign-off ritual.

**Acceptance:** gap doc approved; the chosen event set is captured to a queryable, RLS-scoped, retention-aware store; pgTAP covers the new surface; sign-off recorded. **Honest scope flag:** this is a multi-session feature, not a quick win — budget accordingly, and it does not block the beta.

**Dependency:** benefits from Item 1 (test on staging). Otherwise independent.

---

## Item 4 — Invite `action_link` minted at POST time, not send time (OPTIONAL — smaller; paying-client-gated)

**Why.** The C-11 burn-on-click pass already did the **load-bearing** half — removed the embedded invite link from the gate-page HTML so body-parsing email scanners can't trigger it. The residual: the link is still **minted at send time**; minting it only when the human **POSTs** (clicks through the gate) closes the narrow window where a link-prefetching scanner consumes the one-time link before the human. Owned by `auth-onboarding-client.md` (C-14 deferred item 1 / C-11 closure); `go-live-checklist.md` §8.

**Also a security surface → gap-list-first, but far smaller than Item 3.**
- `[CC]` Step 1 — short gap doc / recon: re-read the C-11 closure + C-14 item 1 in `auth-onboarding-client.md`; trace the current invite flow (`src/lib/clients/invite.ts`, the `/i/[id]` gate page + its POST action, the `staff_create_client_invite` / admin-`generateLink` path); confirm exactly where the `action_link` is generated today and what it would take to defer generation to the POST handler without breaking the burn-on-click semantics or the rate-limit/audit wiring.
- `[CC]` Step 2 — surface the plan (one or two paragraphs) for approval; it's small enough that this may be a single approval, not a full gap list.
- `[CC]` Step 3 — implement + verify against `runbooks/verify-invite-prefetch.md` (the anti-prefetch runbook). Note: the *enterprise* Safe Links re-run (a separate §8 item) needs an M365 mailbox you may not have — the live-Gmail prefetch check is what's runnable now.

**Acceptance:** the invite link is generated only on the human POST; the prefetch runbook passes on live Gmail; no regression to burn-on-click, rate-limiting, or audit. Close the §8 pointer + the `auth-onboarding-client.md` C-14 item.

**Dependency:** benefits from Item 1 (test on staging). Otherwise independent.

---

## What this batch deliberately does NOT include

- **Supabase Pro cutover** (DR drill, HIBP G-3, refresh-token lifetime G-4, client-session-duration decision, auth-config re-run) — one dashboard sitting after the Pro upgrade; the DR drill is the last beta blocker.
- **§3 post-reset session behaviour** and **§5b authed render harness** — both trigger at *second practitioner onboarding*, not now.
- **Vercel-Pro Edge-middleware perf residual** — accepted; ~200–250 ms, take it at the commercial-use move.
- **§12 Part B** (connected-account email compose + Comms tab) and the **library editor** deferrals — features, paying-client / feature-triggered.

## The stop line

When Items 1–2 are done and Items 3–4 are either closed or consciously re-deferred, **stop hardening and open the beta** (once the Supabase Pro DR drill runs). Everything past that point is better learned from real f&f use than guessed at in advance.
