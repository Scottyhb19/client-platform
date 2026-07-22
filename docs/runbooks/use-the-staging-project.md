# Environment targets — staging by default, production by explicit channel

> **Evidence base.** The staging stand-up commands were executed live on 2026-07-03 (closing `go-live-checklist.md` §5); the parity sync ran 2026-07-21; the **default flip** (this runbook's current posture) also ran 2026-07-21 — see the Verification log. The two hard-won stand-up discoveries — the `pg_cron` apply-time dependency and the `00_test_helpers.sql` before-AND-after-push ordering — both broke a real first push and are documented from the failure, not from theory.

## Posture (since 2026-07-21 — the environment-separation flip)

**The repo is linked to STAGING.** Every bare Supabase command — `db push`, `migration list`, `db query --linked`, the pgTAP runner — and the local dev server (`.env.local` default keys) target `odyssey-staging`. **Production is reached only through the explicit channels below.** This is the operative form of CLAUDE.md "Environment separation" rules 1–2; rule 3 (state your target and how it resolved) applies to every database touch regardless.

**Never run `supabase link` against the production ref.** The repo's `supabase/.temp` is the staging linkage; production is reached through the prod workdir, the `PROD_*` env keys, or a `--prod` flag — never by re-linking.

| | Staging (default) | Production (explicit) |
|---|---|---|
| Project | `odyssey-staging` / `fbtfzlgvnivgwydlijka` | `azjllcsffixswiigjqhj` |
| App (local dev) | `.env.local` default keys (`NEXT_PUBLIC_SUPABASE_URL`, …) | deployed Vercel env only — local dev never points at prod |
| CLI | bare commands (linked) | `source scripts/prod-workdir.sh` → `--workdir "$PROD_WD" --linked` |
| pgTAP | `bash scripts/run-pgtap-staging.sh` | prod workdir channel, at deploy sittings only |
| Verify scripts | default (no flag) | `--prod` (resolves `PROD_*` keys; prod-looking BASE_URL without `--prod` is refused) |
| Types | `npm run supabase:types` (resolves the linked ref, prints its target) | regenerating from prod should produce an identical file once prod is at migration parity |
| Data | **synthetic only** (`scripts/seed-staging.mjs`) | real client data — the reason this whole posture exists |

Both projects are Pro (org-level billing; no auto-pause). Staging runs Postgres 17 (created 2026-07-03); confirm prod's major version at the next explicit prod sitting if a version-sensitive feature ever matters.

**What staging is:** a database-layer clone — all migrations, the pgTAP helpers, the same extensions, prod-matched auth config (custom-access-token hook registered / G-1 GREEN, HIBP on, min password length 12, session time-box 720 h), storage buckets wherever migrations create them, **plus synthetic seed data** (below).
**What staging is not:** a full environment clone. It has **no** deployed Edge Functions, no Vault `cron_shared_secret` entry, no SMTP (GoTrue auth email never sends from staging), and no Vercel app pointing at it. Anything that depends on Edge Functions, Vault, SMTP, or the Vercel app must still be verified on prod at a deploy sitting. **Note:** the app's own Resend sends (invites, notifications) DO send real email from local dev — the seed uses `@resend.dev` sink addresses everywhere so nothing synthetic can reach a human or bounce.

## Synthetic seed data

`scripts/seed-staging.mjs` seeds staging with a fully synthetic dataset. It refuses to run against any project except `STAGING_PROJECT_REF`. Two orgs mirror production's org **names** ("The Odyssey. Platform", "The Exercise Collaborative") so org-name-targeting scripts (e.g. the conditioning library seed) run unchanged and cross-tenant surfaces are exercisable — but every client, program, note, appointment, and message is fake, and every email address is a `delivered+…@resend.dev` sink. Dev logins are written to `.env.local` (`STAGING_DEV_LOGIN_*`, `STAGING_DEV_CLIENT_*`) — synthetic staging-only credentials, catalogued in `docs/secrets-inventory.md`.

```bash
cd "C:\Users\scott\Desktop\Client Software Platform"
node scripts/seed-staging.mjs           # refuses if the seed org already exists
```

Re-seed after any `db reset` (Fresh rebuild step 8). **Do not put identifiable client data in staging — ever.** Its entire value is being consequence-free.

## Routine use (staging — the default)

### Step 1 — liveness probe

```bash
cd "C:\Users\scott\Desktop\Client Software Platform"
URL=$(grep '^STAGING_DB_URL=' .env.local | cut -d= -f2- | tr -d '\r')
supabase db query --db-url "$URL" "select 1 as ok"
```

### Step 2 — sync migrations

```bash
supabase db push --yes        # bare = staging (the repo link)
```

### Step 3 — run the full pgTAP suite

```bash
bash scripts/run-pgtap-staging.sh            # run (resumes if interrupted)
bash scripts/run-pgtap-staging.sh --fresh    # discard prior results, full re-run
```

The script re-applies `00_test_helpers.sql` first (canonical helper grant posture — see Fresh rebuild step 5 for why), then runs every numbered test file and writes one verdict line per file. Exit 0 = all pass. It handles the two test generations itself: `_tap`-pattern files (09+) are gated on zero `not ok` + ok-count == `plan(N)`; old-pattern files (01–08, 14) run as a throwaway copy whose `finish()` is swapped for a `num_failed()` row, because the Management API runner only returns the last row-producing statement. (Its workdir indirection predates the flip and is now redundant — it resolves to the same staging target the link does — but harmless.)

**Intermittent empty-API-response flake (recorded 2026-07-22).** The Management API occasionally returns an empty body for a file mid-sweep — observed on four *consecutive* old-pattern files (03–06) during one run. The runner **fails closed** on this, verified: an empty response yields no `"failed": N` (old-pattern → `${failed:-x}` ≠ `0` → FAIL, logged `num_failed=parse-error`) and no `ok` lines (new-pattern → `okc=0`, the `okc -gt 0` guard fails → FAIL). Neither branch can score an empty response as zero-failures, so **a green sweep is trustworthy**. Recovery: the runner is resumable — delete the transient FAIL lines from the results file and re-run without `--fresh` (it re-runs only the missing files), or re-run the named files directly. The flake is a transport blip, not a logic failure — but confirm the re-run is genuinely green rather than assuming "cleared on re-run."

### Ad-hoc SQL

Single statement: `supabase db query --linked "…"` (or `--db-url "$URL"`). Multi-statement file: `supabase db query --linked -f "<ABSOLUTE path>"` — note `-f` is Management-API-routed; the direct `--db-url` channel rejects multi-statement SQL with `cannot insert multiple commands into a prepared statement (42601)`.

## Production — the explicit channel

Per CLAUDE.md rule 2: **production is touched only on explicit instruction from the operator in that session.** State the target and how it resolved before every operation (rule 3).

```bash
cd "C:\Users\scott\Desktop\Client Software Platform"
source scripts/prod-workdir.sh     # builds $PROD_WD from PROD_PROJECT_REF; copies config + migrations in

supabase migration list --workdir "$PROD_WD" --linked                    # read-only
supabase db query       --workdir "$PROD_WD" --linked -f "<ABSOLUTE .sql>"  # e.g. a prod pgTAP re-run at a deploy sitting
supabase db push        --workdir "$PROD_WD" --linked                    # apply migrations to PROD (deploy sittings only)
```

Authorisation comes from the CLI's stored account login (Management API) — no password needed on the `--linked` channel. If a direct connection is ever required (`--db-url`), the prod DB password is the operator's (password manager); it is deliberately **not** stored in `.env.local` or the repo. The app-level prod keys (`PROD_SUPABASE_URL` / `PROD_SUPABASE_ANON_KEY` / `PROD_SUPABASE_SERVICE_ROLE_KEY`) live in `.env.local` for the `--prod` verify scripts only.

**First-use note (recorded 2026-07-21, verify at the first prod sitting):** `db push --workdir --linked` against prod has not yet been exercised post-flip; `migration list --workdir` is the cheap first probe. If push over the Management-API channel fails, the fallback is `--db-url` with the operator supplying the password for that sitting.

**Before a prod `db push` that `CREATE OR REPLACE`s a deployed function, snapshot the live body first.** Repo migration history is authoritative for prod *only if* prod received every migration and nobody ever edited a function in the dashboard — operator discipline asserted, not verified — and `CREATE OR REPLACE` overwrites drift silently. So immediately before the push, capture the current prod body of each function the migration replaces and eyeball it against the file:

```bash
supabase db query --workdir "$PROD_WD" --linked \
  "SELECT pg_get_functiondef('public.soft_delete_client(uuid)'::regprocedure);"
supabase db query --workdir "$PROD_WD" --linked \
  "SELECT pg_get_functiondef('public.restore_client(uuid)'::regprocedure);"
```

If the live body differs from the migration's provenance base by anything other than the intended change, stop and reconcile — do not let the push overwrite drift. (Reviewer 2026-07-22, raised for `20260721120000`; applies to any migration that replaces a live function.)

## Fresh rebuild (also the recovery path after `db reset`)

The order matters — steps 3 and 5 exist because the migration chain and the test helpers are interdependent. This exact sequence was proven twice on 2026-07-03 (initial stand-up, then the reset drill).

1. **Create the project** (dashboard: Sydney; inherits the org's plan — currently Pro) — or start from a just-reset database.
2. **Enable extensions the migration chain assumes but never creates** (prod got them via dashboard, outside migrations):
   ```bash
   URL=$(grep '^STAGING_DB_URL=' .env.local | cut -d= -f2- | tr -d '\r')
   supabase db query --db-url "$URL" "CREATE EXTENSION IF NOT EXISTS pg_cron"
   supabase db query --db-url "$URL" "CREATE EXTENSION IF NOT EXISTS pg_net"
   ```
   Without `pg_cron`, the push aborts at `20260604120100_rate_limit_log_cleanup_cron.sql` (`schema "cron" does not exist`).
3. **Apply `00_test_helpers.sql`** (`supabase db query --linked -f "<ABSOLUTE path>"`). The helpers are not migrations, but migration `20260612160000` REVOKEs on them and fails with `function public._test_clear_jwt() does not exist` if they're missing.
4. **Push all migrations:** `supabase db push --yes`.
5. **Re-apply `00_test_helpers.sql`.** The revoke-sweep migrations (`20260612160000`/`20260612160100`) strip the JWT spoofers' `authenticated` EXECUTE grant as they pass; the helpers file is the canonical posture and re-running it restores the grants the suite needs (its own header documents this). Symptom if skipped: every test fails `permission denied for function _test_set_jwt`.
6. **Unschedule the prod-pointing cron jobs.** The two notification jobs carry the **prod** Edge Function URL in their command — a staging database must never poke prod:
   ```bash
   supabase db query --db-url "$URL" "select cron.unschedule('appointment-reminders-5min')"
   supabase db query --db-url "$URL" "select cron.unschedule('message-notifications-5min')"
   ```
   Keep `rate-limit-log-cleanup-hourly` (purely local DELETE, harmless).
7. **Run the suite** (Step 3 above) and confirm all-green.
8. **Re-seed the synthetic data:** `node scripts/seed-staging.mjs`.

## Destructive rehearsal — `db reset` drill

```bash
URL=$(grep '^STAGING_DB_URL=' .env.local | cut -d= -f2- | tr -d '\r')
supabase db reset --db-url "$URL" --no-seed --yes
```

(`--no-seed` because `supabase/seed.sql` is a placeholder; the real synthetic seed is `scripts/seed-staging.mjs`, run separately after recovery.)

The reset drops **all** non-migration state — including the `pg_cron`/`pg_net` extensions (observed: `NOTICE: dropping extension: pg_cron`) and the test helpers — then replays migrations. **The replay therefore stops at `20260604120100` (`relation "cron.job" does not exist`)**: the extensions die before the helpers dependency is even reached. This is expected, documented behaviour, not a failure — recover with **Fresh rebuild steps 2→8 in full**.

## Verification log

- **2026-07-03 — initial stand-up.** All 176 migrations applied (first push stopped at the documented helper dependency, resumed clean after applying helpers). First full-suite run: **55/56 files PASS** — the one failure was pgTAP `49`, whose assertion 1 still asserted the pre-CN-7 archived-client posture. Verified stale on prod too (identical failure), fixed to the CN-7 posture, re-run green on **both** targets. The staging target caught a real regression-net gap on day one: the CN-7 pass (2026-07-02) re-ran tests 17/38/46/54/56 but missed 49.
- **2026-07-03 — destructive rehearsal.** `db reset --db-url --no-seed` executed against staging; replay stopped at `20260604120100` exactly as documented above (extensions dropped by the reset); recovered per Fresh rebuild; full suite re-run via `scripts/run-pgtap-staging.sh --fresh`: **56/56 files PASS**. Prod verified untouched after the drill: 176 migrations, all 3 cron jobs scheduled, client data intact.
- **2026-07-21 — Pro upgrade + parity sync.** Org upgraded to Pro (per-org billing lifts staging too; auto-pause gone; daily physical backups present on both projects; PITR off on both — deliberately deferred). Five pending migrations applied (176 → **181**, matching prod); the `audit_wide_column_config` RLS advisory cleared; `message-attachments` storage bucket created. Auth config patched to prod parity via Management API (min length 12, time-box 720 h, HIBP on) and `verify-auth-config.mjs` run against staging: **G-1 / G-3 / G-3u GREEN** (G-7 CND — no SMTP; G-4 DOC). Full suite `--fresh`: **59/59 files PASS** (incl. new suites 58 + 59). Side effect: the script bootstrapped the inert memberless verification org `verify-auth-config-probe` (`73a63b1c-60fa-4278-a98b-f3e7bab76ffd`) on staging.
- **2026-07-21 — the default flip (environment separation closed).** `.env.local` default keys re-pointed at staging (prod preserved under `PROD_*`); repo re-linked to staging (`supabase link` — the one sanctioned use); `gen-types.mjs` re-based on the linked ref (staging regen produced a 4-line additive diff — the committed types were one regen stale, not a schema divergence); `--prod` flags added to `verify-auth-config.mjs`, `staff-login-path-verify.mjs`, `proxy-poison-cookie-verify.mjs` (with a prod-URL-without-flag refusal); `scripts/prod-workdir.sh` added as the explicit prod channel; synthetic seed landed (`scripts/seed-staging.mjs`). See the CLAUDE.md "Environment separation" section (now marked Operative).
