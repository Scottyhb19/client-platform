-- ============================================================================
-- 20260723130000_reminder_log_nonfatal_and_sms.sql
-- ============================================================================
-- Closes the "trigger-exception → UNBOUNDED reminder resend" latent
-- (go-live-checklist.md §8, severity raised 2026-07-23 by the Package-1
-- gating review; provenance polish/email-and-sms.md Part B logging half).
--
-- Root cause: reminder_log_communication is AFTER UPDATE on
-- appointment_reminders — ANY exception in its communications INSERT aborts
-- the Edge Function's terminal status write (markSent/markFailed), the row
-- stays status='scheduled', and the next cron tick re-sends. Nothing bounds
-- the loop: retry_count is only incremented on the transient-send path, and
-- the due-row SELECT has no ceiling. The concrete reachable instance was the
-- SMS branch (communication_type='sms' with no recipient_phone violates
-- communications_recipient_matches_type) — unreachable today because only
-- reminder_24h_email is enqueued, but latent for SMS activation.
--
-- Fix shapes shipped (all three named by the checklist entry):
--   1. HERE — the derived-log INSERT is wrapped in its own exception scope:
--      a logging failure can no longer abort the reminder status write. The
--      miss is RAISE WARNING'd (Postgres logs) — same best-effort posture as
--      the app-side seam (src/lib/comms/log.ts): the log must never fail or
--      retry a send.
--   2. HERE — the SMS branch is made constraint-valid: recipient_phone is
--      carried from clients.phone (recipient_email is populated on every
--      row for the record; the constraint requires phone for sms, email for
--      email). An SMS reminder for a phoneless client still cannot produce a
--      valid row — that lands in the exception scope (WARNING, send outcome
--      preserved) instead of an unbounded resend.
--   3. Edge Function (deployed with this migration) — belt-and-braces send
--      bound: a due row at the retry ceiling is terminally failed WITHOUT
--      another send, and a failed terminal write now bumps retry_count in a
--      trigger-safe statement, so even a persistently-failing terminal write
--      can no longer produce more than MAX_RETRIES real emails.
--
-- pgTAP 62 extended (assertions 7–9). No grant/RLS change.
-- ============================================================================

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

  -- The derived log is best-effort BY DESIGN: an exception here would abort
  -- the reminder's terminal status write, roll the row back to 'scheduled',
  -- and re-send on every cron tick (the unbounded-resend latent). The
  -- reminder outcome is the truth being recorded — losing one derived log
  -- row (WARNING'd below) is strictly better than re-emailing the client.
  BEGIN
    INSERT INTO communications (
      organization_id, client_id, sender_user_id,
      communication_type, direction, status,
      provider, provider_message_id,
      subject, body, recipient_email, recipient_phone,
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
      c.phone,
      CASE WHEN NEW.status = 'sent' THEN COALESCE(NEW.sent_at, now()) END,
      CASE WHEN NEW.status = 'failed' THEN COALESCE(NEW.failed_at, now()) END,
      NEW.failure_reason
    FROM appointments a
    JOIN clients c ON c.id = a.client_id
    JOIN organizations o ON o.id = a.organization_id
    WHERE a.id = NEW.appointment_id
      AND a.client_id IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING
      'reminder_log_communication: derived communications row NOT written for reminder % (%). Send outcome preserved.',
      NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reminder_log_communication() FROM PUBLIC, anon, authenticated;
