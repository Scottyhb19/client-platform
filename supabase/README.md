# Supabase

Schema, migrations, edge functions, and pgTAP tests for the Client Platform database.

This directory is the backend source of truth. Every schema change lives here as a migration; nothing is ever edited in the Supabase dashboard.

---

## Directory structure

```
supabase/
├── config.toml              Supabase CLI project config (committed to git)
├── seed.sql                 Local dev seed data (committed — no PHI, no real secrets)
├── migrations/              Timestamped SQL migrations, applied in lexicographic order
├── tests/                   pgTAP test files — run via `supabase test db`
└── functions/               Edge Functions (Deno) — reminder scheduler, retention purge, etc.
```

---

## Prerequisites

1. **Install the Supabase CLI**:
   ```
   npm install -g supabase          # or: scoop install supabase (Windows), brew install supabase/tap/supabase (macOS)
   ```
2. **Docker Desktop** — required for local dev (`supabase start`). Download from docker.com.
3. **A Supabase account** at supabase.com (free tier is fine for dev).

---

## First-time setup (dev)

```bash
# 1. Create a new Supabase project on the dashboard (free tier, region: ap-southeast-2).
#    Copy the project-ref from Settings → General.

# 2. Link this repo to that project
supabase link --project-ref <your-project-ref>

# 3. Start a local Supabase stack (Postgres + Auth + Storage, all in Docker)
supabase start

# 4. Apply all migrations to your local DB
supabase db reset

# 5. Or push migrations to the linked cloud project
supabase db push

# 6. Enable the Custom Access Token Hook:
#    Dashboard → Authentication → Hooks → Custom Access Token
#    Set URI to: pg-functions://postgres/auth_hooks/custom_access_token
#    Without this, RLS has no organization context and all policies fail closed.
```

---

## Migration conventions

- **Naming:** `YYYYMMDDHHMMSS_<snake_case_description>.sql`. Supabase CLI applies in lexicographic order.
- **One logical change per file.** Grouped by topic (identity, clinical core, programs, etc.) — see the existing set.
- **Every migration has a header comment** explaining what it does and why.
- **Every migration is reversible** where the cost is reasonable. Destructive migrations call it out in the header and in the commit message.
- **No data migrations in schema migrations** — if you need to backfill data, it lives in a separate migration file that runs after the schema change.

Create a new migration:
```
supabase migration new <short_description>
```

---

## Test conventions

- **Tests live in `supabase/tests/`** as `.sql` files using the pgTAP framework.
- **Every RLS policy has at least two tests** — one proving authorized access works, one proving unauthorized access fails.
- **Global invariant tests** live in `supabase/tests/invariants/`.

Run the suite:
```
supabase test db
```

See `/docs/rls-policies.md` §7 for the full test coverage matrix.

---

## Deploy to production

**Do not deploy until the go-live checklist (`/docs/go-live-checklist.md`, Gate 3 deliverable) is green.** In particular:

- Supabase project upgraded to Pro (PITR + daily backups).
- Custom Access Token Hook configured.
- All pgTAP tests passing in CI.
- First DR drill completed and documented.
- Production secrets set via environment variables, never in migrations.

When those are true:
```
supabase db push --project-ref <production-ref>
```

Monitor Supabase logs for 15 minutes afterwards. Any error in a migration is treated as an incident (IR-02 in `/docs/incident-response.md`).

---

## Cross-references

- Schema: `/docs/schema.md`
- Auth flows: `/docs/auth.md`
- RLS policy map: `/docs/rls-policies.md`
- SLOs: `/docs/slos.md`
- Incident response: `/docs/incident-response.md`
