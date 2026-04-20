-- ============================================================================
-- 20260420100200_identity_tables
-- ============================================================================
-- Why: organizations is the tenant root. user_profiles mirrors auth.users so
-- our business tables can FK against a stable, soft-deletable identity target
-- rather than cascading on auth-side deletions. user_organization_roles is
-- the join whose (organization_id, role) is surfaced to RLS via the JWT
-- custom-claim hook defined in the next migration.
--
-- Invariants enforced here:
--   - An organization always has at least one owner (trigger).
--   - A new auth.users row automatically gets a user_profiles row.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- organizations — tenant root
-- ----------------------------------------------------------------------------
CREATE TABLE organizations (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text         NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  slug        text         NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,63}$'),
  -- timezone validity is enforced by a trigger (see validate_timezone() below).
  -- CHECK constraints in Postgres cannot reference other tables / system catalogs,
  -- so pg_timezone_names lookup must live in a trigger function.
  timezone    text         NOT NULL DEFAULT 'Australia/Sydney',
  email       text,
  phone       text,
  address     text,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- Partial index keeps default queries for live orgs cheap.
CREATE INDEX organizations_active_idx
  ON organizations (id)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE organizations IS
  'Tenant root. One row per clinical practice business entity.';
COMMENT ON COLUMN organizations.slug IS
  'URL-friendly identifier: lowercase alphanumeric + hyphens, 3–63 chars.';
COMMENT ON COLUMN organizations.timezone IS
  'IANA timezone name; used when resolving availability_rules to UTC. Validated by validate_timezone() trigger.';

-- Trigger function: validates that the timezone exists in pg_timezone_names.
-- Reusable for any future table with a timezone column.
CREATE OR REPLACE FUNCTION public.validate_timezone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.timezone IS NULL THEN
    RAISE EXCEPTION 'timezone cannot be NULL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Invalid IANA timezone: %', NEW.timezone
      USING HINT = 'See SELECT name FROM pg_timezone_names for the full list.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_validate_timezone
  BEFORE INSERT OR UPDATE OF timezone ON organizations
  FOR EACH ROW EXECUTE FUNCTION public.validate_timezone();


-- ----------------------------------------------------------------------------
-- user_profiles — 1:1 mirror of auth.users
-- ----------------------------------------------------------------------------
CREATE TABLE user_profiles (
  user_id     uuid         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name  text         NOT NULL CHECK (length(trim(first_name)) BETWEEN 1 AND 100),
  last_name   text         NOT NULL CHECK (length(trim(last_name))  BETWEEN 1 AND 100),
  phone       text,
  avatar_url  text,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

COMMENT ON TABLE user_profiles IS
  'Per-user profile data; 1:1 mirror of auth.users(id). Business tables FK here for stable soft-delete semantics.';

-- Auto-create a user_profiles row whenever auth.users gets one.
-- Placeholders are overwritten by the application during signup before the
-- user reaches a dashboard route.
CREATE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, first_name, last_name)
  VALUES (NEW.id, 'Pending', 'Pending')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_auth_user() IS
  'Creates a user_profiles row whenever a new auth.users row appears.';

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();


-- ----------------------------------------------------------------------------
-- user_organization_roles — membership + role (JWT claim source)
-- ----------------------------------------------------------------------------
CREATE TABLE user_organization_roles (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid         NOT NULL REFERENCES user_profiles(user_id) ON DELETE RESTRICT,
  organization_id  uuid         NOT NULL REFERENCES organizations(id)      ON DELETE RESTRICT,
  role             user_role    NOT NULL,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id)
);

CREATE INDEX user_organization_roles_user_idx ON user_organization_roles (user_id);
CREATE INDEX user_organization_roles_org_idx  ON user_organization_roles (organization_id);

COMMENT ON TABLE user_organization_roles IS
  'Join linking auth users to organizations with a role. The active (organization_id, role) is surfaced to RLS via the JWT custom claim hook.';

-- Invariant: an organization must always have at least one owner.
-- Expressed as a BEFORE DELETE trigger because RLS cannot easily say
-- "and at least one owner remains."
CREATE FUNCTION public.prevent_last_owner_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role = 'owner' AND (
      SELECT count(*) FROM user_organization_roles
       WHERE organization_id = OLD.organization_id
         AND role = 'owner'
  ) <= 1 THEN
    RAISE EXCEPTION 'Cannot remove the last owner of organization %', OLD.organization_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.prevent_last_owner_delete() IS
  'BEFORE DELETE trigger on user_organization_roles; rejects removing the last owner of an organization.';

CREATE TRIGGER enforce_last_owner_invariant
  BEFORE DELETE ON user_organization_roles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_last_owner_delete();


-- ----------------------------------------------------------------------------
-- updated_at maintenance for all three tables
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.touch_updated_at() IS
  'Generic BEFORE UPDATE trigger: bumps updated_at to now().';

CREATE TRIGGER organizations_touch_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER user_profiles_touch_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
