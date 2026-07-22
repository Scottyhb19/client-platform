# Prod-apply sitting — §12 Part B logging half + the July-21 stack

**Written 2026-07-22** (session: §12 Part B reviewer pass, cleared to close). One-time sitting procedure, not a standing runbook — delete or archive after the sitting completes and Phase 6 records the closures.

**Scope of the sitting:** merge the local stack → apply 4 migrations to **PRODUCTION** → deploy the frontend → run the named verifications, including the two-leg §12 prod-verify → record closures. Production is touched only in Phases 3, 5, and 6-verify, always through the explicit prod-workdir channel — every prod step below names its target.

**Have on hand before starting:** `CRON_SHARED_SECRET` (password manager — Leg 1 invoke), a browser logged into the prod staff app, ~45–60 min uninterrupted.

---

## Phase 0 — commit this session's work (still uncommitted)

Target: git only, no DB. The 8 files from the reviewer pass are sitting uncommitted on `client-auth-signoff-closeout` (plus this runbook itself).

```powershell
cd "C:\Users\scott\Desktop\Client Software Platform"
git status --short
git add src/lib/comms/log.ts "src/app/(staff)/clients/[id]/_components/CommsTab.tsx" scripts/seed-staging.mjs e2e/staff-render.spec.ts test_scenarios_template.md docs/polish/email-and-sms.md docs/runbooks/deploy-an-edge-function.md docs/go-live-checklist.md docs/runbooks/prod-apply-sitting-2026-07.md
git commit -m "fix(comms): §12 Part B reviewer pass — log observability, summary label, 9/9 render coverage, two-leg prod-verify defined"
```

**Gate:** `git status` afterward shows only `docs/polish/initial-assessment-intake.md` untracked (not this pass's — leave it).

---

## Phase 1 — pre-flight (all read-only)

1. **Sibling-session divergence check** (the silent-timestamp-collision hazard): confirm the migrations folder holds exactly the four new files and no stranger has appeared:
   ```powershell
   cd "C:\Users\scott\Desktop\Client Software Platform"
   Get-ChildItem supabase\migrations\202607211*.sql | Select-Object Name
   ```
   **Expect exactly:** `20260721120000_write_immutability_guards.sql`, `20260721140000_*` (auth_events), `20260721150000_invite_link_mint_at_post.sql`, `20260721160000_comms_system_send_log.sql`. Anything unexpected → **STOP**, reconcile before merging.

2. **Guard-function drift check on prod (pre-apply)** — the write-immutability sign-off's precondition: run the `pg_get_functiondef` drift check from `use-the-staging-project.md` against **PRODUCTION** (via the prod workdir, Git Bash):
   ```bash
   cd "/c/Users/scott/Desktop/Client Software Platform"
   source scripts/prod-workdir.sh
   supabase migration list --workdir "$PROD_WD" --linked
   ```
   **Expect:** the four `202607211*` migrations pending on prod and **nothing else** pending. A fifth pending row → **STOP** (sibling-session `db push` divergence — resolve per the standing procedure, never `migration repair`).

3. **Local build gate:** `npm run build` green on the tip branch. (tsc + eslint are already green from the pass; build is the deploy gate.)

---

## Phase 2 — merge the stack to master

Target: git only. Master is 1 commit ahead of the stack base (`32c07d9`, the MessageAttachments lint fix); `merge-tree` was verified **zero conflicts** (2026-07-21). Merging the tip brings the whole linear stack (`env-separation` → `db-write-immutability` → `g6-auth-events` → `invite-mint-at-post` → `comms-tab-logging` → `render-harness` → `client-auth-signoff-closeout`).

```powershell
cd "C:\Users\scott\Desktop\Client Software Platform"
git checkout master
git merge client-auth-signoff-closeout
npm run build
```

**Gate:** merge completes with no conflict prompts; `next build` green **on master**. Do **not** push yet — DB goes first (Phase 3), because the new frontend writes `sender_user_id: null` system sends and needs the nullable column live.

---

## Phase 3 — prod DB push (the 4 migrations)

**Target: PRODUCTION**, resolved via the prod-workdir channel (`scripts/prod-workdir.sh` → `PROD_PROJECT_REF` from `.env.local`) — the repo's own link stays staging. **Re-source the script now** — it re-copies `supabase/migrations` from the current checkout, and you want master's copy (the merged write-immutability revision):

```bash
cd "/c/Users/scott/Desktop/Client Software Platform"
source scripts/prod-workdir.sh
supabase migration list --workdir "$PROD_WD" --linked
supabase db push --workdir "$PROD_WD" --linked
```

**Gate:** push applies exactly the 4; re-run `migration list` — zero pending. Skew note: between here and Phase 4, prod runs new-DB + old-frontend. All four migrations are skew-safe by design (additive nullable column, triggers on paths old code doesn't take, invite legacy path preserved) — no need to rush, but proceed to Phase 4 next.

**Also now:** the write-immutability guards are live in prod — the accepted-risk exposure window in `incident-response.md` §10 closes at this moment (record it in Phase 6).

---

## Phase 4 — frontend deploy

Target: Vercel prod via git (no Vercel CLI on this machine; push = deploy, ~80s):

```powershell
cd "C:\Users\scott\Desktop\Client Software Platform"
git push origin master
```

**Gate:** Vercel dashboard shows the new build green, then `/api/health` returns `200 db:ok config:ok`.

---

## Phase 5 — post-deploy verification

### 5a. Standing checks

| Check | Command / method | Pass |
|---|---|---|
| Health | probe `https://…/api/health` | `200 db:ok config:ok` |
| Staff login path | `node scripts/staff-login-path-verify.mjs --prod` | green |
| Cross-tenant tripwire (per-migration rule) | `supabase db query --workdir "$PROD_WD" --linked -f "<abs path>\supabase\tests\database\17_cross_tenant_isolation.sql"` (Git Bash, **PRODUCTION**, BEGIN/ROLLBACK) | 8/8 |
| Guard parity (post-apply half of the drift check) | `pg_get_functiondef` on the four guard functions via prod workdir, diff vs staging | identical |
| Types parity | `npm run supabase:types` (targets **staging**, now schema-equal) → `git diff src/types/database.ts` | zero diff, tsc green |
| G-6 live in prod | log in to prod staff app, then read `auth_events` for `auth.login.success` via prod workdir | ≥1 fresh row |

### 5b. §12 two-leg prod-verify (the close condition)

**Leg 1 — trigger (reminder → communications).** Run the standing **Synthetic send check** in `deploy-an-edge-function.md` end-to-end against **PRODUCTION** — it is now §12-aware. In order: setup insert → ⚠️ re-time UPDATE (the upsert-trigger pitfall, step 1) → invoke with `CRON_SHARED_SECRET` → assert **body** `succeeded≥1` + reminder row `sent` → **assert the derived `communications` row** (system send, `subject='Appointment reminder'`) → **teardown, comms row FIRST**. The `DELETE … RETURNING` on the comms row returning a row **is** the BYPASSRLS confirmation; an empty result → **STOP before the client delete** (it would FK-fail and strand the synthetic client).

**Leg 2 — app-side (`logCommunication`).** In the prod staff app: create a throwaway client (`delivered@resend.dev`, last name "Healthcheck (delete me)"), tick **send invite**. Then via prod workdir:

- assert one `communications` row: `status='sent'`, `sender_user_id` = your uid, `body` contains the real invite plaintext with the `/i/<id>` gate URL;
- bonus assertions from the same probe (no extra work): the `invite_tokens` row has `action_link IS NULL` (**mint-at-POST live in prod**) and an `auth_events` row `auth.invite.sent` exists (**G-6 emitter live**);
- teardown: comms row first, then the client (`invite_tokens` cascades; no auth user exists — the gate was never tapped). Artifacts reference: `recover-stuck-client-onboarding.md`.

**Final census (both legs):**
```sql
SELECT count(*) FROM communications WHERE recipient_email IN ('delivered@resend.dev');
```
**Pass = 0.** Run via prod workdir or SQL Editor (**PRODUCTION**).

---

## Phase 6 — record the closures (docs, then sign-off rituals)

1. `incident-response.md` §10 — write-immutability prod exposure window **closed** (date/time of Phase 3).
2. `go-live-checklist.md` §8 — flip the four "pending prod apply" entries (write-immutability, G-6, mint-at-POST, §12 logging half) to applied-and-verified, each with a pointer to its owning doc.
3. `docs/polish/email-and-sms.md` — add the logging-half close entry under the frozen header: prod-applied + two-leg verify results. Reviewer pre-cleared (2026-07-22): *"closes on prod-apply + two-leg prod-verify, no further conditions"* — so this entry plus the reviewer's clearance message **is** the sign-off record.
4. **Sign-off rituals ×3** (operator → claude.ai chat, per the ritual): G-6 closure (`auth-onboarding-staff.md`), C-14 item 1 closure (`auth-onboarding-client.md`), §12 Part B logging half (`email-and-sms.md` — largely pre-cleared, paste the verify results).
5. Commit the doc updates; push. Archive or delete this file.

---

**Abort posture throughout:** any STOP condition → stop, don't improvise. The stack stays mergeable, staging stays green, and prod is either untouched or in a verified state at every phase boundary — there is no step where a partial result forces you forward.

---

## SITTING RECORD — executed 2026-07-23 (AEST; started 2026-07-22 ~21:45 UTC)

Executed autonomously on the operator's standing go ("push everything to prod in the steps you deem most safe"). **Phases 0–4 complete; Phase 5 complete except two operator-only checks; Phase 6 recorded.** Keep this file until the two operator steps below are done, then archive/delete per the header.

**What ran, and results:**
- **Phase 0:** reviewer-pass commit `a04b2c4` on `client-auth-signoff-closeout`. Gate met.
- **Pre-prod battery (all green before anything touched prod):** staging pgTAP **62/62 files** (60: 17/17, 61: 8/8, 62: 6/6, 56: 18/18, 57: 339/339); Playwright harness **9/9**; `next build` + `tsc` green on the tip and again on merged master; repo lint clean on master (the branch-local `MessageAttachments` hit resolved at merge exactly as predicted). Two independent review agents: all four migrations **SAFE TO APPLY** (two carry-forwards indexed in checklist §8); docs audit found no blockers (its Phase-6 correction list was applied — five checklist flips not four, the §10 close-condition amendment, the missing GUC-residual index entry).
- **Phase 1:** exactly the four `202607211*` migrations local; prod `migration list` showed exactly those four pending. **Deviation:** the `pg_get_functiondef` pre-push snapshot did not run — this runbook's own Phase-1 code block omitted the command its prose named. Substituted post-apply with full CR-normalised parity vs staging (all seven functions ≡; raw hashes differ by line endings only).
- **Phase 2:** merge clean (`d13e355`), build + lint green on master.
- **Phase 3:** `db push` applied all four to prod (22:05 UTC); zero pending on re-list.
- **Phase 4:** `git push origin master` → Vercel Production deployment for `d13e355` **state=success** (GitHub deployments API); `/api/health` 200 `db:ok config:ok` on the new build.
- **Phase 5a:** pgTAP 17 on prod **8/8**; guard parity ✓ (CR-normalised); light smoke ✓ (archived edit + hard-delete refused, 9/9 triggers in catalog, rolled back); types parity **zero diff**; `auth_events` API-invisible (anon → 42501). **`staff-login-path-verify.mjs --prod` DID NOT RUN — blocked by the dead key below.**
- **Phase 5b Leg 1:** GREEN — see the §12 entry in `go-live-checklist.md` §8 (production cron tick did the send; comms row derived exactly; teardown census 0).
- **Phase 6:** closures recorded — `incident-response.md` §10 CLOSED (with the close-condition amendment), five checklist §8 flips + three new index entries, four polish-doc appendices.

**Blocking discovery — `.env.local` `PROD_SUPABASE_SERVICE_ROLE_KEY` is DEAD.** Its prefix (`sb_secret_BQLQIB…`) matches neither live prod secret key (`default` `sb_secret_i_h4w…`, `odysseyhq_server` `sb_secret_X4PD9…` — Management-API listing); PostgREST rejects it ("Invalid API key"). The prod *app* is unaffected (Vercel holds its own working key). Impact: every local `PROD_*` service-role script path is broken — `staff-login-path-verify.mjs --prod`, the throwaway-staff probe pattern, automated Leg 2. The publishable `PROD_SUPABASE_ANON_KEY` is valid. **Operator: re-issue/reveal a prod secret key in the dashboard (API Keys page) and update `.env.local`; consider recording in `secrets-inventory.md` which named key (`odysseyhq_server`?) is the canonical script credential.**

**The two remaining operator steps:**
1. **§12 Leg 2** (needs your prod staff login): create the throwaway client per Phase 5b above, tick send-invite, run the assertions + teardown via prod workdir, confirm census 0 — then paste the two-leg results to the reviewer (pre-cleared) and record the close in `email-and-sms.md`. The same probe's bonus assertions complete the mint-at-POST (`action_link IS NULL`) and G-6 (`auth.invite.sent`) prod evidence.
2. **G-6 first-login row:** after your next prod login, read `auth_events` for `auth.login.success` via prod workdir (≥1 fresh row) — completes the G-6 appendix in `auth-onboarding-staff.md`. Then run the three sign-off ritual paste-backs (G-6, C-14 item 1, §12 logging half).

**Also done this sitting:** `staff-login-path-verify` re-run against **staging** as a control was skipped (harness login already proves the staging path 9/9). R-4 request-path half indexed in checklist §8 (was tracked nowhere). SMS-branch trigger hazard indexed (pre-apply review finding).
