-- ============================================================================
-- 20260421110000_organization_settings_fields
-- ============================================================================
-- Why: Settings → Practice info needs AU-specific billing identifiers (ABN,
-- Medicare provider number) plus org-level notification preferences that
-- today's appointment reminder scheduler will read when it's built.
-- ============================================================================

ALTER TABLE organizations
  ADD COLUMN abn                          text,
  ADD COLUMN provider_number              text,
  ADD COLUMN email_notifications_enabled  boolean NOT NULL DEFAULT true,
  ADD COLUMN sms_notifications_enabled    boolean NOT NULL DEFAULT false,
  ADD COLUMN reminder_lead_hours          int     NOT NULL DEFAULT 24
                                                  CHECK (reminder_lead_hours BETWEEN 1 AND 168);

COMMENT ON COLUMN organizations.abn IS
  'Australian Business Number. Free-text; validation happens in the app if at all (ABNs with typos still beat a rejected form for a solo practice).';
COMMENT ON COLUMN organizations.provider_number IS
  'Medicare provider number, shown on invoices.';
COMMENT ON COLUMN organizations.email_notifications_enabled IS
  'Practice default for outbound email reminders. Per-client overrides live on clients or user_profiles (Phase 4).';
COMMENT ON COLUMN organizations.sms_notifications_enabled IS
  'Practice default for outbound SMS. Off by default — Twilio costs money.';
COMMENT ON COLUMN organizations.reminder_lead_hours IS
  'How many hours before start_at to dispatch reminders. Constrained 1..168 (one week max).';
