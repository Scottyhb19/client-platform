-- ============================================================================
-- 20260420102400_bootstrap_functions
-- ============================================================================
-- Why: Three signup-flow functions that need to run outside of normal RLS
-- constraints because the caller's role/tenant context doesn't yet exist.
-- Each is SECURITY DEFINER with a narrow contract and search_path hardening.
--
--   seed_organization_defaults(org_id)      — populates lookup tables for a new org
--   create_organization_with_owner(...)     — called during EP signup; atomic
--   staff_create_client_invite(...)         — called by staff when inviting a client
--   client_accept_invite(...)               — called by a client after Supabase Auth
--                                             invite is accepted
--
-- These are the ONLY service-role-equivalent paths in the signup/invite
-- flows. Each is unit-testable and reviewable standalone. See /docs/auth.md
-- §5 for the end-to-end flow descriptions.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. seed_organization_defaults
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
    (p_org_id, 'kg',              'kg',           'weight',     10),
    (p_org_id, 'time_minsec',     'time (min:sec)', 'time',     20),
    (p_org_id, 'distance_m',      'distance (m)', 'distance',   30),
    (p_org_id, 'percentage',      'percentage',   'ratio',      40),
    (p_org_id, 'rpe',             'RPE (1-10)',   'rpe',        50),
    (p_org_id, 'tempo',           'tempo',        'tempo',      60),
    (p_org_id, 'bodyweight',      'bodyweight',   'bodyweight', 70),
    (p_org_id, 'lb',              'lb',           'weight',     80),
    (p_org_id, 'distance_miles',  'distance (mi)', 'distance',  90),
    (p_org_id, 'distance_km',     'distance (km)', 'distance', 100);

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
END;
$$;

COMMENT ON FUNCTION public.seed_organization_defaults(uuid) IS
  'Seeds all tenant-configurable lookup tables with default values for a newly-created organization. Idempotent: skips conflicts.';

REVOKE EXECUTE ON FUNCTION public.seed_organization_defaults(uuid) FROM PUBLIC, authenticated, anon;


-- ----------------------------------------------------------------------------
-- 2. create_organization_with_owner
-- ----------------------------------------------------------------------------
-- Called by the signup flow AFTER the user has a Supabase Auth account but
-- BEFORE they have an organization or role. Transactional: if any step fails
-- the whole operation rolls back, leaving the user with no dangling state.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_organization_with_owner(
  p_org_name    text,
  p_timezone    text,
  p_first_name  text,
  p_last_name   text
)
RETURNS uuid  -- returns the new organization_id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_org_id  uuid;
  new_slug    text;
  caller_id   uuid := auth.uid();
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Block double-signup: if the user already has any org membership, fail.
  IF EXISTS (SELECT 1 FROM user_organization_roles WHERE user_id = caller_id) THEN
    RAISE EXCEPTION 'User already belongs to an organization'
      USING HINT = 'Multi-org membership is not supported in v1; contact support.';
  END IF;

  -- Derive a slug from name: lowercase, non-alphanum → hyphen, collapse, trim.
  new_slug := regexp_replace(lower(trim(p_org_name)), '[^a-z0-9]+', '-', 'g');
  new_slug := regexp_replace(new_slug, '^-+|-+$', '', 'g');
  IF length(new_slug) < 3 THEN
    new_slug := new_slug || '-' || substring(gen_random_uuid()::text, 1, 6);
  END IF;
  IF length(new_slug) > 63 THEN
    new_slug := substring(new_slug, 1, 63);
  END IF;

  -- If the slug already exists, append a random suffix to guarantee uniqueness.
  IF EXISTS (SELECT 1 FROM organizations WHERE slug = new_slug) THEN
    new_slug := substring(new_slug, 1, 56) || '-' || substring(gen_random_uuid()::text, 1, 6);
  END IF;

  -- Create the organization
  INSERT INTO organizations (name, slug, timezone)
  VALUES (p_org_name, new_slug, COALESCE(p_timezone, 'Australia/Sydney'))
  RETURNING id INTO new_org_id;

  -- Link caller as owner
  INSERT INTO user_organization_roles (user_id, organization_id, role)
  VALUES (caller_id, new_org_id, 'owner');

  -- Populate the profile if still on placeholders
  UPDATE user_profiles
     SET first_name = p_first_name,
         last_name  = p_last_name
   WHERE user_id = caller_id
     AND (first_name = 'Pending' OR last_name = 'Pending');

  -- Seed lookup tables
  PERFORM public.seed_organization_defaults(new_org_id);

  RETURN new_org_id;
END;
$$;

COMMENT ON FUNCTION public.create_organization_with_owner(text, text, text, text) IS
  'Atomic signup bootstrap: creates organization, links caller as owner, updates profile names, seeds default lookup tables. Refuses if caller already belongs to an organization.';

REVOKE EXECUTE ON FUNCTION public.create_organization_with_owner(text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_organization_with_owner(text, text, text, text) TO authenticated;


-- ----------------------------------------------------------------------------
-- 3. staff_create_client_invite
-- ----------------------------------------------------------------------------
-- Creates the clients row in the staff's active organization. The application
-- then calls supabase.auth.admin.inviteUserByEmail() from a server action
-- using the service role to actually dispatch the magic link.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_create_client_invite(
  p_email       text,
  p_first_name  text,
  p_last_name   text,
  p_dob         date     DEFAULT NULL,
  p_phone       text     DEFAULT NULL,
  p_referral_source text DEFAULT NULL,
  p_category_id uuid     DEFAULT NULL
)
RETURNS uuid  -- returns the new clients.id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id    uuid := auth.uid();
  caller_role  text := public.user_role();
  caller_org   uuid := public.user_organization_id();
  new_client_id uuid;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF caller_role NOT IN ('owner', 'staff') THEN
    RAISE EXCEPTION 'Insufficient role: % cannot invite clients', COALESCE(caller_role, 'null');
  END IF;

  IF caller_org IS NULL THEN
    RAISE EXCEPTION 'No active organization for caller';
  END IF;

  -- Refuse duplicates: a live client with this email in this org already exists.
  IF EXISTS (
    SELECT 1 FROM clients
     WHERE organization_id = caller_org
       AND lower(email) = lower(p_email)
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'A client with email % already exists in this organization', p_email
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO clients (
    organization_id, first_name, last_name, email,
    dob, phone, referral_source, category_id, invited_at
  ) VALUES (
    caller_org, p_first_name, p_last_name, p_email,
    p_dob, p_phone, p_referral_source, p_category_id, now()
  )
  RETURNING id INTO new_client_id;

  RETURN new_client_id;
END;
$$;

COMMENT ON FUNCTION public.staff_create_client_invite(text, text, text, date, text, text, uuid) IS
  'Staff creates a clients row in their active org with invited_at = now. Server-action caller follows up with supabase.auth.admin.inviteUserByEmail to send the magic link.';

REVOKE EXECUTE ON FUNCTION public.staff_create_client_invite(text, text, text, date, text, text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.staff_create_client_invite(text, text, text, date, text, text, uuid) TO authenticated;


-- ----------------------------------------------------------------------------
-- 4. client_accept_invite
-- ----------------------------------------------------------------------------
-- Called from the /welcome page after the client clicks the Supabase magic
-- link and sets a password. Links clients.user_id to auth.uid() and creates
-- the user_organization_roles 'client' row.
--
-- Security: verifies the auth user's email matches the clients.email for
-- the claimed client_id. Without that check, an attacker could claim any
-- client record whose id they know.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_accept_invite(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id       uuid := auth.uid();
  caller_email    text;
  client_row      clients%ROWTYPE;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT email INTO caller_email FROM auth.users WHERE id = caller_id;
  IF caller_email IS NULL THEN
    RAISE EXCEPTION 'Caller has no email on auth.users';
  END IF;

  SELECT * INTO client_row FROM clients WHERE id = p_client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client record not found';
  END IF;

  IF client_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This invitation has been revoked';
  END IF;

  IF lower(client_row.email) <> lower(caller_email) THEN
    RAISE EXCEPTION 'Email mismatch between invite and authenticated user';
  END IF;

  IF client_row.user_id IS NOT NULL AND client_row.user_id <> caller_id THEN
    RAISE EXCEPTION 'This invitation has already been accepted by another user';
  END IF;

  -- Link and onboard
  UPDATE clients
     SET user_id      = caller_id,
         onboarded_at = COALESCE(onboarded_at, now())
   WHERE id = p_client_id;

  -- Role assignment
  INSERT INTO user_organization_roles (user_id, organization_id, role)
  VALUES (caller_id, client_row.organization_id, 'client')
  ON CONFLICT (user_id, organization_id) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.client_accept_invite(uuid) IS
  'Client-side invite acceptance. Verifies email match, links clients.user_id, creates client role. Idempotent on repeated calls from the same authenticated user.';

REVOKE EXECUTE ON FUNCTION public.client_accept_invite(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.client_accept_invite(uuid) TO authenticated;
