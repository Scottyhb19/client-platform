# Perf — Step 5 residual (auth middleware) — gap analysis

Follow-up to the syd1 region fix (`docs/perf/baseline-2026-06-26.md`, promoted to production 2026-07-01). Pass 1 named a residual for "a later pass"; this doc audits it and designs the fix. **Status (2026-07-01): residual MEASURED and confirmed real (~200–250 ms per authenticated request); DECISION recorded below — accepted for the friends-and-family beta with re-triggers. Not implemented: the fix is operator-gated (Vercel Pro billing, or enabling asymmetric JWT keys + the external auth-review gate). Per CLAUDE.md a security-surface change cannot ship without approval + external review.**

## RESOLVED (2026-07-21) — Vercel Pro re-trigger fired; residual gone with no code change

The operator upgraded Vercel to Pro (2026-07-21, alongside the Supabase Pro cutover). The first-listed re-trigger fired and the clean no-auth-code path was taken, exactly as designed. Verified against production the same day:

- `X-Vercel-Id: syd1::syd1::…` on three consecutive probes of a middleware-matched route (`/login`) — the **edge invocation and the function both run in Sydney** (previously the edge hop was un-pinned and could land off-region).
- Warm TTFB through the middleware: **~0.18–0.29 s for the full page** (three probes from an AU connection), versus the ~200–250 ms *added* middleware-auth round-trip measured 2026-07-01. The middleware→Sydney-auth hop is now intra-region.

Consequences: the **local-JWT (`getClaims` + asymmetric keys) alternative is moot** — do not implement it; it existed only as the no-Pro fallback and carries auth-bypass risk. The remaining re-triggers (reported authed-navigation slowness; paying-client onboarding) stay live as ordinary perf vigilance, but the named residual this doc exists for is closed. `PERF-REGION-1` in `test_scenarios_template.md` continues to guard the function-region half; the `syd1::syd1::` edge prefix above is the check for the middleware half if this is ever re-probed.

## Decision (2026-07-01) — accepted with re-triggers
**Accepted** for the current Hobby friends-and-family beta (no paying clients). The residual is real but modest (~200–250 ms per authenticated navigation) and the dominant per-query cost is already removed by the syd1 move. **Re-triggers that reopen it:**
- **The Vercel Pro / commercial-use move** — Pro runs Edge middleware in `syd1` regions, fixing this residual with *no* auth-code change. Do it then (it's the clean fix, and you'll be on Pro anyway for commercial use).
- **Any reported slowness on authenticated navigation** before that.
- **Paying-client onboarding** (the hard rule) — revisit within that gate.

Do **not** implement the local-JWT auth change while on Hobby unless a re-trigger fires and Pro isn't chosen; if it is ever pursued it runs the full polish protocol + external auth review.

*Indexed in `docs/go-live-checklist.md` §8 — per CLAUDE.md, the checklist (not this polish doc) is where these re-triggers actually fire.*

## What the syd1 fix already removed
Serverless/SSR functions now run in `syd1`, co-located with the Sydney database. The per-query cross-Pacific tax collapsed from ~0.75s to ~0s (verified in prod). Every server-side DB round-trip is now local (~2–5ms).

## The residual, ranked (post-syd1)

1. **Edge middleware auth round-trip — DOMINANT, unmeasured.**
   `src/lib/supabase/middleware.ts:150` calls `supabase.auth.getUser()` on **every** matched request. `getUser()` is a **network** call to the Supabase auth server (GoTrue) in Sydney to re-verify the JWT. Middleware is **Edge**, and `vercel.json regions` does **not** pin Edge middleware — Vercel runs it in all regions by default, **fewer on Hobby** (Vercel docs, confirmed). So the middleware may execute outside `syd1` and pay a cross-Pacific hop to the Sydney auth server on every authenticated navigation.
   - **Size: MEASURED 2026-07-01 — real and material.** Method: a crafted **fake-auth-cookie** probe — a structurally-valid but invalid `sb-<ref>-auth-token`. The middleware still calls `getUser()` against Sydney auth, which rejects it, so the request TTFB captures the round-trip with **no real session and no data created** (it just redirects to `/login`). From the US edge (`iad1`), the `getUser`→Sydney round-trip added **~0.7 s** over the no-cookie baseline (paired deltas 0.69 / 0.71 / 0.82 / 0.73 / 0.83 s, one 1.36 s outlier). **Caveat:** a rejected fake token likely triggers a reject-plus-refresh-retry, so ~0.7 s is an **over-estimate**; a real valid session does one clean `getUser` round-trip ≈ one edge→Sydney RTT (~200–250 ms from a US edge). Either way it is **confirmed real** — a per-authenticated-request cost the syd1 function move did **not** remove (middleware is Edge, not syd1-pinned). For AU users the size depends on where Hobby runs the Edge middleware: a Sydney PoP → ~local; a US PoP → the full cross-Pacific hop plus the user's own AU→US edge hop.

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
**Measured: the residual is real (~200–250 ms clean per authenticated request; up to ~0.7 s in the fake-token over-estimate).** It is worth fixing — but **both remediation paths require an operator decision; neither is a safe autonomous prod change:**

1. **Vercel Pro (recommended, cleanest).** Pro runs Edge middleware in more regions (incl. `syd1`), collapsing the edge→auth hop for AU users with **no auth-code risk**. It is *separately* required for commercial use once paying clients enter, so it likely lands for that reason anyway. Business/billing decision — can't be done autonomously.
2. **Local JWT verification** (`getClaims` + asymmetric signing keys) — eliminates the per-request network verify. Hard prerequisite: **enable asymmetric JWT signing keys in the Supabase dashboard first** (operator action; can invalidate live sessions if mishandled). Then it must run the full polish protocol + the external auth-review gate before prod. Do **not** implement until asymmetric keys are enabled and the gap list is approved — an auth-bypass here is the platform's highest-impact failure.

**Interim:** for the Hobby f&f beta with no paying clients, accepting the residual until the Pro move is a legitimate call — the syd1 fix already removed the dominant per-query cost, and this is a smaller (though real) per-navigation hop. The choice — pay for Pro now, do the gated code change, or accept for now — is the operator's; I can't spend money or bypass the auth-review gate autonomously.

---

## Appendix — `PERF-REGION-1` test criterion (now in `test_scenarios_template.md`)
Added to `test_scenarios_template.md` on 2026-07-01 once the operator's concurrent batch landed. Reproduced here for provenance; the canonical copy is the test file.

> ### PERF-REGION-1 — A DB-touching route pays no cross-region query tax on syd1
> - **Setup:** A `syd1` deployment (`vercel.json` → `"regions": ["syd1"]`). Probe a no-DB route (`/login`) and a DB-touching route (`/i/<uuid>`) back-to-back, several times, from any single location (the requester→compute hop is common to both routes and cancels in the delta — valid even when run from outside Australia).
> - **Measure:** `delta = TTFB(DB-touching) − TTFB(no-DB)`.
> - **Pass:** `x-vercel-id` shows compute region **`syd1`** (`…::syd1::…`), **and** the delta is **near-zero — within network noise (≈ ±50–90 ms, often negative)** — not the ~0.65–0.85 s cross-Pacific tax an `iad1` build shows. Baseline (`docs/perf/baseline-2026-06-26.md` §11): before (`iad1`) ~0.75 s; after (`syd1`) ~0.00 s. **Preview-proven and production-verified (2026-07-01); the authenticated-surface residual (this doc) is separate and unmeasured.**
