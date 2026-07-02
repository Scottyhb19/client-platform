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

### Closed 2026-07-03 — operator dashboard confirmation (was: still open)

- **Confirmed in Resend → API Keys: exactly one active key, created 2026-05-17** — the current rotated key. No stale pre-rotation key remains (consistent with the 2026-05-17 entry recording it revoked, and with the 401 the EF hit while still holding it). This closes the last residual of the §9 deferred "stale Resend key revocation" item; `go-live-checklist.md` §2 updated same day.

### Lesson (for the next rotation)

A secret rotation must enumerate **every** store, not just `.env.local`/Vercel. The Edge Function has its own Supabase secret set (`supabase secrets list`) that nothing else updates. Add "update the Edge Function secret set" to `runbooks/rotate-a-secret.md` for any secret the EF reads (`RESEND_API_KEY`, `CRON_SHARED_SECRET`, `EMAIL_FROM`, `NEXT_PUBLIC_APP_URL`), and run the synthetic send check (`runbooks/deploy-an-edge-function.md`) after rotating an EF-read secret.

## 2026-07-02 — SUPABASE_SERVICE_ROLE_KEY migrated to the new API keys; legacy disabled

**Reason:** The legacy `service_role` key appeared in a chat transcript (Beta-entry hardening gate — highest priority, since it bypasses RLS). Supabase removed legacy-key rotation (2025+), so neutralising it required migrating every client onto the new publishable/secret API keys and then disabling the legacy keys. This closes the gate item.

### What was done

- **Confirmed empirically** (throwaway test script, supabase-js `2.103.3` — the app's version) that `sb_secret` bypasses RLS with plain `createClient(url, key)`. The docs' "secret keys can't go on `Authorization: Bearer`" warning did **not** bite this project — the gateway honours the `apikey` header regardless. So **no client-factory code change was needed**; it was a value swap.
- **Worker** (`send-appointment-reminders` EF): now reads `REMINDER_SERVICE_KEY` (=sb_secret) with a fallback to the injected legacy key; supabase-js bumped `2.50.0`→`2.103.3`; redeployed (commit `c6168a8`). Verified: synthetic reminder `status='sent'` via the live cron path.
- **App**: swapped `SUPABASE_SERVICE_ROLE_KEY`→`sb_secret` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`→`sb_publishable` in **Vercel (all environments) + `.env.local`**. No code change. Forced a fresh production build (git push) so the `NEXT_PUBLIC` publishable value re-baked into the client bundle.
- **Verified**: service key bypasses RLS locally; publishable accepted for reads + login locally; production login in a **private window with legacy disabled**; reminder EF sends with legacy disabled (both `status='sent'`).
- **Disabled** the legacy anon + service_role keys (Supabase → API Keys → "Legacy anon, service_role" tab → "Disable JWT-based API keys"). The leaked legacy `service_role` JWT is now rejected by the gateway.

### Notes

- The anon key is public (not itself a secret), but had to move to `sb_publishable` because the "Disable JWT-based API keys" button disables both legacy keys together.
- The EF's platform-injected legacy `SUPABASE_SERVICE_ROLE_KEY` is now dead; the EF runs on `REMINDER_SERVICE_KEY`, read first.
- **Rollback** (if ever needed): re-enable the legacy keys in the Supabase dashboard (instant, one click).
- A same-day detour first mis-blamed the new key for non-sending reminders that were actually a **pre-existing cron bug** (the pg_cron job's `net.http_post` URL held the `YOUR-PROJECT` placeholder host → DNS failure → the EF was never invoked). Diagnosed and fixed separately; the new key was never the problem.
