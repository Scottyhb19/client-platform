-- ============================================================================
-- 20260611120000_cn2_cmh_staff_only_select
-- ============================================================================
-- CN-2 (docs/polish/client-profile-clinical-notes.md): tighten
-- client_medical_history SELECT from Pattern B (client sees own) to
-- Pattern A (staff only).
--
-- Why: the `notes` column on client_medical_history carries practitioner
-- commentary on the condition — clinical reasoning under the master brief
-- §4 access contract. The original Pattern B policy declared the whole
-- row (commentary included) readable by the owning client. No portal
-- surface has ever queried this table (verified in the section 3 audit),
-- so nothing leaks today — but the policy as written invites a future
-- portal surface or Phase 2 AI flow to treat client visibility as
-- intended.
--
-- Operator rule (2026-06-11, recorded in the section 3 approval record):
-- nothing on the staff side is ever client-viewable EXCEPT the exercise
-- program, published reports, and upcoming sessions. Staff-only is the
-- standing default for every future policy decision.
--
-- If a client-facing "your conditions" surface is ever designed, relax
-- deliberately — and exclude the practitioner `notes` column (via a view
-- or column split), per the gap's closing note.
--
-- INSERT / UPDATE / DELETE policies are already staff-only / deny and are
-- unchanged.
-- ============================================================================

DROP POLICY "select cmh in own org" ON client_medical_history;

CREATE POLICY "staff select cmh in own org"
  ON client_medical_history FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND public.user_role() IN ('owner', 'staff')
  );
