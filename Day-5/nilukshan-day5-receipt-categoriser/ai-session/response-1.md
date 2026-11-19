# Response 1 — ambiguities raised, then first implementation

*Condensed record of what the agent returned. Ambiguity list is verbatim; the code is
in `src/categoriser/` at commit 1 rather than duplicated here.*

## Ambiguities the agent raised before coding

| # | Ambiguity | Blocking? | What I did |
|---|---|---|---|
| 1 | §3.3 lists 400 / 413 / 502 but the input rules in §3.1 also imply a *wrong file type* case. PDF is named in §6 as out of scope — is that a 400 or a 415? | **Yes** — I cannot validate without picking | Amended the spec: added `415 unsupported_media_type` and a companion line to AC-05. **The agent found a real hole in my contract.** |
| 2 | AC-03 says an LLM outage returns 200, but §3.3 lists a 502 for "upstream OCR/LLM unavailable". These contradict for the LLM case. | **Yes** | Amended §3.3 to split them: *no text at all* → 502; *text but no LLM* → 200 + rule-based. Added the "Deliberate non-error" note. |
| 3 | §3.5 has a kill switch but no criterion and no status code for "flag is off". | No — could have guessed | Added AC-06 and `404 feature_disabled`. I would rather the endpoint vanish than return a 503 that pages someone. |
| 4 | Functional requirement says "below 0.6 is Needs review", but §7 Q1 says the threshold is an open question. Which is it? | No | Kept both, honestly: 0.6 ships as an App Configuration value, and AC-02 asserts the *invariant* `needsReview === (confidence < threshold)` rather than a hard-coded 0.54. |
| 5 | "Confidence" from an LLM is a self-report, not a calibrated probability. The spec treats it as if it were calibrated. | No | Left as risk; noted in §7 Q1 that we need 500+ labelled suggestions before trusting the number. |
| 6 | Rule-based confidence "≤ 0.5" — is that a cap or a target? | No | Implemented as a hard ceiling constant so the §3.2 invariant cannot be broken by later tuning. |

## What it then produced

- `types.ts`, `rule-based-categoriser.ts`, `llm-categoriser.ts`, `telemetry.ts`, `index.ts`
- `tests/acceptance.test.ts` with one `describe` per AC id
- Validation ordered *before* any upstream call, so AC-05 can assert zero calls
