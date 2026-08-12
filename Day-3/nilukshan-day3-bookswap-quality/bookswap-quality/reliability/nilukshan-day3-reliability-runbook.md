# BookSwap — Reliability Runbook v0.1

> Day 3 · Three named failures, with concrete configuration. No code changes today —
> this proves the design survives (or names what must change).

---

## Failure 1: Azure SQL primary unavailable for 5 minutes

**What the user sees.** Writes fail first — creating a book, requesting a borrow,
approving, and returning a loan all error. Reads that are served cache-aside from Redis
(`GET /books`, `GET /books/{id}`) keep working with data up to the TTL (60 s) stale.
Loans are never cached, so loan reads fail. So: browsing mostly works, *acting* does not.

**Detection.**
- `dependencies | where type == "SQL" and success == false | summarize failRate = ...`
  in Application Insights.
- Azure SQL **connection failures** metric + `/readyz` flips to `503` (it probes SQL).
- **Alert:** SQL dependency failure rate > 5% over 2 min → **Sev1 page**.

**Mitigation in design.**
- Connection timeout **5 s**, command timeout **10 s** (bound the wait — no stuck threads).
- Retry **only transient** SQL errors (error numbers 40613, 49918, 40501, 10928, 10929)
  — **3 attempts**, exponential backoff **base 200 ms, cap 2 s**, plus jitter. Never retry
  a `4xx`/validation error.
- **Circuit breaker** on the SQL dependency: opens after **5 consecutive failures** or
  **>50% failures over a 10 s window**; **half-open after 30 s** with a single trial call.
- **Idempotency key** (the `Idempotency-Key` header from Day 2, reused as the Service Bus
  `messageId`) makes a retried `POST /borrow-requests` after failover safe — the same key
  cannot create two requests inside the 10-min duplicate-detection window.
- Azure SQL automatic failover (zone-redundant / failover group) typically completes in
  **30–60 s**; the timeouts + retries + breaker are sized to bridge that gap gracefully.

**Manual response.** On-call is paged by the Azure Monitor action group. They: (1) check
**Azure Service Health** for a regional SQL incident; (2) confirm the failover group has
promoted the secondary; (3) if auto-failover has not fired after ~2 min, initiate a
**manual failover** on the failover group; (4) post status in `#bookswap-incident`.

**Post-incident actions.** Query `loans` for any duplicate `borrow_request_id` created in
the retry window (proves idempotency held). Blameless postmortem within 48 h. Re-check
circuit-breaker thresholds against the real failure signature.

---

## Failure 2: Azure Cache for Redis is down

**What the user sees.** Ideally *slower, not broken.* Every read falls through to Azure
SQL, so `X-Cache` is always `MISS` and search latency rises — it may temporarily breach
the 800 ms SLO — but results stay **correct**. This is the cache-aside design paying off:
a cache is a lossy accelerator, never the source of truth.

**Detection.**
- `dependencies | where type == "Redis" and success == false`.
- Redis **server** metric (unavailable / connected-clients drop); `X-Cache` MISS rate → 100%.
- **Alert:** Redis dependency failure > 20% over 5 min → **Sev2** (degraded, *not* Sev1 —
  the service still serves correct data).

**Mitigation in design.**
- Redis GET/SET timeout **200 ms**; on timeout or error, **treat as a cache miss and read
  SQL** (fail-open). A Redis failure must never fail a member request.
- When the Redis breaker is **open**, skip the cache call entirely so members don't each
  pay the 200 ms penalty — go straight to SQL until half-open recovery.
- SQL read connection pool has headroom (max pool 100) to absorb the extra read load.

**Manual response.** On-call confirms the Redis outage, watches SQL CPU/DTU and search
p95; if the SLO is burning, scale up SQL read capacity (or route reads to a replica);
comms if the error budget is at risk.

**Post-incident actions.** Confirm SQL did not saturate. **Add single-flight / stampede
protection** to cache repopulation (a short lock so only one request rebuilds a cold key)
— this is the top follow-up, because a cold cache under load is the S1 risk from the SLO map.

---

## Failure 3: Sunday tabloid spike — 10× sustained traffic for 4 hours

**What the user sees.** Ideally nothing. The risks are elevated latency, some write
throttling (`429` with `Retry-After`), and delayed digest emails — all preferable to a
hard outage.

**Detection.**
- Azure Front Door / App Insights **request rate**; App Service **CPU %**; Service Bus
  **queue depth** (`ActiveMessages`).
- **Alerts:** RPS > 5× baseline **or** CPU > 70% for 5 min **or** queue depth > 10,000.

**Mitigation in design.**
- **Autoscale out** on App Service: min 3 instances, **+2 instances per 70% CPU sustained
  5 min**, max 20. Statelessness (Day 2) makes adding instances safe — no sticky sessions.
- **Azure Front Door rate limiting**: e.g. 100 req/min per IP on write endpoints, with a
  short burst allowance, to blunt scraping/abuse during the press bump.
- **Service Bus decoupling** (Day 2 D4) means the borrow request persists and returns
  `202` in tens of ms; email is drained by the worker later, so the spike never blocks a
  member — the queue absorbs the backlog.
- **Cache TTL** shields SQL on hot read paths; **graceful degradation** sheds the
  non-critical `POST /members/me/digest:send-now` with `429 + Retry-After` *before* ever
  degrading core search or borrow.
- **Idempotency key** again: writes retried during throttling do not duplicate.

**Manual response.** On-call **pre-scales before Sunday** (proactive — raise autoscale min
ahead of the feature), then watches queue depth, search p95, and error-budget burn; ready
to raise the autoscale max and widen rate limits if headroom allows.

**Post-incident actions.** Right-size autoscale from real numbers; review error-budget
spend for the day; feed the sustained 200-building load into permanent capacity planning.

---

## Reliability decisions — quick index (for the presentation)

| Failure | Signature pattern | Headline mitigation | Key number |
|---------|-------------------|---------------------|-----------|
| SQL down | Fail-fast + recover | timeout + retry + circuit breaker + idempotency | 5s/10s timeout, 3 retries, breaker at 5 fails |
| Redis down | Fail-open | cache miss → SQL, degrade latency not correctness | 200 ms Redis timeout |
| Traffic spike | Absorb + shed | autoscale + queue + rate limit + shed non-critical | +2 inst/70% CPU, max 20 |
