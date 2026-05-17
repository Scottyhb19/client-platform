## 2026-05-17 — RESEND_API_KEY and CRON_SHARED_SECRET rotated

**Reason:** Both secrets pasted in chat during initial deploy, exposed in chat history (per diagnostic finding #4, 2026-05-15).

### RESEND_API_KEY
- Old key revoked in Resend dashboard
- New key generated and stored in Vercel env vars (Production, Preview, Development)
- Verified: production deployment running on new key

### CRON_SHARED_SECRET
- Old value: lost (not retained after rotation — acceptable since rotation invalidates it)
- New value generated via openssl rand -base64 32, stored in password manager
- Updated in Supabase Edge Function secrets
- Updated in pg_cron job_id 1 via cron.alter_job()
- Verified: 10 consecutive successful cron runs at 5-minute intervals between 00:30 and 01:15 UTC on 2026-05-17

### Follow-ups
- pg_cron job still uses inline literal secret (per docs/polish/client-portal-booking.md:168). Migrate to Vault when convenient.
- Going forward: secrets never appear in chat or in committed code. Use env vars and document in docs/secrets-inventory.md.
