# audit_wide_column_config — RLS lockdown (health-check P0-3)

**Status: APPLIED 2026-07-09 — acceptance green; awaiting the operator's commit.** The
deny-all assumption (§4) was confirmed by the operator: audit-snapshot truncation is
platform infrastructure, not an EP-facing runtime setting, so the CLAUDE.md runtime-config
principle does not reach it — it stays migration-managed. Migration `20260709120000` was
applied to the live project and the acceptance gate (§7) is green. This was a new security
surface (a table with no RLS, writable by any authenticated principal), so per CLAUDE.md's
dogfooding-loop rule it ran the polish-pass protocol rather than shipping as a quick patch.
The operator commits the change (Claude Code does not).

**Provenance:** `docs/health-check-2026-07-09.md` Area 2, P0-3. The 2026-07-09 read-only
health check found `audit_wide_column_config` is the only table in `public` with RLS
disabled, and a live grant probe showed `authenticated` holds full INSERT/UPDATE/DELETE on
it via PostgREST.

---

## 1. What the table is (audit)

`audit_wide_column_config` (created `20260420102300_audit_log_and_triggers.sql:29`) is a
**global, non-tenant config table** (no `organization_id`). It lists which
`(table_name, column_name)` pairs the audit machinery truncates in `audit_log` snapshots —
read at `…102300:135` (`SELECT column_name FROM public.audit_wide_column_config WHERE
table_name = p_table`). It is populated only by migrations (`…102300:38`,
`20260428120900:147`, `20260611130200:20`). Nothing in `src/` reads or writes it
(verified: `grep -rn audit_wide_column_config src/` → one hit, the generated type in
`src/types/database.ts:350`; no runtime query).

**Live state (probe, 2026-07-09):**
- `pg_class`: `rls = false`, `forced = false`, `owner = postgres`.
- `information_schema.role_table_grants`: `authenticated` holds `SELECT, INSERT, UPDATE,
  DELETE` (+ REFERENCES/TRIGGER/TRUNCATE); `service_role` the same; `anon` absent (stripped
  by `20260702170000`).

## 2. The finding

RLS off + `authenticated` DML grants ⇒ **any authenticated JWT (including a portal
client's) can read and, worse, write this table through raw PostgREST.** A hostile INSERT
(e.g. `('clinical_notes','content_json')`) silently truncates future audit snapshots of that
column; a DELETE removes truncation config. Not a PHI-disclosure hole — an **audit-integrity
tamper vector** against the §7.4 audit trail the compliance posture depends on. It is the
only table in the schema in this state; `54_anon_table_grants.sql` covers *anon* only, so no
tripwire exists for the *authenticated* path.

## 3. How the siblings are locked (pattern to match)

- `audit_log` itself: RLS enabled (`20260420102300:98`), INSERT restricted to the audit
  writer, SELECT scoped to org members — but it is *tenant* data (`organization_id`).
- `password_recovery_tickets`: **RLS enabled, zero policies — deliberate default-deny**
  (`20260527140000:111-131`). This is the closest sibling: a non-tenant, security-sensitive
  table that no API role should touch. `audit_wide_column_config` matches that shape, so the
  fix mirrors it: **enable RLS, add no policy (deny-all-by-default), revoke the API-role
  grants.**

## 4. Surfaced assumption — CONFIRM against the stack before applying

The fix rests on one assumption I am **stating, not asserting as settled**:

> **The only legitimate writer is migrations (postgres); the only legitimate reader is the
> audit trigger chain, which runs as postgres and bypasses non-forced RLS. No API role
> (anon or authenticated) needs to read or write this table.**

Evidence it holds today:
- Reader path runs as postgres. Live probe: `log_audit_event` is **SECURITY DEFINER owned by
  postgres**; `audit_trim_row` / `audit_diff_fields` are invoker functions called *within*
  that definer context, so their effective user is postgres. postgres **owns** the table and
  RLS is **not forced**, so the owner bypasses RLS — truncation keeps working after RLS is
  enabled. (This is why the migration must **not** use `FORCE ROW LEVEL SECURITY`: forcing
  would subject even the owner to RLS and break the audit read.)
- Writer path is migrations (postgres) — same bypass.
- No app reader: `grep` over `src/` finds only the generated type.

**Where the assumption could be wrong — your call:** if you intend
`audit_wide_column_config` to become **settings-editable at runtime** (the CLAUDE.md
runtime-config principle — "the EP must be able to change configuration through settings
without a code change"), then deny-all is the wrong end state: it would need an
owner/authenticated-scoped policy (and an org dimension if it ever became per-tenant)
instead. Today it is migration-managed and nothing edits it through the UI, so deny-all is
correct *now*. Confirm you are not planning to make it settings-editable before signing off;
if you are, the fix shape changes.

## 5. Premortem (ranked)

| # | Failure mode | Likelihood | Mitigation |
|---|---|---|---|
| 1 | Enabling RLS breaks audit truncation (reader loses access). | Would be high if the reader weren't owner-privileged | **Mitigated** — reader chain runs as postgres (owner) and RLS is not forced → bypasses. Verified by the ownership probe. Acceptance re-runs the audit pgTAP suite to prove it. |
| 2 | `FORCE RLS` used by reflex → owner subjected to RLS → truncation breaks. | Medium (easy reflex) | **Avoided by design** — migration enables RLS **without** FORCE; the comment states why. |
| 3 | Revoking `authenticated` breaks a real reader. | Low | **Mitigated** — no runtime reader in `src/` (only the generated type). |
| 4 | deny-all is wrong because the table is meant to be settings-editable. | Unknown — operator's call | **Surfaced (§4)** — not mitigated in code; gated on operator confirmation before apply. |
| 5 | New-migration timestamp collides with a concurrent session's. | Low | Re-check the migrations head at apply time; renumber above it (repo's standing collision guard). |

## 6. Gap + fix

**P0-3.** `audit_wide_column_config` has RLS off and is authenticated-writable.

**Fix (prepared, in scratchpad — intended path
`supabase/migrations/20260709120000_audit_wide_column_config_rls.sql`):**
- `ALTER TABLE … ENABLE ROW LEVEL SECURITY` (no FORCE) → deny-all for API roles (no policy,
  matching `password_recovery_tickets`).
- `REVOKE ALL … FROM authenticated` (and a no-op guard revoke from `anon`) → deny at the
  grant layer too (belt-and-suspenders, the §4b posture). `service_role` (server-only,
  trusted) and `postgres` (owner/migrations + definer reads) retain access.
- `COMMENT ON TABLE …` documenting the deny-all-by-design intent so a future reader does not
  misread "RLS on, 0 policies" as a forgotten policy.
- Reversal included as commented SQL.

**Tripwire (prepared, intended path
`supabase/tests/database/58_audit_wide_column_config_rls.sql`):** asserts RLS enabled,
`authenticated` denied INSERT/UPDATE/DELETE at both grant and functional layers, the config
data intact + readable by the owner, and `service_role` retained.

## 7. Acceptance — RAN 2026-07-09, all green

1. **Applied** via `supabase db push` (`20260709120000` alongside the revoke-idiom sibling
   `20260709130000`) — both "Applying migration …" / "Finished". ✓
2. **`58_audit_wide_column_config_rls.sql` → 8/8 on live** (RLS enabled + not forced;
   authenticated denied INSERT/UPDATE/DELETE at grant + functional layers; config intact +
   owner-readable; service_role retained). ✓
3. **Full pgTAP suite re-run on live → 58/58 files pass, 0 fail** — including
   `14_audit_resolve_org_id_coverage`, `17`/`57` cross-tenant isolation, and every grant
   suite (23/25/26/38/52/54). Proves the definer read path and tenant isolation are
   unaffected by enabling RLS. ✓
4. **Live re-probe:** `rls = true`, not forced; a role-switched `authenticated` session is
   denied INSERT/UPDATE/DELETE (42501 each); and a definer-as-postgres audited INSERT
   (`movement_patterns`) still wrote its `audit_log` row (10686→10687) — the truncation-config
   read survives RLS. ✓

*Applied and verified; the operator runs the commit.*
