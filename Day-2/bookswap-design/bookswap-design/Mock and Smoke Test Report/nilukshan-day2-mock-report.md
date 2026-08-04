# BookSwap — Mock Smoke Test Report

> Day 2 · Intern Onboarding Track — System Design Crash Course
> Spec under test: `openapi/bookswap-openapi.yaml`
> Mock server: Stoplight Prism

---

## Setup

The OpenAPI file was served as a mock with Stoplight Prism, and five requests were run
against it with `curl`. This is fully reproducible:

```bash
# 1. confirm the spec is valid first
npx @apidevtools/swagger-cli validate bookswap-openapi.yaml
# -> "bookswap-openapi.yaml is valid"

# 2. start the mock server (leave running in one terminal)
npx @stoplight/prism-cli mock bookswap-openapi.yaml --port 4010

# 3. in a second terminal, run the five smoke tests
# TEST 1 — list books, valid token -> expect 200
curl -s -w "\n[%{http_code}]\n" "http://127.0.0.1:4010/books?page=1&pageSize=20" \
  -H "Authorization: Bearer tok"

# TEST 2 — create a book, valid payload -> expect 201
curl -s -w "\n[%{http_code}]\n" -X POST "http://127.0.0.1:4010/books" \
  -H "Authorization: Bearer tok" -H "Content-Type: application/json" \
  -d '{"title":"Dune","author":"Frank Herbert","condition":"good"}'

# TEST 3 — create a book, missing title -> expect 400/422
curl -s -w "\n[%{http_code}]\n" -X POST "http://127.0.0.1:4010/books" \
  -H "Authorization: Bearer tok" -H "Content-Type: application/json" \
  -d '{"author":"Frank Herbert"}'

# TEST 4 — ask to borrow a book, valid token -> expect 202 (async)
curl -s -w "\n[%{http_code}]\n" -X POST "http://127.0.0.1:4010/borrow-requests" \
  -H "Authorization: Bearer tok" -H "Content-Type: application/json" \
  -d '{"bookId":"11111111-1111-1111-1111-111111111111","message":"May I borrow this?"}'

# TEST 5 — list books, NO Authorization header -> expect 401
curl -s -w "\n[%{http_code}]\n" "http://127.0.0.1:4010/books?page=1&pageSize=20"
```

Postman / Bruno alternative: import `bookswap-openapi.yaml`, point the collection base URL
at `http://127.0.0.1:4010`, and save the five requests above. _(Attach the collection
export or a screenshot here.)_

---

## Results

| # | Endpoint | Method | Body / Params | Expected status | Actual status | Result |
|---|----------|--------|---------------|-----------------|---------------|--------|
| 1 | `/books` | GET | `page=1&pageSize=20`, valid Bearer | 200 | 200 | Pass |
| 2 | `/books` | POST | valid book payload | 201 | 201 | Pass |
| 3 | `/books` | POST | missing `title` | 400 or 422 | 422 | Pass |
| 4 | `/borrow-requests` | POST | valid Bearer + body | 202 | 202 | Pass |
| 5 | `/books` | GET | no `Authorization` header | 401 | 401 | Pass |

### Results Summary

| Metric | Target | Achieved |
|--------|--------|----------|
| Tests run | 5 | 5 |
| Tests passing against the mock | 5 | 5 |
| Endpoints with explicit error responses | 4+ | 4+ (`/books`, `/books/{bookId}`, `/borrow-requests`, plus shared `401`/`429`) |

**Note on Test 4.** The challenge template assumed `POST /books/{id}/borrow-requests`
returning `201`. I deliberately modelled this as a flat `POST /borrow-requests` with
`bookId` in the body, returning `202 Accepted`, because the owner notification is produced
asynchronously by the digest worker (see `decisions/storage-decisions.md`, D4). A `201`
would claim the whole operation — including the email — finished inside the request, which
is not true. `202` correctly says "I have accepted and persisted your request; the
side-effect happens later." The mock confirmed the endpoint returns `202` as designed, so
this is the intended contract, not a failed test.

---

## Findings — what running the mock revealed that reading the spec did not

### Finding 1 — every error response returns the same misleading body

**Observed.** Test 3 is a `422` validation error and Test 5 is a `401` auth error, yet
both returned the identical body `{"title":"Copy already on loan","status":409,...}`. The
HTTP status line was correct each time (`422`, `401`), but the JSON body claimed `409` in
both cases.

**Cause.** The shared `Problem` schema (`components/schemas/Problem`) carries a single
hardcoded `example` — the `409` "copy on loan" case — and Prism replays that one example
for *every* response that references `Problem`. Reading the spec, this looks fine, because
in isolation the example is a valid problem object. It only becomes wrong once the same
example is reused across responses that have different statuses.

**Why it matters.** The `Problem` body is an RFC 7807 problem detail, and the entire point
of that format is that a client can read `status`, `title`, and `type` and branch on them
instead of parsing prose. If a `401` arrives with a body that says `409 "Copy already on
loan"`, a client keying off the body does the wrong thing: it shows "this copy is already
on loan" to a member who has actually just been logged out, and any refresh-token or
re-authenticate logic — which should fire on a `401` body — never triggers because the
body never admits it was a `401`. The transport layer says one thing and the
machine-readable payload says another, so the two sources of truth disagree on every error
that is not genuinely a `409`. That is a silent bug: a smoke test that only checks status
codes passes, and the defect only surfaces in a client that trusts the body.

### Finding 2 — the 400 vs 422 split is undefined

**Observed.** `POST /books` declares *both* `400` and `422`. Sending a body missing the
required `title` produced a `422`. Nothing in the spec states which malformed inputs map to
`400` and which map to `422`.

**Why it matters.** Two codes with no rule means every implementer has to guess. One
developer returns `400` for a missing field; another returns `422` for the same class of
error on a different endpoint; a third returns `400` for malformed JSON and `422` for
schema violations. Now the contract is no longer a single source of truth — the client has
to defensively handle both codes for the same situation, tests diverge from each other, and
the "decision" about which code means what has leaked out of the spec and into individual
developers' heads. Ambiguity in a contract is paid for downstream, by whoever consumes it.

---

## Spec changes I would make

1. **Give each error response its own example instead of one shared example on `Problem`.**
   Remove the `example` block from `components/schemas/Problem` and attach a matching
   example to each response object: `Unauthorized` -> `{status: 401, title: "Unauthorized"}`,
   `ValidationFailed` -> `{status: 422, title: "Validation failed"}`, `NotFound` ->
   `{status: 404, title: "Not found"}`, and keep the `409` example on the copy-on-loan
   responses only. This makes the mock — and any real error handler that copies the shape —
   return a body whose `status`/`title` agree with the HTTP status line.

2. **Document the 400 vs 422 boundary** in the `description` of `POST /books` (and the other
   write endpoints): `400` for malformed or unparseable JSON, `422` for well-formed JSON
   that fails schema or business-rule validation. Now the two codes are no longer
   interchangeable and no implementer has to guess.

3. **Surface the `Location` and `X-Correlation-Id` headers on the `202` endpoints as part of
   the smoke test.** The spec declares them, but the mock run did not assert them; adding a
   check that the correlation id comes back would make the async contract testable end to
   end, not just by status code.

---

## Reflection

The mismatch that would have caused a real bug if it shipped is Finding 1. `swagger-cli`
reported the spec as valid, and reading the YAML top to bottom it looked internally
consistent — the `Problem` schema is well formed and its example is a legal problem object.
Validation checks *structure*; it cannot tell you that one example, correct on its own,
becomes wrong the moment it is reused for a response with a different status. Only
*executing* the contract surfaced that, because the mock had to actually produce a body for
a `401` and a `422` and it produced the `409` example both times. That is the difference
between reading a spec and running it: reading confirms it is well formed, running shows how
it behaves.

If I could fix only one thing before handing this to a developer on Day 3, it would be
Finding 1. The `400`/`422` ambiguity is a consistency papercut that a developer will notice
and resolve while implementing. The error-body mismatch is worse: it looks correct at the
status-code level, so it passes a naive check and slips into a client that then behaves
wrongly for a user who is simply logged out. Fix the defect that causes silent wrong
behaviour before the one that only causes inconsistent style.