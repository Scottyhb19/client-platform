-- ============================================================================
-- 00_test_helpers
-- ============================================================================
-- Why: Shared setup for the pgTAP test suite. Loaded via `supabase test db`
-- which executes every *.sql in this directory in alphabetical order, each
-- as its own session. The `00_` prefix on this file ensures it runs first
-- and installs the pgTAP extension and the JWT-spoofing helpers.
--
-- Tests that follow assume:
--   - pgTAP is installed
--   - public._test_set_jwt(user_id, org_id, role) sets the request.jwt.*
--     GUCs so RLS policies see the caller as the spoofed user.
--   - public._test_clear_jwt() resets back to the un-authenticated state.
--
-- Each test file wraps its own work in BEGIN; … ROLLBACK; so fixtures
-- created mid-test never leak between files.
-- ============================================================================

-- Install pgTAP only if absent. Supabase managed installs extensions
-- into the `extensions` schema, not public — explicit WITH SCHEMA so
-- a fresh project gets it in the right place. Test files SET
-- search_path TO public, extensions, pg_temp so the plan(), is() etc.
-- functions resolve unqualified.
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;


-- ----------------------------------------------------------------------------
-- _test_set_jwt — spoof the JWT claims for the current session.
-- The auth helpers (public.user_organization_id, public.user_role) and
-- Supabase's auth.uid() all read from request.jwt.claims; setting that
-- GUC is sufficient to act as a particular user inside RLS evaluation.
--
-- Note: SET LOCAL only persists for the surrounding transaction. Tests
-- must be wrapped in BEGIN/ROLLBACK or these settings leak.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._test_set_jwt(
  p_user_id uuid,
  p_organization_id uuid,
  p_role text
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  claims jsonb;
BEGIN
  claims := jsonb_build_object(
    'sub',             p_user_id::text,
    'organization_id', p_organization_id::text,
    'user_role',       p_role
  );
  PERFORM set_config('request.jwt.claims',    claims::text,         true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text,      true);
END;
$$;

COMMENT ON FUNCTION public._test_set_jwt(uuid, uuid, text) IS
  'pgTAP helper: spoof request.jwt.claims so RLS policies treat the session as the given user. SET LOCAL semantics — wrap test bodies in BEGIN/ROLLBACK.';


CREATE OR REPLACE FUNCTION public._test_clear_jwt() RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',    '',  true);
  PERFORM set_config('request.jwt.claim.sub', '',  true);
END;
$$;

COMMENT ON FUNCTION public._test_clear_jwt() IS
  'pgTAP helper: clear spoofed JWT claims. Pair with _test_set_jwt.';


-- ----------------------------------------------------------------------------
-- _test_make_user — minimal auth.users row + user_profiles mirror.
-- Returns the new user_id. Idempotent on email collision (returns the
-- existing user_id). Run as the test owner (which has BYPASSRLS).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._test_make_user(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  uid uuid;
BEGIN
  SELECT id INTO uid FROM auth.users WHERE email = p_email LIMIT 1;
  IF uid IS NOT NULL THEN
    RETURN uid;
  END IF;

  uid := gen_random_uuid();

  -- Minimal auth.users row. Real Supabase auth uses many more columns
  -- but the only one referenced by FKs and RLS is id. The
  -- on_auth_user_created trigger will auto-create the matching
  -- user_profiles row with placeholder names.
  INSERT INTO auth.users (
    id, instance_id, email, aud, role,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES (
    uid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    p_email,
    'authenticated',
    'authenticated',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

  RETURN uid;
END;
$$;

COMMENT ON FUNCTION public._test_make_user(text) IS
  'pgTAP helper: create an auth.users + user_profiles pair. Idempotent on email. Test-only — never call from application code.';


-- ----------------------------------------------------------------------------
-- _test_grant_membership — wire user → org → role.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._test_grant_membership(
  p_user_id uuid,
  p_org_id  uuid,
  p_role    user_role
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO user_organization_roles (user_id, organization_id, role)
  VALUES (p_user_id, p_org_id, p_role)
  ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role;
END;
$$;

COMMENT ON FUNCTION public._test_grant_membership(uuid, uuid, user_role) IS
  'pgTAP helper: grant a user a role in an organization. Test-only.';


-- ----------------------------------------------------------------------------
-- _test_insert_test_session — bypass-RLS helper for fixture creation.
--
-- The Supabase SQL Editor's role context isn't reliable across queries —
-- direct INSERTs into test_sessions sometimes hit the RLS policy
-- (TO authenticated) even when we expect BYPASSRLS. Wrapping the write
-- in a SECURITY DEFINER function (owned by postgres) routes around the
-- inconsistency.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._test_insert_test_session(
  p_id           uuid,
  p_org          uuid,
  p_client       uuid,
  p_conducted_by uuid,
  p_conducted_at timestamptz,
  p_source       test_source_t DEFAULT 'manual'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO test_sessions (
    id, organization_id, client_id, conducted_by, conducted_at, source
  ) VALUES (
    p_id, p_org, p_client, p_conducted_by, p_conducted_at, p_source
  );
  RETURN p_id;
END;
$$;

COMMENT ON FUNCTION public._test_insert_test_session(uuid, uuid, uuid, uuid, timestamptz, test_source_t) IS
  'pgTAP helper: insert a test_session bypassing RLS. Test-only.';


-- ----------------------------------------------------------------------------
-- _test_insert_test_result — bypass-RLS helper for fixture creation.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._test_insert_test_result(
  p_org          uuid,
  p_session      uuid,
  p_test_id      text,
  p_metric_id    text,
  p_side         test_side_t,
  p_value        numeric,
  p_unit         text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO test_results (
    organization_id, test_session_id, test_id, metric_id, side, value, unit
  ) VALUES (
    p_org, p_session, p_test_id, p_metric_id, p_side, p_value, p_unit
  );
END;
$$;

COMMENT ON FUNCTION public._test_insert_test_result(uuid, uuid, text, text, test_side_t, numeric, text) IS
  'pgTAP helper: insert a test_result bypassing RLS. Test-only.';


-- ----------------------------------------------------------------------------
-- _test_insert_client_publication — bypass-RLS helper for fixture creation.
-- ----------------------------------------------------------------------------
-- Per-test granularity (Phase D.5): test_id is required. Drop the old
-- (uuid, uuid, uuid, text) signature first so the overloaded versions
-- don't coexist — see project memory `plpgsql function arity evolution`
-- for the consequences (supabase-js silently calls the wrong overload).
DROP FUNCTION IF EXISTS public._test_insert_client_publication(uuid, uuid, uuid, text);

CREATE OR REPLACE FUNCTION public._test_insert_client_publication(
  p_org           uuid,
  p_session       uuid,
  p_published_by  uuid,
  p_test_id       text,
  p_framing_text  text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  pub_id uuid;
BEGIN
  INSERT INTO client_publications (
    organization_id, test_session_id, published_by, test_id, framing_text
  ) VALUES (
    p_org, p_session, p_published_by, p_test_id, p_framing_text
  ) RETURNING id INTO pub_id;
  RETURN pub_id;
END;
$$;

COMMENT ON FUNCTION public._test_insert_client_publication(uuid, uuid, uuid, text, text) IS
  'pgTAP helper: insert a client_publication bypassing RLS. Test-only. Phase D.5: test_id is required (per-test publication granularity).';
