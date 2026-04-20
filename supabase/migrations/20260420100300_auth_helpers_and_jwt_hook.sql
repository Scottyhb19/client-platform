-- ============================================================================
-- 20260420100300_auth_helpers_and_jwt_hook
-- ============================================================================
-- Why: every RLS policy calls public.user_organization_id() and public.user_role()
-- to read the caller's tenant scope and role from the JWT. Those claims are
-- not in the JWT by default — they are injected by a Custom Access Token Hook
-- that runs on every JWT issue/refresh.
--
-- WIRING (must be done ONCE per project — dashboard, not SQL):
--   Dashboard → Authentication → Hooks → Custom Access Token
--   URI: pg-functions://postgres/auth_hooks/custom_access_token
--
-- Without the hook enabled, all RLS policies match zero rows (fail safe).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- RLS helper: read organization_id from the JWT custom claim.
-- Returns NULL if the claim is absent; policies comparing uuid = NULL match
-- zero rows, so the system is safely inoperable rather than unsafely open.
--
-- Lives in public, not auth — Supabase reserves the auth schema for its own
-- objects and denies CREATE to the project's postgres role.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_organization_id()
RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::jsonb ->> 'organization_id',
    ''
  )::uuid;
$$;

COMMENT ON FUNCTION public.user_organization_id() IS
  'Reads organization_id from the JWT custom claim. NULL when claim absent; policies comparing to NULL match zero rows (fail safe).';


-- ----------------------------------------------------------------------------
-- RLS helper: read role from the JWT custom claim.
-- Returns one of 'owner', 'staff', 'client', or NULL.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_role()
RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'user_role';
$$;

COMMENT ON FUNCTION public.user_role() IS
  'Reads user_role from the JWT custom claim. One of owner | staff | client, or NULL.';


-- ----------------------------------------------------------------------------
-- Custom Access Token Hook.
-- Supabase invokes this at every JWT issue/refresh. It looks up the user's
-- first membership in user_organization_roles and injects the corresponding
-- organization_id + role into the JWT claims.
--
-- v1: a user has exactly one membership, so the first row is "the" org.
-- Phase 4 (multi-org): the app writes the chosen org_id to
-- auth.users.raw_app_meta_data.active_organization_id; this function then
-- prefers that value over the default first row. The Phase-4 branch is
-- already prepared below to avoid a subsequent migration.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_hooks.custom_access_token(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  claims          jsonb := COALESCE(event->'claims', '{}'::jsonb);
  user_id_val     uuid  := (event->>'user_id')::uuid;
  preferred_org   uuid;
  active_org      uuid;
  active_role     text;
BEGIN
  -- Phase 4 preference: app-set active organization (not used in v1).
  SELECT (raw_app_meta_data ->> 'active_organization_id')::uuid
    INTO preferred_org
    FROM auth.users
   WHERE id = user_id_val;

  IF preferred_org IS NOT NULL THEN
    SELECT organization_id, role::text
      INTO active_org, active_role
      FROM public.user_organization_roles
     WHERE user_id = user_id_val
       AND organization_id = preferred_org;
  END IF;

  -- Fallback: first membership by created_at.
  IF active_org IS NULL THEN
    SELECT organization_id, role::text
      INTO active_org, active_role
      FROM public.user_organization_roles
     WHERE user_id = user_id_val
     ORDER BY created_at ASC
     LIMIT 1;
  END IF;

  IF active_org IS NOT NULL THEN
    claims := jsonb_set(claims, '{organization_id}', to_jsonb(active_org::text));
    claims := jsonb_set(claims, '{user_role}',       to_jsonb(active_role));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

COMMENT ON FUNCTION auth_hooks.custom_access_token(jsonb) IS
  'Supabase Custom Access Token Hook. Injects organization_id and user_role into every issued JWT. See /docs/auth.md §4.1.';

-- The Supabase auth service calls this function as the supabase_auth_admin
-- role. Grant only that role; deny everyone else.
GRANT USAGE   ON SCHEMA auth_hooks                             TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION auth_hooks.custom_access_token(jsonb) TO supabase_auth_admin;

REVOKE EXECUTE ON FUNCTION auth_hooks.custom_access_token(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_hooks.custom_access_token(jsonb) FROM authenticated, anon;
