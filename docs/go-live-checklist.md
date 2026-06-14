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
- **G-3** — HIBP leaked-password protection. Pro-gated; confirmed locked on the free tier (verified 2026-06-10, `auth-onboarding-client.md` C-7 — the toggle cannot be enabled at all below Pro). Enable at Pro cutover.
- **G-4** — 30-day refresh-token lifetime. Pro-gated. Set and record at Pro cutover.
- **Client session duration (open question 1, `auth-onboarding-client.md`)** — never formally resolved; current state is 30-day uniform across roles. Decide deliberately at Pro cutover, in the same dashboard visit as G-4 (master brief §4.2 contemplated shorter client sessions for shared devices).
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

- Production-origin env var must be set. The open-redirect fix made auth depend on `getPublicOrigin()`, which throws if `NEXT_PUBLIC_SITE_URL` is unset. Auth now fails closed if it is missing — login, confirmation, and recovery all break entirely. Confirm it is set in production before launch. **Confirmed in production 2026-06-10** after this exact failure fired live (second incident record, `auth-onboarding-client.md`): both vars set in Vercel, `/api/health` now reports this class continuously, and `runbooks/deploy-the-app.md` makes the health check a standing post-deploy step.
- HttpOnly cookies and refresh-token rotation must be active. The login-CSRF fix's threat model assumes session tokens are HttpOnly and rotation is on. Confirm both in deployed config before first real client.
- Post-reset session behaviour (bounce-to-login, and the open question of whether a password change should revoke sibling sessions) is real work, not a one-liner; trigger is before first real practitioner onboarding. Owned by Track C / the auth doc.

**Gate:** all three confirmed before first real data.

## 4. SECURITY DEFINER function grants (verify-gate)

The SECURITY DEFINER signup/invite functions (`create_organization_with_owner`, `staff_create_client_invite`, siblings, and the Track C `consume_recovery_ticket`) are hardened in migration source: each does `REVOKE EXECUTE FROM PUBLIC` then `GRANT EXECUTE TO authenticated`, and `seed_organization_defaults` revokes from `PUBLIC, authenticated, anon` explicitly. Anon is not granted execute on any of them in source.

This was confirmed against migration source, not against the live database — no live-query path existed at the time of writing.

**Gate (verify, not remediate):** once a live query path exists (a wired SQL connector, or `psql`), confirm the runtime grants match source — anon absent — by reading `information_schema.role_routine_grants` for these functions. If runtime matches source, this is closed by confirmation. If runtime diverges (anon present), treat as remediation at that point. Do this before client health data enters the project.

**Section-3 RPC family added to this sweep (2026-06-11).** The clinical-records polish pass added three more SECURITY DEFINER functions on the same pattern — `sync_client_profile_name` (CN-5, `20260611130000`), `soft_delete_client_medical_history` and `restore_client_medical_history` (CN-6, `20260611130100`) — each `REVOKE EXECUTE … FROM PUBLIC` then `GRANT EXECUTE … TO authenticated` in source, anon never granted. These join the soft-delete RPC family (`20260429120000` / `20260429130000`). The `role_routine_grants` sweep above must enumerate the **whole** SECURITY DEFINER family, not just the signup/invite functions, and confirm anon is absent for every one. Per the section-3 security recon (2026-06-11): runtime anon-EXECUTE is **unverified across the entire family** — the REVOKE-FROM-PUBLIC idiom does not strip a role-specific anon grant that Supabase default privileges may have added, so source-absence is necessary but not sufficient. Each function's in-body auth guard (`organization_id`/role check, or self-only re-read) is the load-bearing protection until the sweep runs.

**Section-5 confirmation + guardless-helper priority (2026-06-12).** The program-engine/session-builder pass *confirmed the section-3 hypothesis is real at runtime*: a read-only `has_function_privilege('anon', …, 'EXECUTE')` probe (committed at `docs/Prompts/section5-verification.sql`, check 6) showed `anon` **does** hold direct EXECUTE on program RPCs despite `REVOKE … FROM PUBLIC` in source. The six functions that pass created/replaced were tightened immediately (migration `20260612130000`: `REVOKE … FROM anon` on all six, plus `FROM authenticated` on the guardless internal `_clone_program`). **New, sharper finding for the sweep:** the in-body guard that makes the lingering anon grant harmless is *absent on internal `_` helpers*. `_clone_program` (write; now fixed) and **`_program_for_date`** (`20260503120000`; read-only — returns a program id; still anon-reachable, NOT yet fixed) are guardless. **The sweep must treat guardless internal SECURITY DEFINER helpers as the highest-priority bucket** — for them, anon-grant presence is not defence-in-depth, it is the whole exposure. Use the `has_function_privilege`/`pg_get_functiondef` probe shape from `section5-verification.sql` to enumerate every SECURITY DEFINER function, flag those whose body lacks a `user_organization_id()`/`user_role()` guard, and revoke anon from those first.

**Section-6 partial discharge + new finding (2026-06-12, program-calendar P0-1).** Migration `20260612150000` revoked anon EXECUTE on the **entire remaining program-engine/calendar family** predating `20260612130000` (ten guarded caller-facing functions: `copy_program`, `repeat_program`, `create_program_day`, `duplicate_program_day`, `soft_delete_program_day`, `soft_delete_program_exercise`, `restore_program_exercise`, `soft_delete_program_exercise_set`, `reorder_program_exercises`, `swap_program_exercise`) and made the guardless **`_program_for_date` definer-only** (anon AND authenticated revoked — closes the priority item above). pgTAP `23_program_rpc_grants.sql` (21/21 green on live, 2026-06-12) now locks the whole family's posture in as a regression tripwire — any future `CREATE OR REPLACE` that re-trips the auto-grant fails the suite. **The program family is done; the platform-wide sweep remains open**, and the same live probe surfaced its most urgent remaining bucket: **the `_test_*` pgTAP fixture helpers are anon-executable on the live project** — `_test_make_user(text)`, `_test_grant_membership(uuid, uuid, user_role)`, `_test_set_jwt(uuid, uuid, text)`, `_test_clear_jwt()`, `_test_insert_test_session(...)`, `_test_insert_test_result(...)`, `_test_insert_client_publication(...)`. Several are SECURITY DEFINER **write** helpers built to bypass normal flow for fixtures (user creation, membership grants, data inserts); anon-reachable, they are a tenant-boundary bypass, not defence-in-depth. They predate this section and are out of its contract — flagged to the operator 2026-06-12; remediation shape: revoke anon + authenticated (the pgTAP runner connects as the database owner, so test runs don't need API-role grants — verify the suite still passes after the revoke), or drop them from prod entirely once the §5 non-prod target exists. **RESOLVED 2026-06-12 (operator-approved, folded into program-calendar P1-1):** migrations `20260612160000` §3 + `20260612160100` (the helpers had no PUBLIC revoke — API roles resolved EXECUTE through the PUBLIC grant) plus a self-securing rewrite of `supabase/tests/database/00_test_helpers.sql`: every helper now carries an in-body `session_user = 'postgres'` guard that blocks PostgREST sessions regardless of grants and survives future auto-grant re-trips; the five fixture writers are owner-only at the grant level, the two JWT spoofers keep an authenticated grant solely for the suite's `SET LOCAL ROLE` pattern. pgTAP 23 §D locks the posture in; full scriptable suite re-ran 176/176 green. Full detail in `docs/polish/program-calendar.md` progress log.

**Section-7 partial discharge + new findings (2026-06-14, client-portal-pwa P0-2).** A live `has_function_privilege('anon', …, 'EXECUTE')` probe of the whole `client_*` family confirmed all of them were anon-executable. The **section-7 client-portal family** was revoked: migration `20260614120000` (reschedule v3) + `20260614130000` cover `client_start_session`, `client_log_set`, `client_complete_session`, `client_get_week_overview`, `client_get_program_day_exercises`, `client_get_published_reports`, `client_owns_test_session`, `client_list_program_days`, and `client_reschedule_program_day_to_today` — `REVOKE … FROM anon`, authenticated retained. pgTAP `25_portal_rpc_grants.sql` (18 assertions) is the regression tripwire. **The probe surfaced four more anon-reachable functions owned by other, separately-gated sections — still open in the platform-wide sweep, deliberately NOT revoked in section 7:** `client_accept_invite(uuid)` (**§2 onboarding — VERIFY whether it is ever called pre-authentication before revoking anon; a blind revoke could break the invite-accept flow**); `client_available_slots(timestamptz, timestamptz)`, `client_book_appointment(uuid, uuid, timestamptz, timestamptz)`, `client_cancel_appointment(uuid)` (**§9 scheduling**); and `client_cascade_thread_archive()` (**§10 messaging — no-arg; confirm it is a trigger/internal helper, not caller-facing, then revoke anon + authenticated**). These join the still-open platform-wide sweep; each is protected in the meantime by its in-body auth guard (the load-bearing protection until revoked).

## 5. Non-prod test target (standing liability)

All pgTAP, including the Track C recovery-ticket tests, runs only against the live production Supabase project via `BEGIN ... ROLLBACK`. There is no non-prod test target. Docker does not run on the operator's laptop (confirmed; not a path). Real options are a throwaway Supabase cloud staging project or Supabase branching.

**Gate:** stand up a non-prod target before identifiable client health data enters the project.

## 6. Cross-tenant isolation regression test (execution gate)

R-4 is closed. The automated pgTAP test `supabase/tests/database/17_cross_tenant_isolation.sql` landed 2026-06-07 and passed 8/8 against the live project — read isolation on `clients`/`clinical_notes`/`programs`, write isolation on `clients` (UPDATE affects 0 rows; foreign-org INSERT raises 42501), plus anti-trivial controls. The manual procedure at `runbooks/verify-cross-tenant-isolation.md` was also run for the first time the same day (all checks pass, recorded in its run log) and is downgraded to a quarterly broader-surface check (it covers all eight core tenant tables; the automated test covers the regression-prone core).

**Gate:** run the automated test (`17_cross_tenant_isolation.sql`, one batch in the SQL editor) on any migration touching RLS, the JWT hook, or the auth helpers, and before first real data. It runs against prod via `BEGIN … ROLLBACK` until the §5 non-prod target exists. Re-run the broader manual procedure quarterly or whenever the automated test's table coverage is in doubt.

## 7. Auth-config verification (cadence gate)

`runbooks/verify-auth-config.md` and `scripts/verify-auth-config.mjs` verify the dashboard-config properties. G-1 (custom-access-token hook) is verified green and automated. G-7 (email confirmations) is verified. G-3 and G-4 remain Pro-gated (section 1).

**Gate:** re-run the auth-config verification on the Pro-upgraded project as part of cutover, and confirm G-1 and G-7 still green after the upgrade. The same run delivers the definitive **G-3u** answer (does HIBP fire on `updateUser`, the path every client password-set and reset uses) — the probe is built and self-arming; with the Pro HIBP toggle on, G-3u GREEN closes the question, RED is the real platform hole and the support-ticket case (`auth-onboarding-client.md` C-7).

## 8. Deferred hardening surfaced at this gate (pointers)

- **G-6** — structured auth-event audit log. Deferred-with-trigger: before any paying clinical client. Owned by `auth-onboarding-staff.md` Revision 4. Master brief §7.4 names audit logging as a requirement, so this is deferred, not cut.
- **Invite `action_link` minted at POST time, not send time.** The C-11 burn-on-click pass removed the embedded link from the gate page HTML (the load-bearing half against body-parsing scanners); minting the link only on the human's POST is the residual. Deferred-with-trigger: before any paying clinical client. Owned by `auth-onboarding-client.md` (C-14 deferred item 1 / C-11 closure).
- **Enterprise Safe Links prefetch re-run.** The 2026-06-10 anti-prefetch verification covered live Gmail only; the corporate scanner class (Microsoft Safe Links, Proofpoint) is unexercised. Re-run `runbooks/verify-invite-prefetch.md` with an M365/enterprise mailbox. Deferred-with-trigger: before any paying clinical client. Owned by `auth-onboarding-client.md` (C-14 deferred item 2).
- **CN-7 — archived-client record access.** Master brief §7.2 requires archived records to remain queryable; today archiving a client makes their entire record UI-unreachable for the retention window (the clients SELECT policy filters soft-deleted rows, and no staff surface reads past it). Note the archive affordance is already live on the client profile — one click for any staff user — so this trigger is armed behaviourally, not hypothetically. Closing properly needs an additional staff-only SELECT path for archived rows, an "Archived" filter on the client list, and a read-only profile rendering. Deferred-with-trigger: **before the first real client archive, or before any paying clinical client, whichever comes first**. Owned by `polish/client-profile-clinical-notes.md` (CN-7).
- **CN-6 — `client_medical_history` last-write-wins (now-active).** The table has no OCC `version` column, and its UPDATE policy admits every owner/staff member of the org with no author lock, so two staff editing the same condition can silently clobber each other. The friends-and-family beta **already runs two staff** (operator + EP collaborator), so this is a now-active exposure, not a future one — the original closing-commit rationale ("single-practitioner facts") was wrong and was corrected on this point 2026-06-11. Fix is additive and cheap while pre-launch advantages hold: a `version` column + the existing `bump_version_and_touch()` trigger (mirroring `clients`/`clinical_notes`) plus a version check in `updateMedicalConditionAction`. Trigger: **now** (two-staff beta) — schedule before any sustained two-practitioner editing of medical history. Bounded harm (a lost edit to a short structured fact, fully re-enterable). Owned by `polish/client-profile-clinical-notes.md` (CN-6).
- **Reschedule compat-shim removal (section 7 / P0-1).** Migration `20260614140000` re-added the 1-arg `client_reschedule_program_day_to_today(uuid)` overload as a deploy-skew bridge, so prod (still calling the 1-arg form) survived the P0-1 v3 signature change to `(uuid, date)`. The shim resolves **org-tz** today and delegates to the device-tz 2-arg function — a temporary bridge that **contradicts the device-tz fix while it exists**: any call routed to the 1-arg overload silently yields org-tz, not the device-tz "today" P0-1 shipped. Harmless-ish pre-deploy (org-tz beats prod's old UTC), a latent tz-inconsistency landmine post-deploy. **Trigger: immediately after the section-7 branch merges to master and deploys** — drop the 1-arg overload in a new post-deploy migration (`DROP FUNCTION client_reschedule_program_day_to_today(uuid);`) and trim the 1-arg pgTAP `25` assertions, so every reschedule uses the 2-arg device-tz path. Do **not** push the drop before deploy (it re-breaks the still-deployed 1-arg caller). Owned by `polish/client-portal-pwa.md` (P0-1 / §8.6).

## Closing note

This checklist is an index, not a vault. When an item closes, record the closure in the document that owns the item, and mark the gate here closed with a pointer to that record. Do not migrate the detail into this file.
