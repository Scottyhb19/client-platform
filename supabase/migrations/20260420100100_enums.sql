-- ============================================================================
-- 20260420100100_enums
-- ============================================================================
-- Why: Stable status and categorical fields wired into application logic and
-- RLS policies. Tenant-customizable taxonomies (movement patterns, tags,
-- section titles, client categories) are LOOKUP TABLES, not enums — see
-- migrations defining those tables.
--
-- Adding enum values is cheap: `ALTER TYPE <t> ADD VALUE '<new>'`.
-- Removing values requires a type swap + backfill (painful). Add freely;
-- remove only via planned migrations.
-- ============================================================================

CREATE TYPE user_role AS ENUM ('owner', 'staff', 'client');
COMMENT ON TYPE user_role IS 'Membership role in an organization. Wired into RLS policy logic.';

CREATE TYPE program_type AS ENUM ('home_gym', 'in_clinic');
COMMENT ON TYPE program_type IS 'Program delivery mode. Drives appointment coupling and calendar behaviour.';

CREATE TYPE program_status AS ENUM ('draft', 'active', 'archived');
COMMENT ON TYPE program_status IS 'Program lifecycle. Clients see only active + archived via RLS.';

CREATE TYPE appointment_status AS ENUM (
  'pending', 'confirmed', 'cancelled', 'completed', 'no_show'
);
COMMENT ON TYPE appointment_status IS 'Appointment lifecycle state machine.';

CREATE TYPE note_type AS ENUM (
  'initial_assessment', 'progress_note', 'injury_flag',
  'contraindication',   'discharge',     'general'
);
COMMENT ON TYPE note_type IS 'Clinical note classification. injury_flag feeds the dashboard needs-attention panel.';

CREATE TYPE communication_type AS ENUM ('email', 'sms');
COMMENT ON TYPE communication_type IS 'Outbound channel. Drives provider selection (Resend vs Twilio).';

CREATE TYPE communication_direction AS ENUM ('outbound', 'inbound');
COMMENT ON TYPE communication_direction IS 'v1 only sends outbound; inbound reserved for future reply ingest.';

CREATE TYPE communication_status AS ENUM (
  'draft', 'queued', 'sent', 'delivered', 'failed', 'bounced'
);
COMMENT ON TYPE communication_status IS 'Email/SMS provider lifecycle state machine.';

CREATE TYPE assessment_status AS ENUM ('draft', 'completed', 'archived');

CREATE TYPE audit_action AS ENUM ('INSERT', 'UPDATE', 'DELETE');
COMMENT ON TYPE audit_action IS 'Mirrors Postgres TG_OP at the trigger level.';

CREATE TYPE availability_recurrence AS ENUM ('weekly', 'one_off');

CREATE TYPE appointment_reminder_type AS ENUM (
  'confirmation_email', 'confirmation_sms',
  'reminder_24h_email', 'reminder_24h_sms'
);

CREATE TYPE appointment_reminder_status AS ENUM (
  'scheduled', 'sent', 'delivered', 'failed', 'bounced', 'cancelled'
);
