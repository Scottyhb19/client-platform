-- ============================================================================
-- 20260524202523_bootstrap_drop_pending_filter
-- ============================================================================
-- G-13: drop the 'Pending'-placeholder coupling in create_organization_with_owner.
-- The UPDATE that writes the owner's real name was gated on the profile still
-- reading the 'Pending' placeholder that handle_new_auth_user() inserts. A future
-- change to that trigger's placeholder strings would silently break the name
-- write. The double-signup guard already prevents this RPC running twice per
-- caller, so scoping the UPDATE to the caller's own row is sufficient.
--
-- Clean DROP + CREATE because the four-argument signature is unchanged.
-- The DROP destroys the function's grants and comment, so they are
-- restated after the CREATE. The UPDATE's WHERE clause loses its Pending
-- placeholder filter.
-- ============================================================================

DROP FUNCTION public.create_organization_with_owner(text, text, text, text);

CREATE FUNCTION public.create_organization_with_owner(
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

  -- Populate the owner's real name onto their profile row
  UPDATE user_profiles
     SET first_name = p_first_name,
         last_name  = p_last_name
   WHERE user_id = caller_id;

  -- Seed lookup tables
  PERFORM public.seed_organization_defaults(new_org_id);

  RETURN new_org_id;
END;
$$;

COMMENT ON FUNCTION public.create_organization_with_owner(text, text, text, text) IS
  'Atomic signup bootstrap: creates organization, links caller as owner, updates profile names, seeds default lookup tables. Refuses if caller already belongs to an organization.';

REVOKE EXECUTE ON FUNCTION public.create_organization_with_owner(text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_organization_with_owner(text, text, text, text) TO authenticated;
