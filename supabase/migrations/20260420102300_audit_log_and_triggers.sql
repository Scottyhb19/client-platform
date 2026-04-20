-- ============================================================================
-- 20260420102300_audit_log_and_triggers
-- ============================================================================
-- Why: Every PHI mutation lands a row in audit_log. Writes are trigger-driven,
-- never from application code (which can forget). The trigger function runs
-- SECURITY DEFINER as audit_writer, a non-authenticated role granted
-- BYPASSRLS so its inserts are never blocked by RLS.
--
-- Wide-row handling (§11.4 of /docs/schema.md): for columns listed in
-- audit_wide_column_config, the trigger stores a truncated preview + SHA-256
-- + byte size instead of the full content. Keeps audit_log bounded in size
-- for large text bodies (clinical notes, VALD payloads).
--
-- Cascade-delete orphans: when a parent deletes via CASCADE, leaf trigger
-- resolution of the walker may fail (parent gone). Those rows are still
-- audited with organization_id = NULL. The parent's own DELETE entry
-- captures the ownership context.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Grant audit_writer the BYPASSRLS attribute.
-- ----------------------------------------------------------------------------
ALTER ROLE audit_writer BYPASSRLS;


-- ----------------------------------------------------------------------------
-- 2. audit_wide_column_config — which columns get truncated.
-- ----------------------------------------------------------------------------
CREATE TABLE audit_wide_column_config (
  table_name  text NOT NULL,
  column_name text NOT NULL,
  PRIMARY KEY (table_name, column_name)
);

COMMENT ON TABLE audit_wide_column_config IS
  'Columns whose values are truncated in audit_log snapshots when > 4 KB. Reduces audit_log bloat for free-text and payload fields.';

INSERT INTO audit_wide_column_config (table_name, column_name) VALUES
  ('clinical_notes',   'subjective'),
  ('clinical_notes',   'objective'),
  ('clinical_notes',   'assessment'),
  ('clinical_notes',   'plan'),
  ('clinical_notes',   'body_rich'),
  ('communications',   'body'),
  ('assessments',      'responses_json'),
  ('vald_raw_uploads', 'payload');


-- ----------------------------------------------------------------------------
-- 3. audit_log table.
-- organization_id is NULLable to tolerate cascade-delete orphans (nested
-- rows whose parent was already removed by the time the leaf trigger
-- resolves). Those entries are rare but must not be lost.
-- ----------------------------------------------------------------------------
CREATE TABLE audit_log (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid          REFERENCES organizations(id) ON DELETE RESTRICT,
  table_name        text          NOT NULL,
  row_id            uuid          NOT NULL,
  action            audit_action  NOT NULL,
  actor_user_id     uuid,         -- no FK — must survive user deletion
  actor_role        text,
  changed_at        timestamptz   NOT NULL DEFAULT now(),
  old_values        jsonb,
  new_values        jsonb,
  changed_fields    text[],
  request_id        uuid,
  ip_address        inet,
  user_agent        text,
  body_size_bytes   int
);

-- Owner activity feed
CREATE INDEX audit_log_org_time_idx
  ON audit_log (organization_id, changed_at DESC)
  WHERE organization_id IS NOT NULL;

-- Row history lookup
CREATE INDEX audit_log_row_idx
  ON audit_log (table_name, row_id);

-- Actor investigation
CREATE INDEX audit_log_actor_idx
  ON audit_log (actor_user_id, changed_at DESC)
  WHERE actor_user_id IS NOT NULL;

-- Cascade-orphan triage (organization_id NULL)
CREATE INDEX audit_log_orphan_idx
  ON audit_log (changed_at DESC)
  WHERE organization_id IS NULL;


-- ----------------------------------------------------------------------------
-- 4. RLS on audit_log — deny everything from authenticated; triggers write
-- via audit_writer (BYPASSRLS). Owner SELECT policy added in the main RLS
-- migration.
-- ----------------------------------------------------------------------------
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny direct insert audit_log"
  ON audit_log FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "deny update audit_log"
  ON audit_log FOR UPDATE TO authenticated USING (false);

CREATE POLICY "deny delete audit_log"
  ON audit_log FOR DELETE TO authenticated USING (false);

-- Also revoke the default table grants so nothing slips through.
REVOKE INSERT, UPDATE, DELETE ON audit_log FROM PUBLIC, authenticated, anon;

-- Grant the audit_writer role explicit INSERT (required even with BYPASSRLS —
-- BYPASSRLS skips policies, not table-level privileges).
GRANT INSERT ON audit_log TO audit_writer;


-- ----------------------------------------------------------------------------
-- 5. audit_trim_row — truncate wide fields with SHA-256 + preview.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_trim_row(p_table text, p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  trimmed        jsonb := p_row;
  exclusion_col  text;
  field_text     text;
BEGIN
  IF p_row IS NULL THEN
    RETURN NULL;
  END IF;

  FOR exclusion_col IN
    SELECT column_name FROM public.audit_wide_column_config WHERE table_name = p_table
  LOOP
    IF trimmed ? exclusion_col THEN
      field_text := trimmed ->> exclusion_col;
      IF field_text IS NOT NULL AND octet_length(field_text) > 4096 THEN
        trimmed := jsonb_set(
          trimmed,
          ARRAY[exclusion_col],
          jsonb_build_object(
            '_truncated',  true,
            '_sha256',     encode(digest(field_text, 'sha256'), 'hex'),
            '_size_bytes', octet_length(field_text),
            '_preview',    left(field_text, 500)
          )
        );
      END IF;
    END IF;
  END LOOP;

  RETURN trimmed;
END;
$$;

COMMENT ON FUNCTION public.audit_trim_row(text, jsonb) IS
  'Replaces wide column values in a row snapshot with truncated previews + SHA-256 + size. Columns come from audit_wide_column_config.';


-- ----------------------------------------------------------------------------
-- 6. audit_diff_fields — set-symmetric difference of keys whose values differ.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_diff_fields(p_old jsonb, p_new jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result  text[] := ARRAY[]::text[];
  k       text;
BEGIN
  IF p_old IS NULL AND p_new IS NULL THEN
    RETURN result;
  END IF;

  IF p_old IS NULL THEN
    RETURN array(SELECT jsonb_object_keys(p_new));
  END IF;

  IF p_new IS NULL THEN
    RETURN array(SELECT jsonb_object_keys(p_old));
  END IF;

  FOR k IN
    SELECT DISTINCT key FROM (
      SELECT jsonb_object_keys(p_old) AS key
      UNION
      SELECT jsonb_object_keys(p_new)
    ) combined
  LOOP
    IF (p_old -> k) IS DISTINCT FROM (p_new -> k) THEN
      result := array_append(result, k);
    END IF;
  END LOOP;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.audit_diff_fields(jsonb, jsonb) IS
  'Returns the list of top-level JSON keys whose values differ between old and new.';


-- ----------------------------------------------------------------------------
-- 7. audit_resolve_org_id — walk parent chain to find organization_id.
-- Returns NULL on cascade-orphan (parent already gone); caller tolerates.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_resolve_org_id(p_table text, p_row jsonb)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  org_id uuid;
BEGIN
  IF p_row IS NULL THEN
    RETURN NULL;
  END IF;

  CASE p_table
    -- Tables that carry organization_id directly
    WHEN 'clients',
         'client_medical_history',
         'clinical_notes',
         'assessments',
         'programs',
         'sessions',
         'appointments',
         'communications',
         'reports'
    THEN
      org_id := NULLIF(p_row ->> 'organization_id', '')::uuid;

    -- Nested within programs
    WHEN 'program_weeks' THEN
      SELECT p.organization_id INTO org_id
        FROM programs p
       WHERE p.id = NULLIF(p_row ->> 'program_id', '')::uuid;

    WHEN 'program_days' THEN
      SELECT p.organization_id INTO org_id
        FROM program_weeks pw
        JOIN programs p ON p.id = pw.program_id
       WHERE pw.id = NULLIF(p_row ->> 'program_week_id', '')::uuid;

    WHEN 'program_exercises' THEN
      SELECT p.organization_id INTO org_id
        FROM program_days pd
        JOIN program_weeks pw ON pw.id = pd.program_week_id
        JOIN programs p ON p.id = pw.program_id
       WHERE pd.id = NULLIF(p_row ->> 'program_day_id', '')::uuid;

    -- Nested within sessions
    WHEN 'exercise_logs' THEN
      SELECT s.organization_id INTO org_id
        FROM sessions s
       WHERE s.id = NULLIF(p_row ->> 'session_id', '')::uuid;

    WHEN 'set_logs' THEN
      SELECT s.organization_id INTO org_id
        FROM exercise_logs el
        JOIN sessions s ON s.id = el.session_id
       WHERE el.id = NULLIF(p_row ->> 'exercise_log_id', '')::uuid;

    -- Nested within appointments
    WHEN 'appointment_reminders' THEN
      SELECT a.organization_id INTO org_id
        FROM appointments a
       WHERE a.id = NULLIF(p_row ->> 'appointment_id', '')::uuid;

    -- Nested within reports
    WHEN 'report_versions' THEN
      SELECT r.organization_id INTO org_id
        FROM reports r
       WHERE r.id = NULLIF(p_row ->> 'report_id', '')::uuid;

    ELSE
      RAISE EXCEPTION 'audit_resolve_org_id: unknown audited table %', p_table;
  END CASE;

  RETURN org_id;
END;
$$;

COMMENT ON FUNCTION public.audit_resolve_org_id(text, jsonb) IS
  'Resolves organization_id for audit log writes. Direct lookup for tables that carry the column; parent walk for nested tables.';


-- ----------------------------------------------------------------------------
-- 8. log_audit_event — the generic AFTER INSERT/UPDATE/DELETE trigger.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_row      jsonb;
  new_row      jsonb;
  row_for_org  jsonb;
  row_id_val   uuid;
  org_id       uuid;
  actor_id     uuid := NULLIF(current_setting('request.actor_user_id', true), '')::uuid;
  actor_role   text := NULLIF(current_setting('request.actor_role',    true), '');
  req_id       uuid := NULLIF(current_setting('request.request_id',    true), '')::uuid;
  ip_addr      inet := NULLIF(current_setting('request.ip_address',    true), '')::inet;
  ua           text := NULLIF(current_setting('request.user_agent',    true), '');
  diff_fields  text[];
  body_size    int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    old_row := to_jsonb(OLD);
    new_row := NULL;
    row_for_org := old_row;
    row_id_val := OLD.id;
  ELSIF TG_OP = 'INSERT' THEN
    old_row := NULL;
    new_row := to_jsonb(NEW);
    row_for_org := new_row;
    row_id_val := NEW.id;
  ELSE -- UPDATE
    old_row := to_jsonb(OLD);
    new_row := to_jsonb(NEW);
    row_for_org := new_row;
    row_id_val := NEW.id;
  END IF;

  org_id := public.audit_resolve_org_id(TG_TABLE_NAME, row_for_org);

  -- Apply wide-row trimming AFTER resolution so resolution has full row data.
  old_row := public.audit_trim_row(TG_TABLE_NAME, old_row);
  new_row := public.audit_trim_row(TG_TABLE_NAME, new_row);
  diff_fields := public.audit_diff_fields(old_row, new_row);
  body_size := octet_length(COALESCE(old_row::text,'')) + octet_length(COALESCE(new_row::text,''));

  INSERT INTO public.audit_log (
    organization_id, table_name, row_id, action,
    actor_user_id, actor_role, old_values, new_values, changed_fields,
    request_id, ip_address, user_agent, body_size_bytes
  ) VALUES (
    org_id, TG_TABLE_NAME, row_id_val, TG_OP::audit_action,
    actor_id, actor_role, old_row, new_row, diff_fields,
    req_id, ip_addr, ua, body_size
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.log_audit_event() IS
  'Generic AFTER INSERT/UPDATE/DELETE trigger body. SECURITY DEFINER runs as audit_writer so RLS on audit_log does not block writes.';

-- Note on RLS bypass: in self-hosted Postgres we'd ALTER FUNCTION OWNER TO
-- audit_writer so SECURITY DEFINER runs as a narrow role with BYPASSRLS.
-- Supabase's hosted environment denies the project's postgres role the
-- SET ROLE privilege required for ownership transfer. Postgres in Supabase
-- already has BYPASSRLS itself, so the SECURITY DEFINER functions defined
-- above (owned by postgres by default) achieve the same effect: trigger
-- INSERTs to audit_log bypass the deny-INSERT policy, while authenticated
-- users still cannot INSERT directly. audit_writer remains created and
-- granted INSERT for documentation and future portability.

-- Lock down: deny EXECUTE to anonymous; PostgREST won't expose these as RPCs.
REVOKE EXECUTE ON FUNCTION public.log_audit_event()                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_resolve_org_id(text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_trim_row(text, jsonb)       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_diff_fields(jsonb, jsonb)   FROM PUBLIC;


-- ----------------------------------------------------------------------------
-- 9. Attach triggers to every audited table.
-- ----------------------------------------------------------------------------
CREATE TRIGGER audit_clients
  AFTER INSERT OR UPDATE OR DELETE ON clients
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_client_medical_history
  AFTER INSERT OR UPDATE OR DELETE ON client_medical_history
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_clinical_notes
  AFTER INSERT OR UPDATE OR DELETE ON clinical_notes
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_assessments
  AFTER INSERT OR UPDATE OR DELETE ON assessments
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_programs
  AFTER INSERT OR UPDATE OR DELETE ON programs
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_program_weeks
  AFTER INSERT OR UPDATE OR DELETE ON program_weeks
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_program_days
  AFTER INSERT OR UPDATE OR DELETE ON program_days
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_program_exercises
  AFTER INSERT OR UPDATE OR DELETE ON program_exercises
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_sessions
  AFTER INSERT OR UPDATE OR DELETE ON sessions
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_exercise_logs
  AFTER INSERT OR UPDATE OR DELETE ON exercise_logs
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_set_logs
  AFTER INSERT OR UPDATE OR DELETE ON set_logs
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_appointments
  AFTER INSERT OR UPDATE OR DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_appointment_reminders
  AFTER INSERT OR UPDATE OR DELETE ON appointment_reminders
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_communications
  AFTER INSERT OR UPDATE OR DELETE ON communications
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_reports
  AFTER INSERT OR UPDATE OR DELETE ON reports
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_report_versions
  AFTER INSERT OR UPDATE OR DELETE ON report_versions
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();
