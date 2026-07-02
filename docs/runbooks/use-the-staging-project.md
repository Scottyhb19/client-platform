# Use the staging project

> **Evidence base.** Every command below was executed live on 2026-07-03 while standing up `odyssey-staging` and closing `go-live-checklist.md` §5 (non-prod test target). Nothing here is inferred. The two hard-won discoveries — the `pg_cron` apply-time dependency and the `00_test_helpers.sql` before-AND-after-push ordering — both broke a real first push and are documented from the failure, not from theory.

## Purpose

A second, disposable Supabase project that lets us do the things that can never be risked on prod: rehearse destructive migrations, run a real `db reset`, and run the full pgTAP suite somewhere a mistake costs nothing. Prod (`azjllcsffixswiigjqhj`) remains the linked project of this repo at all times; staging is reached only through the explicit channels below.

**What staging is:** a database-layer clone — all migrations, the pgTAP helpers, the same extensions.
**What staging is not:** a full environment clone. It has **no** deployed Edge Functions, no Vault `cron_shared_secret` entry, no Auth dashboard config (custom-access-token hook registration, SMTP), no storage buckets, and no Vercel app pointing at it. The pgTAP suite is unaffected (it spoofs JWTs via GUCs and never touches those surfaces), but anything that depends on them must still be verified on prod.

## Project facts

| | |
|---|---|
| Name | `odyssey-staging` |
| Project ref | `fbtfzlgvnivgwydlijka` |
| Region | ap-southeast-2 (Sydney, same as prod) |
| Tier | Free |
| Created | 2026-07-03 (operator), wired same day |

**Free-tier auto-pause:** the project pauses after ~1 week idle. Wake it from the Supabase dashboard (project page → Restore/Resume, takes a minute or two) before any session, then confirm with the wake probe in Step 1.

**Credentials** live in `.env.local` (gitignored) as `STAGING_PROJECT_REF`, `STAGING_DB_PASSWORD`, and the assembled `STAGING_DB_URL` (session pooler, port 5432: `postgresql://postgres.<ref>:<password>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres`). Catalogued in `docs/secrets-inventory.md`. The password must be percent-encoded if it ever contains URL-special characters (the current generated one doesn't).

## The two channels (and why there are two)

All commands run from the repo root in **Git Bash** (from PowerShell, prefix with `bash -c '...'` or just run the snippets inside `bash`).

1. **Direct connection — `--db-url`.** Works for `supabase db push`, `supabase db reset`, and single-statement `supabase db query`. It does **not** work for multi-statement SQL (inline or `-f` file): the CLI uses the extended protocol and Postgres rejects it with `cannot insert multiple commands into a prepared statement (42601)`.

2. **Management API — the workdir trick.** `supabase db query --linked -f <file>` handles whole multi-statement files (this is the established prod pgTAP runner), but `--linked` resolves its target from `<workdir>/supabase/.temp/project-ref`. Pointing a throwaway workdir at the staging ref redirects it without ever re-linking the repo:

   ```bash
   SWD="${TMPDIR:-/tmp}/odyssey-staging-workdir"
   mkdir -p "$SWD/supabase/.temp"
   grep '^STAGING_PROJECT_REF=' .env.local | cut -d= -f2- | tr -d '\r' > "$SWD/supabase/.temp/project-ref"
   cp supabase/config.toml "$SWD/supabase/config.toml"
   supabase db query --workdir "$SWD" --linked -f "<ABSOLUTE path to .sql file>" -o json
   ```

   Note `-f` resolves relative to the workdir — always pass an absolute path. Authorisation comes from the CLI's stored account login, so no password is needed on this channel.

**Never run `supabase link` against the staging ref.** The repo's `supabase/.temp` is the prod linkage; both channels above deliberately leave it untouched.

## Routine use

### Step 1 — wake probe

```bash
cd "C:\Users\scott\Desktop\Client Software Platform"
URL=$(grep '^STAGING_DB_URL=' .env.local | cut -d= -f2- | tr -d '\r')
supabase db query --db-url "$URL" "select 1 as ok"
```

If this hangs or errors and the project has been idle a week+, wake it in the dashboard and retry.

### Step 2 — sync migrations

```bash
URL=$(grep '^STAGING_DB_URL=' .env.local | cut -d= -f2- | tr -d '\r')
supabase db push --db-url "$URL" --yes
```

Brings staging up to the repo's migration set (applies only what's missing). Run this before any test session so staging matches the code under test.

### Step 3 — run the full pgTAP suite

```bash
bash scripts/run-pgtap-staging.sh            # run (resumes if interrupted)
bash scripts/run-pgtap-staging.sh --fresh    # discard prior results, full re-run
```

The script re-applies `00_test_helpers.sql` first (canonical helper grant posture — see Fresh rebuild step 5 for why), then runs every numbered test file and writes one verdict line per file. Exit 0 = all pass. It handles the two test generations itself: `_tap`-pattern files (09+) are gated on zero `not ok` + ok-count == `plan(N)`; old-pattern files (01–08, 14) run as a throwaway copy whose `finish()` is swapped for a `num_failed()` row, because the Management API runner only returns the last row-producing statement.

### Ad-hoc SQL

Single statement: `supabase db query --db-url "$URL" "…"`. Multi-statement file: the workdir channel above.

## Fresh rebuild (also the recovery path after `db reset`)

The order matters — steps 3 and 5 exist because the migration chain and the test helpers are interdependent. This exact sequence was proven twice on 2026-07-03 (initial stand-up, then the reset drill).

1. **Create the project** (dashboard: Sydney, Free) — or start from a just-reset database.
2. **Enable extensions the migration chain assumes but never creates** (prod got them via dashboard, outside migrations):
   ```bash
   supabase db query --db-url "$URL" "CREATE EXTENSION IF NOT EXISTS pg_cron"
   supabase db query --db-url "$URL" "CREATE EXTENSION IF NOT EXISTS pg_net"
   ```
   Without `pg_cron`, the push aborts at `20260604120100_rate_limit_log_cleanup_cron.sql` (`schema "cron" does not exist`).
3. **Apply `00_test_helpers.sql`** (workdir channel, absolute path). The helpers are not migrations, but migration `20260612160000` REVOKEs on them and fails with `function public._test_clear_jwt() does not exist` if they're missing.
4. **Push all migrations:** `supabase db push --db-url "$URL" --yes`.
5. **Re-apply `00_test_helpers.sql`.** The revoke-sweep migrations (`20260612160000`/`20260612160100`) strip the JWT spoofers' `authenticated` EXECUTE grant as they pass; the helpers file is the canonical posture and re-running it restores the grants the suite needs (its own header documents this). Symptom if skipped: every test fails `permission denied for function _test_set_jwt`.
6. **Unschedule the prod-pointing cron jobs.** The two notification jobs carry the **prod** Edge Function URL in their command — a staging database must never poke prod:
   ```bash
   supabase db query --db-url "$URL" "select cron.unschedule('appointment-reminders-5min')"
   supabase db query --db-url "$URL" "select cron.unschedule('message-notifications-5min')"
   ```
   Keep `rate-limit-log-cleanup-hourly` (purely local DELETE, harmless).
7. **Run the suite** (Step 3 above) and confirm all-green.

## Destructive rehearsal — `db reset` drill

```bash
supabase db reset --db-url "$URL" --no-seed --yes
```

(`--no-seed` because `supabase/seed.sql` is local-dev fixture data; staging stays prod-shaped, and pgTAP builds its own fixtures.)

The reset drops **all** non-migration state — including the `pg_cron`/`pg_net` extensions (observed: `NOTICE: dropping extension: pg_cron`) and the test helpers — then replays migrations. **The replay therefore stops at `20260604120100` (`relation "cron.job" does not exist`)**: the extensions die before the helpers dependency is even reached. This is expected, documented behaviour, not a failure — recover with **Fresh rebuild steps 2→7 in full** (extensions → helpers → push → helpers again → unschedule crons → suite).

Drill result 2026-07-03: see the Verification log below.

## Verification log

- **2026-07-03 — initial stand-up.** All 176 migrations applied (first push stopped at the documented helper dependency, resumed clean after applying helpers). First full-suite run: **55/56 files PASS** — the one failure was pgTAP `49`, whose assertion 1 still asserted the pre-CN-7 archived-client-invisible posture. Verified stale on prod too (identical failure), fixed to the CN-7 posture, re-run green on **both** targets. The staging target caught a real regression-net gap on day one: the CN-7 pass (2026-07-02) re-ran tests 17/38/46/54/56 but missed 49.
- **2026-07-03 — destructive rehearsal.** `db reset --db-url --no-seed` executed against staging; replay stopped at `20260604120100` exactly as documented above (extensions dropped by the reset); recovered per Fresh rebuild steps 2→7; full suite re-run via `scripts/run-pgtap-staging.sh --fresh`: **56/56 files PASS**. Prod verified untouched after the drill: 176 migrations, all 3 cron jobs scheduled, client data intact.

## Rollback

None needed — staging holds no real data, ever. Worst case: delete the project in the dashboard and repeat Fresh rebuild (~15 minutes). **Do not put identifiable client data in staging** — its entire value is being consequence-free.
