# Secrets Rotation Log

## 2026-05-17 — RESEND_API_KEY and CRON_SHARED_SECRET rotated

**Reason:** Both secrets pasted in chat during initial deploy, exposed in chat history (per diagnostic Finding #4, 2026-05-15).

### RESEND_API_KEY

- Old key revoked in Resend dashboard
- New key generated and stored in Vercel env vars (Production, Preview, Development)
- Verified: production deployment running on new key

### CRON_SHARED_SECRET

- Old value: not retained after rotation (acceptable — rotation invalidates the old value regardless of whether the rotator retains it)
- New value generated via openssl rand -base64 32, stored in password manager
- Updated in Supabase Edge Function secrets (Project Settings → Edge Functions → Secrets)
- Updated in pg_cron job_id 1 via cron.alter_job()
- Verified: 10 consecutive successful pg_cron runs at 5-minute intervals between 00:30 and 01:15 UTC on 2026-05-17 (see cron.job_run_details)

### Follow-ups (not blocking)

- pg_cron job still uses inline literal secret in its command (per docs/polish/client-portal-booking.md:161-168 TODO). Migrate to Supabase Vault when convenient.
- Going forward: secrets never appear in chat or in committed code. Use env vars and document in docs/secrets-inventory.md (to be created).
- Function header comment in supabase/functions/send-appointment-reminders/index.ts references current_setting('app.cron_token') as the bearer source, which may not work on hosted Supabase. Reconcile comment with actual deployment mechanism.
