# BookSwap — Mock Smoke Test Report

**Spec under test:** `openapi/bookswap-openapi.yaml` (OpenAPI 3.1.0, 815 lines) · **Date:** 2026-07-21

## Setup

Environment: Node v22 (≥ 20 LTS required), curl. Everything below is scripted in **`mock/smoke-test.sh`** — run `bash mock/smoke-test.sh` from the repo root to reproduce end-to-end.

```bash
# 1. Validate the spec (must print "... is valid")
npx -y @apidevtools/swagger-cli validate openapi/bookswap-openapi.yaml
#    → bookswap-openapi.yaml is valid          (swagger-cli 4.0.4)

# 2. Start the mock — NOTE the package name (see Finding 1)
npx -y @stoplight/prism-cli mock openapi/bookswap-openapi.yaml --port 4010 --errors
#    → Prism 5.14.2 serving http://127.0.0.1:4010

# 3. In another terminal: run the 5 tests (dummy JWT — Prism checks presence/shape, not signature)
AUTH='Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.dummy.signature'
curl -s -w '%{http_code}' -H "$AUTH" 'http://127.0.0.1:4010/books?page=1&pageSize=20'
# ... (T2–T5 exactly as in mock/smoke-test.sh)
```

## Results

| # | Endpoint | Method | Body / Params | Expected status | **Actual status** |
|---|---|---|---|---|---|
| 1 | `/books` | GET | `page=1&pageSize=20` + JWT | 200 | **200** ✅ |
| 2 | `/books` | POST | valid book payload (*Madol Doova*) | 201 | **201** ✅ |
| 3 | `/books` | POST | payload missing `title` | 400 or 422 | **422** ✅ |
| 4 | `/books/999/borrow-requests` | POST | borrower JWT + optional message | 201 | **201** ✅ |
| 5 | `/books` | GET | *(no Authorization header)* | 401 | **401** ✅ |
| 6* | `/books` | GET | `pageSize=5000` (over the 100 cap) + JWT | 4xx | **400** ✅ |

*Test 6 is a bonus negative test I added: the `maximum: 100` constraint on `pageSize` is enforced by the mock, proving the "never return unbounded lists" rule is encoded in the contract, not just in prose.

## Results Summary

| Metric | Target | Achieved |
|---|---|---|
| Tests run | 5 | **6** (5 required + 1 bonus) |
| Tests passing against the mock | 5 | **6 / 6** |
| Endpoints with explicit error responses | 4+ | **9 of 9 operations** (all define 401 + at least one of 400/403/404/409/422) |
| Distinct status codes exercised live | — | 200, 201, 400, 401, 422 (409/403/404 defined in spec, not mock-triggerable without stateful behaviour) |

## Findings — what running the mock revealed that reading the OpenAPI did not

1. **The brief's command doesn't work.** `npx @stoplight/prism mock ...` fails: the package `@stoplight/prism` returns **npm error 404 Not Found**. The CLI actually lives at **`@stoplight/prism-cli`**. Reproduce: `npm view @stoplight/prism version` → 404, vs `npm view @stoplight/prism-cli version` → 5.16.0.
2. **Missing `title` is a 422, not a 400.** Prism maps request-body *schema* violations to 422 Unprocessable Entity and returns an `sl-violations` header naming the exact failure: `"Request body must have required property 'title'"`. This matches the semantics we learned (400 = can't parse, 422 = parsed but invalid), and my spec already declared 422 on `POST /books` — the mock confirmed the choice.
3. **Every error status replays the *same* example body.** My 401 response body read `{"code":"BOOK_UNAVAILABLE", ...}` — nonsense for an auth failure. Cause: all error responses `$ref` one `Error` schema, and Prism replays that schema's single example regardless of status. The contract is right; the *examples* are misleading. → spec change 1.
4. **The mocked 201 borrow request contradicts itself.** It returned `"status":"pending"` *together with* `"loanId":88` and a `decidedAt` — impossible states, because Prism merges every field-level example in the schema blindly. Only running the mock exposes this; the YAML looks fine on paper. → spec change 2.
5. **The mock validates the contract, not behaviour.** T2 echoed the schema example (`"condition":"new"`) even though I POSTed `"good"`, and T1 claims `total: 137` while returning one item at `pageSize=20`. Useful reminder of what a mock is *for*; `--dynamic` generates varied fake data if the mobile team needs it.
6. *(Positive confirmation)* The **`X-Request-Id` header declared in the spec is actually emitted** by the mock on every response — so the mobile team can build their log-correlation handling against the mock before the real API exists. Also: Prism 5.14 enforces security and validation **by default** — older tutorials say you need `--errors`, but T3/T5 returned 422/401 even without it (verified on port 4011/4012).

**Which endpoints feel awkward to call?** (a) The photo two-step (`POST /books/{id}/photos` → PUT bytes to the SAS URL) is correct but trusts the client to finish step 2 — a book can end up pointing at a photo that was never uploaded. (b) `PATCH /loans/{id}` with body `{"status":"returned"}` is a lot of ceremony for a one-word action; I kept it because the alternative (`POST /loans/{id}/return`) puts a verb in the URL.

## Spec changes I would make

1. **Per-status error examples** — `openapi/bookswap-openapi.yaml`, `components.responses` block (lines **464–530**): add a response-level `example` under each error's `content.application/json` (e.g. `TOKEN_MISSING` for Unauthorized, `VALIDATION_FAILED` for UnprocessableEntity) so mock error bodies match their status codes. Fixes Finding 3.
2. **Two named examples for borrow requests** — remove `loanId`/`decidedAt` field examples from the `BorrowRequest` schema (line **679**) and add named response examples instead: `pending` (no loanId/decidedAt) on the 201 of `createBorrowRequest` (line **191**), `accepted` on the 200 of `decideBorrowRequest`. Fixes Finding 4.
3. **`Idempotency-Key` request header** — add a `components.parameters.IdempotencyKey` and reference it from `createBook` (line **65**) and `createBorrowRequest` (line **191**), so a client that times out can safely retry the two non-idempotent POSTs (ties directly to today's idempotency discussion and to §6 of the decisions doc).
4. **Explicit `sort` parameter** — `listBooks` (line **38**): add `sort` (enum: `-createdAt`, `title`; default `-createdAt`). While testing I realised "newest first" lives only in the description — clients can't request or rely on an ordering contractually.
