-- ============================================================================
-- 20260612160100_test_helpers_revoke_public
-- ============================================================================
-- Completes the _test_* lockdown started in 20260612160000 §3. pgTAP 23 §D
-- caught it immediately (the tripwire working as designed): the fixture
-- helpers never had a `REVOKE EXECUTE … FROM PUBLIC` in their source
-- migrations, so anon/authenticated still resolve EXECUTE *through the
-- PUBLIC grant* — revoking the two roles directly removed grants they never
-- held individually. This is the inverse of the auto-grant trap the program
-- family had (direct role grants surviving a PUBLIC revoke).
--
-- Grants only; no signature or body changes.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public._test_clear_jwt()                                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._test_set_jwt(uuid, uuid, text)                     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._test_make_user(text)                               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._test_grant_membership(uuid, uuid, user_role)       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._test_insert_test_session(uuid, uuid, uuid, uuid, timestamptz, test_source_t) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._test_insert_test_result(uuid, uuid, text, text, test_side_t, numeric, text)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._test_insert_client_publication(uuid, uuid, uuid, text, text)                 FROM PUBLIC;
