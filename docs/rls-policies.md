# Row-Level Security Policy Map

**Project:** Client Platform — EP clinical + programming SaaS
**Version:** 0.1 (Gate 2 — awaiting IT-advisor review)
**Date:** 2026-04-20
**Status:** Design document. No RLS code is written yet. This document is the spec.

---

## 0. How to read this document

This document maps every table in the schema to its exact Row-Level Security policies, in plain English and SQL. It is the reference the IT advisor reviews to confirm the tenant boundary, the client↔staff boundary, and the audit-integrity boundary are all watertight.

Sections:
1. Non-negotiables
2. Helper functions and conventions
3. Policy patterns (named templates)
4. Per-table policies (34 tables)
5. Direct DELETE vs soft-delete policy
6. SECURITY DEFINER function catalogue
7. pgTAP test coverage matrix
8. Cross-references

If a table is not in §4, it is a bug in this document — file it.

---

## 1. Non-negotiables

- **Every tenant-owned table has four explicit policies** (`SELECT`, `INSERT`, `UPDATE`, `DELETE`), even when the body is "never." Implicit default-deny is acceptable in Postgres, but explicit is auditable.
- **RLS is enabled on every table** that stores tenant data. `ALTER TABLE x ENABLE ROW LEVEL SECURITY; ALTER TABLE x FORCE ROW LEVEL SECURITY;` — the second `FORCE` makes the table owner subject to RLS too, preventing accidental admin reads.
- **Policies are authored in SQL migration files.** No policy is ever created or edited in the Supabase dashboard.
- **Every policy is covered by at least two pgTAP tests.** One proves the authorized path works; one proves the unauthorized path is denied.
- **Policies never reference values passed from the client.** Everything derives from `auth.uid()` and `auth.user_organization_id()` — JWT claims that the client cannot forge.

---

## 2. Helper functions and conventions

### 2.1 Helper functions

These functions exist in the `auth` schema (per `/docs/schema.md` §5). They are the ONLY way policies read session context.

```sql
-- Returns the authenticated user's ID from the JWT sub claim.
-- Built into Supabase; referenced here for completeness.
auth.uid() RETURNS uuid

-- Returns the active organization ID from the JWT custom claim.
-- NULL if the claim is absent; policies comparing org_id = NULL match zero rows (safe).
auth.user_organization_id() RETURNS uuid

-- Returns the user's role in the active organization from the JWT custom claim.
-- One of 'owner', 'staff', 'client', or NULL.
auth.user_role() RETURNS text
```

### 2.2 Conventions used in every policy

- `TO authenticated` is on every policy. The `anon` role (unauthenticated requests) has no access to any table except very narrow SECURITY DEFINER functions.
- `USING (...)` clauses filter visible rows for SELECT/UPDATE/DELETE.
- `WITH CHECK (...)` clauses validate rows at INSERT/UPDATE time.
- Every policy filters `deleted_at IS NULL` in its `USING` clause for tables that soft-delete, unless stated otherwise.
- Policy names are human-readable: `"<action> <subject> <qualifier>"` (e.g., `"SELECT clients in own org"`).

### 2.3 Fail-closed guarantees

If any of the following happens, the user sees NO rows:
- `auth.uid()` returns NULL (no session).
- `auth.user_organization_id()` returns NULL (JWT claim missing — e.g., fresh signup before org creation).
- `auth.user_role()` returns NULL or an unexpected value.

The system is safely inoperable in these cases rather than unsafely permissive.

---

## 3. Policy patterns

Many tables share one of these patterns. Each pattern is defined once with its SQL template; per-table sections reference the pattern.

### Pattern A — Staff-org-scoped CRUD

Used by tables that hold tenant-owned data with no client visibility. Staff can do everything within their org; clients cannot touch the table.

```sql
-- SELECT
CREATE POLICY "select <table> in own org"
  ON <table> FOR SELECT TO authenticated
  USING (
    organization_id = auth.user_organization_id()
    AND deleted_at IS NULL
  );

-- INSERT
CREATE POLICY "insert <table> in own org"
  ON <table> FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth.user_organization_id()
    AND auth.user_role() IN ('owner', 'staff')
  );

-- UPDATE
CREATE POLICY "update <table> in own org"
  ON <table> FOR UPDATE TO authenticated
  USING (
    organization_id = auth.user_organization_id()
    AND auth.user_role() IN ('owner', 'staff')
  )
  WITH CHECK (
    organization_id = auth.user_organization_id()
  );

-- DELETE (hard) — denied to all non-service roles; staff soft-delete via UPDATE
CREATE POLICY "deny delete <table>"
  ON <table> FOR DELETE TO authenticated
  USING (false);
```

### Pattern B — Staff-org CRUD with client SELECT of own records

Used by tables where the client can see their own rows (e.g., `programs`, `appointments`, `reports`).

```sql
-- SELECT: staff see all in org; client sees own
CREATE POLICY "select <table> in own org"
  ON <table> FOR SELECT TO authenticated
  USING (
    organization_id = auth.user_organization_id()
    AND deleted_at IS NULL
    AND (
      auth.user_role() IN ('owner', 'staff')
      OR (
        auth.user_role() = 'client'
        AND client_id IN (
          SELECT id FROM clients
          WHERE user_id = auth.uid() AND deleted_at IS NULL
        )
        AND <additional client-visibility filter, e.g. is_published = true>
      )
    )
  );

-- INSERT / UPDATE — staff only (Pattern A form)
-- DELETE — denied (Pattern A form)
```

### Pattern C — Nested child via parent

Used by tables that do not store `organization_id`; tenancy inherited through a parent. Applies to template_weeks, template_days, template_exercises, program_weeks, program_days, program_exercises, set_logs, exercise_tag_assignments, appointment_reminders, report_versions.

```sql
-- SELECT (example: program_weeks → programs)
CREATE POLICY "select program_weeks via parent"
  ON program_weeks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM programs p
      WHERE p.id = program_weeks.program_id
        AND p.organization_id = auth.user_organization_id()
        AND p.deleted_at IS NULL
        AND (
          auth.user_role() IN ('owner', 'staff')
          OR (
            auth.user_role() = 'client'
            AND p.client_id IN (
              SELECT id FROM clients
              WHERE user_id = auth.uid() AND deleted_at IS NULL
            )
            AND p.status IN ('active', 'archived')
          )
        )
    )
    AND program_weeks.deleted_at IS NULL
  );

-- INSERT/UPDATE — staff only, parent must be in own org
-- DELETE — denied
```

### Pattern D — Client-own-only

Used by `sessions`, `exercise_logs`, `set_logs` — tables the client writes to during their portal flow.

```sql
-- SELECT: staff see all in org; client sees own
-- INSERT: staff anywhere in org; client only with client_id pointing at themselves
-- UPDATE: staff anywhere; client only on in-progress, own session
-- DELETE: denied to clients; staff soft-delete via UPDATE
```

Full SQL in §4 for each table.

### Pattern E — Reference lookup (tenant-configurable)

Used by `movement_patterns`, `exercise_tags`, `section_titles`, `client_categories`, `vald_device_types`, `exercise_metric_units`. Identical to Pattern A but no `deleted_at` filter on SELECT (some lookup tables hard-delete).

### Pattern F — Audit-only

Used exclusively by `audit_log`. Owner SELECT, triggers INSERT, never UPDATE or DELETE.

```sql
CREATE POLICY "owner selects audit_log in own org"
  ON audit_log FOR SELECT TO authenticated
  USING (
    organization_id = auth.user_organization_id()
    AND auth.user_role() = 'owner'
  );

CREATE POLICY "deny direct insert audit_log"
  ON audit_log FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "deny update audit_log"
  ON audit_log FOR UPDATE TO authenticated USING (false);

CREATE POLICY "deny delete audit_log"
  ON audit_log FOR DELETE TO authenticated USING (false);

-- The trigger function log_audit_event() runs as SECURITY DEFINER;
-- GRANT INSERT ON audit_log TO the function owner only.
```

---

## 4. Per-table policies

Format for each table:

- **Pattern** — which pattern above applies.
- **Plain English** — what each of the four actions does.
- **Specifics** — deviations from the pattern, SQL snippets where the pattern is customized.
- **Tests** — named pgTAP tests to be written at Gate 3.

### 4.1 `organizations`

**Pattern:** Custom. An org is not "in" an org; membership is the scope.

**Plain English:**
- **SELECT** — a user sees the orgs they belong to (one row in v1).
- **INSERT** — service role only. Happens during owner signup.
- **UPDATE** — owner of the org only.
- **DELETE** — service role only.

**SQL:**
```sql
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

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
    id = auth.user_organization_id()
    AND auth.user_role() = 'owner'
    AND deleted_at IS NULL
  )
  WITH CHECK (id = auth.user_organization_id());

CREATE POLICY "deny delete organizations"
  ON organizations FOR DELETE TO authenticated USING (false);
```

**Tests:**
- `rls_organizations_select_own_works`
- `rls_organizations_select_other_denied`
- `rls_organizations_insert_direct_denied`
- `rls_organizations_update_owner_own_works`
- `rls_organizations_update_staff_denied`
- `rls_organizations_update_owner_other_org_denied`
- `rls_organizations_delete_denied`

---

### 4.2 `user_profiles`

**Pattern:** Custom — cross-user visibility within shared orgs.

**Plain English:**
- **SELECT** — the user sees their own profile, and profiles of other users who share at least one organization with them.
- **INSERT** — trigger-created when `auth.users` row is created; direct insert denied.
- **UPDATE** — user can update their own profile.
- **DELETE** — service role only.

**SQL:**
```sql
CREATE POLICY "select own profile or co-members"
  ON user_profiles FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      user_id = auth.uid()
      OR user_id IN (
        SELECT uor2.user_id FROM user_organization_roles uor1
        JOIN user_organization_roles uor2 ON uor2.organization_id = uor1.organization_id
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
```

**Tests:**
- `rls_user_profiles_select_own_works`
- `rls_user_profiles_select_co_member_works`
- `rls_user_profiles_select_stranger_denied`
- `rls_user_profiles_update_own_works`
- `rls_user_profiles_update_other_denied`
- `rls_user_profiles_insert_denied`
- `rls_user_profiles_delete_denied`

---

### 4.3 `user_organization_roles`

**Pattern:** Custom — the bootstrap table.

**Plain English:**
- **SELECT** — user sees own memberships; owner/staff see all memberships in their active org.
- **INSERT** — owner creates any role in own org; staff creates `role='client'` in own org (used by invite flow); service role bootstraps owners.
- **UPDATE** — owner only, in own org.
- **DELETE** — owner only, in own org; additionally denied when deleting the last owner of an org.

**SQL:**
```sql
CREATE POLICY "select own or in-org memberships"
  ON user_organization_roles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      organization_id = auth.user_organization_id()
      AND auth.user_role() IN ('owner', 'staff')
    )
  );

CREATE POLICY "insert memberships in own org"
  ON user_organization_roles FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth.user_organization_id()
    AND (
      auth.user_role() = 'owner'
      OR (auth.user_role() = 'staff' AND role = 'client')
    )
  );

CREATE POLICY "owner updates memberships in own org"
  ON user_organization_roles FOR UPDATE TO authenticated
  USING (
    organization_id = auth.user_organization_id()
    AND auth.user_role() = 'owner'
  )
  WITH CHECK (
    organization_id = auth.user_organization_id()
  );

CREATE POLICY "owner deletes memberships in own org"
  ON user_organization_roles FOR DELETE TO authenticated
  USING (
    organization_id = auth.user_organization_id()
    AND auth.user_role() = 'owner'
  );
```

**Last-owner invariant** — enforced by a BEFORE DELETE trigger, not RLS, because RLS cannot easily express "and at least one owner remains":

```sql
CREATE FUNCTION prevent_last_owner_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role = 'owner' AND (
    SELECT count(*) FROM user_organization_roles
    WHERE organization_id = OLD.organization_id AND role = 'owner'
  ) <= 1 THEN
    RAISE EXCEPTION 'Cannot remove the last owner of an organization';
  END IF;
  RETURN OLD;
END;
$$;
```

**Tests:**
- `rls_uor_select_own_works`
- `rls_uor_select_in_org_as_staff_works`
- `rls_uor_select_other_org_denied`
- `rls_uor_insert_owner_any_role_works`
- `rls_uor_insert_staff_client_role_works`
- `rls_uor_insert_staff_staff_role_denied`
- `rls_uor_insert_other_org_denied`
- `rls_uor_update_owner_works`
- `rls_uor_update_staff_denied`
- `rls_uor_delete_owner_works`
- `rls_uor_delete_last_owner_denied`
- `rls_uor_delete_staff_denied`

---

### 4.4 `clients`

**Pattern:** Mostly Pattern B, with client UPDATE explicitly denied at the RLS layer.

**Plain English:**
- **SELECT** — staff see all clients in their org; a client sees only their own row.
- **INSERT** — staff only, within their org.
- **UPDATE** — staff only. Clients cannot UPDATE `clients` directly; any self-service profile field edits go through a server action using service role, which validates the field allowlist (phone, emergency contact).
- **DELETE** — denied; staff soft-delete via UPDATE.

**SQL:**
```sql
CREATE POLICY "select clients in own org"
  ON clients FOR SELECT TO authenticated
  USING (
    organization_id = auth.user_organization_id()
    AND deleted_at IS NULL
    AND (
      auth.user_role() IN ('owner', 'staff')
      OR (auth.user_role() = 'client' AND user_id = auth.uid())
    )
  );

CREATE POLICY "insert clients in own org"
  ON clients FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth.user_organization_id()
    AND auth.user_role() IN ('owner', 'staff')
  );

CREATE POLICY "staff update clients in own org"
  ON clients FOR UPDATE TO authenticated
  USING (
    organization_id = auth.user_organization_id()
    AND auth.user_role() IN ('owner', 'staff')
  )
  WITH CHECK (
    organization_id = auth.user_organization_id()
  );

CREATE POLICY "deny delete clients"
  ON clients FOR DELETE TO authenticated USING (false);
```

**Tests:**
- `rls_clients_select_staff_own_org_works`
- `rls_clients_select_staff_other_org_denied`
- `rls_clients_select_client_own_row_works`
- `rls_clients_select_client_other_row_denied`
- `rls_clients_insert_staff_works`
- `rls_clients_insert_client_denied`
- `rls_clients_insert_cross_org_denied`
- `rls_clients_update_staff_works`
- `rls_clients_update_client_denied`
- `rls_clients_update_cross_org_denied`
- `rls_clients_delete_denied`
- `rls_clients_soft_delete_via_update_works`

---

### 4.5 `client_medical_history`

**Pattern:** Pattern B with client SELECT on own.

**Plain English:**
- **SELECT** — staff within org; client sees own history.
- **INSERT/UPDATE** — staff only.
- **DELETE** — denied; soft-delete.

**SQL:** direct Pattern B template, where the client check is `client_id IN (SELECT id FROM clients WHERE user_id = auth.uid() AND deleted_at IS NULL)`.

**Tests:** mirror `clients` suite with `rls_cmh_*` prefix.

---

### 4.6 `clinical_notes`

**Pattern:** Pattern A — **staff only always**. v0.2 of schema.md removed client visibility entirely.

**Plain English:**
- **SELECT** — staff in org only.
- **INSERT** — staff in org only.
- **UPDATE** — staff in org only, with optimistic-concurrency check via `version` column (application-layer).
- **DELETE** — denied; soft-delete.

**SQL:** direct Pattern A template.

**Tests:**
- `rls_clinical_notes_select_staff_works`
- `rls_clinical_notes_select_client_denied` — **critical test**: a client attempting to SELECT clinical_notes returns zero rows even for their own `client_id`.
- `rls_clinical_notes_select_other_org_denied`
- `rls_clinical_notes_insert_staff_works`
- `rls_clinical_notes_insert_client_denied`
- `rls_clinical_notes_update_staff_works`
- `rls_clinical_notes_update_client_denied`
- `rls_clinical_notes_delete_denied`

The `rls_clinical_notes_select_client_denied` test is a load-bearing protection — a bug here is a Privacy Act breach. pgTAP must assert this explicitly, not infer from absence.

---

### 4.7 `assessment_templates`

**Pattern:** Pattern A.

**Plain English:** staff only; no client access.

**SQL:** Pattern A template.

**Tests:** standard 6 (select works / select other org denied / select as client denied / insert works / update works / delete denied).

---

### 4.8 `assessments`

**Pattern:** Pattern A (v1) — no client access to assessments in v1. Phase 2 may change this.

**Plain English:** staff only.

**SQL:** Pattern A template.

**Tests:** standard 6 with explicit `rls_assessments_select_client_denied`.

---

### 4.9 `exercises`

**Pattern:** Pattern A. **Clients do NOT have direct SELECT**. Client access to exercise details flows through SECURITY DEFINER functions (§6).

**Plain English:**
- **SELECT** — staff in own org.
- **INSERT/UPDATE** — staff in own org.
- **DELETE** — denied; soft-delete.

**SQL:** Pattern A template.

**Tests:** standard 6 + `rls_exercises_select_via_function_as_client_works` (calls the SECURITY DEFINER function to prove indirect access path).

---

### 4.10 `movement_patterns`, `section_titles`, `client_categories`, `exercise_tags`, `exercise_metric_units`, `vald_device_types`

**Pattern:** Pattern E (reference lookup).

**Plain English:** staff in own org; no client access.

**SQL:** Pattern E template, replace `<table>` for each.

**Tests:** per table — `select_staff_works`, `select_other_org_denied`, `select_as_client_denied`, `insert_staff_works`, `update_staff_works`, `delete_staff_works`.

---

### 4.11 `exercise_tag_assignments`

**Pattern:** Pattern C (nested via parent). Parents are `exercises` and `exercise_tags` — both must belong to the caller's org (enforced by the cross-org trigger, §5.4 of schema.md).

**SQL:**
```sql
CREATE POLICY "select exercise_tag_assignments via parent exercise"
  ON exercise_tag_assignments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM exercises e
      WHERE e.id = exercise_tag_assignments.exercise_id
        AND e.organization_id = auth.user_organization_id()
        AND e.deleted_at IS NULL
    )
  );

-- INSERT/UPDATE/DELETE all require auth.user_role() IN ('owner','staff')
-- and parent in own org (same join). DELETE is hard — row has no clinical meaning.
```

**Tests:** `rls_eta_select_via_parent_works`, `rls_eta_insert_cross_org_denied` (critical — tests the cross-org trigger fires).

---

### 4.12 `program_templates`

**Pattern:** Pattern A.

**Tests:** standard 6.

---

### 4.13 `template_weeks`, `template_days`, `template_exercises`

**Pattern:** Pattern C via `program_templates`.

**SQL (template_weeks example):**
```sql
CREATE POLICY "select template_weeks via parent template"
  ON template_weeks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM program_templates pt
      WHERE pt.id = template_weeks.template_id
        AND pt.organization_id = auth.user_organization_id()
        AND pt.deleted_at IS NULL
    )
    AND template_weeks.deleted_at IS NULL
  );

-- Staff-only INSERT/UPDATE with same parent check
```

`template_days` joins through `template_weeks → program_templates`. `template_exercises` joins through `template_days → template_weeks → program_templates`. Each adds one join layer.

**Tests:** per table — `select_via_parent_works`, `select_other_org_denied`, `insert_staff_works`, `insert_cross_org_denied`.

---

### 4.14 `programs`

**Pattern:** Pattern B. Client sees own program where `status IN ('active', 'archived')`.

**SQL:**
```sql
CREATE POLICY "select programs in own org"
  ON programs FOR SELECT TO authenticated
  USING (
    organization_id = auth.user_organization_id()
    AND deleted_at IS NULL
    AND (
      auth.user_role() IN ('owner', 'staff')
      OR (
        auth.user_role() = 'client'
        AND status IN ('active', 'archived')
        AND client_id IN (
          SELECT id FROM clients
          WHERE user_id = auth.uid() AND deleted_at IS NULL
        )
      )
    )
  );

-- INSERT/UPDATE — staff in own org only (Pattern A form)
-- DELETE — denied
```

**Tests:**
- `rls_programs_select_staff_works`
- `rls_programs_select_client_own_active_works`
- `rls_programs_select_client_own_draft_denied` — **critical**: a client's in-progress draft is not visible until published.
- `rls_programs_select_client_other_denied`
- `rls_programs_insert_staff_works`
- `rls_programs_insert_client_denied`
- `rls_programs_update_client_denied`
- `rls_programs_delete_denied`

---

### 4.15 `program_weeks`, `program_days`, `program_exercises`

**Pattern:** Pattern C via `programs`.

The SELECT policy walks up to `programs` and applies the same staff/client split described in §4.14. Clients see these rows only if the parent `program.status IN ('active', 'archived')` and is their own.

**SQL (program_exercises — three-layer walk):**
```sql
CREATE POLICY "select program_exercises via parent program"
  ON program_exercises FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM program_days pd
      JOIN program_weeks pw ON pw.id = pd.program_week_id
      JOIN programs       p  ON p.id  = pw.program_id
      WHERE pd.id = program_exercises.program_day_id
        AND p.organization_id = auth.user_organization_id()
        AND p.deleted_at IS NULL
        AND (
          auth.user_role() IN ('owner', 'staff')
          OR (
            auth.user_role() = 'client'
            AND p.status IN ('active', 'archived')
            AND p.client_id IN (
              SELECT id FROM clients WHERE user_id = auth.uid() AND deleted_at IS NULL
            )
          )
        )
    )
    AND program_exercises.deleted_at IS NULL
  );
```

**Tests:** per table — verify visibility walks the parent chain; verify cross-org denial; verify the `rls_program_exercises_select_client_draft_denied` case.

---

### 4.16 `sessions`

**Pattern:** Pattern D.

**Plain English:**
- **SELECT** — staff see all in own org; client sees own.
- **INSERT** — client creates own (portal "Begin Session"); staff create on behalf of any client in own org.
- **UPDATE** — client updates own **in-progress** session (cannot reopen a completed one); staff update any in own org.
- **DELETE** — denied; staff soft-delete.

**SQL:**
```sql
CREATE POLICY "select sessions in own org"
  ON sessions FOR SELECT TO authenticated
  USING (
    organization_id = auth.user_organization_id()
    AND deleted_at IS NULL
    AND (
      auth.user_role() IN ('owner', 'staff')
      OR (
        auth.user_role() = 'client'
        AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid() AND deleted_at IS NULL)
      )
    )
  );

CREATE POLICY "insert sessions"
  ON sessions FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth.user_organization_id()
    AND (
      auth.user_role() IN ('owner', 'staff')
      OR (
        auth.user_role() = 'client'
        AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
      )
    )
  );

CREATE POLICY "update sessions"
  ON sessions FOR UPDATE TO authenticated
  USING (
    organization_id = auth.user_organization_id()
    AND deleted_at IS NULL
    AND (
      auth.user_role() IN ('owner', 'staff')
      OR (
        auth.user_role() = 'client'
        AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
        AND completed_at IS NULL   -- client cannot reopen a completed session
      )
    )
  )
  WITH CHECK (organization_id = auth.user_organization_id());

CREATE POLICY "deny delete sessions"
  ON sessions FOR DELETE TO authenticated USING (false);
```

**Tests:** session-specific suite including `rls_sessions_client_reopen_completed_denied`.

---

### 4.17 `exercise_logs`, `set_logs`

**Pattern:** Pattern C via `sessions`, extending to Pattern D's client-own insert/update.

Exercise/set logs belong to a session. Client can insert/update logs attached to their own in-progress session. Staff can do so anywhere in their org.

**SQL (exercise_logs):**
```sql
CREATE POLICY "select exercise_logs via parent session"
  ON exercise_logs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM sessions s
      WHERE s.id = exercise_logs.session_id
        AND s.organization_id = auth.user_organization_id()
        AND s.deleted_at IS NULL
        AND (
          auth.user_role() IN ('owner', 'staff')
          OR (
            auth.user_role() = 'client'
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
      WHERE s.id = session_id
        AND s.organization_id = auth.user_organization_id()
        AND (
          auth.user_role() IN ('owner', 'staff')
          OR (
            auth.user_role() = 'client'
            AND s.client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
            AND s.completed_at IS NULL
          )
        )
    )
  );

-- UPDATE mirrors INSERT; DELETE denied.
```

`set_logs` adds another layer through `exercise_logs → sessions`.

---

### 4.18 `availability_rules`

**Pattern:** Pattern A (staff only).

Clients do not read `availability_rules`. They see a derived list via the `client_available_slots` SECURITY DEFINER function (§6).

**Tests:** standard 6 + `rls_availability_rules_select_client_denied`.

---

### 4.19 `appointments`

**Pattern:** Pattern B with custom UPDATE rules for client cancellation.

**Plain English:**
- **SELECT** — staff see all in own org; client sees own.
- **INSERT** — staff create for any client in own org; client creates for themselves only.
- **UPDATE** — staff update any; client may set `status='cancelled'` on their own pending/confirmed appointment — not reschedule, not change any other field.
- **DELETE** — denied; soft-delete.

**SQL:**
```sql
CREATE POLICY "select appointments in own org"
  ON appointments FOR SELECT TO authenticated
  USING (
    organization_id = auth.user_organization_id()
    AND deleted_at IS NULL
    AND (
      auth.user_role() IN ('owner', 'staff')
      OR (auth.user_role() = 'client'
          AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()))
    )
  );

CREATE POLICY "insert appointments"
  ON appointments FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth.user_organization_id()
    AND (
      auth.user_role() IN ('owner', 'staff')
      OR (auth.user_role() = 'client'
          AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()))
    )
  );

-- Staff update — full
CREATE POLICY "staff update appointments in own org"
  ON appointments FOR UPDATE TO authenticated
  USING (
    organization_id = auth.user_organization_id()
    AND auth.user_role() IN ('owner', 'staff')
  )
  WITH CHECK (organization_id = auth.user_organization_id());

-- Client cancellation only
CREATE POLICY "client cancels own appointment"
  ON appointments FOR UPDATE TO authenticated
  USING (
    organization_id = auth.user_organization_id()
    AND auth.user_role() = 'client'
    AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
    AND status IN ('pending', 'confirmed')
  )
  WITH CHECK (
    organization_id = auth.user_organization_id()
    AND status = 'cancelled'
    AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
  );
-- Field-level lockdown (client can only touch status + cancelled_at) enforced
-- by a BEFORE UPDATE trigger that compares NEW vs OLD per column and raises
-- if a client touched anything else.

CREATE POLICY "deny delete appointments"
  ON appointments FOR DELETE TO authenticated USING (false);
```

**Tests:**
- `rls_appointments_select_staff_works`, `_client_own_works`, `_client_other_denied`
- `rls_appointments_insert_staff_works`, `_client_own_works`, `_client_other_denied`
- `rls_appointments_update_staff_works`
- `rls_appointments_client_cancel_works`
- `rls_appointments_client_reschedule_denied` — client attempting to change `start_at` is rejected by the field-lockdown trigger.
- `rls_appointments_client_change_other_client_denied`
- `rls_appointments_delete_denied`

---

### 4.20 `appointment_reminders`

**Pattern:** Pattern C via `appointments`. Staff SELECT only; clients do not see. INSERTs are from the reminder scheduler (service role).

**SQL:**
```sql
CREATE POLICY "select appointment_reminders via parent"
  ON appointment_reminders FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM appointments a
      WHERE a.id = appointment_reminders.appointment_id
        AND a.organization_id = auth.user_organization_id()
        AND auth.user_role() IN ('owner', 'staff')
    )
  );

CREATE POLICY "deny direct insert appointment_reminders"
  ON appointment_reminders FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "deny update appointment_reminders"
  ON appointment_reminders FOR UPDATE TO authenticated USING (false);

CREATE POLICY "deny delete appointment_reminders"
  ON appointment_reminders FOR DELETE TO authenticated USING (false);
```

Writes happen via service role in the reminder scheduler Edge Function.

**Tests:** verify staff can read, verify client gets zero rows, verify direct INSERT is denied.

---

### 4.21 `communications`

**Pattern:** Pattern A (staff only). Clients see the delivered email/SMS in their actual inbox, not this log.

**Plain English:** staff only.

**Tests:** standard 6 + `rls_communications_select_client_denied`.

---

### 4.22 `communication_templates`

**Pattern:** Pattern A.

---

### 4.23 `reports`

**Pattern:** Pattern B with `is_published = true` client-visibility gate.

**SQL:**
```sql
CREATE POLICY "select reports in own org"
  ON reports FOR SELECT TO authenticated
  USING (
    organization_id = auth.user_organization_id()
    AND deleted_at IS NULL
    AND (
      auth.user_role() IN ('owner', 'staff')
      OR (
        auth.user_role() = 'client'
        AND is_published = true
        AND client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
      )
    )
  );

-- INSERT/UPDATE — staff only; DELETE — denied
```

**Tests:**
- `rls_reports_select_staff_works`
- `rls_reports_select_client_published_works`
- `rls_reports_select_client_unpublished_denied` — **critical**: a draft report is NOT visible to the client.
- `rls_reports_select_client_other_denied`

---

### 4.24 `report_versions`

**Pattern:** Pattern C via `reports`. Client can read versions of a report they can read.

**Tests:** verify the `is_published` check propagates through the version join.

---

### 4.25 `vald_raw_uploads`

**Pattern:** Pattern A (staff only).

---

### 4.26 `audit_log`

**Pattern:** Pattern F.

**Critical property:** the triggers that write to `audit_log` run as `SECURITY DEFINER` owned by a role with INSERT privilege. That role is NOT `authenticated`, `anon`, or `service_role`. It is a dedicated `audit_writer` role granted INSERT and nothing else.

```sql
CREATE ROLE audit_writer NOLOGIN;
GRANT INSERT ON audit_log TO audit_writer;
ALTER FUNCTION log_audit_event() OWNER TO audit_writer;
```

This prevents even the service role from writing synthetic audit log entries via normal INSERT (it can still INSERT because service role bypasses RLS, but doing so is visible in code review because it would require an explicit `FROM audit_log` query).

**Tests:**
- `rls_audit_log_select_owner_works`
- `rls_audit_log_select_staff_denied`
- `rls_audit_log_select_client_denied`
- `rls_audit_log_select_other_org_denied`
- `rls_audit_log_direct_insert_denied`
- `rls_audit_log_update_denied`
- `rls_audit_log_delete_denied`
- `rls_audit_log_trigger_writes_succeed` (positive test — triggers do write)

---

## 5. Direct DELETE vs soft-delete policy

Every table that holds PHI or clinical-adjacent data has its RLS DELETE policy set to `USING (false)`. The path to remove such a row is:

1. **Staff soft-delete** — `UPDATE <table> SET deleted_at = now() WHERE id = ...`. RLS allows this via the UPDATE policy.
2. **Service-role hard-delete** — a server action that (a) writes a final `audit_log` entry, (b) issues DELETE, (c) runs as service role which bypasses RLS. Used only for: the 7-year retention purge, right-to-be-forgotten requests, and catastrophic cleanup.

Tables where hard DELETE IS allowed (and why):
- `user_organization_roles` — access revocation is a DELETE.
- `exercise_tag_assignments` — pure join row, no clinical significance.
- Lookup tables (`exercise_tags`, `section_titles`, `client_categories`, `movement_patterns` — when unused).
- `rate_limit_log` entries past window expiration (if that table is added).

Every DELETE is audit-logged either by trigger (for audited tables) or by application code.

---

## 6. SECURITY DEFINER function catalogue

These are the complete set of functions that bypass RLS. Each is a separate security surface; each has pgTAP tests.

| Function | Role | Purpose | Rows returned / effect |
|---|---|---|---|
| `auth_hooks.custom_access_token(event jsonb)` | `supabase_auth_admin` | Injects `organization_id` and `user_role` into JWT | Modified event JSON |
| `log_audit_event()` | `audit_writer` | Trigger body — writes audit rows | INSERT to `audit_log` |
| `enforce_same_org_fk(...)` | `postgres` | Trigger body — rejects cross-org FKs | RAISE on violation |
| `bump_version()` | `postgres` | Trigger body — increments `version` | — |
| `prevent_last_owner_delete()` | `postgres` | Trigger — blocks removing last owner | RAISE on violation |
| `audit_trim_row(table, row)` | `audit_writer` | Truncates wide fields in audit snapshots | jsonb |
| `audit_diff_fields(old, new)` | IMMUTABLE | Computes `changed_fields text[]` | text[] |
| `audit_resolve_org_id(table, new, old)` | `postgres` | Walks parent chain to get org_id for trigger | uuid |
| `create_organization_with_owner(...)` | `postgres` | Owner signup bootstrap | Inserts org + role + seeds |
| `staff_create_client_invite(...)` | `postgres` | Client invite flow | Creates `clients` row + sends invite |
| `client_accept_invite(...)` | `postgres` | Client welcome flow | Links `clients.user_id` + creates role |
| `client_get_program_day_exercises(uuid)` | `postgres` | Portal — render session | Rows joining `program_exercises` + `exercises` |
| `client_list_program_days(uuid)` | `postgres` | Portal — week view | Rows from `program_days` |
| `client_start_session(uuid)` | `postgres` | Portal — begin session | Inserts `sessions` + returns id |
| `client_log_set(...)` | `postgres` | Portal — log a set | Inserts `set_logs` |
| `client_complete_session(...)` | `postgres` | Portal — finish session | UPDATEs `sessions.completed_at` |
| `client_available_slots(from, to)` | `postgres` | Portal — see bookable times | Rows computed from `availability_rules` minus booked appointments |
| `client_get_published_reports()` | `postgres` | Portal — reports list | Rows from `reports` where `is_published = true` and own |
| `switch_active_organization(uuid)` | `postgres` | Phase 4 org switch | Updates `raw_app_meta_data` |

**Policy for adding to this list:** every addition requires a design note, pgTAP coverage, and review. The list should stay small — each function is a bypass path.

**Every SECURITY DEFINER function:**
- Sets `SET search_path = public, pg_temp` to neutralize search-path injection.
- `REVOKE ALL ... FROM PUBLIC` and `GRANT EXECUTE ... TO authenticated`.
- Parameter validation as the first statement (e.g., check UUID format if needed).
- Pins rows to `auth.uid()` — never trusts a passed-in user ID.
- Has at least two pgTAP tests: positive (caller's own data) and negative (another user's data).

---

## 7. pgTAP test coverage matrix

### 7.1 Minimum per-table coverage

Every tenant-owned table has, at a minimum:

| Test class | Example name |
|---|---|
| Positive SELECT — staff own org | `rls_<table>_select_staff_own_works` |
| Negative SELECT — staff other org | `rls_<table>_select_other_org_denied` |
| Negative SELECT — client (where applicable) | `rls_<table>_select_client_denied` |
| Positive SELECT — client own (where applicable) | `rls_<table>_select_client_own_works` |
| Positive INSERT — staff | `rls_<table>_insert_staff_works` |
| Negative INSERT — cross-org | `rls_<table>_insert_cross_org_denied` |
| Negative INSERT — client (where applicable) | `rls_<table>_insert_client_denied` |
| Positive UPDATE — staff | `rls_<table>_update_staff_works` |
| Negative UPDATE — cross-org | `rls_<table>_update_cross_org_denied` |
| Negative DELETE | `rls_<table>_delete_denied` |

That is 10 tests per tenant-owned table × 34 tables ≈ 340 tests as the baseline. Tables with richer policies (sessions, appointments) have additional tests covering specific behaviours (cancellation, in-progress-only, etc.).

### 7.2 Global invariant tests

Additional tests not tied to a single table:

| Test | Purpose |
|---|---|
| `rls_all_tenant_tables_have_rls_enabled` | Asserts `relrowsecurity = true` on every tenant-owned table |
| `rls_all_tenant_tables_forced` | Asserts `relforcerowsecurity = true` |
| `rls_all_tables_have_four_policies` | Every tenant-owned table has SELECT/INSERT/UPDATE/DELETE policies |
| `fk_phi_tables_no_cascade_delete` | Asserts no FK targeting a PHI table has `ON DELETE CASCADE` (whitelist for private-tree cascades per §6 of schema.md) |
| `audit_log_trigger_coverage` | Every table in the audited-set has the `log_audit_event` trigger |
| `security_definer_functions_have_search_path` | Asserts every SECURITY DEFINER function has `SET search_path` |
| `cross_org_trigger_coverage` | Every cross-org-risky FK has the `enforce_same_org_fk` trigger |

These invariants catch the drift class of bugs — a developer adding a table and forgetting a policy, a new FK without cross-org enforcement, a trigger attached everywhere except the new table.

### 7.3 Test execution

`supabase test db` runs the pgTAP suite against a local Supabase instance. CI runs the same suite on every PR against a scratch Supabase project.

Any PR that:
- Adds a table without adding policies, fails a global invariant test.
- Changes a policy without adding/updating tests, fails code review (no CI check — enforced by humans at Gate 3).
- Reduces coverage below the §7.1 minimum, fails CI.

---

## 8. Cross-references

- Schema: `/docs/schema.md`
- Authentication flows and JWT claim mechanism: `/docs/auth.md`
- Monitoring of RLS violation signals: `/docs/slos.md`
- What to do when a client reports seeing another client's data: `/docs/incident-response.md`
