# Receipt Categoriser — Day 5 spec-driven build

Suggests an expense category for an uploaded GreenChit receipt. Spec first, then the
implementation was driven by an AI agent against that spec (see `ai-session/`).

## Run the tests

```bash
node --version            # needs v22.6+ (TypeScript is stripped natively, no build step)
npm test                  # runs tests/acceptance.test.ts
```
15 assertions across 7 of the 9 acceptance criteria. No install, no network, no Azure keys.

## Layout

| Path | What |
|---|---|
| `spec/spec.md` | The feature spec (7 sections) — the source of truth |
| `spec/acceptance.md` | AC-01…AC-09 |
| `src/categoriser/index.ts` | Orchestrator: flag → validate → OCR → LLM → fallback → telemetry |
| `src/categoriser/llm-categoriser.ts` | Azure OpenAI path (primary) |
| `src/categoriser/rule-based-categoriser.ts` | Keyword path (degraded, confidence capped at 0.5) |
| `src/categoriser/telemetry.ts` | Allowlisted event construction |
| `tests/fixtures/` | OCR fixtures + recording fakes for Doc Intelligence / OpenAI / App Insights |
| `tests/load/categoriser.k6.js` | AC-08 latency run (staging only) |
| `ai-session/` | Verbatim prompts and responses |
| `IMPLEMENTATION-REPORT.md` | What the agent did, what it missed, what I fixed |

## Criteria not covered by `npm test`

- **AC-08 (latency p95)** — needs the k6 run against staging.
- **AC-09 (cost ceiling)** — needs a month of `categoriser.suggested` events:
  ```kusto
  customEvents | where name == "categoriser.suggested"
  | summarize avg(todouble(customDimensions.estimatedCostLkr))
  ```
