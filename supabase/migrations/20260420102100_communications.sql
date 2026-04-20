-- ============================================================================
-- 20260420102100_communications
-- ============================================================================
-- Why: Email is the communication channel (brief §6.7 — in-app messaging
-- deliberately excluded). SMS is used only for appointment reminders and
-- booking confirmations. This table holds the log of every email or SMS
-- sent to or about a client, plus reusable templates.
--
-- Clients do NOT see the communications log — they see the actual email/SMS
-- in their inbox. Log exists for staff audit and compliance.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- communication_templates
-- ----------------------------------------------------------------------------
CREATE TABLE communication_templates (
  id                   uuid                 PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid                 NOT NULL REFERENCES organizations(id)      ON DELETE RESTRICT,
  created_by_user_id   uuid                 REFERENCES user_profiles(user_id)          ON DELETE SET NULL,
  name                 text                 NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  communication_type   communication_type   NOT NULL,
  subject_template     text,    -- email only; NULL for SMS
  body_template        text                 NOT NULL,
  variables_schema     jsonb                NOT NULL DEFAULT '{}'::jsonb,
  is_active            boolean              NOT NULL DEFAULT true,
  created_at           timestamptz          NOT NULL DEFAULT now(),
  updated_at           timestamptz          NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  CONSTRAINT communication_templates_subject_when_email CHECK (
    (communication_type = 'email' AND subject_template IS NOT NULL)
    OR communication_type = 'sms'
  ),
  CONSTRAINT communication_templates_variables_object CHECK (
    jsonb_typeof(variables_schema) = 'object'
  )
);

CREATE UNIQUE INDEX communication_templates_org_name_unique
  ON communication_templates (organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX communication_templates_org_active_idx
  ON communication_templates (organization_id)
  WHERE deleted_at IS NULL AND is_active = true;

CREATE TRIGGER communication_templates_touch_updated_at
  BEFORE UPDATE ON communication_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE communication_templates IS
  'Reusable email/SMS templates with variable placeholders. variables_schema documents the expected variable names and types (validated at application layer).';


-- ----------------------------------------------------------------------------
-- communications — the log
-- ----------------------------------------------------------------------------
CREATE TABLE communications (
  id                     uuid                      PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid                      NOT NULL REFERENCES organizations(id)      ON DELETE RESTRICT,
  client_id              uuid                      NOT NULL REFERENCES clients(id)            ON DELETE RESTRICT,
  sender_user_id         uuid                      NOT NULL REFERENCES user_profiles(user_id) ON DELETE RESTRICT,
  template_id            uuid                      REFERENCES communication_templates(id)     ON DELETE SET NULL,
  communication_type     communication_type        NOT NULL,
  direction              communication_direction   NOT NULL DEFAULT 'outbound',
  status                 communication_status      NOT NULL DEFAULT 'draft',
  subject                text,
  body                   text                      NOT NULL,
  provider               text                      CHECK (provider IS NULL OR provider IN ('resend', 'twilio')),
  provider_message_id    text,
  recipient_email        text,
  recipient_phone        text,
  scheduled_for          timestamptz,
  sent_at                timestamptz,
  delivered_at           timestamptz,
  failed_at              timestamptz,
  failure_reason         text,
  ai_draft               boolean                   NOT NULL DEFAULT false,  -- Phase 2: AI-drafted
  ai_approved_by_user_id uuid                      REFERENCES user_profiles(user_id) ON DELETE SET NULL,
  ai_approved_at         timestamptz,
  created_at             timestamptz               NOT NULL DEFAULT now(),
  updated_at             timestamptz               NOT NULL DEFAULT now(),
  deleted_at             timestamptz,
  CONSTRAINT communications_subject_when_email CHECK (
    (communication_type = 'email' AND subject IS NOT NULL)
    OR communication_type = 'sms'
  ),
  CONSTRAINT communications_recipient_matches_type CHECK (
    (communication_type = 'email' AND recipient_email IS NOT NULL)
    OR
    (communication_type = 'sms' AND recipient_phone IS NOT NULL)
  ),
  CONSTRAINT communications_sent_has_timestamp CHECK (
    (status IN ('sent', 'delivered') AND sent_at IS NOT NULL) OR
    status NOT IN ('sent', 'delivered')
  )
);

-- Per-client comm log (profile Comms tab), time-descending
CREATE INDEX communications_client_sent_idx
  ON communications (client_id, sent_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

-- Org-wide monitor (admin view)
CREATE INDEX communications_org_status_idx
  ON communications (organization_id, status)
  WHERE deleted_at IS NULL;

-- Scheduler finds queued + scheduled
CREATE INDEX communications_queue_idx
  ON communications (scheduled_for)
  WHERE status IN ('draft', 'queued') AND deleted_at IS NULL;

-- Provider-side correlation
CREATE INDEX communications_provider_msg_idx
  ON communications (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TRIGGER communications_touch_updated_at
  BEFORE UPDATE ON communications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER communications_enforce_client_org
  BEFORE INSERT OR UPDATE ON communications
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('clients', 'client_id', 'organization_id');

CREATE TRIGGER communications_enforce_template_org
  BEFORE INSERT OR UPDATE ON communications
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('communication_templates', 'template_id', 'organization_id');

COMMENT ON TABLE communications IS
  'Log of every email or SMS sent to or about a client. AI-draft fields (ai_draft, ai_approved_*) are reserved for Phase 2; always false/NULL in v1.';
