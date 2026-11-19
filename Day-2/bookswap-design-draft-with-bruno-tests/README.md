# BookSwap — Day 2 Backend Design

Design-only deliverable for the BookSwap community book-lending marketplace (Colombo apartment block): REST API contract, storage/cache/queue decisions, and a C4 Level 2 container diagram. No application code — this is what a developer would pick up on Day 3 of their week.

## How to read the diagram (5 sentences)

The Member uses the React Native Mobile App, which signs in against Microsoft Entra External ID and then calls the stateless Node.js API Service over HTTPS with a Bearer JWT — solid arrows are synchronous request/response. On every read, the API tries Azure Cache for Redis first (cache-aside) and falls back to Azure SQL, which is the single system of record for members, books, borrow requests, loans, and notifications. Photo bytes never touch the API or the database: the API issues a short-lived SAS URL and the Mobile App uploads directly to Azure Blob Storage. Anything a user should never wait for — owner notifications and the weekly digest — is published to Azure Service Bus as a dashed orange asynchronous message, so listing a book succeeds even if email is down. The Digest & Notification Worker consumes the queue, writes in-app notifications back to SQL, and sends the weekly digest through Azure Communication Services Email.

## Repository map

```
bookswap-design/
├── diagrams/
│   ├── container-diagram.png       # export for submission
│   └── container-diagram.drawio    # editable source (diagrams.net)
├── openapi/
│   └── bookswap-openapi.yaml       # OpenAPI 3.1.0 — validates clean
├── decisions/
│   └── storage-decisions.md        # storage / cache / queue memo
├── mock/
│   ├── smoke-test.sh               # reproducible smoke-test runner
│   └── mock-report.md              # results + findings + spec changes
└── README.md
```

## Reproduce the validation and smoke tests

```bash
npx -y @apidevtools/swagger-cli validate openapi/bookswap-openapi.yaml
bash mock/smoke-test.sh     # starts Prism on :4010, runs all 6 tests, prints actual codes
```

Heads-up: the CLI package is **`@stoplight/prism-cli`** — the name `@stoplight/prism` used in the session brief 404s on npm (see mock/mock-report.md, Finding 1).

## Two deliberate diagram decisions (defended)

1. **A ninth container (the Worker) beyond the required eight.** A queue with no consumer does nothing — Service Bus needs a process on the other end. Putting consumption in a separate worker keeps the API stateless and fast and makes the sync/async boundary visible.
2. **No arrow from the API to Blob Storage.** Generating a SAS URL is a local cryptographic operation using the storage account key — it involves no network call to Blob, so drawing an arrow would misstate the runtime behaviour. The only data path to Blob is the Mobile App's direct PUT/GET.

## Before submitting

Rename files to the convention, e.g.:

```bash
NAME=your-name   # e.g. kasun-perera
cp openapi/bookswap-openapi.yaml   ../$NAME-day2-bookswap-openapi.yaml
cp decisions/storage-decisions.md  ../$NAME-day2-storage-decisions.md
cp diagrams/container-diagram.png  ../$NAME-day2-container-diagram.png
cp mock/mock-report.md             ../$NAME-day2-mock-report.md
```
