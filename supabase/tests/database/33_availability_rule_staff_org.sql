-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), ok() resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 33_availability_rule_staff_org
-- ============================================================================
-- Section 9 (Scheduling) — P2-11 (AVL-5, FM-15). Tripwire that the same-org
-- guard on availability_rules.staff_user_id (migration 20260616150000) is
-- installed: the BEFORE INSERT/UPDATE trigger + its function. A future
-- migration that drops either fails this test.
--
-- Catalog-only (no auth.users fixtures): the functional behaviour — reject a
-- rule whose staff_user_id is not an owner/staff member of its org — is a
-- straightforward EXISTS over user_organization_roles, and a live probe before
-- the migration confirmed zero existing rows violate it.
-- Test count: 2
-- ============================================================================

BEGIN;

SELECT plan(2);

CREATE TEMP TABLE _tap (n int PRIMARY KEY, line text NOT NULL) ON COMMIT DROP;

INSERT INTO _tap VALUES (1, ok(
  EXISTS (
    SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'availability_rules'
       AND t.tgname  = 'availability_rules_enforce_staff_org'
       AND NOT t.tgisinternal
  ),
  '1: BEFORE INSERT/UPDATE trigger availability_rules_enforce_staff_org exists'
));

INSERT INTO _tap VALUES (2, ok(
  EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'enforce_availability_rule_staff_in_org'
  ),
  '2: function enforce_availability_rule_staff_in_org exists'
));

SELECT line FROM _tap ORDER BY n;

ROLLBACK;
