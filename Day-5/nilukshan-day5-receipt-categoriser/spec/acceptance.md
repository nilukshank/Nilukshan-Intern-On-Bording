# Receipt Categoriser — Acceptance Criteria

Companion to `spec.md` v0.1. Every criterion below is observable from **outside** the process: an HTTP response, a stored row, an Application Insights event, or a wall-clock measurement. None of them assert on internal calls, class names, or return types.

**Fixtures** live in `tests/fixtures/` and are referenced by name so the criteria can be lifted into a test framework unchanged.

| Fixture | What it is |
|---|---|
| `meal-receipt.png` | Restaurant bill, LKR 2,400, food line items |
| `mixed-receipt.png` | Supermarket bill: A4 paper, pens, one sandwich |
| `hotel-receipt.png` | Hotel folio, 2 nights |
| `unreadable.png` | Photo of a desk — text present, no receipt structure |
| `pii-receipt.png` | Receipt showing "Ms. Nadeeka Perera" and "VISA ****4821" |
| `oversized.png` | Valid PNG, 14 MB |

---

## AC-01 — Happy path: clear meal receipt

**Given** the feature flag `greenchit.categoriser.enabled` is `true`
**And** a claim `C-1001` owned by the authenticated claimant
**And** the receipt image `meal-receipt.png` (restaurant bill totalling LKR 2,400)
**When** the claimant sends `POST /claims/C-1001/receipts/categorise` with the image as `multipart/form-data`
**Then** the response is `200 OK`
**And** the body satisfies `category == "Meals"`, `confidence >= 0.7`, `source == "llm"`, `needsReview == false`, `message == null`
**And** an Application Insights customEvent named `categoriser.suggested` is emitted within 5 seconds carrying the same `suggestionId` as the response body

---

## AC-02 — Ambiguous receipt is flagged for review, not guessed at silently

**Given** the configured review threshold is `0.6`
**And** the receipt image `mixed-receipt.png` (A4 paper LKR 1,850, pens LKR 600, one sandwich LKR 420)
**When** the claimant categorises it
**Then** the response is `200 OK`
**And** `category` is exactly one of the five allowed values — the response contains no split, list, or array of categories
**And** `needsReview == (confidence < 0.6)` holds in the response body
**And** if `confidence < 0.6`, the UI renders the control with the label "Needs review" and the claimant can still submit after choosing a category

*Why this is worded this way:* the pass condition is the **invariant** between `needsReview` and `confidence`, not a hard-coded expected confidence. We do not yet know how the model scores this receipt (§7 Q1) and a test that asserts `confidence == 0.54` would be asserting on the model, not on our feature.

---

## AC-03 — LLM unavailable: degrade to rule-based, never fail

**Given** Azure OpenAI returns `503` to every attempt (including the single retry)
**And** Document Intelligence is healthy
**When** the claimant categorises `meal-receipt.png`
**Then** the response is `200 OK` — **not** 502, **not** 503
**And** `source == "rule-based"`
**And** `confidence <= 0.5`
**And** `needsReview == true`
**And** `message` is a non-empty string explaining that the category was suggested from keywords only
**And** the `categoriser.suggested` event carries `source: "rule-based"`

---

## AC-04 — OCR runs but the image is not a receipt

**Given** Document Intelligence returns `200` for `unreadable.png` but the result contains no total and no line items
**When** the claimant categorises it
**Then** the response is `200 OK`
**And** `category == "Other"`
**And** `confidence <= 0.2`
**And** `needsReview == true`
**And** `message` tells the claimant in plain language that the image could not be read as a receipt and invites them to re-upload or pick a category — it does not contain a stack trace, an Azure request ID, or the word "OCR"

**And separately — Given** Document Intelligence itself is unreachable (connection refused, or 5xx after retries)
**Then** the response is `502` with `code == "ocr_unavailable"`, because with no text at all there is nothing for the rule-based path to work on

---

## AC-05 — Oversized payload is rejected before any upstream call

**Given** the receipt image `oversized.png` at 14,680,064 bytes (> 10 MB)
**When** the claimant sends it to the categorise endpoint
**Then** the response is `413 Payload Too Large`
**And** the body is `application/problem+json` with `code == "payload_too_large"` and `maxBytes == 10485760`
**And** **no** `categoriser.suggested` event is emitted
**And** no call is made to Document Intelligence or Azure OpenAI — verified by the upstream mocks recording zero requests

*Companion negative:* a valid 2 MB `application/pdf` returns `415` with `code == "unsupported_media_type"`; a request with the `receipt` part missing returns `400` with `code == "invalid_request"`.

---

## AC-06 — Kill switch works without a deploy

**Given** the feature is running and serving 200s
**When** an operator sets `greenchit.categoriser.enabled` to `false` in Azure App Configuration
**Then** within 60 seconds and with no restart or redeploy, the endpoint returns `404` with `code == "feature_disabled"`
**And** the Claims Web receipt step no longer renders the suggestion control
**And** claim submission continues to work with manual category selection
**And** when the flag is set back to `true`, 200s resume within 60 seconds

---

## AC-07 — PII does not reach telemetry or the response

**Given** the receipt image `pii-receipt.png` containing the customer name "Ms. Nadeeka Perera" and the card line "VISA ****4821"
**When** the claimant categorises it
**Then** the response is `200 OK` and the response body contains neither the name, the digits `4821`, nor any OCR text
**And** the captured `categoriser.suggested` event properties are **exactly** the allowlisted set: `suggestionId`, `claimId`, `category`, `confidence`, `source`, `needsReview`, `latencyMs`, `ocrLatencyMs`, `modelVersion`, `promptTokens`, `completionTokens`, `estimatedCostLkr` — asserted as a set equality, so a newly added property fails the test
**And** a full-text scan of the captured event JSON for `"Nadeeka"`, `"Perera"` and `"4821"` returns zero matches
**And** the OCR text is not written to the application log at any level, including `debug`

---

## AC-08 — Latency budget

**Given** the load script `tests/load/categoriser.k6.js` running 50 concurrent claimants for 5 minutes against the staging environment, with stubbed upstreams at their measured p50 latencies
**When** the run completes
**Then** p95 of upload-to-suggestion is `<= 4000 ms`
**And** no request exceeds the 8,000 ms hard ceiling without returning `504` with `code == "categorisation_timeout"`
**And** the error rate excluding deliberate 4xx fixtures is `< 1%`

*Measurement point is §7 Q7 and is not settled; this criterion measures server-side receipt-received → response-sent, and will need restating if we agree to include client upload time.*

---

## AC-09 — Cost ceiling

**Given** 2,000 suggestions produced in a calendar month at the observed prompt/completion token mix
**When** `estimatedCostLkr` is summed across all `categoriser.suggested` events for the month
**Then** the mean per suggestion is `<= LKR 5.00`
**And** an Application Insights alert fires when the 7-day rolling mean exceeds LKR 4.00, before the ceiling is breached

---

### Coverage check against the brief

| Required | Met by |
|---|---|
| ≥ 6 criteria | 9 criteria |
| 1 happy path | AC-01 |
| 1 ambiguous case | AC-02 |
| 1 fallback / degraded mode | AC-03 (LLM), AC-04 (OCR) |
| 1 input error | AC-05 (+ 415 and 400 companions) |
| 1 PII / privacy criterion | AC-07 |
| Observable from outside the code | All — assertions are on HTTP responses, emitted events, config state and wall-clock timing |
