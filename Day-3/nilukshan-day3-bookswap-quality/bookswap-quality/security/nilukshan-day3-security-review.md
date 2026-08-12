# BookSwap — Security Review

> Day 3 · Review of `openapi/bookswap-openapi.yaml` against the seven categories, with an
> OWASP ZAP baseline scan against the Prism mock.

---

## Review table

| Category | Question | Finding | Severity | Mitigation |
|----------|----------|---------|----------|------------|
| **Authn** | Is every non-public endpoint protected by JWT? | Global `security: [bearerAuth]`; only `/healthz` and `/readyz` opt out with `security: []`. Compliant. **But** verify token lifetime ≤ 1 h and that the signature is validated against the Entra JWKS with `iss`/`aud`/`exp` checks (Day 2 D7 claims this — confirm in code). | **L** | Keep global default; add a CI test asserting a `none`-alg or expired token is rejected `401`. |
| **Authz (BOLA)** | Does every `/{id}`-shaped endpoint check object ownership? | **Not proven in the contract.** `PATCH /books/{bookId}`, `POST /borrow-requests/{requestId}/approve` and `/decline`, and loan reads are authorization-sensitive. Nothing in the spec forces an ownership check — a member could act on a resource they don't own. | **H** | In each handler, scope the query to the caller: `WHERE owner_id = @callerSub`. Return **404** (not 403) for non-owned resources so existence isn't leaked. See BOLA scenario below. |
| **Injection** | Are all DB queries parameterised? | Day 2 storage doc shows parameterised queries (`WHERE id = $1`). The `q` free-text search param on `GET /books` flows into a query — confirm it is parameterised / passed to Azure AI Search as a bound term, not string-concatenated. | **M** | Parameterise every query; never concatenate `q`. Add a lint/CI check for raw SQL string concat. |
| **Secrets** | Where are connection strings stored? | Day 2 D1 uses **Managed Identity** (no passwords) for SQL; design mandates **Azure Key Vault**, no `.env` in prod. Compliant. | **L** | Use Key Vault references in App Service config; assert no plaintext connection strings in app settings. |
| **Transport** | Is TLS enforced at Front Door? | Design puts **Azure Front Door** in front with TLS. Confirm HTTPS-only redirect, **min TLS 1.2**, and HSTS. | **L** | Enable "HTTPS only", set min TLS 1.2, add HSTS header at Front Door. |
| **Rate limit** | Are auth and write endpoints rate-limited? | `429` responses are *declared* in the spec, but no rate-limit **rule** is defined. `POST /books`, `POST /borrow-requests`, and the `:send-now` digest trigger are abuse-prone (listing spam, notification spam). | **M** | Configure Front Door rate limiting (e.g. 100/min per IP on writes; tighter on `:send-now`). Wire the declared `429 + Retry-After` to the real limiter. |
| **PII** | What PII appears in responses, logs, or queues? | Responses: `Member` carries `email` + `apartment` — ensure these are only ever returned for `/members/me`, never for other members (ties to N5). Queue: Day 2 D4 says **ID-only, no PII** — good. Logs/traces: risk of Authorization headers or member email landing in App Insights `customDimensions`. | **M** | Never return another member's `email`/`apartment`. Redact `Authorization` and PII fields before logging; log **member ID**, not email. |

---

## Concrete BOLA scenario (required)

**Setup.** Mallory (member, valid JWT, `sub = mallory`) wants to approve a borrow request
on a book she does **not** own.

**Attack request:**
```
POST /borrow-requests/{requestId}/approve
Authorization: Bearer <mallory's valid JWT>
```
where `{requestId}` is a request against a book owned by **Alice**.

**Why it works (if unguarded).** The endpoint takes the request ID from the URL and, if
the handler only checks "is this a valid logged-in member?" (authentication) and not "does
this member own the book behind this request?" (authorization), Mallory opens a loan on
Alice's book. Same shape applies to `PATCH /books/{bookId}` (edit someone else's listing)
and guessing a `loanId` UUID to read another member's loan.

**Fix.** Every `/{id}` handler must load the resource, compare its owner to the caller's
`sub` claim, and return **404** if they differ (404, not 403, so the API doesn't confirm
the resource exists to a non-owner). Add an authorization test per endpoint.

---

## OWASP ZAP baseline scan

> ⚠️ Run this yourself and attach `zap-baseline-report.html` — the scan must be *your*
> artifact, and it needs the Prism mock running locally (Docker + network the sandbox here
> can't reach). Command:

```bash
# 1. start the mock
npx @stoplight/prism-cli mock openapi/bookswap-openapi.yaml --port 4010

# 2. run the ZAP baseline scan against it
docker run --rm -t -v "$PWD:/zap/wrk" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t http://host.docker.internal:4010 \
                  -r zap-baseline-report.html
```

**Expected baseline findings to discuss** (a baseline scan against a mock mostly surfaces
missing security headers — pick at least one and explain it):
- **Missing `Content-Security-Policy`** — low risk for a pure JSON API but flagged; note it
  applies to any HTML error pages Front Door serves.
- **Missing `X-Content-Type-Options: nosniff`** — add at Front Door to stop MIME sniffing.
- **Missing HSTS** (`Strict-Transport-Security`) — ties to the Transport finding above.
- Treat these as **Low** and be honest that a mock has no real auth logic, so ZAP cannot
  test BOLA — that's why the manual review above matters more than the scan.

---

## `threats.csv`

See `nilukshan-day3-threats.csv` — one row per finding with category, severity, and owner.
