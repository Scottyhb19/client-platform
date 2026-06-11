-- ============================================================================
-- 20260611130200_cn12_audit_wide_content_json
-- ============================================================================
-- CN-12 (docs/polish/client-profile-clinical-notes.md): the 4KB audit
-- truncation design (schema.md §11.4) covered the legacy SOAP columns but
-- not content_json — the column ALL template-era note content lives in
-- since 20260427100000. Every note UPDATE was snapshotting full old+new
-- bodies into audit_log, silently bypassing the bound the original design
-- intended.
--
-- One config row restores it. No trigger change: audit_trim_row() reads
-- the column as text via ->>, which serialises jsonb cleanly, and replaces
-- values over 4096 bytes with {_truncated, _sha256, _size_bytes, _preview}.
--
-- Compliance trade (same as the SOAP columns this replaces, restated):
-- truncated bodies are not reconstructable from audit_log alone — the
-- clinical_notes row itself is the record.
-- ============================================================================

INSERT INTO audit_wide_column_config (table_name, column_name)
VALUES ('clinical_notes', 'content_json')
ON CONFLICT DO NOTHING;
