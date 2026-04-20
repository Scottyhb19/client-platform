-- ============================================================================
-- 20260420101900_session_logging
-- ============================================================================
-- Why: What the client actually did. A session is a single training workout.
-- Each session contains exercise_logs (one per exercise performed), which
-- contain set_logs (one per set). Per-exercise RPE + notes; per-set weight,
-- reps, and optional metric. Session-level RPE + subjective note on the
-- session itself.
--
-- sessions may be created by a client from the portal (starts in-progress),
-- or by staff on behalf of a client (in-clinic session). Appointment linkage
-- is optional — a home session has no appointment, an in-clinic session has
-- one.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- sessions — one per completed workout
-- ----------------------------------------------------------------------------
CREATE TABLE sessions (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid         NOT NULL REFERENCES organizations(id)   ON DELETE RESTRICT,
  client_id          uuid         NOT NULL REFERENCES clients(id)         ON DELETE RESTRICT,
  program_day_id     uuid         REFERENCES program_days(id)             ON DELETE SET NULL,
  appointment_id     uuid,        -- FK added in scheduling migration (appointments table not yet created)
  started_at         timestamptz  NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  duration_minutes   int          GENERATED ALWAYS AS (
                       CASE
                         WHEN completed_at IS NOT NULL
                         THEN GREATEST(0, EXTRACT(EPOCH FROM (completed_at - started_at))::int / 60)
                         ELSE NULL
                       END
                     ) STORED,
  session_rpe        smallint     CHECK (session_rpe IS NULL OR session_rpe BETWEEN 1 AND 10),
  feedback           text,        -- "How are you feeling?" free text
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  CONSTRAINT sessions_completed_ordering CHECK (
    completed_at IS NULL OR completed_at >= started_at
  ),
  CONSTRAINT sessions_completed_requires_rpe CHECK (
    completed_at IS NULL OR session_rpe IS NOT NULL
  )
);

-- Session history for a client, time-descending
CREATE INDEX sessions_client_completed_idx
  ON sessions (client_id, completed_at DESC)
  WHERE deleted_at IS NULL;

-- Dashboard "recently completed" + org-wide activity
CREATE INDEX sessions_org_completed_idx
  ON sessions (organization_id, completed_at DESC)
  WHERE completed_at IS NOT NULL AND deleted_at IS NULL;

-- Calendar dot: "which session occurred on which program day"
CREATE INDEX sessions_program_day_idx
  ON sessions (program_day_id)
  WHERE program_day_id IS NOT NULL AND deleted_at IS NULL;

-- Appointment-detail "session from this appointment"
CREATE INDEX sessions_appointment_idx
  ON sessions (appointment_id)
  WHERE appointment_id IS NOT NULL AND deleted_at IS NULL;

-- Portal home: resume in-progress session
CREATE INDEX sessions_in_progress_idx
  ON sessions (client_id)
  WHERE completed_at IS NULL AND deleted_at IS NULL;

CREATE TRIGGER sessions_touch_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER sessions_enforce_client_org
  BEFORE INSERT OR UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_same_org_fk('clients', 'client_id', 'organization_id');

COMMENT ON TABLE sessions IS
  'One training session. May be client-initiated (home) or staff-initiated (in-clinic). duration_minutes is a generated column computed from started_at/completed_at.';
COMMENT ON COLUMN sessions.appointment_id IS
  'Optional link to the appointment during which this session happened. FK constraint added when the appointments table is created.';


-- ----------------------------------------------------------------------------
-- exercise_logs — one per exercise performed in a session
-- ----------------------------------------------------------------------------
-- program_exercise_id is SET NULL if the prescription changes after logging —
-- the log row keeps its set_logs, just loses the link to the current prescription.
CREATE TABLE exercise_logs (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           uuid         NOT NULL REFERENCES sessions(id)          ON DELETE CASCADE,
  program_exercise_id  uuid         REFERENCES program_exercises(id)          ON DELETE SET NULL,
  exercise_id          uuid         NOT NULL REFERENCES exercises(id)         ON DELETE RESTRICT,
  sort_order           int          NOT NULL DEFAULT 0,
  rpe                  smallint     CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  notes                text,
  completed_at         timestamptz,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);

CREATE INDEX exercise_logs_session_idx
  ON exercise_logs (session_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE INDEX exercise_logs_program_exercise_idx
  ON exercise_logs (program_exercise_id)
  WHERE program_exercise_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX exercise_logs_exercise_idx
  ON exercise_logs (exercise_id)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE exercise_logs IS
  'One per exercise performed within a session. Holds per-exercise RPE and notes; sets roll up from set_logs.';
COMMENT ON COLUMN exercise_logs.exercise_id IS
  'Direct FK to exercises. Duplicates the link through program_exercises but survives prescription changes; historical logs always know WHICH exercise was performed.';


-- ----------------------------------------------------------------------------
-- set_logs — one per set performed within an exercise
-- ----------------------------------------------------------------------------
CREATE TABLE set_logs (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_log_id   uuid         NOT NULL REFERENCES exercise_logs(id) ON DELETE CASCADE,
  set_number        smallint     NOT NULL CHECK (set_number BETWEEN 1 AND 50),
  -- Client logs ACTUAL performance (all fields nullable — client may skip a field)
  weight_value      numeric(7,2) CHECK (weight_value IS NULL OR weight_value BETWEEN 0 AND 99999),
  weight_metric     text,         -- 'kg' | 'lb' | 'bodyweight' (matches exercise_metric_units.code)
  reps_performed    smallint     CHECK (reps_performed IS NULL OR reps_performed BETWEEN 0 AND 1000),
  optional_metric   text,
  optional_value    text,
  rpe               smallint     CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  notes             text,
  completed_at      timestamptz,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  UNIQUE (exercise_log_id, set_number)
);

CREATE INDEX set_logs_exercise_log_idx
  ON set_logs (exercise_log_id, set_number)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE set_logs IS
  'One per set performed. Actual weight / reps / optional metric logged by the client during their session. set_logs.rpe is available for future per-set autoregulation; v1 uses per-exercise RPE on exercise_logs.';
