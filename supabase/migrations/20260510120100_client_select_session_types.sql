-- ============================================================================
-- 20260510120100_client_select_session_types
-- ============================================================================
-- Why: The portal booking picker (Phase F) lets the client choose which kind
-- of session they want to book. The list of types is read from session_types,
-- which until now was staff-only at the RLS layer. Clients need SELECT here
-- so the picker can render the chips. Display fields only — no insert /
-- update / delete by clients ever.
--
-- Posture mirrors the existing staff policy: tenant-scoped via
-- organization_id = public.user_organization_id(), live rows only. No
-- client-specific data on this table — names + display colour are display
-- metadata.
-- ============================================================================

CREATE POLICY "client select session_types in own org"
  ON session_types FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND public.user_role() = 'client'
  );

COMMENT ON POLICY "client select session_types in own org" ON session_types IS
  'Clients can read the org''s session type taxonomy so the portal booking picker can render the available types. Read-only — INSERT / UPDATE / DELETE remain staff-only.';
