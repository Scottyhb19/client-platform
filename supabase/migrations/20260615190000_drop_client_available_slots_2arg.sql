-- ============================================================================
-- 20260615190000_drop_client_available_slots_2arg
-- ============================================================================
-- Section 9 — post-deploy-#1 cleanup (P1-6 re-trigger). The welded 2-arg
-- client_available_slots(timestamptz, timestamptz) was kept as a deploy-skew
-- bridge so the pre-section-9 portal kept working while the new 3-arg per-type
-- picker rolled out. Deploy #1 is now live (the section-9 frontend calls the
-- 3-arg, and client_book_appointment's re-check uses the 3-arg too), so the
-- 2-arg has no caller. Drop it — there is now a single per-type slot path.
--
-- Mirrors the section-7 reschedule-compat-shim drop: only safe AFTER the new
-- frontend deployed (never before). pgTAP 26 is trimmed to 8 (the 2-arg
-- anon/auth assertions are removed; has_function_privilege would otherwise
-- error on the missing signature).
-- ============================================================================

DROP FUNCTION IF EXISTS public.client_available_slots(timestamptz, timestamptz);
