# Go-Live Checklist — project-wide pre-launch gate (Gate 3 deliverable)

**Status:** open. No item here is closed.

**What this is.** The named dev-to-production transition gate referenced by `schema.md` and `slos.md` as the Gate 3 deliverable. It is the project-wide gate that must be walked before the first real user — including any friends-and-family beta tester — creates data.

**What this is NOT.** Not a restatement of the documents it points at. Every item below is either a verification gate (confirm a property holds, with a pointer to the authoritative document for detail) or a trigger surfaced at the point it fires. Where a liability is owned by another document, this checklist points at it and does not duplicate its detail — a duplicated gate goes stale the day its source changes. This file deals in gates and document pointers only; it carries no file:line citations, by design, because every line-cited document in this repo has drifted at least once.

**How to read it.** The hard rule is absolute and gates everything else. The remaining sections are the verification and trigger gates, in no priority order — all must hold before first real data.

## 0. The hard rule (source of truth: `CLAUDE.md` "Open gates")

No paying clinical client may be onboarded to OdysseyHQ as their primary clinical record system until all three of the following are true:

- **(a)** An external IT security review is completed and documented in `docs/external-reviews.md`.
- **(b)** Anthropic has established a BAA meeting Australian health-privacy standards (assessed 12–24 month horizon; treat as not-yet-met until documented).
- **(c)** The entity structure has been reviewed against the increased liability surface (sole trader to likely Pty Ltd).

`CLAUDE.md` is the source of truth for this rule; the text above is reproduced for legibility at the gate. If the two ever diverge, `CLAUDE.md` wins. Until all three hold, the existing clinical clients stay on Cliniko and OdysseyHQ runs as a friends-and-family beta only. This rule is not waivable by convenience, deadline, or "just one client".

Note the scope distinction this checklist runs on: the friends-and-family beta itself begins the day the first beta tester logs in. Items below marked **before first real data** gate that day. Items marked **before paying client** gate the hard-rule threshold above, which is later. The two are not the same day.

## 1. Supabase Pro-tier transition (owned by: `auth-onboarding-staff.md` Track A)

The free tier is acceptable only while no real data exists. The following are Pro-gated and are reproduced here only as the go-live trigger; Track A owns their detail and current state:

- Point-in-Time Recovery and daily backups become mandatory the moment a real client is onboarded (see `schema.md`, `slos.md`).
- **G-3** — HIBP leaked-password protection. Pro-gated; confirmed locked on the free tier. Enable at Pro cutover.
- **G-4** — 30-day refresh-token lifetime. Pro-gated. Set and record at Pro cutover.
- First DR drill is run on the newly-upgraded Pro project as the final pre-launch step (named in `schema.md` and `slos.md`).

**Gate:** Pro upgrade is done before first real data; G-3 and G-4 are set on the upgraded project and their state recorded in their owning documents at that time.

## 2. Secrets (source of truth: `secrets-inventory.md`, `secrets-rotation-log.md`)

Standing policy is rotate-on-suspicion-of-exposure; there is no scheduled cadence. State at this writing:

- `RESEND_API_KEY` and `CRON_SHARED_SECRET` were rotated 2026-05-17 after transcript exposure — already discharged.
- `SUPABASE_SERVICE_ROLE_KEY` rotation status is recorded as not-determinable and flagged for stakeholder confirmation. This is the one open secrets item.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is not a secret (RLS-bounded, shipped to the browser by design) — it is not a rotation item.

**Gate:** before first real data, confirm or rotate `SUPABASE_SERVICE_ROLE_KEY` and record the outcome in `secrets-rotation-log.md`. See `secrets-inventory.md` for the catalogue and `runbooks/rotate-a-secret.md` for procedure.

Tracked secrets tech-debt (pointers, not gates): the `CRON_SHARED_SECRET` pg_cron value is an inline literal, not Vault (migrate when convenient); `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_APP_URL` are the same logical value under two keys and must both be set and kept in sync (Flag E, runbook README backlog).

## 3. Auth security forward-dependencies (source of truth: `auth-onboarding-staff.md` Track C)

The Track C security pass created or assumes these production-config dependencies:

- Production-origin env var must be set. The open-redirect fix made auth depend on `getPublicOrigin()`, which throws if `NEXT_PUBLIC_SITE_URL` is unset. Auth now fails closed if it is missing — login, confirmation, and recovery all break entirely. Confirm it is set in production before launch.
- HttpOnly cookies and refresh-token rotation must be active. The login-CSRF fix's threat model assumes session tokens are HttpOnly and rotation is on. Confirm both in deployed config before first real client.
- Post-reset session behaviour (bounce-to-login, and the open question of whether a password change should revoke sibling sessions) is real work, not a one-liner; trigger is before first real practitioner onboarding. Owned by Track C / the auth doc.

**Gate:** all three confirmed before first real data.

## 4. SECURITY DEFINER function grants (verify-gate)

The SECURITY DEFINER signup/invite functions (`create_organization_with_owner`, `staff_create_client_invite`, siblings, and the Track C `consume_recovery_ticket`) are hardened in migration source: each does `REVOKE EXECUTE FROM PUBLIC` then `GRANT EXECUTE TO authenticated`, and `seed_organization_defaults` revokes from `PUBLIC, authenticated, anon` explicitly. Anon is not granted execute on any of them in source.

This was confirmed against migration source, not against the live database — no live-query path existed at the time of writing.

**Gate (verify, not remediate):** once a live query path exists (a wired SQL connector, or `psql`), confirm the runtime grants match source — anon absent — by reading `information_schema.role_routine_grants` for these functions. If runtime matches source, this is closed by confirmation. If runtime diverges (anon present), treat as remediation at that point. Do this before client health data enters the project.

## 5. Non-prod test target (standing liability)

All pgTAP, including the Track C recovery-ticket tests, runs only against the live production Supabase project via `BEGIN ... ROLLBACK`. There is no non-prod test target. Docker does not run on the operator's laptop (confirmed; not a path). Real options are a throwaway Supabase cloud staging project or Supabase branching.

**Gate:** stand up a non-prod target before identifiable client health data enters the project.

## 6. Cross-tenant isolation regression test (execution gate)

R-4 is closed. The automated pgTAP test `supabase/tests/database/17_cross_tenant_isolation.sql` landed 2026-06-07 and passed 8/8 against the live project — read isolation on `clients`/`clinical_notes`/`programs`, write isolation on `clients` (UPDATE affects 0 rows; foreign-org INSERT raises 42501), plus anti-trivial controls. The manual procedure at `runbooks/verify-cross-tenant-isolation.md` was also run for the first time the same day (all checks pass, recorded in its run log) and is downgraded to a quarterly broader-surface check (it covers all eight core tenant tables; the automated test covers the regression-prone core).

**Gate:** run the automated test (`17_cross_tenant_isolation.sql`, one batch in the SQL editor) on any migration touching RLS, the JWT hook, or the auth helpers, and before first real data. It runs against prod via `BEGIN … ROLLBACK` until the §5 non-prod target exists. Re-run the broader manual procedure quarterly or whenever the automated test's table coverage is in doubt.

## 7. Auth-config verification (cadence gate)

`runbooks/verify-auth-config.md` and `scripts/verify-auth-config.mjs` verify the dashboard-config properties. G-1 (custom-access-token hook) is verified green and automated. G-7 (email confirmations) is verified. G-3 and G-4 remain Pro-gated (section 1).

**Gate:** re-run the auth-config verification on the Pro-upgraded project as part of cutover, and confirm G-1 and G-7 still green after the upgrade.

## 8. Deferred hardening surfaced at this gate (pointers)

- **G-6** — structured auth-event audit log. Deferred-with-trigger: before any paying clinical client. Owned by `auth-onboarding-staff.md` Revision 4. Master brief §7.4 names audit logging as a requirement, so this is deferred, not cut.

## Closing note

This checklist is an index, not a vault. When an item closes, record the closure in the document that owns the item, and mark the gate here closed with a pointer to that record. Do not migrate the detail into this file.
