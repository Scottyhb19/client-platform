-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok(), is() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 52_onboarding_audit_rpc_grants
-- ============================================================================
-- Why: locks in migration 20260702130000 — the discharge of the FINAL
-- "candidate, owner-gated" bucket of the go-live-checklist §4 anon-EXECUTE
-- sweep, including client_accept_invite, THE tracked item since section 2
-- (its pre-auth-use verification is recorded in the migration header and
-- docs/polish/auth-onboarding-client.md). The Supabase auto-grant trap means
-- any future CREATE OR REPLACE on these functions silently re-grants anon —
-- this test is the tripwire, companion to 23/25/26/38.
--
--   §A anon holds EXECUTE on NOTHING here (7 functions).
--   §B caller-facing onboarding RPCs keep authenticated — the welcome flow
--      accepts an invite and the first-run flow creates the org as a
--      logged-in user; a blanket revoke would pass §A while breaking
--      onboarding, not securing it.
--   §C audit-infra internals are definer-only: authenticated stripped too.
--      They are called only from log_audit_event / migration guards /
--      pgTAP 14, all of which execute as postgres (function owner).
--
-- No fixtures, no JWT spoof — pure catalog checks as the test owner.
-- Test count: 14
-- ============================================================================

BEGIN;

SELECT plan(14);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;

-- ----------------------------------------------------------------------------
-- §A — anon must hold EXECUTE on nothing in this family.
-- ----------------------------------------------------------------------------
WITH family(ord, sig) AS (
  VALUES
    (1, 'public.client_accept_invite(uuid)'),
    (2, 'public.create_organization_with_owner(text, text, text, text)'),
    (3, 'public.staff_create_client_invite(text, text, text, date, text, text, uuid)'),
    (4, 'public.audit_resolve_org_id(text, jsonb)'),
    (5, 'public.assert_audit_resolver_coverage()'),
    (6, 'public.audit_trim_row(text, jsonb)'),
    (7, 'public.audit_diff_fields(jsonb, jsonb)')
)
INSERT INTO _tap (n, line)
SELECT ord, ok(
  NOT has_function_privilege('anon', sig, 'EXECUTE'),
  format('A%s: anon cannot execute %s', ord, sig)
)
FROM family;

-- ----------------------------------------------------------------------------
-- §B — caller-facing grants survive: authenticated must KEEP EXECUTE.
-- ----------------------------------------------------------------------------
WITH family(ord, sig) AS (
  VALUES
    (8,  'public.client_accept_invite(uuid)'),
    (9,  'public.create_organization_with_owner(text, text, text, text)'),
    (10, 'public.staff_create_client_invite(text, text, text, date, text, text, uuid)')
)
INSERT INTO _tap (n, line)
SELECT ord, ok(
  has_function_privilege('authenticated', sig, 'EXECUTE'),
  format('B%s: authenticated keeps EXECUTE on %s', ord - 7, sig)
)
FROM family;

-- ----------------------------------------------------------------------------
-- §C — audit internals are definer-only: authenticated stripped as well.
-- ----------------------------------------------------------------------------
WITH family(ord, sig) AS (
  VALUES
    (11, 'public.audit_resolve_org_id(text, jsonb)'),
    (12, 'public.assert_audit_resolver_coverage()'),
    (13, 'public.audit_trim_row(text, jsonb)'),
    (14, 'public.audit_diff_fields(jsonb, jsonb)')
)
INSERT INTO _tap (n, line)
SELECT ord, ok(
  NOT has_function_privilege('authenticated', sig, 'EXECUTE'),
  format('C%s: authenticated cannot execute audit internal %s', ord - 10, sig)
)
FROM family;

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
