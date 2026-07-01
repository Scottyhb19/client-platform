# Perf — Step 5 residual (auth middleware) — gap analysis

Follow-up to the syd1 region fix (`docs/perf/baseline-2026-06-26.md`, promoted to production 2026-07-01). Pass 1 named a residual for "a later pass"; this doc audits it and designs the fix. **Status: audit + gap list only — NOT implemented. The primary fix is a security surface (auth) and per CLAUDE.md must be approved before implementation and cannot ship without the external auth review gate.**

## What the syd1 fix already removed
Serverless/SSR functions now run in `syd1`, co-located with the Sydney database. The per-query cross-Pacific tax collapsed from ~0.75s to ~0s (verified in prod). Every server-side DB round-trip is now local (~2–5ms).

## The residual, ranked (post-syd1)

1. **Edge middleware auth round-trip — DOMINANT, unmeasured.**
   `src/lib/supabase/middleware.ts:150` calls `supabase.auth.getUser()` on **every** matched request. `getUser()` is a **network** call to the Supabase auth server (GoTrue) in Sydney to re-verify the JWT. Middleware is **Edge**, and `vercel.json regions` does **not** pin Edge middleware — Vercel runs it in all regions by default, **fewer on Hobby** (Vercel docs, confirmed). So the middleware may execute outside `syd1` and pay a cross-Pacific hop to the Sydney auth server on every authenticated navigation.
   - **Size: unknown — not measurable from here.** It needs an authenticated `/portal` probe against a `syd1` deployment with a real session; the operator's US probe machine has no prod session, and the Vercel bypass token clears Vercel's wall, not the app's own auth. Estimated ~150–250ms per request *if* the Edge region is outside AU; ~0 if Hobby happens to run the middleware near the AU user. **Measure before investing.**

2. **Portal sequential awaits — now cheap, low value.**
   `src/app/portal/page.tsx` chains `getUser → client → resolvePortalToday → activePrograms → week-overview RPC → sessions`. Independent pairs (`resolvePortalToday` + `activePrograms`) could go parallel. But each hop is now a **local** Sydney round-trip (~2–5ms), so parallelising saves ~10ms. Marginal; not worth refactoring a page that carries load-bearing timezone/FM-1 logic unless telemetry says otherwise.

3. **Double `getUser` (middleware + page).** The page's own `getUser` (`portal/page.tsx:40`, and `require-role.ts` for staff) is now a **local** Sydney call — cheap. Only the middleware copy (#1) is the concern.

## Fix design (for approval — not implemented)

**Primary (addresses #1) — replace the middleware's network verify with local JWT verification.**
Swap `getUser()` (network) for **`getClaims()` with asymmetric JWT signing keys**, which verifies the token **signature locally** (no network) — cryptographically secure, so it is *not* spoofable (this directly answers the existing `middleware.ts` comment's reason for using `getUser` over `getSession`). Token *refresh* still makes a network call only when the token is actually expired (~hourly), not on every request. Net: the per-request auth check becomes local.
- **Prerequisites:** Supabase **asymmetric JWT signing keys** enabled (dashboard migration — can invalidate live sessions if done carelessly); a `@supabase/ssr` / `supabase-js` version that supports `getClaims` (verify against installed `^0.7.0` / `^2.50.0`).
- **Risk: HIGH — auth bypass if misconfigured.** RLS/auth is the platform's highest-impact failure surface and the named external-review gate (Open gates (a)). This **must** run the full polish protocol (premortem → gap list → approval → test) and land under the external auth review, not as an autonomous change.

**Alternative (no code) — Vercel Pro.** Pro runs Edge middleware in more regions (incl. `syd1`), so the middleware→Sydney-auth hop becomes local without touching auth code. It's a paid plan (currently Hobby/free) and is separately required for commercial use once paying clients enter — so it may land for that reason anyway.

**Secondary (safe, optional, low value) — parallelise portal's independent awaits.** Pure-perf, non-security; ~10ms post-syd1. Implement on a branch with the operator's browser verification if desired; not urgent.

## Recommendation
For the friends-and-family beta on Hobby with no paying clients, the syd1 fix already removed the dominant cost. Before spending on #1: **measure the authenticated residual** (authed `/portal` probe on `syd1`). If it's a real few-hundred-ms hop, do the local-JWT fix through the polish protocol + auth review, or move to Pro. If it's negligible (Edge running near AU users), accept it. Do **not** change the auth middleware without that measurement and approval.

---

## Appendix — `PERF-REGION-1` test criterion (now in `test_scenarios_template.md`)
Added to `test_scenarios_template.md` on 2026-07-01 once the operator's concurrent batch landed. Reproduced here for provenance; the canonical copy is the test file.

> ### PERF-REGION-1 — A DB-touching route pays no cross-region query tax on syd1
> - **Setup:** A `syd1` deployment (`vercel.json` → `"regions": ["syd1"]`). Probe a no-DB route (`/login`) and a DB-touching route (`/i/<uuid>`) back-to-back, several times, from any single location (the requester→compute hop is common to both routes and cancels in the delta — valid even when run from outside Australia).
> - **Measure:** `delta = TTFB(DB-touching) − TTFB(no-DB)`.
> - **Pass:** `x-vercel-id` shows compute region **`syd1`** (`…::syd1::…`), **and** the delta is **near-zero — within network noise (≈ ±50–90 ms, often negative)** — not the ~0.65–0.85 s cross-Pacific tax an `iad1` build shows. Baseline (`docs/perf/baseline-2026-06-26.md` §11): before (`iad1`) ~0.75 s; after (`syd1`) ~0.00 s. **Preview-proven and production-verified (2026-07-01); the authenticated-surface residual (this doc) is separate and unmeasured.**
