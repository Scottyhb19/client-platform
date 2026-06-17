# Deploy the app (Next.js → Vercel production)

**Evidence base:** the two 2026-06-10 production incidents (`docs/polish/auth-onboarding-client.md`, both incident records) — a poison-cookie 500 (`c301832`) and a missing `NEXT_PUBLIC_SITE_URL` breaking every owner/staff sign-in (`c7750be`). Both were env/config-class failures that a post-deploy check would have caught in one curl. The lesson encoded here, from the second incident's honesty note: *a verification matrix that never exercises each role branch can pass while the operator's exact path is broken.* `/api/health` (added in `c7750be`) reports required-env status by name; `scripts/staff-login-path-verify.mjs` and `scripts/proxy-poison-cookie-verify.mjs` are the standing role-branch and cookie-robustness harnesses.

## Purpose

Deploy the Next.js app to production and verify the deploy. **Every push to `master` IS a production deploy** — Vercel builds and flips live in roughly 80 seconds. There is no separate "release" step, and no Vercel CLI or dashboard access from the operator's machine (no tokens by design; see `docs/secrets-inventory.md` posture) — so the local build is the pre-push gate and the probes below are the post-deploy confirmation.

## Prerequisites

- Working tree contains exactly what you intend to ship (`git status`).
- `.env.local` present (the local production build reads it).
- No schema change is riding along unapplied — DB changes follow their own sequence (migration file → `supabase db push` → types regen → verify) *before* the code that depends on them is pushed.

## Steps

1. **Pre-push gate (always):**
   ```powershell
   cd "C:\Users\scott\Desktop\Client Software Platform"
   npx tsc --noEmit
   npm run build
   ```
   Both must exit 0. A failure here is a failure production would have had.
2. **Push = deploy:**
   ```powershell
   cd "C:\Users\scott\Desktop\Client Software Platform"
   git push origin master
   ```
3. Wait ~90 seconds for the flip.

## Verification

4. **Health check (always, every deploy):**
   ```powershell
   curl.exe -s https://odysseyhq.com.au/api/health
   ```
   Expect HTTP 200 with `"db":"ok"` and `"config":"ok"`. A 503 lists the missing env-var **names** (never values) — fix in Vercel → Settings → Environment Variables, redeploy, re-check. This one curl is the standing defence against the entire env/config failure class.
5. **After any auth-surface change** (login, callback, middleware/proxy, cookies, `safeNext`, env handling) — additionally:
   ```powershell
   cd "C:\Users\scott\Desktop\Client Software Platform"
   node scripts/staff-login-path-verify.mjs
   node scripts/proxy-poison-cookie-verify.mjs
   ```
   Expect 4/4 and 13/13 against production. The first exercises a real **staff** role branch end-to-end; the second the malformed-cookie matrix. Run both whenever in doubt — they are cheap.
6. **If this deploy also (re)deployed the reminder Edge Function** (`supabase functions deploy send-appointment-reminders`) — run the **synthetic send check** in [`deploy-an-edge-function.md`](deploy-an-edge-function.md#synthetic-send-check-standing--run-after-every-redeploy-of-send-appointment-reminders). A `200` from the function is **not** proof it sends — the 2026-06-16 reminder outage returned `200` with `failed:N` on every tick. The synthetic check drives a real send to a safe sink and asserts `status='sent'`. The Edge Function carries its own Supabase secret set (separate from Vercel) — a redeploy is exactly when a missing/stale `EMAIL_FROM` / `RESEND_API_KEY` / `NEXT_PUBLIC_APP_URL` bites.

## Rollback

Forward-fix and push is the default (the deploy loop is ~80s, faster than investigating a dashboard rollback without CLI access). For a truly broken deploy: `git revert <bad-commit>` and push — never force-push master. Vercel's dashboard offers instant rollback to a prior deployment, but it is not drivable from this machine and requires the operator's browser session.
