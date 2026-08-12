# BookSwap — Quality Attribute Plan (Day 3)

Proves the Day 2 design is ready for 200 buildings + a 10x Sunday spike.

- `slo/slo-map.md` — every NFR mapped to an SLI and an SLO, with error-budget policy.
- `reliability/runbook.md` — three named failures (SQL down, Redis down, traffic spike)
  with concrete timeouts, retries, circuit-breaker and idempotency configuration.
- `security/review.md` + `security/threats.csv` — seven-category review, a concrete BOLA
  path, and ZAP baseline instructions. Attach `zap-baseline-report.html` after running it.
- `observability/plan.md` + `observability/alerts.yaml` — logs/metrics/traces, an alert
  per SLO, and an explicit "what we don't page on" list.

Still to attach before submission: `security/zap-baseline-report.html` (run the scan
yourself — see review.md).
