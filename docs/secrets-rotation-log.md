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

## 2026-06-16 — RESEND_API_KEY: missed-consumer follow-up to the 2026-05-17 rotation

**Reason:** The §9 (scheduling) Edge Function verification (`docs/polish/scheduling.md` §8c) found the deployed `send-appointment-reminders` function still holding the **pre-rotation** `RESEND_API_KEY` → every reminder send failed `resend 401 validation_error`. The 2026-05-17 rotation updated `.env.local` and Vercel but **never reached the Edge Function's Supabase secret set** — a separate store from Vercel. Reminders had been silently non-functional in production since (FM-3 unmitigated).

### What was done (2026-06-16, operator-approved)

- `supabase secrets set RESEND_API_KEY=<current verified key>` on the Edge Function — the same key the Next confirmation path already used successfully. Also set `EMAIL_FROM` and `NEXT_PUBLIC_APP_URL` (both absent from the EF's store; `EMAIL_FROM` unset had been throwing → HTTP 500).
- **Verified end-to-end:** a due reminder to `delivered@resend.dev` reached `status='sent'` with a Resend `provider_message_id`. Detail in `docs/polish/scheduling.md` §8c.

### Consumer sweep (2026-06-17) — confirm no other consumer was missed

Enumerated every runtime reader of `RESEND_API_KEY` (grep of the repo, `src/` + `supabase/functions/`). There are exactly **two stores**:

| Store | Consumer | State |
|---|---|---|
| Vercel env + `.env.local` | `src/lib/email/client.ts` (`process.env.RESEND_API_KEY`) — the Next app's single Resend client; all invite / confirmation / booking-confirmation paths route through it | Rotated 2026-05-17, verified working |
| Supabase Edge Function secrets | `supabase/functions/send-appointment-reminders/index.ts` (`Deno.env.get('RESEND_API_KEY')`) | Corrected 2026-06-16, send verified |

`src/lib/env/required-env.ts` lists the name only (startup validation), it does not read the value. **No third consumer exists.** Both stores now hold the current key. Sweep complete.

### Still open (operator hygiene — dashboard action, not doable from this machine)

- **Revoke the stale pre-rotation `RESEND_API_KEY` in the Resend dashboard.** The 2026-05-17 entry above records the old key as revoked; the 401 the EF hit is consistent with that (a revoked key returns 401). Confirm in Resend → API Keys that only the current key is active and delete any stale key. This is the last residual of the §9 deferred "stale Resend key revocation" item.

### Lesson (for the next rotation)

A secret rotation must enumerate **every** store, not just `.env.local`/Vercel. The Edge Function has its own Supabase secret set (`supabase secrets list`) that nothing else updates. Add "update the Edge Function secret set" to `runbooks/rotate-a-secret.md` for any secret the EF reads (`RESEND_API_KEY`, `CRON_SHARED_SECRET`, `EMAIL_FROM`, `NEXT_PUBLIC_APP_URL`), and run the synthetic send check (`runbooks/deploy-an-edge-function.md`) after rotating an EF-read secret.
