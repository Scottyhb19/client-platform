-- ============================================================================
-- 20260420102000_scheduling
-- ============================================================================
-- Why: EP availability, client bookings, reminder delivery. Replaces
-- Cliniko's scheduling surface.
--
-- availability_rules hold recurring weekly windows and one-off exceptions.
-- Available slot view is computed on demand (not materialized) from rules
-- minus existing appointments (see client_available_slots function later).
--
-- appointments are the concrete bookings. Status lifecycle:
--   pending → confirmed → completed | cancelled | no_show
--
-- appointment_reminders are one row per reminder scheduled (confirmation +
-- 24h, email + SMS). Dedicated table, not jsonb — each reminder has its
-- own lifecycle (scheduled / sent / delivered / failed / bounced).
--
-- Also: back-wire sessions.appointment_id FK to appointments now that the
-- appointments table exists.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- availability_rules
-- ----------------------------------------------------------------------------
CREATE TABLE availability_rules (
  id                    uuid                     PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid                     NOT NULL REFERENCES organizations(id)      ON DELETE RESTRICT,
  staff_user_id         uuid                     NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  recurrence            availability_recurrence  NOT NULL,
  day_of_week           smallint                 CHECK (day_of_week IS NULL OR day_of_week BETWEEN 0 AND 6),
  specific_date         date,
  start_time            time                     NOT NULL,
  end_time              time                     NOT NULL,
  slot_duration_minutes smallint                 NOT NULL DEFAULT 60 CHECK (slot_duration_minutes BETWEEN 5 AND 240),
  effective_from        date                     NOT NULL DEFAULT CURRENT_DATE,
  effective_to          date,
  notes                 text,
  created_at            timestamptz              NOT NULL DEFAULT now(),
  updated_at            timestamptz              NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  CONSTRAINT availability_time_ordering CHECK (end_time > start_time),
  CONSTRAINT availability_effective_range CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  ),
  CONSTRAINT availability_recurrence_fields CHECK (
    (recurrence = 'weekly'  AND day_of_week IS NOT NULL AND specific_date IS NULL)
    OR
    (recurrence = 'one_off' AND specific_date IS NOT NULL AND day_of_week IS NULL)
  )
);

CREATE INDEX availability_rules_org_staff_idx
  ON availability_rules (organization_id, staff_user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX availability_rules_effective_idx
  ON availability_rules (organization_id, effective_from, effective_to)
  WHERE deleted_at IS NULL;

CREATE TRIGGER availability_rules_touch_updated_at
  BEFORE UPDATE ON availability_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE availability_rules IS
  'EP availability windows — weekly recurring or one-off. Times are in the organizations.timezone; resolved to UTC when computing slots.';


-- ----------------------------------------------------------------------------
-- appointments
-- ----------------------------------------------------------------------------
CREATE TABLE appointments (
  id                     uuid                 PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid                 NOT NULL REFERENCES organizations(id)      ON DELETE RESTRICT,
  client_id              uuid                 NOT NULL REFERENCES clients(id)            ON DELETE RESTRICT,
  staff_user_id          uuid                 NOT NULL REFERENCES user_profiles(user_id) ON DELETE RESTRICT,
  start_at               timestamptz          NOT NULL,
  end_at                 timestamptz          NOT NULL,
  status                 appointment_status   NOT NULL DEFAULT 'pending',
  appointment_type       text                 NOT NULL DEFAULT 'in_clinic'
                         CHECK (appointment_type IN ('in_clinic', 'telehealth')),
  location               text,
  notes                  text,
  confirmed_at           timestamptz,
  cancelled_at           timestamptz,
  cancellation_reason    text,
  no_show_marked_at      timestamptz,
  created_at             timestamptz          NOT NULL DEFAULT now(),
  updated_at             timestamptz          NOT NULL DEFAULT now(),
  deleted_at             timestamptz,
  CONSTRAINT appointments_time_ordering CHECK (end_at > start_at),
  CONSTRAINT appointments_confirmed_fields CHECK (
    (status = 'confirmed' AND confirmed_at IS NOT NULL) OR status <> 'confirmed'
  ),
  CONSTRAINT appointments_cancelled_fields CHECK (
    (status = 'cancelled' AND cancelled_at IS NOT NULL) OR status <> 'cancelled'
  )
);

-- Staff schedule view
CREATE INDEX appointments_org_start_idx
  ON appointments (organization_id, start_at)
  WHERE deleted_at IS NULL;

-- Per-staff calendar (Phase 4 multi-practitioner)
CREATE INDEX appointments_staff_start_idx
  ON appointments (staff_user_id, start_at)
  WHERE deleted_at IS NULL;

-- Client booking history
CREATE INDEX appointments_client_start_idx
  ON appointments (client_id, start_at DESC)
  WHERE deleted_at IS NULL;

-- Reminder scheduler scans upcoming pending/confirmed
CREATE INDEX appointments_reminder_scan_idx
  ON appointments (start_at)
  WHERE status IN ('pending', 'confirmed') AND deleted_at IS NULL;

CREATE TRIGGER appointments_touch_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER appointments_enforce_client_org
  BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('clients', 'client_id', 'organization_id');

COMMENT ON TABLE appointments IS
  'Concrete client–staff booking at a specific time. Status lifecycle: pending → confirmed → completed | cancelled | no_show.';


-- ----------------------------------------------------------------------------
-- appointment_reminders
-- ----------------------------------------------------------------------------
CREATE TABLE appointment_reminders (
  id                   uuid                         PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id       uuid                         NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  reminder_type        appointment_reminder_type    NOT NULL,
  status               appointment_reminder_status  NOT NULL DEFAULT 'scheduled',
  provider             text                         NOT NULL CHECK (provider IN ('resend', 'twilio')),
  provider_message_id  text,
  scheduled_for        timestamptz                  NOT NULL,
  sent_at              timestamptz,
  delivered_at         timestamptz,
  failed_at            timestamptz,
  failure_reason       text,
  retry_count          smallint                     NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 5),
  created_at           timestamptz                  NOT NULL DEFAULT now(),
  updated_at           timestamptz                  NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, reminder_type)
);

-- Scheduler pulls due reminders
CREATE INDEX appointment_reminders_due_idx
  ON appointment_reminders (scheduled_for)
  WHERE status = 'scheduled';

CREATE INDEX appointment_reminders_appointment_idx
  ON appointment_reminders (appointment_id);

CREATE TRIGGER appointment_reminders_touch_updated_at
  BEFORE UPDATE ON appointment_reminders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE appointment_reminders IS
  'One row per reminder scheduled (confirmation + 24h, email + SMS). Separate lifecycle per reminder — dedicated table, not jsonb on appointments.';


-- ----------------------------------------------------------------------------
-- Back-wire sessions.appointment_id FK.
-- The sessions migration declared the column without a FK constraint
-- because appointments didn't exist yet.
-- ----------------------------------------------------------------------------
ALTER TABLE sessions
  ADD CONSTRAINT sessions_appointment_fk
  FOREIGN KEY (appointment_id)
  REFERENCES appointments(id)
  ON DELETE SET NULL;
