# Incident Response Runbook

**Project:** Client Platform — EP clinical + programming SaaS
**Version:** 0.1 (Gate 2 — awaiting IT-advisor review)
**Date:** 2026-04-20
**Status:** Design document. Contacts and drill records are placeholders until real on-call is established.

---

## 0. How to read this document

You are the operator. An alert has fired, or a client has just told you something is wrong. This document tells you what to do.

Read §1 (severity) first. Find the matching playbook in §5. Execute. Fill in §7 afterwards.

If the incident might be a **data breach under the Privacy Act 1988**, go directly to **§6 (Notifiable Data Breach)** — a 72-hour clock starts when you become aware.

Sections:
1. Severity classification
2. Roles and responsibilities
3. Communication channels
4. Contacts
5. Playbooks by incident type
6. Privacy Act 1988 notifiable data breach procedure
7. Post-incident review
8. Appendix — templates

---

## 1. Severity classification

| Severity | Meaning | Examples | Response time |
|---|---|---|---|
| **S0** | Data loss, exposure, or integrity compromised | Cross-tenant leak, audit log gap, confirmed data loss | **Drop everything. Respond within 15 minutes.** |
| **S1** | Product broadly unavailable | Auth broken, database down, > 50% of users cannot log in | Respond within 30 minutes. |
| **S2** | Product degraded but usable | p95 > 3s, one feature broken (scheduling, reports), email delivery < 95% | Respond within 2 hours business hours. |
| **S3** | Minor issue, workaround available | Cosmetic bug, isolated user issue | Respond same day or next business day. |

An S0 is always a potential Privacy Act breach event (§6) until investigation rules it out.

---

## 2. Roles and responsibilities

In v1 there is one operator who holds every role. When the team grows, split these.

| Role | Held by (v1) | Responsibilities |
|---|---|---|
| Incident Commander | Operator | Decides severity, coordinates response, makes the call to communicate externally |
| Technical lead | Operator | Executes the fix |
| Communications lead | Operator | Posts to `/status`, emails affected users, drafts OAIC notification |
| Scribe | Operator (post-hoc) | Writes the post-incident review |

**Solo-operator implication:** during an S0/S1 with a patient in the clinic, the operator's first action is to end the clinical session safely (not mid-exercise, not mid-assessment) before switching to incident response. Patient safety precedes SaaS reliability.

---

## 3. Communication channels

| Channel | Purpose |
|---|---|
| `/status` (static page) | Public-facing status. Updated within 30 minutes of an S0/S1. |
| Email to affected clients | Sent when downtime > 1 hour OR when a breach is confirmed. Templates in §8. |
| `#incidents` in personal Slack / Notion | Internal log — every step recorded. Timestamps matter. |
| Phone (operator) | For paging third parties (Supabase support, Vercel support, legal advisor). |

During an S0, do NOT post to public social channels until the incident is resolved AND legal notification (if applicable) has been made.

---

## 4. Contacts

These are placeholders. The operator maintains the live list in a password manager and prints a physical backup stored at the clinic. Contact details are NOT stored in this git-tracked file.

| Role | Who | When to call |
|---|---|---|
| Supabase support (paid tier) | See password manager | Database unavailable > 30 min; data integrity concerns |
| Vercel support | See password manager | Deployment platform unavailable |
| Resend support | See password manager | Email delivery failures |
| Twilio support | See password manager | SMS delivery failures |
| Legal advisor (Privacy Act) | See password manager | Any suspected notifiable breach — BEFORE publishing communications |
| Primary IT advisor | See password manager | Any S0/S1 decision needing a second opinion |
| OAIC (Office of the Australian Information Commissioner) | oaic.gov.au / 1300 363 992 | Notifiable data breach — within 72 hours (§6) |

---

## 5. Playbooks

### IR-01 — RLS violation / cross-tenant data access

**Triggered by:** Sentry alert on `auth.cross_tenant_access_attempt`, or a user report ("I can see someone else's data").

**This is potentially an S0 and potentially a notifiable data breach. Treat as both until proven otherwise.**

1. **Acknowledge the page.** Open this playbook.
2. **Capture evidence.** Before changing anything:
   - Take screenshots of the user's screen if they reported verbally.
   - Copy the Sentry event payload, including the request ID.
   - Query `audit_log` for all rows associated with the request_id and the affected user(s).
3. **Scope the exposure.**
   - Query: *what rows did the affected session access?*
     ```sql
     SELECT table_name, row_id, action, changed_at
     FROM audit_log
     WHERE request_id = '<id>'
     ORDER BY changed_at;
     ```
   - Identify: which org was accessed, which clients, which tables.
4. **Contain.**
   - If a user is actively exploiting, revoke their session: `UPDATE auth.users SET banned_until = '9999-12-31' WHERE id = '<user>'` (service role).
   - If the exposure is via a specific buggy code path, disable the feature flag or revert the deploy.
5. **Assess.** Was PHI of a living patient exposed to an unauthorized person? If yes → §6 applies. Start the 72-hour clock (record the timestamp in the incident doc).
6. **Call the legal advisor.** Do this before any external communication.
7. **Root cause.** Review the failing RLS policy. Write a pgTAP test that reproduces the bug. Only merge a fix with the test in place.
8. **Communicate** per §6 if breach confirmed.
9. **Post-incident review.**

### IR-02 — Data loss

**Triggered by:** monthly restore drill fails; a table query unexpectedly returns fewer rows than audit_log indicates.

**This is an S0.**

1. **Stop writes to the affected table** if possible (disable the feature, revert a deploy).
2. **Snapshot current state.** Take a full logical dump of the affected table NOW, before any recovery.
3. **Identify the last known good state.** Cross-reference `audit_log` entries with current rows. Find the timestamp after which rows went missing.
4. **PITR restore to a scratch project.** Supabase Pro PITR allows restore to any point in the last 7 days:
   - Create a new Supabase project (scratch).
   - Use dashboard → Database → Point in Time Recovery → restore at target timestamp.
   - Wait 10-30 minutes.
5. **Extract missing rows** from the scratch project. Copy to main project via `INSERT INTO ... SELECT ... FROM scratch_project.*`.
6. **Verify integrity.** For every recovered row, confirm audit_log has the matching history.
7. **Investigate root cause.** A data-loss event without operator action is either a Supabase infrastructure issue (call support) or a bug (find it).
8. **Run a fresh restore drill** to confirm the recovery procedure itself works.

### IR-03 — Database unavailable / complete Supabase outage

**Triggered by:** health check endpoint 5xx for > 5 minutes; user reports of "nothing works."

1. **Check Supabase status page** (status.supabase.com). If it's a Supabase incident, you are a passenger.
2. **Update `/status`** — "Platform temporarily unavailable. We are monitoring provider status."
3. **If > 30 minutes**, email affected clients a brief note (template §8.1). Prioritize clients with appointments today.
4. **If > 2 hours**, call Supabase support.
5. **If the outage appears to be regional** (only ap-southeast-2), consider whether to fail over to a backup project. v1 does NOT have a pre-configured failover; the procedure is:
   - Provision a new Supabase project in a different region.
   - Restore the most recent backup.
   - Update Vercel env vars to point at the new project.
   - DNS changes not required.
   - **Expected RTO for this manual failover: 3-6 hours.** This is documented, not comfortable. If this becomes an expected operation, budget for a warm standby in Phase 4.

### IR-04 — Auth broken

**Triggered by:** `auth.jwt.hook_failure` rate > 1% over 5 minutes; users cannot log in.

**Most common cause:** a migration changed `user_organization_roles` in a way the custom token hook does not handle; the hook raises.

1. **Roll back the most recent migration** if deployed in the last 24 hours.
2. **Check the hook function** — call it directly:
   ```sql
   SELECT auth_hooks.custom_access_token(
     jsonb_build_object(
       'user_id', '<a valid user id>',
       'claims', '{}'::jsonb
     )
   );
   ```
3. **If the hook raises**, read the error. Common causes:
   - Renamed column referenced by the hook.
   - NULL where NOT NULL was assumed.
   - Changed enum value.
4. **Patch in Supabase dashboard TEMPORARILY** — the hook can be edited there to stop the bleed. This is the ONE place where "edit in dashboard" is acceptable, because it restores service; the edit is then re-codified as a migration in the next 24 hours.
5. **Communicate.** Users with existing sessions continue to work; users trying to log in cannot. Post to `/status`.

### IR-05 — Audit log write failure

**Triggered by:** trigger error captured in Sentry; audit_log rows missing.

1. **Stop PHI writes** if possible — an untracked write is a compliance gap.
2. **Query:** count mutations on audited tables vs audit_log rows for the last hour.
3. **Investigate.** Likely causes:
   - `audit_writer` role permissions changed.
   - Storage full on audit_log table.
   - Trigger function errored on an edge case.
4. **Restore function** to the last known good version (via migration revert).
5. **Backfill missing audit entries** from application logs if possible (every server action logs its mutation). This does NOT replace the trigger-level audit but provides a best-effort reconstruction.
6. **Consider Privacy Act implications.** A gap in the audit log is a compliance concern. Document and discuss with legal advisor.

### IR-06 — Degraded performance

**Triggered by:** p95 > 3s sustained 15 minutes; user reports of slowness.

1. **Check Supabase dashboard** — look for long-running queries, high CPU, connection pool exhaustion.
2. **`pg_stat_statements`** — identify the top 5 queries by total time in the last hour.
3. **If one query dominates** — it is likely a missing index or a broken query plan.
   - EXPLAIN the slow query.
   - Add an index if the plan is obvious.
   - Roll back the recent migration if it coincides.
4. **If CPU-bound** — a runaway loop somewhere. Check server action logs for an action called hundreds of times per minute.
5. **If connection-pool-bound** — add connection pooling if not already using PgBouncer (Supabase has it built in by default; confirm usage).
6. **Communicate** if user impact is confirmed.

### IR-07 — Email / SMS delivery broken

**Triggered by:** Resend/Twilio delivery rate below SLO; user reports of missed reminders.

1. **Check provider dashboards** for error codes, account health, billing status.
2. **If provider is healthy** — check our outbound: are we hitting the rate limit? Did an API key rotate without the app knowing?
3. **If our domain reputation is the issue** — an anti-spam flag on Resend means appointment reminders fail. Coordinate with Resend support; consider backup provider (SendGrid) as a fallback if this recurs.
4. **Notify affected clients personally** if appointments coming up have unsent reminders. This is a manual phone call in the worst case.

### IR-08 — Ransomware / malicious deletion by insider

**Triggered by:** mass mutations detected in audit_log; suspicious login from new geography; physical device theft.

**This is an S0 regardless of apparent impact.**

1. **Disable all sessions** — Supabase dashboard → Users → sign out all users. Yes, this logs out legitimate users. Acceptable during an incident.
2. **Reset API keys** — rotate Supabase anon key and service role key; update Vercel env vars.
3. **Snapshot backups immediately** — take a fresh backup before any cleanup (preserve forensic evidence).
4. **Engage legal advisor.**
5. **Review audit log** — every action by the compromised actor in the last 30 days.
6. **Restore from a known-good point-in-time** if malicious changes are confirmed (IR-02 procedure).
7. **Notify affected clients** if data exposure is possible.
8. **Report to law enforcement** if criminal activity is suspected (ACSC — 1300 CYBER1).

---

## 6. Privacy Act 1988 notifiable data breach procedure

The Notifiable Data Breaches (NDB) scheme applies to any "eligible data breach" — unauthorized access, disclosure, or loss of personal information likely to result in serious harm. Health information triggers the threshold quickly.

**The 72-hour clock starts when the operator becomes aware of the likely eligibility.**

### 6.1 Assessment — is this an eligible breach?

Four conditions, all of which must be true:
1. Unauthorized access, disclosure, or loss of personal information held by us.
2. Likely to result in serious harm to one or more individuals (physical, psychological, financial, reputational — health information almost always qualifies).
3. Remedial action cannot prevent serious harm.
4. The breach cannot be adequately contained.

**If ANY doubt**, treat as eligible and proceed. Over-notification is recoverable; under-notification is not.

### 6.2 Within 72 hours — the checklist

1. **Record the time of awareness.** This is the start of the clock.
2. **Engage the legal advisor.** Confirm assessment.
3. **Draft the OAIC notification.** Template §8.2. It must contain:
   - Our contact details.
   - Description of the breach.
   - Kinds of information involved.
   - Recommendations for affected individuals to protect themselves.
4. **Notify affected individuals.** In parallel with OAIC. Template §8.3.
   - Direct notification preferred — email or phone.
   - Indirect notification (website notice) only if direct is not practicable.
5. **Submit OAIC notification.** Via oaic.gov.au online form.
6. **Record submission.** Date, time, confirmation number.
7. **Do NOT publish on social media** until OAIC submission is complete.

### 6.3 After the 72 hours

- Continue investigation and remediation.
- Additional notifications if new affected parties are identified.
- Regulator may request further information — respond within stated timeframes.
- Review whether the breach was reportable to other regulators (state health departments, AHPRA for any registered practitioner involvement).

### 6.4 Documentation

Every step of §6 is recorded in the incident file. The incident file itself is retained for 7 years under general Privacy Act record-keeping requirements.

---

## 7. Post-incident review

Within 7 days of any S0 or S1. Within 14 days for S2.

Template:

```markdown
# Post-Incident Review: <title>

## Timeline
- HH:MM — <event>
- HH:MM — <event>
...

## Impact
- Users affected: <count>
- Data exposure: <none | <description>>
- SLO budget consumed: <minutes>
- Privacy Act status: <not applicable | notified | investigating>

## Root cause
<narrative, not "operator error">

## Contributing factors
- <systemic issue 1>
- <systemic issue 2>

## What worked
- <response strength 1>
- <response strength 2>

## What didn't
- <response gap 1>
- <response gap 2>

## Action items
- [ ] <concrete, owner-assigned, dated>

## Lessons for the runbook
- Playbook IR-XX update: <change>
```

Reviews are blameless — the question is never "who made the mistake" but "what in the system made the mistake possible."

Action items go into the project backlog with explicit owners and dates. Completion tracked in the next monthly SLO report.

---

## 8. Appendix — Templates

### 8.1 Client notification — brief downtime

```
Subject: <Practice Name> — temporary booking/portal outage

Hi <Name>,

The client portal is temporarily unavailable this morning. I'm aware and working to restore access.

Your appointment at <time> today is unaffected — please attend as usual. If you need to reach me urgently, call <number>.

I'll send a follow-up once the portal is back online.

<EP name>
```

### 8.2 OAIC notification — template

```
To: Office of the Australian Information Commissioner
Subject: Notifiable Data Breach — <Practice Name>

Entity details:
  Name: <Practice Name>
  ABN: <abn>
  Contact: <operator name, role, email, phone>

Breach details:
  Date of breach: <date or range>
  Date of awareness: <date>
  Date of this notification: <date>

Description of breach:
  <plain-language narrative>

Information involved:
  <list the categories: names, dates of birth, health information, ...>

Individuals affected:
  <count; cohort description>

Actions taken to contain:
  <concrete steps>

Recommendations for affected individuals:
  <what they should do>

Signed: <operator name>
```

### 8.3 Affected-individual notification — template

```
Subject: Important notice regarding your personal information

Dear <Name>,

I am writing to let you know about a security incident that may have affected your personal information held at <Practice Name>.

What happened:
  <plain-language>

What information was involved:
  <list>

What we are doing about it:
  <concrete steps>

What you can do:
  <concrete advice — change password, watch for suspicious contact, etc.>

I have reported this incident to the Office of the Australian Information Commissioner in accordance with the Privacy Act 1988.

I am deeply sorry this has happened. If you have questions or concerns, please contact me directly on <phone> or reply to this email.

<EP name>
```

---

## 9. Cross-references

- Schema (including audit log): `/docs/schema.md`
- Auth flows: `/docs/auth.md`
- RLS policies (what "unauthorized" means in this system): `/docs/rls-policies.md`
- SLOs and alerting (what fires an incident): `/docs/slos.md`
- Backup and restore procedures (detailed IR-02, IR-08 recovery steps): `/docs/disaster-recovery.md` (Gate 3)
