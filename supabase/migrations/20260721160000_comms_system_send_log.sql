-- ============================================================================
-- 20260721160000_comms_system_send_log.sql
-- ============================================================================
-- §12 Part B — the LOGGING half (go-live-checklist §8; polish/email-and-sms.md
-- Part B), pulled forward as Step 5 of the 2026-07-21 internal sequence. The
-- brief §6.7 requirement "sent communications logged to the client's Comms
-- tab" gets its data layer here:
--
--   1. communications.sender_user_id becomes nullable — NULL = system send
--     (reminders, notifications). System mail was previously unrepresentable
--     without faking attribution to a human.
--   2. appointment_reminders → communications: an AFTER UPDATE trigger logs
--     every reminder send OUTCOME (sent AND failed) as a communications row,
--     giving the Comms tab a complete reminder record with no Edge Function
--     change (the EF already writes status/provider_message_id/failure_reason
--     to the queue row — this trigger derives the log from that). Failed
--     rows surface send failures EP-facing at last (§12 Part A's P1-3 made
--     them ops-observable only; the Comms tab makes them visible).
--
-- App-side sends (invite, booking confirmation, reschedule notification) are
-- logged from the send modules themselves (src/lib/comms/log.ts) — they know
-- the real subject/body. Message-notification emails to the EP are
-- deliberately NOT logged here: they are practice-internal ops mail, not
-- client-directed communication, and the Comms tab is the client's record.
--
-- RLS: unchanged — the 20260420102600 policies are already correct (staff-only
-- SELECT in own org, delete denied, no client access). Service-role inserts
-- (system sends) bypass RLS by design.
-- ============================================================================

ALTER TABLE public.communications
  ALTER COLUMN sender_user_id DROP NOT NULL;

COMMENT ON COLUMN public.communications.sender_user_id IS
  'The human sender, or NULL for system-generated sends (appointment reminders, automated notifications). Made nullable 20260721160000 (§12 Part B logging).';

-- ----------------------------------------------------------------------------
-- Reminder outcomes → communications rows.
-- Fires on the status transitions the Edge Function writes: → 'sent' and
-- → 'failed'. A retry that fails then succeeds produces two rows — a
-- truthful timeline, not a duplicate. Reminder rows for staff-only
-- unavailable blocks cannot exist (reminders enqueue only for client
-- appointments), but the client_id guard keeps the insert total anyway.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reminder_log_communication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status NOT IN ('sent', 'failed')
     OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  INSERT INTO communications (
    organization_id, client_id, sender_user_id,
    communication_type, direction, status,
    provider, provider_message_id,
    subject, body, recipient_email,
    sent_at, failed_at, failure_reason
  )
  SELECT
    a.organization_id,
    a.client_id,
    NULL, -- system send
    CASE WHEN NEW.reminder_type::text LIKE '%sms%' THEN 'sms' ELSE 'email' END::communication_type,
    'outbound'::communication_direction,
    CASE WHEN NEW.status = 'sent' THEN 'sent' ELSE 'failed' END::communication_status,
    COALESCE(NEW.provider, 'resend'),
    NEW.provider_message_id,
    'Appointment reminder',
    format(
      'Appointment reminder for %s on %s.',
      COALESCE(a.appointment_type, 'your appointment'),
      to_char(
        a.start_at AT TIME ZONE COALESCE(o.timezone, 'Australia/Sydney'),
        'Dy DD Mon YYYY, HH12:MI AM'
      )
    ),
    c.email,
    CASE WHEN NEW.status = 'sent' THEN COALESCE(NEW.sent_at, now()) END,
    CASE WHEN NEW.status = 'failed' THEN COALESCE(NEW.failed_at, now()) END,
    NEW.failure_reason
  FROM appointments a
  JOIN clients c ON c.id = a.client_id
  JOIN organizations o ON o.id = a.organization_id
  WHERE a.id = NEW.appointment_id
    AND a.client_id IS NOT NULL;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reminder_log_communication() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reminder_log_communication ON public.appointment_reminders;
CREATE TRIGGER reminder_log_communication
  AFTER UPDATE ON public.appointment_reminders
  FOR EACH ROW EXECUTE FUNCTION public.reminder_log_communication();
