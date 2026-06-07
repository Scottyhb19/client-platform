# Runbook — Verify cross-tenant isolation (manual)

> Decision and design cited from `docs/polish/auth-onboarding-staff.md` (premortem R-4; "A.1 resolution"). This is the **manual, by-hand compensation** for the deferred automated pgTAP cross-tenant test (diagnostic CRITICAL #5; README "Suggested runbooks" #1). It is deliberately independent of `scripts/verify-auth-config.mjs` and uses **ephemeral throwaway orgs/users created for the occasion and torn down after** — no permanent seed accounts.
>
> Division of labour: `verify-auth-config.md` G-1 proves the JWT **hook injects** `organization_id`. This runbook proves the **RLS policies isolate** given that `organization_id`. Both are needed; neither substitutes for the other.

**Purpose:** Confirm by hand that one organisation cannot read, update, or insert into another organisation's rows across the eight core tenant tables — the highest-impact failure mode in a multi-tenant system, and the one with no automated regression net while R-4 is deferred.

**Prerequisites**

- DB access via the Supabase SQL Editor (runs as a privileged role that bypasses RLS — used here both to read UUIDs and to *simulate* an authenticated user via claims).
- The ability to self-signup two orgs via the app (`/signup` → `/onboarding/org`).
- `docs/incident-response.md` to hand, in case a leak is found (it is a P0).

**When to run**

- After the dashboard-config first run (`verify-auth-config.md`) closes.
- On **every migration that touches RLS policies, the JWT hook, the auth helpers, or any core tenant table's shape**.
- **Before any second practitioner account is created** (the R-4 deferral trigger).

**Steps**

*Setup — two ephemeral orgs with data (recognisable, throwaway).*

1. Self-signup Org A via the app: owner email `verify-xtenant-a@verify.invalid` (or a real address if confirmations require it), practice name `verify-xtenant-a`. As that owner, create one **client**, one **clinical note** on that client, and one **program** on that client.
2. Self-signup Org B the same way: owner `verify-xtenant-b@verify.invalid`, practice name `verify-xtenant-b`. Create one client of its own (a known-good baseline).
3. In the SQL Editor (privileged — bypasses RLS), read the identifiers you'll need:
   ```sql
   -- [verify-cross-tenant] resolve org + owner UUIDs
   SELECT o.id AS org_id, o.slug, r.user_id, r.role
   FROM organizations o
   JOIN user_organization_roles r ON r.organization_id = o.id
   WHERE o.slug IN ('verify-xtenant-a', 'verify-xtenant-b');
   ```
   ```sql
   -- [verify-cross-tenant] note Org A's row ids (the rows Org B must NOT see)
   SELECT id, organization_id FROM clients        WHERE organization_id = '<orgA_id>';
   SELECT id, organization_id FROM clinical_notes WHERE organization_id = '<orgA_id>';
   SELECT id, organization_id FROM programs       WHERE organization_id = '<orgA_id>';
   ```

*Read isolation — simulate Org B's owner and confirm Org A is invisible.*

4. In the SQL Editor, run the impersonation transaction below. `set_config(..., true)` scopes the fake claims to the transaction; `SET LOCAL ROLE authenticated` makes RLS apply as it would for a real signed-in user. The `ROLLBACK` guarantees nothing persists.
   ```sql
   -- [verify-cross-tenant] read isolation as Org B's owner
   BEGIN;
   SELECT set_config(
     'request.jwt.claims',
     '{"sub":"<orgB_owner_user_id>","role":"authenticated","organization_id":"<orgB_id>","user_role":"owner"}',
     true
   );
   SET LOCAL ROLE authenticated;

   -- Each of the eight core tenant tables. Expect ONLY Org B rows (often zero,
   -- since Org B has minimal data) and NEVER an Org A organization_id.
   SELECT id, organization_id FROM clients;
   SELECT id, organization_id FROM clinical_notes;
   SELECT id, organization_id FROM programs;
   SELECT id, organization_id FROM sessions;
   SELECT id, organization_id FROM appointments;
   SELECT id, organization_id FROM communications;
   SELECT id, organization_id FROM reports;
   SELECT id, organization_id FROM audit_log;

   -- Targeted: the specific Org A rows from step 3 must return ZERO rows.
   SELECT id FROM clients        WHERE id = '<orgA_client_id>';
   SELECT id FROM clinical_notes WHERE id = '<orgA_note_id>';
   SELECT id FROM programs       WHERE id = '<orgA_program_id>';

   RESET ROLE;
   ROLLBACK;
   ```

*Write isolation — confirm Org B cannot tamper with Org A.*

5. Still as Org B's simulated owner, confirm writes are denied. The `ROLLBACK` undoes anything that unexpectedly succeeds.
   ```sql
   -- [verify-cross-tenant] write isolation as Org B's owner
   BEGIN;
   SELECT set_config(
     'request.jwt.claims',
     '{"sub":"<orgB_owner_user_id>","role":"authenticated","organization_id":"<orgB_id>","user_role":"owner"}',
     true
   );
   SET LOCAL ROLE authenticated;

   -- UPDATE an Org A row: expect 0 rows affected.
   UPDATE clients SET first_name = 'tampered' WHERE id = '<orgA_client_id>';

   -- INSERT into Org A: expect an RLS violation (or 0 rows).
   INSERT INTO clients (organization_id, first_name, last_name, email)
   VALUES ('<orgA_id>', 'X', 'Y', 'xtenant-write@verify.invalid');

   RESET ROLE;
   ROLLBACK;
   ```

**Verification (what healthy looks like)**

- Step 4: every SELECT returns only Org B rows; no row carries Org A's `organization_id`; the three targeted Org-A lookups return **zero rows**.
- Step 5: the UPDATE reports **0 rows affected**; the INSERT **fails** with a row-level-security violation (or inserts 0 rows). The `ROLLBACK` leaves both orgs untouched regardless.
- Record a dated line in this file's log section (below): date, who ran it, "all checks pass" or the specific failing check.

**If a leak is found**

Any Org-A row visible, updatable, or insertable from Org B's context is a **P0**. Halt, do not proceed with any further operation, and follow `docs/incident-response.md` (`auth.cross_tenant_access_attempt` is an S0-class event). The most likely root causes to check first: a policy using `USING (true)` or omitting the `organization_id = user_organization_id()` predicate; a `SECURITY DEFINER` function with caller-tainted input escaping its WHERE; or `FORCE ROW LEVEL SECURITY` absent on a table whose owner role is being used.

**Teardown — remove both throwaway orgs (heavier than the script's probe users)**

These owners are **owner**-role members, so teardown is **not** the light non-owner path used by `verify-auth-config.mjs`. It requires the documented service-role org-cleanup pattern: surgically `DISABLE TRIGGER enforce_last_owner_invariant`, delete in FK order leaf→root (the created `clients`/`clinical_notes`/`programs`/`sessions`/etc., then `user_organization_roles`, then the seeded lookup rows, then `audit_log` rows for the org, then `organizations`), re-enable the trigger, then `admin.deleteUser` each owner. Run it as a one-off service-role script or SQL Editor block scoped to the two `verify-xtenant-*` orgs by id. Confirm both orgs and both users are gone afterward:
```sql
-- [verify-cross-tenant] confirm teardown
SELECT id, slug FROM organizations WHERE slug IN ('verify-xtenant-a', 'verify-xtenant-b'); -- expect 0 rows
```

**Rollback**

N/A for the test itself — every impersonation block is wrapped in `BEGIN … ROLLBACK`, so the read/write probes persist nothing. The only persistent artefacts are the two setup orgs, removed by the teardown above.

**Retirement**

When the automated pgTAP cross-tenant test lands (R-4 closure / README suggested-runbook #1), downgrade this manual procedure to a quarterly check or retire it. Note that here when it happens.

---

## Run log

| Date | Run by | Result |
|---|---|---|
| 2026-06-07 | Operator (with Claude Code preparing SQL blocks) | **All checks pass.** Two ephemeral orgs self-signed-up via the localhost:3000 front door against the live project (slugs `verify-xtenant-a`, `verify-xtenant-b`). Org A seeded with one client, one clinical_note, and one program; Org B seeded with one client. Impersonating Org B's owner via `set_config('request.jwt.claims', ...)` + `SET LOCAL ROLE authenticated`: read probe across the eight core tenant tables returned only Org B rows (one Bravo client + eighteen audit_log rows attributed to Org B's signup/seed/INSERT) with zero Org A rows visible, and the three targeted Org-A row-id lookups returned zero. Write probes denied as expected — `UPDATE` on Org A's client returned `rows_affected = 0`, `INSERT` into Org A raised `42501: new row violates row-level security policy for table "clients"`. Multi-tenant boundary verified for the eight tables. Note: the SQL block was a structural deviation from the runbook's literal form — the eight per-table SELECTs were collapsed into one UNION ALL result set so the SQL Editor surfaced the full output instead of swallowing all but the last. The RLS predicates exercised were identical. **Teardown:** completed and verified clean in the same session — both verify orgs, both owners, both `user_profiles`, all tenant rows, and all 55 audit_log rows returned 0 on a post-COMMIT confirmation census. The teardown SQL was built from two read-only live-catalog diagnostics rather than from the migration files (two earlier hand-built attempts hit column/table drift): a per-table census of org-scoped row counts (`information_schema.columns` where `column_name='organization_id'`) and the full FK delete-rule graph (`pg_constraint`), so the delete set and order were derived from the live schema, not inferred. The program subtree was deleted explicitly bottom-up before `programs` so cascade-orphan audit rows (NULL org) were not generated. |
