-- pgTAP installs into the `extensions` schema on Supabase managed; bring
-- it into search_path so plan(), is(), finish() etc. resolve unqualified.
SET search_path TO public, extensions, pg_temp;

-- ============================================================================
-- 04_three_entry_points
-- ============================================================================
-- Maps to brief §8 Test 2 — "Three entry points, one record."
--
-- The three capture entry points are:
--   (a) Inside a clinical note (Initial Assessment / Reassessment template)
--   (b) Stand-alone via the Reports tab modal
--   (c) Future VALD CSV/XML importer
--
-- All three must produce structurally-identical test_results rows. The
-- only differences are:
--   - test_sessions.source ('manual' for a + b, 'vald' for c)
--   - clinical_notes.test_session_id (FK from a's note; null for b and c)
--
-- Implementation note: the capture RPC is the single write path. The
-- "future VALD importer" is *just* a call to create_test_session() with
-- p_source = 'vald' once the parser turns a CSV/XML payload into the
-- same {test_id, metric_id, side, value, unit} shape. No separate RPC.
-- This pgTAP test is therefore the canonical proof that the data layer
-- is ready for the importer when Phase 3 lands.
-- ============================================================================

BEGIN;

SELECT plan(11);


-- ----------------------------------------------------------------------------
-- Fixture: org, staff, client, note template, three captured sessions
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  org_id        uuid := '00000000-0000-0000-0000-0000000000d1'::uuid;
  staff_uid     uuid;
  client_row_id uuid := '00000000-0000-0000-0000-0000000000d2'::uuid;
  template_id   uuid := '00000000-0000-0000-0000-0000000000d3'::uuid;
  session_a     uuid;
  session_b     uuid;
  session_c     uuid;
  note_a        uuid;
BEGIN
  INSERT INTO organizations (id, name, slug)
  VALUES (org_id, 'Test Org — Three Entry Points', 'test-org-three-entry');

  staff_uid := public._test_make_user('staff-3entry@test.local');
  PERFORM public._test_grant_membership(staff_uid, org_id, 'staff'::user_role);

  INSERT INTO clients (
    id, organization_id, first_name, last_name, email
  ) VALUES (
    client_row_id, org_id, 'Tess', 'Three', 'tess@test.local'
  );

  -- A minimal note template so the (a) path can attach a clinical_note.
  INSERT INTO note_templates (id, organization_id, name, sort_order)
  VALUES (template_id, org_id, 'Initial Assessment', 0);

  -- create_test_session is SECURITY INVOKER and goes through RLS, so:
  -- (1) spoof the JWT so user_organization_id() and auth.uid() return values,
  -- (2) switch role to authenticated so the policies (which target that role)
  --     actually apply.
  PERFORM public._test_set_jwt(staff_uid, org_id, 'staff');
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- Path (a): note-template entry. Capture first, then create the
  -- clinical_note that links to it. Mirrors what NotesTab does on submit.
  session_a := public.create_test_session(
    client_row_id,
    now() - interval '3 minutes',
    'manual'::test_source_t,
    NULL,
    NULL,
    NULL,
    jsonb_build_array(jsonb_build_object(
      'test_id',   'rom_hip_flexion',
      'metric_id', 'passive',
      'side',      'left',
      'value',     115,
      'unit',      'deg'
    ))
  );
  INSERT INTO clinical_notes (
    organization_id, client_id, author_user_id, template_id,
    note_type, note_date, content_json, test_session_id
  ) VALUES (
    org_id, client_row_id, staff_uid, template_id,
    'progress_note'::note_type, CURRENT_DATE,
    jsonb_build_object('fields', jsonb_build_array(
      jsonb_build_object('label', 'Subjective', 'type', 'long_text', 'value', 'Initial assessment narrative.')
    )),
    session_a
  ) RETURNING id INTO note_a;

  -- Path (b): stand-alone Reports modal — same capture, no linked note.
  session_b := public.create_test_session(
    client_row_id,
    now() - interval '2 minutes',
    'manual'::test_source_t,
    NULL,
    NULL,
    NULL,
    jsonb_build_array(jsonb_build_object(
      'test_id',   'rom_hip_flexion',
      'metric_id', 'passive',
      'side',      'left',
      'value',     115,
      'unit',      'deg'
    ))
  );

  -- Path (c): simulated VALD import. Same RPC, source='vald'.
  session_c := public.create_test_session(
    client_row_id,
    now() - interval '1 minute',
    'vald'::test_source_t,
    NULL,
    NULL,
    NULL,
    jsonb_build_array(jsonb_build_object(
      'test_id',   'rom_hip_flexion',
      'metric_id', 'passive',
      'side',      'left',
      'value',     115,
      'unit',      'deg'
    ))
  );

  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT
    org_id        AS org_id,
    staff_uid     AS staff_uid,
    client_row_id AS client_row_id,
    note_a        AS note_a,
    session_a     AS session_a,
    session_b     AS session_b,
    session_c     AS session_c;
  -- Grant access so any later SET LOCAL ROLE authenticated assertion can
  -- read it. (Defensive — this file's assertions all run as the test
  -- runner, but the helpers and pattern are shared across files.)
  GRANT SELECT ON _ids TO authenticated;
END $$;


-- ----------------------------------------------------------------------------
-- Assertions
-- ----------------------------------------------------------------------------

-- 1. Each path produced exactly one test_results row.
SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_a FROM _ids)),
  1,
  '(a) note-template path produced exactly one test_result row'
);
SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_b FROM _ids)),
  1,
  '(b) Reports-modal path produced exactly one test_result row'
);
SELECT is(
  (SELECT count(*)::int FROM test_results
    WHERE test_session_id = (SELECT session_c FROM _ids)),
  1,
  '(c) VALD-importer path produced exactly one test_result row'
);

-- 2. The three rows are byte-identical except for ids and the parent session.
SELECT is(
  (SELECT count(DISTINCT (test_id, metric_id, side, value, unit))::int
     FROM test_results
    WHERE test_session_id IN (
      (SELECT session_a FROM _ids),
      (SELECT session_b FROM _ids),
      (SELECT session_c FROM _ids)
    )),
  1,
  'All three result rows share identical (test_id, metric_id, side, value, unit)'
);

-- 3. The three sessions differ only on the source column.
SELECT is(
  (SELECT source::text FROM test_sessions WHERE id = (SELECT session_a FROM _ids)),
  'manual',
  '(a) source = manual'
);
SELECT is(
  (SELECT source::text FROM test_sessions WHERE id = (SELECT session_b FROM _ids)),
  'manual',
  '(b) source = manual'
);
SELECT is(
  (SELECT source::text FROM test_sessions WHERE id = (SELECT session_c FROM _ids)),
  'vald',
  '(c) source = vald'
);

-- 4. The note-template path linked the clinical_note to its session.
SELECT is(
  (SELECT test_session_id FROM clinical_notes WHERE id = (SELECT note_a FROM _ids)),
  (SELECT session_a FROM _ids),
  '(a) clinical_note linked to its captured test_session via test_session_id'
);

-- 5. Paths (b) and (c) have no linked clinical_note pointing at them.
SELECT is(
  (SELECT count(*)::int FROM clinical_notes
    WHERE test_session_id = (SELECT session_b FROM _ids)
      AND deleted_at IS NULL),
  0,
  '(b) Reports-modal path has no linked clinical_note'
);
SELECT is(
  (SELECT count(*)::int FROM clinical_notes
    WHERE test_session_id = (SELECT session_c FROM _ids)
      AND deleted_at IS NULL),
  0,
  '(c) VALD path has no linked clinical_note'
);

-- 6. Sanity: there's exactly one clinical_note for this client (path a only).
SELECT is(
  (SELECT count(*)::int FROM clinical_notes
    WHERE client_id = (SELECT client_row_id FROM _ids)
      AND deleted_at IS NULL),
  1,
  'Exactly one clinical_note exists for the client (the path-a note)'
);


SELECT * FROM finish();

ROLLBACK;
