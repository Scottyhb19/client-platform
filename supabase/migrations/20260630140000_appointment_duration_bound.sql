-- ============================================================================
-- 20260630140000_appointment_duration_bound
-- ============================================================================
-- Schedule round-three (RO-5 review follow-up) — bound an appointment's length
-- at the database, not just the form.
--
-- BEFORE. The booking form caps Duration at 480 and the server actions reject
-- <= 0, but the appointments table has an INSERT policy for `authenticated`
-- (own-org WITH CHECK), so a crafted PostgREST request that skips the form/action
-- could write any end_at — a 69-day "appointment" (duration = 99999) and worse.
-- The only DB guard was appointments_time_ordering (end_at > start_at), which
-- blocks zero/negative but has no ceiling.
--
-- AFTER. A CHECK caps the span at 24 hours. This is the bypass-proof layer: it
-- fires on every write path (form action, recurring action, or a direct
-- PostgREST insert/update), where an application-level guard cannot. 24h is a
-- deliberately generous safety ceiling — it blocks the absurd-value hole while
-- still allowing a legitimate full-day Unavailable block; the product rule
-- (<= 480 min) is enforced in the actions on top, as the clean inline error.
--
-- Verified additive: max existing appointment span is 1h and zero rows exceed
-- 24h, so ADD CONSTRAINT validates without rewriting or rejecting live data.
-- Applies to both kinds (appointment + unavailable). Backward-compatible with
-- deployed master, which never writes anything near the bound.
-- ============================================================================

ALTER TABLE appointments
  ADD CONSTRAINT appointments_duration_bound
  CHECK (end_at <= start_at + interval '24 hours');

COMMENT ON CONSTRAINT appointments_duration_bound ON appointments IS
  'Caps an appointment span at 24h as a bypass-proof safety ceiling (the authenticated INSERT policy makes a crafted over-long write otherwise possible). The product rule (<= 480 min) is enforced in the server actions; this is the absolute backstop.';
