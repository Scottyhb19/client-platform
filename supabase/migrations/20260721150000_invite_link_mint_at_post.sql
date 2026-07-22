-- ============================================================================
-- 20260721150000_invite_link_mint_at_post.sql
-- ============================================================================
-- C-14 deferred item 1 (auth-onboarding-client.md; go-live-checklist §8),
-- pulled forward as Step 4 of the 2026-07-21 internal sequence.
--
-- The invite gate's Supabase action_link is now minted at the HUMAN's POST
-- (the gate button), not at send time. Send stores a token row with
-- action_link NULL; continueInviteAction mints on the winning claim, stores
-- the minted link (for the C-11 grace window), and redirects. Consequences:
--   - No live OTP link sits in the database between send and tap; the OTP's
--     lifetime starts when the human taps, so a slow inbox can no longer
--     burn the OTP TTL before the client ever sees the email.
--   - Rows written by the previous code (action_link already set) keep
--     working — the claim path redirects a stored link when present, so the
--     deploy is skew-safe with no shim.
--
-- Schema change: action_link becomes nullable (NULL = not yet minted).
-- ============================================================================

ALTER TABLE public.invite_tokens
  ALTER COLUMN action_link DROP NOT NULL;

COMMENT ON COLUMN public.invite_tokens.action_link IS
  'Supabase verify URL. NULL until the human''s gate POST mints it (C-14 mint-at-POST, 20260721150000); stored on mint for the C-11 double-tap grace window. Rows from before the change carry the link from send time.';
