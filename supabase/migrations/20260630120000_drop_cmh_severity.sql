-- ============================================================================
-- 20260630120000_drop_cmh_severity
-- ============================================================================
-- Why: The Profile rework retired client_medical_history.severity, replacing it
-- with show_on_header (the Tag / No-tag header control, migration 20260629160000).
-- 20260629160000 left the column dormant to avoid a destructive change mid-pass;
-- this cleanup drops it now that the deployed frontend no longer reads or writes
-- it.
--
-- Safe to push: the live frontend (Profile rework commits 1–3) selects
-- `id, condition, notes, is_active, diagnosis_date, show_on_header` — never
-- severity — and no INSERT path sets it. No function, index, FK, or RLS policy
-- references the column; only the inline CHECK rode on it (dropped with the
-- column). Existing audit_log rows keep their historical "severity" JSON key;
-- new snapshots simply omit it.
--
-- The pgTAP fixture in 19_cmh_client_select_denied.sql is updated in the same
-- change to stop inserting severity (its only remaining reference).
-- ============================================================================

ALTER TABLE client_medical_history DROP COLUMN severity;


-- ============================================================================
-- §ROLLBACK (down reversal) — Supabase migrations are forward-only; run this in
-- the SQL Editor (or as a follow-up migration) to restore the column. Historic
-- severity values are not recoverable (the data was dropped), but the column
-- and its CHECK are re-created identically to 20260420100700.
-- ----------------------------------------------------------------------------
-- ALTER TABLE client_medical_history
--   ADD COLUMN severity smallint CHECK (severity IS NULL OR severity BETWEEN 1 AND 5);
-- ============================================================================
