# BookSwap — Storage & Messaging Decisions

**Status:** Accepted · **Applies to:** `diagrams/container-diagram.png`

Every container in the container diagram traces back to one of the decisions below.
The diagram is the picture of this document; if they disagree, this document wins.

---

## D1 — Azure SQL is the single system of record

**Decision.** All durable, relational, transactional state lives in Azure SQL Database:
`Member`, `Book`, `BookCopy`, `BorrowRequest`, `Loan`, `Notification`.

**Why.** Borrowing is inherently transactional — a book copy must not be lent to two
members at once. That needs ACID guarantees, foreign keys, and a unique constraint on
`(book_copy_id)` where `loan.returned_at IS NULL`. A document store would push that
invariant into application code.

**Consequences.**

- Only two containers connect to SQL: the **API service** and the **digest worker**.
- Nothing else may write to SQL. The cache never writes back to it.
- Connection over TDS on port 1433, TLS enforced, Managed Identity (no passwords).

**Placement in the diagram.** Bottom-centre, beneath the API service — the deepest layer.

---

## D2 — Azure Cache for Redis sits *in front of* SQL, on read paths only

**Decision.** Redis is a **cache-aside** read accelerator in front of Azure SQL. It is
**never** the system of record. Anything in Redis can be deleted at any moment without
data loss.

**What goes in it.**

| Key pattern | Contents | TTL |
|---|---|---|
| `books:available:page:{n}` | Paginated available-book listings | 60 s |
| `books:search:{hash}` | Search result ID lists | 60 s |
| `member:{id}:profile` | Display name, avatar URL, borrow count | 300 s |
| `book:{id}` | Single book detail projection | 60 s |

**What never goes in it.** Loans, borrow requests, or anything a decision is made on.
No session state either — the JWT carries the session.

**Read algorithm (cache-aside).**

1. API service reads Redis.
2. On miss, API service reads Azure SQL and writes the result back to Redis with TTL.
3. On write (new book, new loan), the API service **deletes** the affected keys rather
   than updating them — invalidate, don't reconcile.

**Consequences.** A cold or flushed cache degrades latency, never correctness. Stale
reads are bounded to 60 s on book data and 300 s on a profile, and that is acceptable for
a browse list.

**Placement in the diagram.** Drawn **directly between the API service and Azure SQL**, in
the same column, so the three form one vertical stack: API service → Cache → Database. A
read therefore meets Redis first as a matter of layout, and the API-to-SQL arrow has to
detour around the Cache box to reach the database — which is precisely the miss path.

Redis is connected *only* to the API service and deliberately has **no arrow of its own to
Azure SQL**: it never talks to SQL, because the API service orchestrates both. The *Read
path (cache-aside)* note beneath the database restates the order in words for anyone
reading the diagram cold.

---

## D3 — Azure Blob Storage holds book photos, never the database

**Decision.** Book cover photos (≤ 5 MB, JPEG/PNG/WebP) are stored as blobs in the
`book-photos` container. Azure SQL stores only the blob path plus content metadata.

**Why.** Binary payloads in SQL inflate backup size and cost, blow the row cache, and
cannot be served directly to clients. Blob storage is ~1/20th the cost per GB and can
be handed to the client directly.

**Access pattern.**

- **Upload:** mobile app `POST`s multipart to the API service; the API service validates
  size/MIME/virus-scan flag and writes the blob. The app never gets a write SAS.
- **Download:** the API service returns a **read-only, 15-minute, user-delegation SAS
  URL**. The client fetches the bytes from Blob Storage directly, so photo traffic never
  passes through App Service.

**Placement in the diagram.** Right-hand side at storage level, connected only to the
API service. The client-side SAS fetch is deliberately omitted from the arrows to keep
the diagram readable; it is described in the README instead.

---

## D4 — Azure Service Bus decouples the request from the email

**Decision.** A Service Bus **queue** (`bookswap-jobs`, with a `digest` and a
`notification` message type) sits between the API service and the digest worker.

**Why.** Sending email is slow (hundreds of ms to seconds), fails transiently, and is
not something a member should wait for. When a member taps *Request to borrow*, the API
service must persist the request and return `202 Accepted` in tens of milliseconds.

**Where exactly it sits.** **Between the API service (producer) and the digest worker
(consumer)** — never between the API and SQL, and never on any read path. The API service
writes to SQL synchronously *first*, then publishes the job. The queue is therefore
strictly on the **write / follow-up** path.

**Message contract.** Small, ID-only messages — `{ type, borrowRequestId, memberId,
correlationId }`. No PII in the message body; the worker re-reads current state from SQL
so it can never send an email based on stale data.

**Reliability.** Peek-lock, 5 delivery attempts, exponential back-off, then dead-letter.
Duplicate detection window of 10 minutes on `messageId` makes consumers idempotent.

**Placement in the diagram.** Left column, drawn with **dashed orange arrows** on both
sides (in and out) because both hops are asynchronous.

---

## D5 — The digest worker is a separate container, not a thread in the API

**Decision.** Queue consumption runs as an Azure WebJob (`Node.js`), deployed separately
from the API service.

**Why.** Independent scaling and blast radius: an email backlog scales the worker, not
the request tier, and a crashing worker cannot take down member-facing traffic.

**Consequences.** The worker needs its own SQL connection (D1) and its own ACS
credentials (D6). It is the only container that talks to the email service.

---

## D6 — Azure Communication Services sends all outbound email

**Decision.** ACS Email is the only egress point for email. Only the digest worker holds
its credentials.

**Why.** Managed reputation, DKIM/SPF, and delivery reporting without running our own mail
server. Keeping it behind the worker means the API service holds no email credentials at
all.

**Interface.** ACS Email offers both an HTTPS REST API and authenticated SMTP submission on
port 587. The worker uses SMTP submission so the same code path can be pointed at a local
SMTP sink in development, which is what the diagram's `[SMTP over TLS 587 · sync]` label
records.

**Placement in the diagram.** Bottom-left, downstream of the worker, with the returning
mail to the member drawn dashed — the member receives digests and notifications out of
band, long after the original request completed.

---

## D7 — Microsoft Entra External ID owns identity; BookSwap stores no passwords

**Decision.** Members authenticate against Entra External ID (CIAM). It issues the JWT;
the API service validates it against the published JWKS and caches the signing keys.

**Why.** No password storage, no reset flow, no MFA implementation to get wrong.

**Consequences.** Two arrows touch Identity: the mobile app signs in (OIDC + PKCE), and
the API service validates tokens (JWKS). `member.external_object_id` in SQL is the join
key to the Entra subject claim.

---

## Summary — one row per container

| Container | Technology | Responsibility | Sits where |
|---|---|---|---|
| Mobile app | React Native (iOS + Android) | Member-facing UI | The only container the member calls |
| API service | Node.js Express on Azure App Service | REST API, authorisation, business rules | The single front door |
| Database | Azure SQL | System of record (D1) | Deepest layer, behind the API and worker |
| Cache | Azure Cache for Redis | Hot read paths, 60–300 s TTL (D2) | Stacked between the API and SQL, read path only |
| Object store | Azure Blob Storage | Book photos ≤ 5 MB (D3) | Beside the API, write via API / read via SAS |
| Queue | Azure Service Bus | Digest + notification jobs (D4) | Between the API and the worker, write path only |
| Digest worker | Node.js on Azure WebJob | Consumes queue, sends mail (D5) | Downstream of the queue |
| Email | Azure Communication Services | Outbound digest + notifications (D6) | Downstream of the worker only |
| Identity | Microsoft Entra External ID | Authentication, JWT issuance (D7) | Beside the app and API |

## Rejected alternatives

| Considered | Rejected because |
|---|---|
| Cosmos DB as system of record | Cross-document transactions for the "one copy, one loan" invariant add cost and complexity for no benefit at neighbourhood scale. |
| Redis as session store | The JWT already carries the session; a session store would reintroduce server-side state. |
| Photos as `VARBINARY(MAX)` in SQL | Backup size, cost, and no direct-to-client delivery. |
| Storage Queues instead of Service Bus | No duplicate detection, no dead-letter semantics, no topics for later fan-out. |
| Sending email inline in the request | Couples member-visible latency to a third party; a transient ACS failure would fail the borrow request. |
| SendGrid | ACS keeps identity, email, and billing inside the Azure tenant. |
