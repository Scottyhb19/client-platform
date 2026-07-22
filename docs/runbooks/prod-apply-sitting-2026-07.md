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
