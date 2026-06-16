-- ============================================================================
-- 20260616150000_availability_rule_staff_org
-- ============================================================================
-- Section 9 (Scheduling) — P2-11 (AVL-5, FM-15).
--
-- availability_rules.staff_user_id had no same-org guard, unlike
-- appointments.client_id (which has appointments_enforce_client_org). An owner
-- could author an availability rule for a staff_user_id who isn't a member of
-- the rule's organization — ghost slots that can't be booked.
--
-- The generic enforce_same_org_fk('user_profiles', …) can't be used here:
-- user_profiles has no organization_id (membership lives in
-- user_organization_roles). So this is a bespoke BEFORE INSERT/UPDATE check
-- that the staff_user_id is an owner/staff member of NEW.organization_id.
--
-- Zero behaviour change at solo / single-staff scope (the EP authors rules for
-- themselves, an owner of their own org). Additive + backward-compatible — a
-- live probe confirmed no existing availability_rules row violates it, so no
-- future UPDATE (e.g. a soft-delete) on existing data can trip it. This is a
-- trigger function (RETURNS trigger, not SECURITY DEFINER, not directly
-- invocable), so there is no anon-EXECUTE concern.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_availability_rule_staff_in_org()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM user_organization_roles uor
     WHERE uor.user_id         = NEW.staff_user_id
       AND uor.organization_id = NEW.organization_id
       AND uor.role IN ('owner', 'staff')
  ) THEN
    RAISE EXCEPTION
      'staff_user_id % is not an owner/staff member of organization %',
      NEW.staff_user_id, NEW.organization_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_availability_rule_staff_in_org() IS
  'Reject an availability_rule whose staff_user_id is not an owner/staff member of its organization (Section 9 P2-11 / AVL-5). Membership is via user_organization_roles since user_profiles carries no organization_id.';

DROP TRIGGER IF EXISTS availability_rules_enforce_staff_org ON availability_rules;
CREATE TRIGGER availability_rules_enforce_staff_org
  BEFORE INSERT OR UPDATE ON availability_rules
  FOR EACH ROW EXECUTE FUNCTION public.enforce_availability_rule_staff_in_org();
