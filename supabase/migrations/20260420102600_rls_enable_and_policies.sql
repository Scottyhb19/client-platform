-- ============================================================================
-- 20260420102600_rls_enable_and_policies
-- ============================================================================
-- Why: This is THE security boundary. Until this migration runs, no RLS is
-- active. After it runs, every tenant-owned table has explicit SELECT /
-- INSERT / UPDATE / DELETE policies wired to JWT claims. Organized in the
-- same order as /docs/rls-policies.md §4 for reviewability.
--
-- Patterns (per /docs/rls-policies.md §3):
--   A  staff-org-scoped CRUD, no client access
--   B  staff-org CRUD + client SELECT of own records
--   C  nested child via parent join
--   D  client-own-only (client writes during portal flow)
--   E  reference lookup (same as A but no deleted_at on SELECT)
--   F  audit-only (owner SELECT, deny writes)
-- ============================================================================


-- ============================================================================
-- §1. IDENTITY TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- organizations
-- ----------------------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select orgs user belongs to"
  ON organizations FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND id IN (
      SELECT organization_id FROM user_organization_roles
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "deny direct insert organizations"
  ON organizations FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "owner updates own org"
  ON organizations FOR UPDATE TO authenticated
  USING (
    id = public.user_organization_id()
    AND public.user_role() = 'owner'
    AND deleted_at IS NULL
  )
  WITH CHECK (id = public.user_organization_id());

CREATE POLICY "deny delete organizations"
  ON organizations FOR DELETE TO authenticated USING (false);


-- ----------------------------------------------------------------------------
-- user_profiles
-- ----------------------------------------------------------------------------
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select own profile or co-members"
  ON user_profiles FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      user_id = auth.uid()
      OR user_id IN (
        SELECT uor2.user_id
          FROM user_organization_roles uor1
          JOIN user_organization_roles uor2
            ON uor2.organization_id = uor1.organization_id
         WHERE uor1.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "deny direct insert user_profiles"
  ON user_profiles FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "update own profile"
  ON user_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND deleted_at IS NULL)
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "deny delete user_profiles"
  ON user_profiles FOR DELETE TO authenticated USING (false);


-- ----------------------------------------------------------------------------
-- user_organization_roles
-- ----------------------------------------------------------------------------
ALTER TABLE user_organization_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select own or in-org memberships"
  ON user_organization_roles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      organization_id = public.user_organization_id()
      AND public.user_role() IN ('owner', 'staff')
    )
  );

CREATE POLICY "insert memberships in own org"
  ON user_organization_roles FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND (
      public.user_role() = 'owner'
      OR (public.user_role() = 'staff' AND role = 'client')
    )
  );

CREATE POLICY "owner updates memberships in own org"
  ON user_organization_roles FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() = 'owner'
  )
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "owner deletes memberships in own org"
  ON user_organization_roles FOR DELETE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() = 'owner'
  );


-- ============================================================================
-- §2. CLINICAL CORE
-- ============================================================================

-- ----------------------------------------------------------------------------
-- clients  (Pattern B; client RLS allows SELECT on own row but NOT UPDATE)
-- ----------------------------------------------------------------------------
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select clients in own org"
  ON clients FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND (
      public.user_role() IN ('owner', 'staff')
      OR (public.user_role() = 'client' AND user_id = auth.uid())
    )
  );

CREATE POLICY "staff insert clients in own org"
  ON clients FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
  );

CREATE POLICY "staff update clients in own org"
  ON clients FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
  )
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "deny delete clients"
  ON clients FOR DELETE TO authenticated USING (false);


-- ----------------------------------------------------------------------------
-- client_medical_history  (Pattern B — client sees own)
-- ----------------------------------------------------------------------------
ALTER TABLE client_medical_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select cmh in own org"
  ON client_medical_history FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND (
      public.user_role() IN ('owner', 'staff')
      OR (
        public.user_role() = 'client'
        AND client_id IN (
          SELECT id FROM clients WHERE user_id = auth.uid() AND deleted_at IS NULL
        )
      )
    )
  );

CREATE POLICY "staff insert cmh in own org"
  ON client_medical_history FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
  );

CREATE POLICY "staff update cmh in own org"
  ON client_medical_history FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
  )
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "deny delete cmh"
  ON client_medical_history FOR DELETE TO authenticated USING (false);


-- ----------------------------------------------------------------------------
-- clinical_notes  (Pattern A — STAFF ONLY ALWAYS)
-- Critical: clients must NOT SELECT these rows. See /docs/rls-policies.md §4.6.
-- ----------------------------------------------------------------------------
ALTER TABLE clinical_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff select clinical_notes in own org"
  ON clinical_notes FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND public.user_role() IN ('owner', 'staff')
  );

CREATE POLICY "staff insert clinical_notes in own org"
  ON clinical_notes FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
    AND author_user_id = auth.uid()
  );

CREATE POLICY "staff update clinical_notes in own org"
  ON clinical_notes FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
  )
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "deny delete clinical_notes"
  ON clinical_notes FOR DELETE TO authenticated USING (false);


-- ----------------------------------------------------------------------------
-- assessment_templates  (Pattern A)
-- ----------------------------------------------------------------------------
ALTER TABLE assessment_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff select assessment_templates in own org"
  ON assessment_templates FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND public.user_role() IN ('owner', 'staff')
  );

CREATE POLICY "staff insert assessment_templates in own org"
  ON assessment_templates FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
  );

CREATE POLICY "staff update assessment_templates in own org"
  ON assessment_templates FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
  )
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "deny delete assessment_templates"
  ON assessment_templates FOR DELETE TO authenticated USING (false);


-- ----------------------------------------------------------------------------
-- assessments  (Pattern A in v1 — clients cannot SELECT)
-- ----------------------------------------------------------------------------
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff select assessments in own org"
  ON assessments FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND public.user_role() IN ('owner', 'staff')
  );

CREATE POLICY "staff insert assessments in own org"
  ON assessments FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
  );

CREATE POLICY "staff update assessments in own org"
  ON assessments FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner', 'staff')
  )
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "deny delete assessments"
  ON assessments FOR DELETE TO authenticated USING (false);


-- ============================================================================
-- §3. EXERCISE LIBRARY
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Generic helper: staff CRUD pattern for library lookup tables.
-- Applied to movement_patterns, section_titles, client_categories,
-- exercise_tags, exercise_metric_units, vald_device_types.
-- ----------------------------------------------------------------------------

-- movement_patterns
ALTER TABLE movement_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff select movement_patterns in own org"
  ON movement_patterns FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND deleted_at IS NULL
         AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff insert movement_patterns in own org"
  ON movement_patterns FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff update movement_patterns in own org"
  ON movement_patterns FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'))
  WITH CHECK (organization_id = public.user_organization_id());
CREATE POLICY "staff delete movement_patterns in own org"
  ON movement_patterns FOR DELETE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'));

-- section_titles
ALTER TABLE section_titles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff select section_titles in own org"
  ON section_titles FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND deleted_at IS NULL
         AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff insert section_titles in own org"
  ON section_titles FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff update section_titles in own org"
  ON section_titles FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'))
  WITH CHECK (organization_id = public.user_organization_id());
CREATE POLICY "staff delete section_titles in own org"
  ON section_titles FOR DELETE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'));

-- client_categories
ALTER TABLE client_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff select client_categories in own org"
  ON client_categories FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND deleted_at IS NULL
         AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff insert client_categories in own org"
  ON client_categories FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff update client_categories in own org"
  ON client_categories FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'))
  WITH CHECK (organization_id = public.user_organization_id());
CREATE POLICY "staff delete client_categories in own org"
  ON client_categories FOR DELETE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'));

-- exercise_tags
ALTER TABLE exercise_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff select exercise_tags in own org"
  ON exercise_tags FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND deleted_at IS NULL
         AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff insert exercise_tags in own org"
  ON exercise_tags FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff update exercise_tags in own org"
  ON exercise_tags FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'))
  WITH CHECK (organization_id = public.user_organization_id());
CREATE POLICY "staff delete exercise_tags in own org"
  ON exercise_tags FOR DELETE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'));

-- exercise_metric_units
ALTER TABLE exercise_metric_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff select exercise_metric_units in own org"
  ON exercise_metric_units FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND deleted_at IS NULL
         AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff insert exercise_metric_units in own org"
  ON exercise_metric_units FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff update exercise_metric_units in own org"
  ON exercise_metric_units FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'))
  WITH CHECK (organization_id = public.user_organization_id());
CREATE POLICY "staff delete exercise_metric_units in own org"
  ON exercise_metric_units FOR DELETE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'));

-- vald_device_types
ALTER TABLE vald_device_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff select vald_device_types in own org"
  ON vald_device_types FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND deleted_at IS NULL
         AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff insert vald_device_types in own org"
  ON vald_device_types FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff update vald_device_types in own org"
  ON vald_device_types FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'))
  WITH CHECK (organization_id = public.user_organization_id());
CREATE POLICY "staff delete vald_device_types in own org"
  ON vald_device_types FOR DELETE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'));


-- ----------------------------------------------------------------------------
-- exercises  (Pattern A — staff only; clients reach via SECURITY DEFINER fns)
-- ----------------------------------------------------------------------------
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff select exercises in own org"
  ON exercises FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND deleted_at IS NULL
         AND public.user_role() IN ('owner','staff'));

CREATE POLICY "staff insert exercises in own org"
  ON exercises FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff'));

CREATE POLICY "staff update exercises in own org"
  ON exercises FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'))
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "deny delete exercises"
  ON exercises FOR DELETE TO authenticated USING (false);


-- ----------------------------------------------------------------------------
-- exercise_tag_assignments  (Pattern C — via parent exercise)
-- ----------------------------------------------------------------------------
ALTER TABLE exercise_tag_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff select exercise_tag_assignments via parent"
  ON exercise_tag_assignments FOR SELECT TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM exercises e
       WHERE e.id = exercise_tag_assignments.exercise_id
         AND e.organization_id = public.user_organization_id()
         AND e.deleted_at IS NULL
    )
  );

CREATE POLICY "staff insert exercise_tag_assignments via parent"
  ON exercise_tag_assignments FOR INSERT TO authenticated
  WITH CHECK (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM exercises e
       WHERE e.id = exercise_tag_assignments.exercise_id
         AND e.organization_id = public.user_organization_id()
         AND e.deleted_at IS NULL
    )
  );

CREATE POLICY "staff delete exercise_tag_assignments via parent"
  ON exercise_tag_assignments FOR DELETE TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM exercises e
       WHERE e.id = exercise_tag_assignments.exercise_id
         AND e.organization_id = public.user_organization_id()
    )
  );

-- No UPDATE path for tag assignments — it's just (exercise_id, tag_id). If the
-- pair needs to change, delete and re-insert.
CREATE POLICY "deny update exercise_tag_assignments"
  ON exercise_tag_assignments FOR UPDATE TO authenticated USING (false);


-- ============================================================================
-- §4. PROGRAM ENGINE
-- ============================================================================

-- ----------------------------------------------------------------------------
-- program_templates  (Pattern A)
-- ----------------------------------------------------------------------------
ALTER TABLE program_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff select program_templates in own org"
  ON program_templates FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND deleted_at IS NULL
         AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff insert program_templates in own org"
  ON program_templates FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff update program_templates in own org"
  ON program_templates FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'))
  WITH CHECK (organization_id = public.user_organization_id());
CREATE POLICY "deny delete program_templates"
  ON program_templates FOR DELETE TO authenticated USING (false);


-- ----------------------------------------------------------------------------
-- template_weeks, template_days, template_exercises  (Pattern C)
-- ----------------------------------------------------------------------------
ALTER TABLE template_weeks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff select template_weeks via parent"
  ON template_weeks FOR SELECT TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM program_templates pt
       WHERE pt.id = template_weeks.template_id
         AND pt.organization_id = public.user_organization_id()
         AND pt.deleted_at IS NULL
    )
  );
CREATE POLICY "staff write template_weeks via parent"
  ON template_weeks FOR INSERT TO authenticated
  WITH CHECK (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM program_templates pt
       WHERE pt.id = template_weeks.template_id
         AND pt.organization_id = public.user_organization_id()
    )
  );
CREATE POLICY "staff update template_weeks via parent"
  ON template_weeks FOR UPDATE TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM program_templates pt
       WHERE pt.id = template_weeks.template_id
         AND pt.organization_id = public.user_organization_id()
    )
  );
CREATE POLICY "deny delete template_weeks"
  ON template_weeks FOR DELETE TO authenticated USING (false);

ALTER TABLE template_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff select template_days via parent"
  ON template_days FOR SELECT TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM template_weeks tw
        JOIN program_templates pt ON pt.id = tw.template_id
       WHERE tw.id = template_days.template_week_id
         AND pt.organization_id = public.user_organization_id()
         AND pt.deleted_at IS NULL
    )
  );
CREATE POLICY "staff insert template_days via parent"
  ON template_days FOR INSERT TO authenticated
  WITH CHECK (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM template_weeks tw
        JOIN program_templates pt ON pt.id = tw.template_id
       WHERE tw.id = template_days.template_week_id
         AND pt.organization_id = public.user_organization_id()
    )
  );
CREATE POLICY "staff update template_days via parent"
  ON template_days FOR UPDATE TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM template_weeks tw
        JOIN program_templates pt ON pt.id = tw.template_id
       WHERE tw.id = template_days.template_week_id
         AND pt.organization_id = public.user_organization_id()
    )
  );
CREATE POLICY "deny delete template_days"
  ON template_days FOR DELETE TO authenticated USING (false);

ALTER TABLE template_exercises ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff select template_exercises via parent"
  ON template_exercises FOR SELECT TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM template_days td
        JOIN template_weeks tw ON tw.id = td.template_week_id
        JOIN program_templates pt ON pt.id = tw.template_id
       WHERE td.id = template_exercises.template_day_id
         AND pt.organization_id = public.user_organization_id()
         AND pt.deleted_at IS NULL
    )
  );
CREATE POLICY "staff insert template_exercises via parent"
  ON template_exercises FOR INSERT TO authenticated
  WITH CHECK (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM template_days td
        JOIN template_weeks tw ON tw.id = td.template_week_id
        JOIN program_templates pt ON pt.id = tw.template_id
       WHERE td.id = template_exercises.template_day_id
         AND pt.organization_id = public.user_organization_id()
    )
  );
CREATE POLICY "staff update template_exercises via parent"
  ON template_exercises FOR UPDATE TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM template_days td
        JOIN template_weeks tw ON tw.id = td.template_week_id
        JOIN program_templates pt ON pt.id = tw.template_id
       WHERE td.id = template_exercises.template_day_id
         AND pt.organization_id = public.user_organization_id()
    )
  );
CREATE POLICY "deny delete template_exercises"
  ON template_exercises FOR DELETE TO authenticated USING (false);


-- ----------------------------------------------------------------------------
-- programs  (Pattern B — client sees own non-draft)
-- ----------------------------------------------------------------------------
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select programs in own org"
  ON programs FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND (
      public.user_role() IN ('owner','staff')
      OR (
        public.user_role() = 'client'
        AND status IN ('active','archived')
        AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid() AND deleted_at IS NULL)
      )
    )
  );

CREATE POLICY "staff insert programs in own org"
  ON programs FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
  );

CREATE POLICY "staff update programs in own org"
  ON programs FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
  )
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "deny delete programs"
  ON programs FOR DELETE TO authenticated USING (false);


-- ----------------------------------------------------------------------------
-- program_weeks, program_days, program_exercises  (Pattern C; client path)
-- ----------------------------------------------------------------------------
ALTER TABLE program_weeks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select program_weeks via parent program"
  ON program_weeks FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM programs p
       WHERE p.id = program_weeks.program_id
         AND p.organization_id = public.user_organization_id()
         AND p.deleted_at IS NULL
         AND (
           public.user_role() IN ('owner','staff')
           OR (
             public.user_role() = 'client'
             AND p.status IN ('active','archived')
             AND p.client_id IN (SELECT id FROM clients WHERE user_id = auth.uid() AND deleted_at IS NULL)
           )
         )
    )
  );
CREATE POLICY "staff insert program_weeks via parent program"
  ON program_weeks FOR INSERT TO authenticated
  WITH CHECK (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM programs p
       WHERE p.id = program_weeks.program_id
         AND p.organization_id = public.user_organization_id()
    )
  );
CREATE POLICY "staff update program_weeks via parent program"
  ON program_weeks FOR UPDATE TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM programs p
       WHERE p.id = program_weeks.program_id
         AND p.organization_id = public.user_organization_id()
    )
  );
CREATE POLICY "deny delete program_weeks"
  ON program_weeks FOR DELETE TO authenticated USING (false);

ALTER TABLE program_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select program_days via parent"
  ON program_days FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM program_weeks pw
        JOIN programs p ON p.id = pw.program_id
       WHERE pw.id = program_days.program_week_id
         AND p.organization_id = public.user_organization_id()
         AND p.deleted_at IS NULL
         AND (
           public.user_role() IN ('owner','staff')
           OR (
             public.user_role() = 'client'
             AND p.status IN ('active','archived')
             AND p.client_id IN (SELECT id FROM clients WHERE user_id = auth.uid() AND deleted_at IS NULL)
           )
         )
    )
  );
CREATE POLICY "staff insert program_days via parent"
  ON program_days FOR INSERT TO authenticated
  WITH CHECK (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM program_weeks pw
        JOIN programs p ON p.id = pw.program_id
       WHERE pw.id = program_days.program_week_id
         AND p.organization_id = public.user_organization_id()
    )
  );
CREATE POLICY "staff update program_days via parent"
  ON program_days FOR UPDATE TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM program_weeks pw
        JOIN programs p ON p.id = pw.program_id
       WHERE pw.id = program_days.program_week_id
         AND p.organization_id = public.user_organization_id()
    )
  );
CREATE POLICY "deny delete program_days"
  ON program_days FOR DELETE TO authenticated USING (false);

ALTER TABLE program_exercises ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select program_exercises via parent"
  ON program_exercises FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM program_days pd
        JOIN program_weeks pw ON pw.id = pd.program_week_id
        JOIN programs p ON p.id = pw.program_id
       WHERE pd.id = program_exercises.program_day_id
         AND p.organization_id = public.user_organization_id()
         AND p.deleted_at IS NULL
         AND (
           public.user_role() IN ('owner','staff')
           OR (
             public.user_role() = 'client'
             AND p.status IN ('active','archived')
             AND p.client_id IN (SELECT id FROM clients WHERE user_id = auth.uid() AND deleted_at IS NULL)
           )
         )
    )
  );
CREATE POLICY "staff insert program_exercises via parent"
  ON program_exercises FOR INSERT TO authenticated
  WITH CHECK (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM program_days pd
        JOIN program_weeks pw ON pw.id = pd.program_week_id
        JOIN programs p ON p.id = pw.program_id
       WHERE pd.id = program_exercises.program_day_id
         AND p.organization_id = public.user_organization_id()
    )
  );
CREATE POLICY "staff update program_exercises via parent"
  ON program_exercises FOR UPDATE TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM program_days pd
        JOIN program_weeks pw ON pw.id = pd.program_week_id
        JOIN programs p ON p.id = pw.program_id
       WHERE pd.id = program_exercises.program_day_id
         AND p.organization_id = public.user_organization_id()
    )
  );
CREATE POLICY "deny delete program_exercises"
  ON program_exercises FOR DELETE TO authenticated USING (false);


-- ============================================================================
-- §5. SESSION LOGGING
-- ============================================================================

-- ----------------------------------------------------------------------------
-- sessions  (Pattern D; client creates/updates own in-progress)
-- ----------------------------------------------------------------------------
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select sessions in own org"
  ON sessions FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND (
      public.user_role() IN ('owner','staff')
      OR (
        public.user_role() = 'client'
        AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid() AND deleted_at IS NULL)
      )
    )
  );

CREATE POLICY "insert sessions"
  ON sessions FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND (
      public.user_role() IN ('owner','staff')
      OR (
        public.user_role() = 'client'
        AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
      )
    )
  );

CREATE POLICY "update sessions"
  ON sessions FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND (
      public.user_role() IN ('owner','staff')
      OR (
        public.user_role() = 'client'
        AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
        AND completed_at IS NULL
      )
    )
  )
  WITH CHECK (organization_id = public.user_organization_id());

CREATE POLICY "deny delete sessions"
  ON sessions FOR DELETE TO authenticated USING (false);


-- ----------------------------------------------------------------------------
-- exercise_logs, set_logs  (Pattern C via sessions)
-- ----------------------------------------------------------------------------
ALTER TABLE exercise_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select exercise_logs via session"
  ON exercise_logs FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM sessions s
       WHERE s.id = exercise_logs.session_id
         AND s.organization_id = public.user_organization_id()
         AND s.deleted_at IS NULL
         AND (
           public.user_role() IN ('owner','staff')
           OR (
             public.user_role() = 'client'
             AND s.client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
           )
         )
    )
  );
CREATE POLICY "insert exercise_logs for allowed session"
  ON exercise_logs FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sessions s
       WHERE s.id = exercise_logs.session_id
         AND s.organization_id = public.user_organization_id()
         AND (
           public.user_role() IN ('owner','staff')
           OR (
             public.user_role() = 'client'
             AND s.client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
             AND s.completed_at IS NULL
           )
         )
    )
  );
CREATE POLICY "update exercise_logs for allowed session"
  ON exercise_logs FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM sessions s
       WHERE s.id = exercise_logs.session_id
         AND s.organization_id = public.user_organization_id()
         AND (
           public.user_role() IN ('owner','staff')
           OR (
             public.user_role() = 'client'
             AND s.client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
             AND s.completed_at IS NULL
           )
         )
    )
  );
CREATE POLICY "deny delete exercise_logs"
  ON exercise_logs FOR DELETE TO authenticated USING (false);

ALTER TABLE set_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select set_logs via parent"
  ON set_logs FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM exercise_logs el
        JOIN sessions s ON s.id = el.session_id
       WHERE el.id = set_logs.exercise_log_id
         AND s.organization_id = public.user_organization_id()
         AND (
           public.user_role() IN ('owner','staff')
           OR (
             public.user_role() = 'client'
             AND s.client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
           )
         )
    )
  );
CREATE POLICY "insert set_logs via parent"
  ON set_logs FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM exercise_logs el
        JOIN sessions s ON s.id = el.session_id
       WHERE el.id = set_logs.exercise_log_id
         AND s.organization_id = public.user_organization_id()
         AND (
           public.user_role() IN ('owner','staff')
           OR (
             public.user_role() = 'client'
             AND s.client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
             AND s.completed_at IS NULL
           )
         )
    )
  );
CREATE POLICY "update set_logs via parent"
  ON set_logs FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM exercise_logs el
        JOIN sessions s ON s.id = el.session_id
       WHERE el.id = set_logs.exercise_log_id
         AND s.organization_id = public.user_organization_id()
         AND (
           public.user_role() IN ('owner','staff')
           OR (
             public.user_role() = 'client'
             AND s.client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
             AND s.completed_at IS NULL
           )
         )
    )
  );
CREATE POLICY "deny delete set_logs"
  ON set_logs FOR DELETE TO authenticated USING (false);


-- ============================================================================
-- §6. SCHEDULING
-- ============================================================================

ALTER TABLE availability_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff select availability_rules in own org"
  ON availability_rules FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND deleted_at IS NULL
         AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff insert availability_rules in own org"
  ON availability_rules FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff update availability_rules in own org"
  ON availability_rules FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'))
  WITH CHECK (organization_id = public.user_organization_id());
CREATE POLICY "staff delete availability_rules in own org"
  ON availability_rules FOR DELETE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'));

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select appointments in own org"
  ON appointments FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND (
      public.user_role() IN ('owner','staff')
      OR (public.user_role() = 'client'
          AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()))
    )
  );

CREATE POLICY "insert appointments"
  ON appointments FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND (
      public.user_role() IN ('owner','staff')
      OR (public.user_role() = 'client'
          AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()))
    )
  );

CREATE POLICY "staff update appointments in own org"
  ON appointments FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() IN ('owner','staff')
  )
  WITH CHECK (organization_id = public.user_organization_id());

-- Client cancellation: narrow UPDATE allowing only status → cancelled on
-- caller's own pending/confirmed appointment. Field-level lockdown
-- enforced by a BEFORE UPDATE trigger below.
CREATE POLICY "client cancels own appointment"
  ON appointments FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() = 'client'
    AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
    AND status IN ('pending','confirmed')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    organization_id = public.user_organization_id()
    AND status = 'cancelled'
    AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
  );

-- Field lockdown: a client may only modify status, cancelled_at, and
-- cancellation_reason. Any other change raises.
CREATE OR REPLACE FUNCTION public.appointments_client_field_lockdown()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.user_role() = 'client' THEN
    IF NEW.start_at            IS DISTINCT FROM OLD.start_at
    OR NEW.end_at              IS DISTINCT FROM OLD.end_at
    OR NEW.appointment_type    IS DISTINCT FROM OLD.appointment_type
    OR NEW.location            IS DISTINCT FROM OLD.location
    OR NEW.notes               IS DISTINCT FROM OLD.notes
    OR NEW.confirmed_at        IS DISTINCT FROM OLD.confirmed_at
    OR NEW.no_show_marked_at   IS DISTINCT FROM OLD.no_show_marked_at
    OR NEW.staff_user_id       IS DISTINCT FROM OLD.staff_user_id
    OR NEW.client_id           IS DISTINCT FROM OLD.client_id
    OR NEW.organization_id     IS DISTINCT FROM OLD.organization_id
    THEN
      RAISE EXCEPTION 'Clients may only cancel their own appointment — no other field changes permitted'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER appointments_client_field_lockdown_trg
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION public.appointments_client_field_lockdown();

CREATE POLICY "deny delete appointments"
  ON appointments FOR DELETE TO authenticated USING (false);

ALTER TABLE appointment_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff select appointment_reminders via parent"
  ON appointment_reminders FOR SELECT TO authenticated
  USING (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM appointments a
       WHERE a.id = appointment_reminders.appointment_id
         AND a.organization_id = public.user_organization_id()
    )
  );
CREATE POLICY "deny direct insert appointment_reminders"
  ON appointment_reminders FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "deny update appointment_reminders"
  ON appointment_reminders FOR UPDATE TO authenticated USING (false);
CREATE POLICY "deny delete appointment_reminders"
  ON appointment_reminders FOR DELETE TO authenticated USING (false);


-- ============================================================================
-- §7. COMMUNICATIONS
-- ============================================================================

ALTER TABLE communication_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff select communication_templates in own org"
  ON communication_templates FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND deleted_at IS NULL
         AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff insert communication_templates in own org"
  ON communication_templates FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff update communication_templates in own org"
  ON communication_templates FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'))
  WITH CHECK (organization_id = public.user_organization_id());
CREATE POLICY "staff delete communication_templates in own org"
  ON communication_templates FOR DELETE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'));

ALTER TABLE communications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff select communications in own org"
  ON communications FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND deleted_at IS NULL
         AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff insert communications in own org"
  ON communications FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff')
              AND sender_user_id = auth.uid());
CREATE POLICY "staff update communications in own org"
  ON communications FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'))
  WITH CHECK (organization_id = public.user_organization_id());
CREATE POLICY "deny delete communications"
  ON communications FOR DELETE TO authenticated USING (false);


-- ============================================================================
-- §8. REPORTS + VALD
-- ============================================================================

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select reports in own org"
  ON reports FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND deleted_at IS NULL
    AND (
      public.user_role() IN ('owner','staff')
      OR (
        public.user_role() = 'client'
        AND is_published = true
        AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
      )
    )
  );
CREATE POLICY "staff insert reports in own org"
  ON reports FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff update reports in own org"
  ON reports FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'))
  WITH CHECK (organization_id = public.user_organization_id());
CREATE POLICY "deny delete reports"
  ON reports FOR DELETE TO authenticated USING (false);

ALTER TABLE report_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select report_versions via parent"
  ON report_versions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM reports r
       WHERE r.id = report_versions.report_id
         AND r.organization_id = public.user_organization_id()
         AND r.deleted_at IS NULL
         AND (
           public.user_role() IN ('owner','staff')
           OR (
             public.user_role() = 'client'
             AND r.is_published = true
             AND r.client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
           )
         )
    )
  );
CREATE POLICY "staff insert report_versions via parent"
  ON report_versions FOR INSERT TO authenticated
  WITH CHECK (
    public.user_role() IN ('owner','staff')
    AND EXISTS (
      SELECT 1 FROM reports r
       WHERE r.id = report_versions.report_id
         AND r.organization_id = public.user_organization_id()
    )
  );
CREATE POLICY "deny update report_versions"
  ON report_versions FOR UPDATE TO authenticated USING (false);
CREATE POLICY "deny delete report_versions"
  ON report_versions FOR DELETE TO authenticated USING (false);

ALTER TABLE vald_raw_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff select vald_raw_uploads in own org"
  ON vald_raw_uploads FOR SELECT TO authenticated
  USING (organization_id = public.user_organization_id()
         AND deleted_at IS NULL
         AND public.user_role() IN ('owner','staff'));
CREATE POLICY "staff insert vald_raw_uploads in own org"
  ON vald_raw_uploads FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_organization_id()
              AND public.user_role() IN ('owner','staff')
              AND uploaded_by_user_id = auth.uid());
CREATE POLICY "staff update vald_raw_uploads in own org"
  ON vald_raw_uploads FOR UPDATE TO authenticated
  USING (organization_id = public.user_organization_id()
         AND public.user_role() IN ('owner','staff'))
  WITH CHECK (organization_id = public.user_organization_id());
CREATE POLICY "deny delete vald_raw_uploads"
  ON vald_raw_uploads FOR DELETE TO authenticated USING (false);


-- ============================================================================
-- §9. AUDIT LOG — owner SELECT policy
-- (deny INSERT/UPDATE/DELETE policies were defined in the audit_log migration)
-- ============================================================================

CREATE POLICY "owner selects audit_log in own org"
  ON audit_log FOR SELECT TO authenticated
  USING (
    organization_id = public.user_organization_id()
    AND public.user_role() = 'owner'
  );
