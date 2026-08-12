# BookSwap — SLI/SLO Map

> Day 3 · Intern Onboarding Track — System Design Crash Course
> Scope: BookSwap at 200 buildings, with a Sunday tabloid spike (10× RPS, 4h sustained)

---

## 1. NFR inventory

| # | NFR (from Day 2 / Day 3) | User-visible behaviour |
|---|---------------------------|------------------------|
| N1 | Catalogue search fast under load | A member searching the catalogue gets results quickly, even on a busy Sunday |
| N2 | Listing creation reliable & retryable | A member who adds a book sees it succeed; a retry after a blip never creates a duplicate |
| N3 | Search survives a cold/absent cache | Search still returns correct results (slower) when Redis is unavailable |
| N4 | Authentication enforced everywhere | Every endpoint except health checks demands a valid, short-lived token |
| N5 | Loan/address privacy | A member can never see another member's loan history or address |
| N6 | Fast outage detection | Ops can confirm health in < 5 min; a listings outage pages on-call in < 3 min |
| N7 | Audit trail | Every auth failure and every loan create/return is logged with request ID + member ID |

---

## 2. SLI / SLO table

| # | SLI definition (plain language) | Measurement source | SLO target | Window | Error budget |
|---|--------------------------------|--------------------|-----------|--------|--------------|
| S1 | % of `GET /books` requests returning 2xx **in < 800 ms** | App Insights `requests` table | ≥ 99% | 28d rolling | 1% of search requests (~the slowest 1% may exceed 800 ms) |
| S2 | % of `POST /books` requests returning 2xx (listing creation success) | App Insights `requests` table | ≥ 99.9% | 28d rolling | 0.1% of create attempts |
| S3 | % of requests to protected endpoints **without** a valid JWT that receive `401` | Synthetic auth probes + `requests` filtered on `resultCode == 401` | 100% | continuous | 0 — this is a control, not a graded budget |
| S4 | Time from a hard listings-endpoint outage to on-call **paged** | Azure Monitor alert fire time vs synthetic-probe first failure | < 3 min | per incident | n/a (detection latency) |
| S5 | % of API responses containing **no** other member's PII (loan history / address) | Authorization test suite + BOLA synthetic probes | 100% | continuous | 0 — security invariant |
| S6 | % of auth failures & loan create/return events that appear in logs with request ID + member ID | Log Analytics coverage query vs known event count | ≥ 99.9% | 7d rolling | 0.1% of audit events |

**Why these targets, not "99.9 everything":** search (S1) is read-heavy and browse-tolerant, so 99% at a latency bar is right — a member can retry a search. Listing creation (S2) is a write a member expects to *stick*, so it earns a stricter 99.9%. Auth (S3), privacy (S5), and audit (S6) are **invariants**, not budgets — you do not get to "fail 1% of access-control checks."

---

## 3. Error budget policy

**Trigger.** When S1 or S2 burns its 28-day error budget (search drops below 99%, or listing creation below 99.9%):

- **Halt-and-fix behaviour:** feature deploys to the affected service are **frozen**. The next sprint's top priority becomes the reliability work that caused the burn (e.g. cache stampede protection, autoscale tuning), and nothing else ships to that service until the SLO recovers over a full week.
- **Owner of the decision:** the on-call engineer *declares* the burn; the **engineering lead** owns the freeze decision and the un-freeze, recorded in the incident channel.

Invariant breaches (S3/S5/S6) are not "budget" events — a single confirmed breach is an incident and a stop-the-line, regardless of window.

## 4. Out of budget right now

> ✍️ Personalise this one honest sentence — it's graded on honesty, not optimism.

The SLO I would bet we **cannot** meet today is **S1 (search < 800 ms at 99%) during the 10× Sunday spike with a cold cache.** Cache-aside means a cold or evicted cache sends a stampede of reads straight to Azure SQL; at 10× RPS the database becomes the bottleneck and p95 latency will breach 800 ms until the cache re-warms. We have the cache and autoscale, but no stampede protection (single-flight repopulation) yet — so the honest answer is "not reliably, not on the first cold Sunday."
