-- ============================================================================
-- 20260629150000_rename_clients_gender_to_sex
-- ============================================================================
-- Why: The client profile field is renamed from "gender" to "sex" (profile
-- rework). This is a pure rename — the value model is unchanged: the column
-- stays free-text `text`, nullable, no enum, no CHECK, no new values. Only the
-- identifier changes.
--
-- No function, RLS policy, index, or constraint references this column by name
-- (verified by a whole-repo grep), so a single ALTER TABLE … RENAME COLUMN is
-- the complete schema change. Existing audit_log rows keep their historical
-- "gender" JSON key; new rows snapshot "sex". No backfill needed and none is
-- correct — the data is identical, only the key name differs going forward.
--
-- Deploy coordination (shared dev/prod DB): the deployed frontend selects this
-- column by name, so the column rename and the frontend that references `sex`
-- must go live close together — push this migration and deploy the matching
-- frontend (same commit) back to back. Either order leaves a brief window
-- where one side names a column the other doesn't; at friends-and-family scale
-- with no real data that window is acceptable, but it should be minutes, not
-- hours. (A bare RENAME has no zero-window path; expand/contract was not
-- warranted for a single free-text field with no production data.)
--
-- §ROLLBACK (down reversal) is the commented block at the foot of the file.
-- ============================================================================

ALTER TABLE clients RENAME COLUMN gender TO sex;


-- ============================================================================
-- §ROLLBACK (down reversal) — Supabase migrations are forward-only; run this
-- in the SQL Editor (or as a follow-up migration) to reverse the rename. It is
-- exact and lossless — a rename has no data component.
-- ----------------------------------------------------------------------------
-- ALTER TABLE clients RENAME COLUMN sex TO gender;
-- ============================================================================
