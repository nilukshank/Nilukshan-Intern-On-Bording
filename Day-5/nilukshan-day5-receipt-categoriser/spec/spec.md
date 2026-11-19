# Receipt Categoriser — Feature Spec v0.1


> **Note on constraints vs. solutions.** Azure OpenAI, Document Intelligence, Application Insights and App Configuration are named in §3 because they were **given to us as platform constraints**, not because this spec is choosing them. Anything we would actually be free to choose (cache, queue, model prompt strategy, keyword list ownership) is deliberately left to §7 or a follow-on ADR.

---

## 1. Why

**User outcome.** A GreenChit claimant photographs a receipt and today must scroll a dropdown and pick an expense category by hand. They pick wrong or pick "Other" to move on, which pushes correction work onto Finance at month-end. We want the category to be *already filled in and usually right*, with the claimant staying in control of the final answer.

**Business outcome.** Finance spends less time recategorising claims after submission, and category data becomes trustworthy enough to report on.

**Metrics this is expected to move**

| Metric | Baseline (today) | Target after 1 month at full rollout |
|---|---|---|
| Claims recategorised by Finance after submission | 31% (Jul-2026 export) | ≤ 12% |
| Median time from receipt upload to claim submitted | 74 s | ≤ 45 s |
| Claims submitted with category `Other` | 22% | ≤ 10% |
| Suggestion acceptance rate (new metric) | n/a | ≥ 70% accepted unchanged |

**How we will know it failed.** Acceptance rate below 50%, or Finance recategorisation *rises*, means the suggestion is noise and we turn the flag off (§3, feature flag).

---

## 2. Scope

**In scope**

1. One synchronous endpoint that takes an uploaded receipt image plus a claim ID and returns a single suggested category with a confidence score and its source.
2. A rule-based fallback categoriser that produces a suggestion when the LLM path is unavailable or times out.
3. Telemetry: one event when a suggestion is produced, one event when the claimant accepts or overrides it.

**Containers affected (Day 4 architecture)**

| Container | Change |
|---|---|
| Claims Web (React SPA) | New "Suggested category" control on the receipt upload step; claimant can accept or change before submit |
| Claims API (Node/TS) | New endpoint + categoriser module; new outbound calls; reads feature flag |
| Claims DB (PostgreSQL) | New nullable columns on `claim_receipt`: `suggested_category`, `suggested_confidence`, `suggestion_source`, `suggestion_id` |
| Azure AI Document Intelligence | New dependency — OCR of receipt image |
| Azure OpenAI (BISTEC tenant) | New dependency — categorisation from OCR text |
| Application Insights | New customEvents |
| Azure App Configuration | New flag `greenchit.categoriser.enabled` |

**Not affected:** Approvals service, Payments service, Notification service. No change to the claim submission or approval workflow — the suggestion is advisory only.

---

## 3. Contract

### 3.1 Inputs

`POST /claims/{claimId}/receipts/categorise`

| Field | Type / rule |
|---|---|
| `claimId` (path) | UUID. Must exist and belong to the authenticated claimant. |
| Authorization (header) | Bearer token, existing Claims API auth. Claimant role. |
| Content-Type (header) | `multipart/form-data` |
| `receipt` (part) | Binary image. **Allowed:** `image/jpeg`, `image/png`. **Max 10 MB** (10 × 1024 × 1024 bytes). Exactly one file per request. |
| `Idempotency-Key` (header, optional) | If repeated within 24 h, returns the stored suggestion without re-calling OCR/LLM. |

Anything not listed above is rejected. The endpoint does **not** accept a URL, a base64 JSON body, a PDF, or multiple files.

### 3.2 Outputs

`200 OK`, `application/json`:

```jsonc
{
  "suggestionId": "b3f1…",          // UUID, used to correlate the accept/override event
  "category": "Meals",              // enum: Meals | Travel | Lodging | Office Supplies | Other
  "confidence": 0.82,               // float, 0.0–1.0 inclusive, 2 decimal places
  "source": "llm",                  // enum: "llm" | "rule-based"
  "needsReview": false,             // true when confidence < the configured threshold (see §7 Q1)
  "message": null                   // human-readable string, non-null only when the result is degraded
}
```

Invariants a reviewer or test can hold us to:

- `category` is always one of the five values — never null, never a new value, never a free-text string.
- `confidence` is always present, including on the fallback and the OCR-unparseable paths.
- `needsReview === (confidence < threshold)` — the client never recomputes this.
- `source: "rule-based"` implies `confidence <= 0.5`.
- The response contains no OCR text, no merchant address, and no card digits.

### 3.3 Errors

All errors are `application/problem+json` with a stable machine-readable `code`.

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_request` | Missing `receipt` part, more than one file, zero-byte file, malformed `claimId` |
| 401 | `unauthenticated` | Missing/expired token |
| 403 | `forbidden` | Claim exists but belongs to another claimant |
| 404 | `claim_not_found` | No such claim |
| 404 | `feature_disabled` | Feature flag off — the endpoint behaves as if it does not exist |
| 413 | `payload_too_large` | Image > 10 MB |
| 415 | `unsupported_media_type` | Not JPEG or PNG (includes PDF and HEIC) |
| 429 | `rate_limited` | > 10 categorise calls per claimant per minute |
| 502 | `ocr_unavailable` | Document Intelligence unreachable or returned 5xx after retries — we have no text at all, so no suggestion is possible |
| 504 | `categorisation_timeout` | Total processing exceeded 8 s hard ceiling |

**Deliberate non-error:** Azure OpenAI being down is **not** an error response. It degrades to `source: "rule-based"` with `200 OK` (AC-03). Likewise an image that OCR *reads but cannot parse as a receipt* returns `200 OK` with `category: "Other"` and a populated `message` (AC-04). The distinction is: *no text at all* → 502; *text but no usable receipt* → 200 + Other.

### 3.4 Side effects

| Effect | Detail |
|---|---|
| customEvent `categoriser.suggested` | Emitted on every 200 response, within 5 s of the response. **Allowlisted properties only:** `suggestionId`, `claimId`, `category`, `confidence`, `source`, `needsReview`, `latencyMs`, `ocrLatencyMs`, `modelVersion`, `promptTokens`, `completionTokens`, `estimatedCostLkr`. Anything not on this list is dropped by construction, not by filtering. |
| customEvent `categoriser.decided` | Emitted when the claimant submits the claim: `suggestionId`, `suggestedCategory`, `finalCategory`, `accepted` (bool). This is how we measure the acceptance-rate metric in §1. |
| DB write | `claim_receipt` row updated with the suggestion columns. Advisory only — never sets the claim's own category. |
| Outbound calls | Document Intelligence (1 call), Azure OpenAI (0 or 1 call). Both inside the BISTEC Azure tenant. No receipt bytes, OCR text or prompt content leaves the tenant. |
| Retention | Receipt image retention is unchanged (existing claim attachment policy). OCR text is held in memory for the duration of the request and is not persisted — see §7 Q4. |

### 3.5 Non-functional budget

| Property | Target | Verified by |
|---|---|---|
| Latency | ≤ 4 s p95 upload→suggestion; 8 s hard timeout | AC-08 |
| Availability under LLM outage | 100% of requests still return a suggestion | AC-03 |
| Cost | ≤ LKR 5 per suggestion at ~2,000/month | AC-09 |
| PII | No PII in telemetry; no data outside the BISTEC tenant | AC-07 |
| Kill switch | Flag `greenchit.categoriser.enabled` takes effect ≤ 60 s, no deploy | AC-06 |

---

## 4. Acceptance criteria

Nine Given/When/Then criteria in `spec/acceptance.md` (AC-01 … AC-09). Summary of coverage:

| AC | Covers |
|---|---|
| AC-01 | Happy path — clear meal receipt |
| AC-02 | Ambiguous receipt → `needsReview` |
| AC-03 | LLM outage → rule-based fallback (degraded mode) |
| AC-04 | OCR cannot parse the image → `Other` + message |
| AC-05 | Oversized payload → 413 (input error) |
| AC-06 | Feature flag off → 404 `feature_disabled` |
| AC-07 | PII never reaches telemetry |
| AC-08 | Latency p95 under load |
| AC-09 | Cost per suggestion ceiling |

---

## 5. Examples

**Example A — happy path.** Restaurant bill, LKR 2,400, items "Chicken Kottu ×2, Lime Soda ×2", merchant "Green Cabin".

```json
{ "suggestionId": "b3f1…", "category": "Meals", "confidence": 0.91,
  "source": "llm", "needsReview": false, "message": null }
```

**Example B — ambiguous.** Supermarket receipt: "A4 Paper 500 sheets — LKR 1,850; Sandwich — LKR 420; Ballpoint pens ×10 — LKR 600".

```json
{ "suggestionId": "7c2a…", "category": "Office Supplies", "confidence": 0.54,
  "source": "llm", "needsReview": true, "message": null }
```

Note: the receipt is **not** split across categories — one receipt, one suggestion, low confidence, claimant decides. Splitting is out of scope (§6).

**Example C — degraded, LLM outage.** Same restaurant bill as A, but Azure OpenAI returns 503 on both attempts.

```json
{ "suggestionId": "1d90…", "category": "Meals", "confidence": 0.40,
  "source": "rule-based", "needsReview": true,
  "message": "Suggested from keywords only — please confirm the category." }
```

**Example D — negative, unparseable.** Claimant uploads a photo of their desk; OCR returns text but no total, no line items.

```json
{ "suggestionId": "44ab…", "category": "Other", "confidence": 0.10,
  "source": "rule-based", "needsReview": true,
  "message": "We couldn't read this as a receipt. Please pick a category, or re-upload a clearer photo." }
```

**Example E — negative, too large.** 14 MB PNG.

```json
{ "type": "https://greenchit.bistec/errors/payload-too-large",
  "title": "Receipt is too large", "status": 413,
  "code": "payload_too_large", "detail": "Maximum receipt size is 10 MB.",
  "maxBytes": 10485760 }
```

---

## 6. Out of scope

Each of these is a real thing a reviewer might expect. We are explicitly not doing them in v1.

1. **Multi-receipt batch upload.** One image per request. A claimant with five receipts makes five calls.
2. **Auto-submission without claimant confirmation.** The suggestion never sets the claim category by itself, at any confidence.
3. **Line-item splitting across categories.** A receipt with food and stationery gets one category, not a split claim.
4. **Learning from overrides.** We log overrides (§3.4) but nothing consumes them in v1 — see §7 Q3.
5. **Non-LKR receipts and FX conversion.** Foreign-currency receipts are categorised on text only; amounts are not converted.
6. **PDF and HEIC receipts.** 415 for now, even though the mobile app can produce HEIC.
7. **Custom or per-department categories.** The five categories are fixed in v1.
8. **Duplicate-receipt detection** and **policy/limit enforcement** ("this meal exceeds the LKR 3,000 cap"). Different feature, different owner.
9. **Offline capture.** The suggestion requires connectivity; there is no queued-suggestion mode.

---

## 7. Open questions

These are open. This spec does **not** answer them, and v1 ships them as configuration or as accepted risk.

**Q1 — What confidence threshold should trigger "Needs review"?**
The brief gives 0.6. We are shipping 0.6 **as an App Configuration value, not a constant**, because we have no data yet on how calibrated the model's confidence is. Open: what threshold do we settle on after two weeks of shadow traffic, and do we need *per-category* thresholds (Lodging may be much easier to detect than Other)? Needs: 500+ labelled suggestions. Owner: TBD. Blocks nothing in v1.

**Q2 — Is the merchant name PII under the BISTEC tenant policy?**
We exclude it from telemetry to be safe, which means we cannot debug "why did it say Travel" from Application Insights alone. Open: does Security classify merchant name as PII, and if not, do we want it in a separate lower-retention event? Owner: Security review, not yet scheduled.

**Q3 — Do we want active learning from overrides in v1.1?**
We are logging the data for it. Open: whether we fine-tune, few-shot from recent overrides, or just adjust the keyword list by hand. This changes the retention answer in Q4, so it should be decided before, not after.

**Q4 — How long, if at all, do we retain OCR text?**
v1 does not persist it. Open: Q3 probably needs it. If we start retaining it, we need a retention period and a DSAR deletion path, which we have not designed.

**Q5 — Who owns the rule-based keyword list?**
The fallback ships with a keyword list written by the implementing engineer. Open: is that Finance's list to maintain, and through what mechanism (config, PR, admin screen)? If nobody owns it, it will rot and the fallback quality will drift silently.

**Q6 — What do we do when confidence is high but claimants override anyway?**
We will be able to see it in `categoriser.decided`. Open: what threshold of disagreement triggers action, and what the action is (retune, disable a category, turn the feature off).

**Q7 — Should the p95 latency budget be measured from upload start or from OCR start?**
The NFR says "from upload to displayed suggestion", which includes the claimant's mobile upload time on a Sri Lankan 4G connection — that could be several seconds on its own and is largely outside our control. Open: agree the measurement point with the Day 4 team before we commit to 4 s in a dashboard.

---

*Review this spec with the rubric in the Day 5 handout. If any section takes you more than 3 minutes to read, tell me — that is a defect in the spec, not in you.*
