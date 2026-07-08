# Health check — read-only diagnostic pass (2026-07-09)

**Nature:** Read-only, evidence-first, gate-anchored audit. No code, migration, doc (other
than this file), or git state was changed. Findings only — triage and fixing are separate,
deliberate passes.

**Working tree:** `master` @ `a9ed592` (`git log --oneline -1`). 176 applied migrations,
57 pgTAP files (00–56 tracked + one untracked `57_…`).

**Evidence provenance.** Three classes, labelled per finding:
- **[LIVE]** — a `supabase db query --linked` read-only catalog probe run today against the
  production project (`azjllcsffixswiigjqhj`). SELECT-only; no writes.
- **[STATIC]** — file/line evidence from the working tree (migrations, source, docs, pgTAP).
- **[UNVERIFIABLE-FROM-CODE]** — a claim that code/repo searching *cannot* settle; each names
  the operator/dashboard/live action that would settle it. Collected in the final section.

**Standing caveat (per the acceptance gate).** `tsc --noEmit`, `eslint`, and `next build` all
exit 0 today (Area 4). That is **necessary but not sufficient**. The project's acceptance gate
is behavioural verification on a live authenticated session (`go-live-checklist.md` §5b), which
static green does not substitute for. Nothing in this report should be read as "healthy because
it compiles."

---

## Area 1 — Beta-entry hardening gate (the live gate — highest priority)

The gate has three named items in CLAUDE.md. Verdict up front: **two closed, one open.** The
open one is the actual blocker on the friends-and-family beta.

### P0-1 — Backup-restore DR drill has never been run (the one open beta gate) — OPEN
- **[STATIC]** `docs/disaster-recovery.md:3` — *"**Status: blocked on plan — operator
  confirmed Free tier 2026-07-02.** … do not treat the gate as met until the drill actually
  runs post-upgrade."* Run log `docs/disaster-recovery.md:74` — the only row is
  `| _(pending first run)_ | | | | |`.
- **[STATIC]** `docs/go-live-checklist.md:3` — *"open on exactly one beta-gating item — the §1
  Supabase Pro upgrade + DR drill sitting."* §1 line 31 confirms the drill is blocked until the
  Pro upgrade (Free tier has no "Restore to a New Project").
- **Cross-ref:** CLAUDE.md Beta-entry hardening gate, item 3 ("A backup restore actually
  exercised once"). This is the sole remaining un-closed sub-item of that gate.
- **Assessment:** Not a code defect — a documented dependency (blocked on the Pro upgrade,
  itself a go-live step). But it is the highest-priority *open* gate item, so it leads this
  report. The drill recipe is written and ready; it becomes a ~30-minute task the moment the
  project is on Pro. **Do not treat the beta gate as clear until the run log has a real row.**

### Closed and independently re-verified today

- **Secret neutralisation (transcript-leaked keys).** [LIVE] anon table grants in `public` =
  **0** (probe: `select count(*) from information_schema.role_table_grants where grantee='anon'
  and table_schema='public'` → `0`), consistent with the §4b revoke. [LIVE] all three cron jobs
  read the shared secret from Vault, none embed a bearer literal (probe over `cron.job`:
  `appointment-reminders-5min` `reads_vault=true`, `message-notifications-5min`
  `reads_vault=true`, `rate-limit-log-cleanup-hourly` needs none;
  `inline_bearer_literal=false` for all three) — confirms the `20260701120000` Vault migration
  is effective at runtime. See Area 2 for the full function/table grant census. **However, one
  residual copy of the leaked key persists on disk — see P0-2 below.**
- **R-4 cross-tenant isolation.** [STATIC] `supabase/tests/database/17_cross_tenant_isolation.sql`
  exists and is wired; an untracked `57_cross_tenant_isolation_full.sql` extends it to all 41
  `organization_id`-bearing tables (`git status` shows it `??`). Both are tripwires per
  `go-live-checklist.md` §6.

### P0-2 — Leaked legacy `service_role` JWT persists in plaintext on disk (5 files)
- **[STATIC]** `.claude/settings.local.json:132-138` — seven Bash permission-allowlist entries
  of the form `curl -s -H "apikey: eyJ…" -H "Authorization: Bearer eyJ…"
  https://azjllcsffixswiigjqhj.supabase.co/rest/v1/…` against `message_threads` / `messages` /
  `clients`. I confirmed these firsthand (values masked on read). The decoded JWT payload
  (public metadata only) is `role=service_role, ref=azjllcsffixswiigjqhj` — the live project's
  **legacy service_role key**, the exact class the Beta gate's secret item was closed against.
- **[STATIC]** Identical copies exist in all four
  `.claude/worktrees/*/.claude/settings.local.json`.
- **[STATIC]** Never committed: across 533 commits (`git rev-list --all --count` → 533), full
  tree-grep + pickaxe for `eyJhbGciOi` and for the literal value = **0**; `.claude/` is
  gitignored (`git check-ignore` → `.gitignore:8`).
- **Cross-ref:** CLAUDE.md Beta gate item 1 (secret rotation, marked DONE 2026-07-02). The
  neutralisation was done by **disabling the legacy keys at the gateway**, not by removing this
  on-disk copy.
- **Assessment.** Inert **if and only if** the gateway legacy-key disable actually holds — and
  that disable is (a) a one-click-reversible toggle and (b) **not verifiable from code** (see
  final section). Under the project's own trust-nothing posture, a full-DB RLS-bypass credential
  sitting in plaintext, whose only protection is an unverified reversible toggle, is a P0. The
  entries also re-propagate into every new worktree. Recommended (do not action here): scrub
  lines 132–138 and the four worktree copies; re-confirm the gateway disable.

---

## Area 2 — Tenant isolation & RLS (production-grade weighting)

Method: [LIVE] full `public`-schema census (67 tables) via `pg_tables`/`pg_class`/`pg_policies`,
and [LIVE] SECURITY DEFINER + non-definer EXECUTE census via `has_function_privilege`.
Reconciled against [STATIC] migration source.

### P0-3 — `audit_wide_column_config` has no RLS and is writable by any authenticated principal
- **[LIVE] table census:** the **only** table in `public` with `rls_on=false` and `policies=0`
  (`has_org_id=false`). Every other one of the 67 tables has RLS enabled.
- **[LIVE] grant probe** on that table (`information_schema.role_table_grants`): `authenticated`
  holds `SELECT, INSERT, UPDATE, DELETE` (+ REFERENCES/TRIGGER/TRUNCATE); `service_role` the
  same; `anon` absent (stripped by `20260702170000`). So with RLS off, **any authenticated
  JWT — including a portal client's — can read and write this table through PostgREST.**
- **[STATIC]** Created `supabase/migrations/20260420102300_audit_log_and_triggers.sql:29`; no
  migration ever runs `ENABLE ROW LEVEL SECURITY` on it (exhaustive grep of all 176). It is the
  global config that drives audit-snapshot truncation (`…102300:135`: `SELECT column_name FROM
  public.audit_wide_column_config WHERE table_name = p_table`).
- **Impact:** audit-fidelity tampering, not PHI disclosure. A hostile authenticated INSERT
  (e.g. `('clinical_notes','content_json')`) silently truncates future audit snapshots of that
  column; a DELETE removes truncation config. It does not itself leak client health data, but it
  degrades the §7.4 audit trail that the compliance posture relies on. Master brief §7.4 names
  audit logging as a requirement; a tamperable audit-config table undercuts it.
- **Standard breached:** CLAUDE.md Code standards — *"Row-Level Security enforced on every
  tenant-owned table. RLS is the security boundary, not application code."* This is a global
  (non-tenant) config table, so it sits in the seam of that rule as written — but the design
  intent (migration-populated only) is clearly that authenticated users should not write it.
- **Test gap:** [STATIC] `54_anon_table_grants.sql` covers *anon* only; nothing asserts the
  *authenticated* write exposure. No regression tripwire exists for this.
- **Fix shape (not applied):** enable RLS + a deny-all-or-owner-read policy, **or** revoke
  authenticated DML leaving service-role/migration writes; add a pgTAP assertion. Cheap now
  (no real data).

### P2-1 — Ineffective anon revoke on two trigger functions (source ≠ runtime)
- **[LIVE]** anon holds EXECUTE on `circuit_exercise_enforce_exercise_org` and
  `session_template_exercise_enforce_exercise_org` (both `returns trigger`, confirmed via
  `pg_get_function_result`).
- **[STATIC]** The migrations *believe* they revoked it:
  `20260624100000_circuits.sql:151` `REVOKE EXECUTE … FROM anon;` and
  `20260624130000_session_templates.sql:152` likewise.
- **Root cause:** the revoke targets `anon`, not `PUBLIC`. The default `EXECUTE TO PUBLIC` grant
  survives, and `has_function_privilege('anon', …)` resolves *through* PUBLIC — the exact trap
  the repo fought family-by-family (`REVOKE FROM PUBLIC` ≠ `REVOKE FROM anon`; see memory
  `project_supabase_default_execute_grants`). The revoke silently did nothing.
- **Impact:** **inert.** Trigger-typed functions are not exposed as PostgREST RPCs, so anon
  cannot invoke them regardless of the catalog grant. Flagged as P2 because it is a latent
  correctness defect in the revoke idiom (any future non-trigger function revoked the same way
  would be genuinely exposed) and a documentation-vs-runtime divergence, not a live hole.

### P2-2 — `sync_client_profile_name` missed by the §4 anon-EXECUTE family sweep
- **[LIVE]** anon holds EXECUTE on `sync_client_profile_name` (`returns void` — a real RPC, not
  a trigger).
- **[STATIC]** `20260611130000_cn5_sync_client_profile_name.sql:79-80` does `REVOKE … FROM
  PUBLIC` + `GRANT … TO authenticated` only; no migration ever `REVOKE … FROM anon` on it
  (its CN-6 siblings got explicit anon revokes in `20260623180000:37/50`; this one was missed).
- **Mitigation in place:** the body guards first (`…:46` `IF caller_org IS NULL OR caller_role
  NOT IN ('owner','staff') THEN RAISE … 42501`), and it re-reads the name from the `clients`
  row rather than trusting a parameter, so an anon call raises immediately and cannot write.
  Exposure is convention-drift, not a hole.
- **Cross-ref:** `go-live-checklist.md` §4 (marked CLOSED 2026-07-02 — "every family is
  discharged"). This function contradicts that completeness claim at runtime. Worth an explicit
  revoke for posture (it is guarded, so P2 not P1).

### Documented-and-accepted anon-EXECUTE residuals (not new findings — confirmed still true)
- **[LIVE]** anon holds EXECUTE on: `consume_recovery_ticket`, `rate_limit_check_and_record`,
  `rate_limit_check_failures`, `rate_limit_record_failure`, `calendar_feed_events` — all
  **anon-REQUIRED pre-auth surfaces**, correct by design (`go-live-checklist.md:81`).
- **[LIVE]** anon holds EXECUTE on the RLS-policy helpers `test_session_in_org`,
  `test_session_has_active_publication`, `test_session_has_auto_visible_metric`,
  `test_metric_visibility`, `battery_in_clients_published_session` — the consciously-deferred
  "§8 call" bucket (`go-live-checklist.md:82`, "marginal-benefit / real-regression-risk").
  Reached only through authenticated-only RLS policies; anon never actually invokes them.
- **[LIVE]** anon holds EXECUTE on `handle_new_auth_user` and `log_audit_event` — both
  trigger/inert return types, not RPC-callable. `log_audit_event` is deliberately left
  (`go-live-checklist.md:83`); `handle_new_auth_user`'s residual grant has no recorded
  rationale (P2 hygiene note, inert).

### `client_accept_invite` — verified correct and complete
- **[STATIC]** Sole definition `20260611090000_…:33` is `SECURITY DEFINER` with an
  `auth.uid()`-null guard + email-match; **[STATIC]** anon revoked at
  `20260702130000_…:52` (`REVOKE EXECUTE ON FUNCTION public.client_accept_invite(uuid) FROM
  anon;`), signature matches, tripwire `52_onboarding_audit_rpc_grants.sql`. **[LIVE]** it does
  **not** appear in the anon-executable set. The last-open item of the §4 sweep is genuinely
  closed.

### Table census — full RLS result (evidence for "no other table is unprotected")
- **[LIVE]** All 67 `public` tables except `audit_wide_column_config` have `rls_on=true`.
  Two carry FORCE RLS (`client_files`, `contacts`, `client_publications`, and the five
  `practice_*`/`physical_markers_*`/`test_*` tables show `rls_forced=true`).
  `password_recovery_tickets` shows `rls_on=true, policies=0` — [STATIC] a deliberate
  zero-policy default-deny (`20260527140000:111-131`), not a gap.
- **[LIVE]** 41 tables carry `organization_id`; the 26 without are child tables (tenancy via
  parent) or global/auth-adjacent — matches the classification in the untracked
  `57_…:34-40`.

### P2-3 — Audit-register hygiene (from [STATIC] `audit_resolve_org_id` latest def)
- **Phantom CASE entries:** `invitations`, `client_tags`, `client_tag_assignments` are in the
  resolver's CASE list (`20260629140000_client_medications.sql:131` region) but **no migration
  ever creates those tables**. Inert, but misleading. (The real invite table is `invite_tokens`,
  which is *not* registered.)
- **Latent misregistration:** `template_weeks` / `template_days` / `template_exercises` sit in
  the resolver's "row carries organization_id" branch but have **no** such column
  (`20260420101700:56-110`). Inert today (no audit triggers on them); a future trigger would
  write org-less audit rows silently instead of failing loud.
- **Unaudited newer tenant families:** [STATIC] the circuits family (`circuits`,
  `circuit_exercises`, `circuit_exercise_sets`) and session-templates family
  (`session_templates`, `session_template_exercises`, `session_template_exercise_sets`) created
  2026-06-24 got **neither** an audit trigger **nor** a resolver CASE entry — contrary to the
  repo convention (memory `project_audit_register_new_tables`; `client_medications`
  2026-06-29 correctly got both). Also unaudited: `contacts`, `session_types`,
  `communication_templates`, `note_template_fields`, `calendar_feed_tokens`,
  `message_notifications`, `section_titles`. These are programming/library/ops tables rather
  than direct clinical records, so severity is P2 pending an owner decision on audit scope —
  but it is a real drift from the stated convention and from master-brief §7.4.

---

## Area 3 — CLAUDE.md code standards (audited one by one)

### PASS — TypeScript throughout
- **[STATIC]** 0 JavaScript files in application source (`src/`, `supabase/functions/`). The 18
  JS-family files are all tooling/config (`eslint.config.mjs`, `postcss.config.mjs`, 16
  `scripts/*.mjs`) plus the PWA `public/sw.js` — conventional. Reference prototypes
  (`*.html`) are imported by nothing (only a doc-comment reference at
  `clients/[id]/notes/[noteId]/print/page.tsx:22`).

### PASS (letter) / P2 (spirit) — `any` usage
- **[STATIC]** **0** occurrences of `any` as a type across `src/` and `supabase/functions/`
  (every raw pattern hit was prose in comments). `@ts-ignore`: 0. `@ts-expect-error`: 4, all
  with same-line justification.
- **P2-4:** 34 `as unknown as` double-casts (the same escape hatch the rule targets, outside its
  letter; ~25 uncommented) — concentrated at Supabase join/RPC boundaries
  (`src/lib/testing/loaders.ts` ×9, `dashboard/page.tsx` ×5, `src/lib/testing/resolver.ts` ×3).
  Plus 2 uncommented `eslint-disable` lines (`schedule/_components/WeekView.tsx:1728`,
  `library/_components/ExerciseCard.tsx:46`). Suggest the standard name `as unknown as`
  explicitly, since it is the de-facto sanctioned escape.

### P1-1 — Design-token drift: stale superseded colour values rendering in live UI
- **[STATIC]** `src/app/(staff)/clients/[id]/_components/ReportsPanel.tsx:53-56` hardcodes
  `const MUTED = '#78746F'; const FAINT = '#9C9690'` — the **pre-darkening** values.
  `globals.css:24-25` records those colours were darkened; the live tokens are
  `--color-muted: #7a7166` and `--color-text-faint: #a09890`. `AnalyticsView.tsx:979` uses the
  same stale `#78746F`. These render *wrong* colours against the current design system today —
  not mere duplication, actual visual drift.
- **Standard breached:** *"Design tokens live in `src/app/globals.css` only … Components
  reference tokens, never raw values."* Severity P1 within the token rule because it produces a
  visibly-incorrect result, unlike inert re-typing.

### P2-5 — Design-token literals at scale (largely the recorded P2-13 deferral)
- **[STATIC]** Outside `globals.css`: 182 hex colours (43 files), 196 `rgb/rgba` (63 files), 46
  `boxShadow` literals (21 files), 283 `borderRadius` numeric literals, 435 `fontWeight`
  literals, 28 `rounded-[…]` arbitrary Tailwind (auth/onboarding pages).
- **Cross-ref:** this is the consciously-deferred **P2-13 "residual literals"** (scheduling §9,
  indexed in CLAUDE.md; re-trigger "a brand palette/radius change"). Two sub-observations worth
  a decision beyond the blanket deferral:
  - **84 off-scale radius literals** (values 6/5/4/12/17/18/9/2/3) sit outside the sanctioned
    radius set (14 / 10 / 8–10 / 7 / 999) — this violates *"No other radii"* as written, not
    just "inline a token."
  - The **overlay-shadow family** (~8 distinct popover/dialog elevations, e.g.
    `0 12px 40px rgba(0,0,0,.18)` ×10) has no token; the design system names *one* card shadow
    "and nothing else." Needs a one-time design-system ruling (sanction a tier, or tokenise),
    not 34 individual edits.
- **Note:** `globals.css` defines **no spacing or font-weight tokens**, so those two clauses of
  the standard are currently unsatisfiable — a token-set gap, not per-site negligence.

### PASS — Tailwind config matches tokens
- **[STATIC]** No `tailwind.config.*` (Tailwind v4). Tokens defined once in a single `@theme`
  block in `globals.css:9-80`. No second *config* duplicates values. Two *code* mirrors exist:
  `chart-shared.tsx:20-31` (documented, Recharts can't read CSS vars) and `ReportsPanel.tsx:53-56`
  (undocumented, and the drifted one — see P1-1). Architecture compliant; consolidate the
  ReportsPanel constants.

### PASS — runtime schema resolver; no direct JSON reads
- **[STATIC]** Resolver at `src/lib/testing/resolver.ts:91` (`resolveMetricSettings`,
  override-OR-default). The only runtime file-read of `physical_markers_schema_v1.1.json` is
  `src/lib/testing/schema-loader.ts:95-105` (`'server-only'`, used solely for the version-drift
  check), and the runtime *data* path reads the DB seed table. `scripts/generate-physical-
  markers-seed.mjs` reads the JSON at build-time (sanctioned). **Zero** direct JSON imports or
  hard-coded metric definitions elsewhere in `src/`. Minor P2: the loaders are re-exported from
  the public barrel (`index.ts:12-17`) — a doc comment, not structure, stops a future bypass.

### PASS — operational-state claims verified in code
- **[STATIC]** (a) `src/lib/email/client.ts:42-50` — `defaultFromAddress()` throws
  `EmailConfigError` when `EMAIL_FROM` unset, no sandbox fallback. (b)
  `supabase/functions/send-appointment-reminders/index.ts:108-113` — throws on missing
  `EMAIL_FROM` (→ HTTP 500); the sibling `send-message-notifications/index.ts:74-79` carries the
  same guard. (c) `src/lib/constants.ts:12` — `PRACTICE_TIMEZONE = 'Australia/Sydney'`, no
  design tokens in the file.

---

## Area 4 — Test & verification integrity

### Static checks (necessary, NOT sufficient — see standing caveat)
- **[LIVE/cmd]** `npm run type-check` (`tsc --noEmit`) → **exit 0**, no diagnostics (only an npm
  version notice).
- **[LIVE/cmd]** `npm run lint` (`eslint`) → **exit 0**, no output.
- **[LIVE/cmd]** `npm run build` (`next build`) → **exit 0**, full route table emitted.
- These prove compile/type/lint health only. The render tier and behavioural correctness are
  **not** covered (`go-live-checklist.md` §5b: render-tier is accepted-by-`build`+pgTAP+code-read
  for the f&f beta, not by automated browser). Do not read green here as a clean bill of health.

### pgTAP suite integrity
- **[STATIC]** 57 files present, consecutively numbered 00–56 (tracked) + untracked
  `57_cross_tenant_isolation_full.sql` (`git status` → `??`). All nine suites referenced across
  the polish docs exist and match their subjects: `17` (cross-tenant), `25` (portal grants),
  `26` (scheduling grants), `34` (message RLS), `46` (clients anon-denial), `49` (orphan appt),
  `51` (CMH OCC), `52` (onboarding/audit grants), `54` (anon table grants). Test `05` is
  statically operational (plan(43), uses the sanctioned FORCE-RLS fixture pattern, no dropped
  signatures) — the historically-flagged "test 05 fixture" issue is not open in
  `go-live-checklist.md` and the 2026-07-03 staging run was 56/56.
- **[NOT RUN]** The pgTAP suites were **not executed** in this pass (they mutate within
  `BEGIN…ROLLBACK`; running them is a behavioural check outside a read-only audit's remit). Their
  existence and wiring are confirmed statically; their *green* status is asserted by the polish
  docs (last full run 56/56 on staging 2026-07-03) and is [UNVERIFIABLE-FROM-CODE] today without
  a run.

### Maintenance rule (every new behaviour has a scenario) — PASS for recent commits
- **[STATIC]** The three most recent feature commits each ship scenarios in
  `test_scenarios_template.md`: rich-text notes (`a9ed592`) → `CN-RT-1..5`
  (`test_scenarios_template.md:1495+`); avatar-tone (`d67b806`) → `CL-AV-1..4`; set-grid
  autofill (`c013172`/`aad0ee1`) → `SB-AF-*`/`SB-CX-*`/`LIB-AF-*`/`LIB-CX-*`. 29 scenario-ID
  hits across those families. No shipped-without-scenario behaviour found in the recent set.

### P0-3 test gap (repeated from Area 2)
- No pgTAP asserts the `audit_wide_column_config` authenticated-write exposure; `54` covers anon
  only. A fix must land with a tripwire.

---

## Area 5 — Documentation integrity

### PASS — incident-response uses the Australian NDB scheme, not GDPR
- **[STATIC]** `docs/incident-response.md` uses the **Privacy Act 1988 / Notifiable Data
  Breaches** framing throughout: 72-hour clock (`:16`, `:112`, `:234`), OAIC notification
  (`:83`, `:258`), NDB "eligible data breach" (`:232`). No GDPR-standard timeline present.
  The prompt's flag condition (still-GDPR) does **not** apply — this is correct.

### P2-6 — `secrets-inventory.md` is stale against the code it catalogues
- **[STATIC]** Header `secrets-inventory.md:3` "Last updated: **2026-05-18**" contradicts body
  entries dated 2026-07-02/03.
- **[STATIC]** The `send-message-notifications` Edge Function (landed 2026-07-02) reads
  `RESEND_API_KEY`, `CRON_SHARED_SECRET`, `REMINDER_SERVICE_KEY`, `EMAIL_FROM`,
  `NEXT_PUBLIC_APP_URL` but is **not** listed as a consumer (the inventory names only
  `send-appointment-reminders`). Store count is still two; the consumer list is stale.
- **[STATIC]** `CRON_SHARED_SECRET` "Stored where" (`:57`) still says pg_cron **inline literal
  (not Vault)** — superseded by `20260701120000` (moved to Vault) and confirmed [LIVE]
  (`reads_vault=true`). The inventory's own §2 note is updated but the Section-1 entry is not.
- **[STATIC]** `VERIFY_EMAIL_DOMAIN` (read by `scripts/verify-auth-config.mjs`, present in
  `.env.local`) is absent from the inventory despite its "every env var the codebase reads"
  scope.

### P2-7 — `runbooks/rotate-a-secret.md` banner contradicts its own body
- **[STATIC]** The file's line-3 banner reportedly still states the `SUPABASE_SERVICE_ROLE_KEY`
  rotation is "NOT evidenced anywhere … an explicit TODO", while the same file's
  `SUPABASE_SERVICE_ROLE_KEY` section documents the procedure "run 2026-07-02". Self-contradiction;
  the banner is stale.

### P2-8 — CLAUDE.md `_program_for_date` staleness
- **[STATIC]** CLAUDE.md (§4 recon text) describes `_program_for_date` as *"still anon-reachable
  but read-only … NOT yet fixed."* The migrations disagree: `20260612150000:49-50` revokes it
  from **anon and authenticated**, and **[LIVE]** it does not appear in the anon-executable set.
  CLAUDE.md's own rule ("CLAUDE.md drift on operational state is a contamination risk for every
  subsequent polish-pass prompt") makes this worth correcting.

### P2-9 — Memory `project_secret_rotation_status.md` is stale (as the prompt warned)
- The memory's title still reads rotation-done-2026-05-17 as the headline; the body has been
  amended with the 2026-07-02 service-role/anon migration, but the leading claim is the one that
  misleads a naive reader. Confirmed the prompt's premise: this doc is a **claim**, and the
  underlying live-key state is [UNVERIFIABLE-FROM-CODE].

### P2-10 — `docs/external-reviews.md` does not exist
- **[STATIC]** `ls docs/external-reviews.md` → "No such file or directory". Referenced by
  `go-live-checklist.md` §0(a) and CLAUDE.md hard-rule (a) as the destination for the external
  IT-security review. **Not a beta gate** (that review is required only before a paying clinical
  client), so this is a P2 forward-pointer, not an open beta item — but the referenced artifact
  is absent and will need creating when that review happens.

---

## Could not verify from code alone (with the action that would verify each)

1. **Legacy Supabase anon + service_role JWT keys actually disabled at the gateway.** The
   entire secret-neutralisation gate and the inertness of finding P0-2 rest on this. *Verify:*
   Supabase dashboard → Settings → API Keys → legacy-keys tab shows *disabled*; or a `curl` to
   `/rest/v1/` presenting the legacy JWT expecting **401**. (The JWT is available in
   `.claude/settings.local.json` for the test.) Deliberately not performed — read-only audit.
2. **Old Resend key revoked at the Resend dashboard.** Docs claim checked 2026-07-03. *Verify:*
   Resend → API Keys shows exactly one key, created 2026-05-17.
3. **Vercel env values are the new-format keys across all environments.** Repo proves only the
   local `.env.local`. *Verify:* Vercel → Settings → Environment Variables value prefixes.
4. **Edge Function secret set holds the current `REMINDER_SERVICE_KEY` / `RESEND_API_KEY` /
   `CRON_SHARED_SECRET` / `EMAIL_FROM` / `NEXT_PUBLIC_APP_URL`.** *Verify:* `supabase secrets
   list` (digests) + the runbook synthetic-send check asserting `succeeded ≥ 1`.
5. **pgTAP suites are green today.** Existence/wiring confirmed statically; the last recorded
   full run was 56/56 on staging 2026-07-03. *Verify:* run `scripts/run-pgtap-staging.sh`
   (staging) or the `BEGIN…ROLLBACK` path on prod.
6. **The DR backup restore actually works.** The whole point of the open gate. *Verify:* run the
   `docs/disaster-recovery.md` drill after the Pro upgrade and log a real run-log row.
7. **Behavioural/render correctness of any shipped surface.** Static green ≠ working UI
   (`go-live-checklist.md` §5b). *Verify:* an authenticated `:3000` walkthrough of the affected
   flow — the project's actual acceptance gate.

---

## Ranked P0 list (address in this order — no action taken here)

1. **Verify the legacy-key gateway disable actually holds** (Unverifiable-item #1). It is the
   load-bearing control behind both the closed secret-rotation gate and the on-disk-JWT
   exposure. 5-minute dashboard/curl check. If it fails, everything below is secondary.
2. **P0-2 — scrub the leaked legacy `service_role` JWT** from `.claude/settings.local.json:132-138`
   and the four worktree copies. Removes the secondary plaintext copy of a full-DB credential.
3. **P0-3 — enable RLS (or revoke authenticated DML) on `audit_wide_column_config`** and land a
   pgTAP tripwire. The only unprotected table in the schema, authenticated-writable, audit-
   integrity impact. Cheap to fix pre-data.
4. **P0-1 — run the DR backup-restore drill** — the one open Beta-entry gate item. Blocked until
   the Supabase Pro upgrade; execute the written recipe immediately after and log the result.
   Do not treat the beta gate as clear until then.

*End of report. No files other than this one were modified; no git state changed; nothing was
staged, committed, or fixed.*
