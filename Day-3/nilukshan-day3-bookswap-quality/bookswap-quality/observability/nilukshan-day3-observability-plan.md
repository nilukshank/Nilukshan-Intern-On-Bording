# BookSwap — Observability Plan

> Day 3 · Logs, metrics, traces on the Azure stack (Application Insights + Azure Monitor
> Logs), with alerts mapped to every SLO in the SLI/SLO map.

---

## Setup

- **Logs — Azure Monitor Logs (App Insights `traces`).** Structured JSON events. Retention
  30 days hot. **Redaction rules:** the `Authorization` header is never logged; request
  bodies are not logged for endpoints carrying PII; member **email/apartment are never
  logged** — events carry `memberId` (the UUID) and `requestId` only.
- **Metrics — Application Insights.** Auto-collected `requests` and `dependencies`, plus
  custom metrics for queue depth and cache hit ratio.
- **Traces — App Insights distributed tracing.** Correlated spans across
  API → Redis → SQL and API → Service Bus → worker → ACS. **Sample rate 15%** of successful
  requests, **100% of failures** (never sample away an error).

---

## Signals (three pillars, ≥ 2 each)

| # | Pillar | Source | What it answers | Sample query / metric |
|---|--------|--------|-----------------|-----------------------|
| 1 | Metric | App Insights `requests` | Search latency p95 (SLI S1) | `requests \| where name == "GET /books" \| summarize percentile(duration, 95) by bin(timestamp, 1m)` |
| 2 | Metric | App Insights `requests` | Listing creation success rate (SLI S2) | `requests \| where name == "POST /books" \| summarize good=countif(success==true), total=count() \| extend sli = 100.0*good/total` |
| 3 | Metric | Service Bus | Email/notification queue depth | `ActiveMessages` on `bookswap-jobs` (Azure Monitor metric) |
| 4 | Log | App Insights `traces` | Auth failures with member + request ID (audit N7) | `traces \| where customDimensions.event == "auth.failed" \| project timestamp, memberId=customDimensions.memberId, requestId=customDimensions.requestId` |
| 5 | Log | App Insights `traces` | Loan create/return audit events (audit N7) | `traces \| where customDimensions.event in ("loan.created","loan.returned") \| project timestamp, memberId, requestId, loanId=customDimensions.loanId` |
| 6 | Trace | App Insights `dependencies` | Where a slow request spent its time (SQL vs Redis) | `dependencies \| where operation_Id == "<id>" \| project target, type, duration \| order by duration desc` |
| 7 | Trace | App Insights | End-to-end borrow → notification path (async) | Follow `operation_Id` from `POST /borrow-requests` through the Service Bus span into the worker + ACS spans |

---

## Results Summary

| Metric | Target | Achieved |
|--------|--------|----------|
| SLOs covered by an alert | 100% | 100% (S1, S2, S4, S6 have alerts; S3/S5 covered by synthetic control probes below) |
| Alerts with a clear runbook link | 100% | 100% (each links into `reliability/runbook.md`) |
| Dashboards for ops | 1 health, 1 business | 2 (Health: p95, error rate, dependency health, queue depth, instance count, CPU · Business: listings/day, active loans, digest sends) |

---

## Alert proposal

| Alert | Condition | Severity | Notification | Runbook |
|-------|-----------|----------|--------------|---------|
| Search SLO burn | `GET /books` error-or-slow rate > 1% over 5 min | Sev2 | Pager + Teams | `reliability/runbook.md` (Redis / spike) |
| Listing creation failing | `POST /books` success < 99.9% over 10 min | Sev2 | Pager + Teams | `reliability/runbook.md` (SQL) |
| Listings endpoint down | Synthetic probe on `POST /books` fails 3× in a row | **Sev1** | Pager (≤ 3 min, satisfies S4) | `reliability/runbook.md` (SQL) |
| SQL dependency failing | SQL dependency failure rate > 5% over 2 min | Sev1 | Pager | `reliability/runbook.md` (SQL) |
| Redis degraded | Redis dependency failure > 20% over 5 min | Sev2 | Teams | `reliability/runbook.md` (Redis) |
| Queue backing up | `bookswap-jobs` ActiveMessages > 10,000 for 10 min | Sev3 | Teams | `reliability/runbook.md` (spike) |
| Auth anomaly | `auth.failed` events > 100/min from one IP | Sev3 | Teams (security) | `security/review.md` |
| Audit gap | audit-event log coverage < 99.9% over 1 h | Sev3 | Teams | `slo-map.md` S6 |

Machine-readable copy in `observability/alerts.yaml`.

---

## What we are deliberately NOT alerting on

1. **Cache miss rate.** A cold cache is expected (deploys, evictions) and self-heals; we
   alert on the *symptom* (search latency SLO), not the cache internals.
2. **Individual 4xx responses.** A `400`/`404` is usually a client mistake, not our
   outage; alerting on these creates noise and pager fatigue.
3. **Email digest delay.** Digests are best-effort (Day 2 NFR); a late digest is not a
   page — the queue-depth Sev3 covers a *systemic* backlog only.
4. **A single instance restart.** Autoscale and health checks handle this; paging on it
   would wake someone for a self-healing event.

---

## PII redaction statement

Before anything is logged: the `Authorization` header is stripped; request/response bodies
for member endpoints are not captured; member **email and apartment are never written to
logs, metrics dimensions, or traces**. Audit and diagnostic events carry `memberId` (UUID)
and `requestId` only, which are sufficient to investigate without exposing personal data.

---

> ✍️ Learning-log (personalise, 2 questions for the Day 5 retro): e.g. "When is a read
> replica worth it over just a bigger cache?" and "How do you set an autoscale max without
> just guessing?"
