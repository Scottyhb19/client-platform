-- ============================================================================
-- 20260615160000_client_session_types_appointment_only
-- ============================================================================
-- Section 9 — P1-7 follow-up. The Unavailable session-type kind (admin /
-- meeting / note / …) is staff-only and must never be client-visible, but the
-- client SELECT policy on session_types (20260510120100) returned ALL live
-- types — so the portal booking picker offered Unavailable types as bookable.
--
-- Tighten the client policy to appointment-kind only. RLS is the security
-- boundary (CLAUDE.md), so this is the real fix; the portal query also filters
-- explicitly. Backward-compatible: the deployed portal only ever rendered
-- appointment types (Unavailable did not exist when it shipped), so restricting
-- clients to kind='appointment' changes nothing for it.
-- ============================================================================

DROP POLICY IF EXISTS "client select session_types in own org" ON session_types;

CREATE POLICY "client select session_types in own org"
  ON session_types FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND public.user_role() = 'client'
    AND kind = 'appointment'
  );

COMMENT ON POLICY "client select session_types in own org" ON session_types IS
  'Clients can read the org''s APPOINTMENT-kind session types so the portal booking picker can render bookable types. Unavailable-kind types are staff-only (P1-7). Read-only — INSERT / UPDATE / DELETE remain staff-only.';
