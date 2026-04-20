# Service Level Objectives

**Project:** Client Platform — EP clinical + programming SaaS
**Version:** 0.1 (Gate 2 — awaiting IT-advisor review)
**Date:** 2026-04-20
**Status:** Design document. Instrumentation exists nowhere yet.

---

## 0. How to read this document

SLOs are the contract we hold ourselves to. Every number in this document is either hit or missed — there is no "mostly." If we cannot measure the SLO, it is not an SLO.

Sections:
1. What SLOs are for
2. Service Level Indicators (SLIs) and Objectives (SLOs)
3. Error budgets
4. Measurement tooling
5. Alerting
6. Breach response
7. Reporting cadence
8. Cross-references

---

## 1. What SLOs are for

**SLOs are NOT about hitting 100% everything.** A platform operated by a single EP who also sees patients cannot respond to every blip. SLOs define:
- What "good enough" looks like for each axis of quality.
- How much degradation the operator tolerates before changing behaviour (deploying a fix, calling Supabase, notifying clients).
- What signals wake the operator up at night, and what signals wait until morning.

**SLOs for this platform balance two realities:**
1. Clinical data integrity is non-negotiable — data durability must be 100%.
2. The operator is one person who also treats patients — availability and latency can tolerate slack.

---

## 2. SLIs and SLOs

Each service level indicator (SLI) is a measurable signal. Each SLO is the target for that signal over a rolling 30-day window.

### 2.1 API availability

**SLI.** `successful_http_responses / total_http_responses` where successful = status code < 500 and responses are served within 30 seconds. Measured at the Vercel edge for `/dashboard/**`, `/portal/**`, and `/api/**` routes.

**SLO.** 99.5% over any rolling 30-day window.

**Error budget.** (1 - 0.995) × 30 days = 3 hours 36 minutes of downtime or elevated 5xx rate per month.

**Rationale.** Three hours of downtime per month is generous by SaaS standards but appropriate here — a solo operator cannot respond to a weekend outage while treating a client. Higher than 99.9% would create a false promise; we would miss it the first month and then every reported SLO breach loses the team's trust.

**Exclusions.**
- Scheduled maintenance windows announced to users 48 hours in advance (cap: 2 hours/month).
- Outages originating in the Vercel or Supabase control plane (their availability SLA applies, not ours, but we report both).

### 2.2 Data durability

**SLI.** Rows written to the database that remain readable after all backup/restore cycles. Measured by monthly restore drills (per `/docs/incident-response.md`).

**SLO.** 100%. No acceptable data loss.

**Error budget.** Zero. Any data-loss event is an S0 incident.

**How we reach 100%:**
- Supabase Pro point-in-time recovery (7-day retention, 2-second granularity).
- Nightly logical backups retained 30 days (Supabase default on Pro).
- Weekly S3 exports to a separate AWS account in ap-southeast-2, lifecycle-archived to Glacier at 1 year.
- Monthly restore drill confirming data integrity.
- `audit_log` table is append-only with external shipping; a database-wide corruption event is reconstructible from the audit stream.

### 2.3 API latency (p95)

**SLI.** 95th percentile of response time for all authenticated API routes, measured over a rolling 30-day window.

**SLO.** p95 < 500 ms.

**SLO breach threshold.** p95 between 500 ms and 1 s = amber (investigate this week). p95 > 1 s = red (fix this sprint). p95 > 3 s sustained for an hour = page immediately.

**Rationale.** A session builder where the EP waits 2 seconds per exercise swap is a design failure. Fast defaults.

**Breakdowns we track:**
- p50, p95, p99.
- Per-route (dashboard loads, session builder saves, appointment creates).
- Server action vs route handler.

### 2.4 Login success rate

**SLI.** `successful_logins / attempted_logins` excluding explicit user errors (wrong password counts as success-for-availability even though it failed for the user — the system worked).

Specifically:
- **Success:** 2xx from `/auth/v1/token?grant_type=password` and subsequent JWT issued with valid custom claims.
- **Failure:** 5xx from auth endpoint, JWT hook failure, or infrastructure timeout.
- **Excluded:** 401 from wrong credentials (not an availability failure).

**SLO.** 99.9% over a rolling 30-day window.

**Rationale.** Login is the one endpoint where a failure means a user cannot use the product at all. Tighter target than general API availability.

### 2.5 Email / SMS delivery rate

**SLI.** `delivered_messages / sent_messages` where delivered = provider reports delivery within 10 minutes.

**SLO.** 99% for email (Resend), 98% for SMS (Twilio). SMS is lower because carrier-level filtering is opaque.

**Breach threshold.** < 95% for either channel over 7 days = incident.

**Rationale.** Appointment reminders that do not arrive cause no-shows; SOAP notes emailed to a GP that do not arrive cause clinical follow-up delays.

### 2.6 Audit log integrity

**SLI.** Every mutation on a table in the audited-set produces a corresponding `audit_log` row within 1 second.

**SLO.** 100% — an audit log gap is an incident, not a statistic.

**Measurement.** A background check runs hourly:
1. SELECT count of rows in audited tables created/updated/deleted in the last hour.
2. SELECT count of audit_log rows for those operations.
3. Compare. Gap > 0.1% = page.

The check runs as a service-role Edge Function and records its results in a `slo_checks` table.

### 2.7 Backup recency

**SLI.** Hours since last successful backup across each backup stream (PITR, nightly logical, weekly S3).

**SLO.**
- PITR: continuous (< 15 minutes lag).
- Nightly logical: within 26 hours (2-hour buffer on 24-hour cadence).
- Weekly S3: within 8 days.

**Breach threshold.** Double the SLO window on any stream = incident.

### 2.8 RLS violation signal

**SLI.** Count of events where:
- A request returned rows spanning more than one `organization_id` for a non-owner user.
- A request authenticated as a client returned a `client_id` different from their own.
- A `cross_org_fk_violation` trigger fired.

**SLO.** Zero. Any event = S0 incident (potential data breach).

**Measurement.** Logged to Sentry with a dedicated tag; alerts configured (§5).

---

## 3. Error budgets

### 3.1 How the budget works

Availability SLO: 99.5% over 30 days = 3h 36m of allowable downtime per month.

If we spend more than the budget, we:
- Freeze non-critical feature deploys until the rolling window recovers.
- Investigate the root cause as a post-incident review.
- Communicate with users if the budget is blown by more than 50%.

If we consistently leave the budget unspent (< 20% consumed over three consecutive months), we:
- Re-evaluate whether the SLO is too loose.
- Consider raising to 99.7% in the next quarter.

### 3.2 What counts against the budget

- Any minute where the availability SLI is below 99.5% for that minute.
- Any incident with customer impact (client reported inability to log in, book, log a session, view a report).

### 3.3 What does NOT count against the budget

- Degraded third-party provider (Resend, Twilio) that does not affect core app — those have their own SLOs (§2.5).
- Scheduled maintenance per §2.1.
- Browser-side issues (a user's bad network).

### 3.4 Recording budget consumption

A monthly report in `/reports/slo-<yyyy-mm>.md` tracks:
- Minutes of availability breach.
- p95 latency distribution.
- SLO budget consumed (percent).
- Incident summaries.

Generated from Sentry + Supabase + Better Stack data on the first Monday of the following month.

---

## 4. Measurement tooling

### 4.1 Services

| Signal | Tool | Tier |
|---|---|---|
| HTTP availability, response codes, latency | Vercel Analytics + Better Stack external probes | Free |
| Errors, stack traces, tags | Sentry | Free (5k errors/month) — upgrade if breached |
| Structured logs | Axiom (Supabase log drain target) | Free (0.5 TB/month) |
| Synthetic uptime checks | Better Stack | Free (10 monitors) — SMS alerts to operator |
| Database metrics | Supabase dashboard | Built-in |
| Email delivery stats | Resend dashboard | Built-in |
| SMS delivery stats | Twilio console | Built-in |

All chosen so total cost for observability is under $30 AUD/month while coverage is comprehensive. Spend scales with revenue; does not scale in v1.

### 4.2 What we instrument

**Every server action** emits a log line with: `duration_ms`, `status` (`ok` / `conflict` / `denied` / `error`), `actor_user_id`, `organization_id`, `request_id`, `action_name`. Durations exceeding 1 second log at warning level; exceeding 3 seconds at error level.

**Every database trigger failure** (cross-org FK violation, audit log write failure, etc.) emits a log line with trigger name and the offending row_id.

**Every auth event** (§11 of `/docs/auth.md`) is logged to Sentry + Axiom with the structured fields listed there.

**Every external call** (Resend, Twilio, Supabase admin API) logs its result with provider, duration, and outcome.

### 4.3 What we do NOT instrument

- Individual queries — we rely on Postgres' own pg_stat_statements accessed through Supabase dashboard.
- Per-keystroke events in the UI — that is product analytics, not reliability.
- PII in log bodies — Sentry `beforeSend` strips known PII fields; logs are structured around IDs, not content.

### 4.4 PII hygiene in observability

- No clinical note content ever lands in a log or error.
- No raw email addresses in Sentry (hash on emit, or log the user_id).
- No client names; only IDs.
- Exception: the audit log (internal to Postgres) contains full row snapshots subject to §11.4 of `/docs/schema.md`.

---

## 5. Alerting

Tiered by urgency. Every alert has a named playbook in `/docs/incident-response.md`.

### 5.1 Page immediately (SMS + push)

| Signal | Source | Playbook |
|---|---|---|
| Any RLS violation signal (§2.8) | Sentry | IR-01 |
| Data durability event (restore drill fails) | Axiom | IR-02 |
| API availability < 99% over 15-minute window | Better Stack | IR-03 |
| JWT hook failure rate > 1% over 5 minutes | Sentry | IR-04 |
| Audit log write failure | Trigger alert → Sentry | IR-05 |
| Health check endpoint failing for > 5 minutes | Better Stack | IR-03 |
| p95 latency > 3s sustained 15 minutes | Better Stack | IR-06 |

### 5.2 Notify within business hours (email)

| Signal | Source |
|---|---|
| p95 latency > 1s over rolling hour |
| Email delivery rate < 98% over 24 hours |
| SMS delivery rate < 95% over 24 hours |
| Backup recency SLO breach (PITR > 30m lag) |
| Login success rate < 99.5% over 6-hour window |
| Error budget > 50% consumed mid-month |

### 5.3 Weekly review

Signals that don't page but inform the weekly review cadence:
- SLO budget consumption for the rolling window.
- Slow query list from pg_stat_statements.
- Audit log table growth rate.
- Sentry error trends.

---

## 6. Breach response

When an SLO is breached, the operator (sole EP) follows a scripted response. Full playbooks live in `/docs/incident-response.md`; this section defines the framing.

1. **Acknowledge** — silence the page, open the incident playbook.
2. **Mitigate** — take immediate action per playbook (roll back deploy, failover, page vendor).
3. **Communicate** — post to `/status` endpoint within 30 minutes if customer-visible.
4. **Resolve** — the SLI returns to target.
5. **Post-incident review** — within 7 days, blameless postmortem in `/reports/pir-<yyyy-mm-dd>.md`.

---

## 7. Reporting cadence

| Cadence | What |
|---|---|
| Real-time | Better Stack status page (linked from `/status`) |
| Weekly | Internal review of SLI distributions, slow queries |
| Monthly | Formal SLO report `/reports/slo-<yyyy-mm>.md` — budget consumption, incidents, trends |
| Quarterly | SLO recalibration — are targets still appropriate? |
| Annually | Disaster recovery test documented + reviewed with advisor |

---

## 8. What v1 does NOT measure

Listed so the advisor knows what is deferred, not forgotten:

- **Apdex score** — more nuanced than p95 but overkill for v1.
- **Per-endpoint burn rate alerts** — single rollup is sufficient at current scale.
- **User-perceived latency (RUM)** — Vercel Analytics gives us this; we rely on it without building bespoke instrumentation.
- **Capacity forecasting dashboards** — the `/docs/scaling-checklist.md` (Gate 3) tracks capacity metrics manually.
- **Custom SLO dashboards (e.g., Grafana + Prometheus)** — observability stack is cloud-hosted free tiers. No infra to maintain.

---

## 9. Cross-references

- Schema and audit log: `/docs/schema.md`
- Auth event instrumentation: `/docs/auth.md`
- Playbooks and incident response: `/docs/incident-response.md`
- Backup and restore procedures: `/docs/disaster-recovery.md` (Gate 3)
- Capacity scaling triggers: `/docs/scaling-checklist.md` (Gate 3)
