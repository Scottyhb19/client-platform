-- ============================================================================
-- 20260615150000_appointment_unavailable_kind
-- ============================================================================
-- Section 9 (Scheduling) — P1-7 (FM-19). An "Unavailable" appointment kind for
-- non-client time (admin, meeting, note, break, travel, …) that renders on the
-- schedule, blocks client bookings, and may sit beside a client appointment.
--
-- MODEL.
--   session_types.kind  — taxonomy: 'appointment' (default) | 'unavailable'.
--   appointments.kind   — the row's own kind, denormalised from the chosen type
--                         at write time so the CHECK, the no-overlap constraint,
--                         and the slot subtraction are all self-contained on the
--                         appointments row (appointment_type is free text, not a
--                         FK, so we cannot derive kind by join reliably).
--   appointments.client_id — relaxed to nullable; an appointment-kind row still
--                         requires a client (CHECK), an unavailable-kind row may
--                         have none.
--
-- BEHAVIOUR. Unavailable blocks are written status='confirmed', so the existing
-- client_available_slots subtraction (status IN pending/confirmed) already
-- removes their time from client-bookable slots (closes FM-19 — a client can no
-- longer book over the EP's admin time). They are EXEMPT from the P1-4
-- double-booking constraint (the recreated WHERE adds AND kind='appointment'),
-- so the EP can pin "Note: ask Sarah about her knee" beside Sarah's 11:00.
--
-- BACKWARD COMPATIBILITY (shared dev/prod). All additive: kind defaults to
-- 'appointment' so existing rows and the deployed frontend's inserts (which set
-- no kind and always provide client_id) satisfy both the CHECK and the
-- recreated constraint unchanged. client_id DROP NOT NULL never breaks an
-- insert that provides it. A live probe (P1-4) confirmed zero overlaps, so the
-- constraint recreation validates cleanly. No type regen is required for the
-- deployed frontend; the section-9 frontend (composer + grid) regen happens
-- with its own deploy.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §1. kind on the taxonomy and on the row.
-- ----------------------------------------------------------------------------
ALTER TABLE session_types
  ADD COLUMN kind text NOT NULL DEFAULT 'appointment'
    CHECK (kind IN ('appointment', 'unavailable'));

COMMENT ON COLUMN session_types.kind IS
  'appointment (default, client-facing) | unavailable (staff-only non-client time: admin, meeting, note, break, …). Section 9 P1-7.';

ALTER TABLE appointments
  ADD COLUMN kind text NOT NULL DEFAULT 'appointment'
    CHECK (kind IN ('appointment', 'unavailable'));

COMMENT ON COLUMN appointments.kind IS
  'appointment (default) | unavailable (staff-only block, no client, exempt from the no-overlap constraint, never client-visible). Denormalised from session_types.kind at write time. Section 9 P1-7.';


-- ----------------------------------------------------------------------------
-- §2. client_id: required for appointment-kind, optional for unavailable-kind.
-- ----------------------------------------------------------------------------
ALTER TABLE appointments
  ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_client_required_for_kind CHECK (
    (kind = 'appointment' AND client_id IS NOT NULL)
    OR kind = 'unavailable'
  );


-- ----------------------------------------------------------------------------
-- §3. Recreate the no-overlap constraint, exempting unavailable-kind rows so
-- they may overlap a client appointment (P1-4 + P1-7). Same predicate as
-- 20260615130000 plus AND kind = 'appointment'. Within this migration's
-- transaction the DROP→ADD is atomic.
-- ----------------------------------------------------------------------------
ALTER TABLE appointments
  DROP CONSTRAINT appointments_no_staff_overlap;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_staff_overlap
  EXCLUDE USING gist (
    staff_user_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (
    status IN ('pending', 'confirmed')
    AND deleted_at IS NULL
    AND kind = 'appointment'
  );

COMMENT ON CONSTRAINT appointments_no_staff_overlap ON appointments IS
  'Two pending/confirmed APPOINTMENT-kind bookings for the same staff member cannot overlap (half-open). Cancelled/no_show/completed, soft-deleted, and unavailable-kind rows are exempt — a replacement may be booked over a cancelled slot and an admin/note block may sit beside an appointment. Section 9 P1-4 + P1-7, 2026-06-15.';


-- ----------------------------------------------------------------------------
-- §4. Seed the Unavailable sub-types for existing organisation(s). Muted grey
-- so they read as non-client time; EP-editable (name/colour/duration) in
-- Settings. ON CONFLICT DO NOTHING skips any an org already has by name.
-- ----------------------------------------------------------------------------
INSERT INTO session_types (organization_id, name, color, sort_order, default_duration_minutes, kind)
SELECT o.id, v.name, v.color, v.sort_order, v.dur, 'unavailable'
FROM organizations o
CROSS JOIN (VALUES
  ('Meeting',                  '#78716c', 100,  60),
  ('Admin/paperwork',          '#78716c', 110,  60),
  ('Note/reminder',            '#78716c', 120,  15),
  ('Break/lunch',              '#78716c', 130,  30),
  ('Travel',                   '#78716c', 140,  30),
  ('Phone call',               '#78716c', 150,  15),
  ('Professional development', '#78716c', 160,  60),
  ('Personal/leave',           '#78716c', 170,  60)
) AS v(name, color, sort_order, dur)
ON CONFLICT DO NOTHING;


-- ----------------------------------------------------------------------------
-- §5. seed_organization_defaults — consolidated rewrite so a NEW org gets the
-- per-type durations (P1-6), the kind column, and the Unavailable sub-types
-- (P1-7) in one place. Body reproduced from 20260612090300 (the latest
-- version) with only the session_types block changed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_organization_defaults(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Movement patterns (brief §6.6)
  INSERT INTO movement_patterns (organization_id, name, sort_order) VALUES
    (p_org_id, 'Push',      10),
    (p_org_id, 'Pull',      20),
    (p_org_id, 'Squat',     30),
    (p_org_id, 'Hinge',     40),
    (p_org_id, 'Carry',     50),
    (p_org_id, 'Core',      60),
    (p_org_id, 'Isometric', 70);

  -- Section titles (brief §6.5.1)
  INSERT INTO section_titles (organization_id, name, sort_order) VALUES
    (p_org_id, 'Mobility',              10),
    (p_org_id, 'Movement Restoration',  20),
    (p_org_id, 'Plyometrics',           30),
    (p_org_id, 'Power',                 40),
    (p_org_id, 'Strength',              50),
    (p_org_id, 'Hypertrophy',           60),
    (p_org_id, 'Conditioning',          70),
    (p_org_id, 'On-Field Conditioning', 80),
    (p_org_id, 'Technique Work',        90),
    (p_org_id, 'Recovery',             100);

  -- Exercise metric units (brief §6.5.3)
  INSERT INTO exercise_metric_units (organization_id, code, display_label, category, sort_order) VALUES
    (p_org_id, 'kg',              'kg',            'weight',     10),
    (p_org_id, 'time_minsec',     'time (min:sec)', 'time',      20),
    (p_org_id, 'distance_m',      'distance (m)',  'distance',   30),
    (p_org_id, 'percentage',      'percentage',    'ratio',      40),
    (p_org_id, 'rpe',             'RPE (1-10)',    'rpe',        50),
    (p_org_id, 'tempo',           'tempo',         'tempo',      60),
    (p_org_id, 'bodyweight',      'bodyweight',    'bodyweight', 70),
    (p_org_id, 'lb',              'lb',            'weight',     80),
    (p_org_id, 'distance_miles',  'distance (mi)', 'distance',   90),
    (p_org_id, 'distance_km',     'distance (km)', 'distance',  100);

  -- Exercise tags (brief §6.6)
  INSERT INTO exercise_tags (organization_id, name, sort_order) VALUES
    (p_org_id, 'DGR',         10),
    (p_org_id, 'PRI',         20),
    (p_org_id, 'Plyometrics', 30),
    (p_org_id, 'Rehab',       40),
    (p_org_id, 'Prehab',      50);

  -- Client categories (brief §6.8.5)
  INSERT INTO client_categories (organization_id, name, sort_order) VALUES
    (p_org_id, 'Athlete',       10),
    (p_org_id, 'Rehab',         20),
    (p_org_id, 'Lifestyle',     30),
    (p_org_id, 'Golf',          40),
    (p_org_id, 'Osteoporosis',  50),
    (p_org_id, 'Neurological',  60);

  -- VALD device types
  INSERT INTO vald_device_types (organization_id, code, display_label, sort_order) VALUES
    (p_org_id, 'forcedecks',  'ForceDecks',  10),
    (p_org_id, 'nordbord',    'NordBord',    20),
    (p_org_id, 'forceframe',  'ForceFrame',  30),
    (p_org_id, 'dynamo',      'DynaMo',      40);

  -- Session types — appointment categories (durations P1-6, kind P1-7) plus
  -- the Unavailable / non-client-time sub-types (P1-7).
  INSERT INTO session_types (organization_id, name, color, sort_order, default_duration_minutes, kind) VALUES
    (p_org_id, 'Session',                  '#1E1A18',  10, 45, 'appointment'),
    (p_org_id, 'Initial assessment',       '#2DB24C',  20, 60, 'appointment'),
    (p_org_id, 'Review',                   '#E8A317',  30, 45, 'appointment'),
    (p_org_id, 'Telehealth',               '#3B82F6',  40, 30, 'appointment'),
    (p_org_id, 'Meeting',                  '#78716c', 100, 60, 'unavailable'),
    (p_org_id, 'Admin/paperwork',          '#78716c', 110, 60, 'unavailable'),
    (p_org_id, 'Note/reminder',            '#78716c', 120, 15, 'unavailable'),
    (p_org_id, 'Break/lunch',              '#78716c', 130, 30, 'unavailable'),
    (p_org_id, 'Travel',                   '#78716c', 140, 30, 'unavailable'),
    (p_org_id, 'Phone call',               '#78716c', 150, 15, 'unavailable'),
    (p_org_id, 'Professional development', '#78716c', 160, 60, 'unavailable'),
    (p_org_id, 'Personal/leave',           '#78716c', 170, 60, 'unavailable');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_organization_defaults(uuid) FROM PUBLIC, authenticated, anon;

COMMENT ON FUNCTION public.seed_organization_defaults(uuid) IS
  'Seeds lookup tables for a newly bootstrapped organization. Section 9 (2026-06-15): session_types now carry default_duration_minutes (P1-6) and kind, and the Unavailable non-client-time sub-types are seeded (P1-7).';
