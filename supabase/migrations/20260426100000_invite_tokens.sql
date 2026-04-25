-- ============================================================================
-- 20260426100000_invite_tokens
-- ============================================================================
-- Why: Defeats Gmail's link prefetcher.
--
-- Invite emails currently embed Supabase's verify URL directly. Gmail's
-- malware scanner pre-fetches every URL in incoming mail to scan it; that
-- fetch is enough to consume the one-time magic-link token before the human
-- ever sees the email. Result: clients on Gmail get "Email link is invalid
-- or has expired" the moment they open the inbox.
--
-- The fix is a click-through gate. The email contains a link to OUR domain
-- (https://<host>/i/<token_id>) that resolves to a server-rendered page
-- with a "Continue" button. The Supabase action_link only fires when the
-- HUMAN clicks — Gmail's prefetch hits our intermediate page, sees no
-- redirect, and stops. This table stores the mapping from short token id
-- to the real action_link.
--
-- Access pattern:
--   - Writer: inviteClientAction (service role) inserts after generateLink.
--   - Reader: src/app/i/[id]/page.tsx (service role) looks up by id.
--   - Authenticated users have NO direct access (RLS denies all). The
--     service-role client bypasses RLS by design.
-- ============================================================================

CREATE TABLE invite_tokens (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        uuid         NOT NULL REFERENCES clients(id)       ON DELETE CASCADE,
  -- Verbatim Supabase verify URL returned by admin.generateLink. Treated as
  -- a secret — anyone who reads this can sign in as the client. Never
  -- exposed to authenticated users via RLS; only the service-role route
  -- handler reads it.
  action_link      text         NOT NULL,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  -- 8h window: long enough that a slow email + holiday inbox still works,
  -- short enough that a stale email shouldn't stay live indefinitely.
  expires_at       timestamptz  NOT NULL DEFAULT (now() + interval '8 hours'),
  -- Reserved for a future "burn on click" pass — we currently rely on
  -- expires_at alone to keep the click route stateless. Filling this in
  -- later is a non-breaking change.
  consumed_at      timestamptz
);

-- Hot path: the click route looks up by id and only cares about live tokens.
-- Partial index keeps it tight (consumed/expired rows are dead weight).
CREATE INDEX invite_tokens_live_idx
  ON invite_tokens (id)
  WHERE consumed_at IS NULL;

-- Backfill / cleanup query: find expired tokens to purge on a schedule.
CREATE INDEX invite_tokens_expires_idx
  ON invite_tokens (expires_at)
  WHERE consumed_at IS NULL;

COMMENT ON TABLE invite_tokens IS
  'Short-id → Supabase verify URL mapping. Defeats Gmail link prefetch by interposing a user-click gate between the email and the action_link.';


-- ============================================================================
-- RLS — deny all from authenticated; service role bypasses
-- ============================================================================
ALTER TABLE invite_tokens ENABLE ROW LEVEL SECURITY;

-- Explicit deny so PostgREST never returns rows to a logged-in client even
-- if a policy is added by mistake later. Same pattern communications uses
-- for hard DELETE.
CREATE POLICY "deny select invite_tokens"
  ON invite_tokens FOR SELECT TO authenticated USING (false);

CREATE POLICY "deny insert invite_tokens"
  ON invite_tokens FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "deny update invite_tokens"
  ON invite_tokens FOR UPDATE TO authenticated USING (false);

CREATE POLICY "deny delete invite_tokens"
  ON invite_tokens FOR DELETE TO authenticated USING (false);
