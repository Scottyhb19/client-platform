# Disaster recovery — backup restore drill

**Status:** **GATE MET — first drill run and PASSED 2026-07-21** (see run log). The Supabase Pro upgrade landed 2026-07-21; the drill ran the same day against a Pro daily backup, the census matched production, and the scratch project was torn down. Because real f&f users had logged in from 2026-06-10 while the drill was plan-blocked, the ~41-day gap is recorded as an exposure window in `incident-response.md` §10 (per the CLAUDE.md Beta-entry rule), not waved through. Backup posture in force: Pro daily backups, 7-day retention; **PITR deliberately deferred to the paying-client gate** (operator decision 2026-07-21, recorded in `slos.md` §2.2). Re-run this drill on any backup-infrastructure change (e.g. enabling PITR).

**Why this exists.** "Backups exist" and "we have restored from one" are different claims. A backup you have never restored is a backup you do not know works. This drill restores a real backup to a **throwaway project** (non-destructive to production), confirms the data is intact, and records the result.

Companion docs: `slos.md` (RPO/RTO targets), `incident-response.md` (what to do in a real event). This doc is the *rehearsal*.

---

## Prerequisite — confirm the plan (do this first)

The clean, non-destructive drill below ("Restore to a New Project") requires a **paid plan (Pro or above) with physical backups / PITR enabled**.

- **Check:** Supabase → Settings → **Billing** (plan tier) and Settings → **Database → Backups** (is there a "Restore to a New Project" tab and/or a PITR selector?).
- **Pro:** last 7 days of daily backups; PITR (if enabled) adds seconds-level granularity.
- **Free plan:** the "Restore to a New Project" dashboard feature is **not available**, and this machine has no local Postgres tools (`pg_restore`/`psql`) for the download-and-restore alternative. So on Free, the practical path is: **enable Pro + physical backups first** (this is also the go-live "PITR" item in `go-live-checklist.md`), then run the drill. Do not mark this gate met on a hand-wave.

If the plan check shows you cannot run the drill yet, stop here and record that the prerequisite (Pro + physical backups) is the blocker — that is a real finding, not a skip.

---

## The drill — "Restore to a New Project" (non-destructive)

1. Supabase Dashboard → your **production** project → **Database → Backups**.
2. Open the **"Restore to a New Project"** tab. Available backups are listed (plus a PITR date/time selector if PITR is on).
3. Pick a recent backup — today's daily backup, or a PITR point a few minutes ago. Click **Restore**.
4. Supabase provisions a **new (scratch) project** from that backup. Wait for it to finish (duration scales with DB size; yours is small, so minutes). Your production project is untouched.
5. The scratch project appears in your dashboard with all data, tables, schema, and RLS policies from the chosen backup.

---

## Verify the restore is real (not empty or partial)

On the **scratch** project's SQL Editor, run this census, then run the identical query on **production** and compare:

```sql
-- [dr-drill] row census — run on BOTH scratch and production, compare
SELECT
  (SELECT count(*) FROM organizations)         AS orgs,
  (SELECT count(*) FROM user_organization_roles) AS memberships,
  (SELECT count(*) FROM clients)               AS clients,
  (SELECT count(*) FROM programs)              AS programs,
  (SELECT count(*) FROM appointments)          AS appointments,
  (SELECT count(*) FROM audit_log)             AS audit_rows,
  (SELECT count(*) FROM pg_policies)           AS rls_policies;
```

Pass conditions:
- Counts on the scratch project **match** production (allowing for rows created *after* the backup point — the scratch should be equal or slightly lower, never empty).
- `rls_policies` is non-zero (schema + security came across, not just raw tables).
- Spot-check real content, e.g. `SELECT name FROM organizations LIMIT 5;` — you should see your actual org name(s), not empty rows.

If the scratch project is missing tables, has zero rows where production has data, or has no RLS policies, the restore is **not** healthy — record it as a failure and raise it (this is a genuine DR finding).

---

## Teardown (do not skip — a scratch project bills while it exists)

1. Once verified, delete the scratch project: Supabase → the **scratch** project → Settings → **General → Delete Project**.
2. Confirm it is gone from your project list.
3. (If PITR/physical backups were enabled *only* for this drill and you do not intend to keep them, revisit that decision deliberately — for the go-live gate you likely want them kept on.)

---

## Record the result

Add a dated line to the run log: the backup point you restored from, whether the census matched, and any issues. That line is what closes the gate — not this document existing.

## Run log

| Date | Plan / backup type | Restored from | Census match | Result / notes |
|---|---|---|---|---|
| 2026-07-21 | Pro / daily backup (first drill, day of the Pro upgrade) | Most recent daily backup → scratch project "OdysseyHQ" | **YES** — orgs 7, memberships 18, clients 14, programs 41, appointments 136, RLS policies 282 all exactly matched prod; audit_rows 12002 vs 12528 (scratch slightly lower = rows written after the backup point, expected) | **PASS.** Spot-check on scratch returned the real org names (operator-confirmed). Scratch project deleted same day (teardown confirmed). This run closes the final Beta-entry hardening gate item; the pre-drill exposure window (2026-06-10 → 2026-07-21) is recorded in `incident-response.md` §10. |
