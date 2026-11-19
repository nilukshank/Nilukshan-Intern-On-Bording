# BookSwap — Storage and Cache Decisions

**Author:** AI Engineering Intern, Day 2 · **Status:** Proposed for Sprint 0 · **Date:** 2026-07-21

**Summary:** One Azure SQL database is the single source of truth for all business records. Blob Storage holds photo bytes, Redis holds short-lived copies of two provably hot reads, and Service Bus carries every piece of work the user should never wait for. Nothing lives *only* in the cache or the queue.

---

## 1. Data inventory

Assumptions: ~500 members and up to 5,000 books per building (per the NFR); the product scales to ~10 buildings in year one → ~50,000 books. ~10% of books are borrowed in any month → ~500 loans/month/building.

| Data type | Example record | Volume estimate (1y) | Read/write ratio |
|---|---|---|---|
| Member profile | 1 row per member (name, unit, contact — contact never serialized to API) | ~5,000 rows | read-heavy, ~50:1 |
| Book listing | 1 row per book (title, author, ISBN, condition, availability, photo URL) | ~50,000 rows | very read-heavy, ~100:1 (every search/browse reads; creates/edits are rare) |
| Book photo | 1–3 JPEG/PNG blobs per book, ≤5 MB each | 50k–150k blobs, up to ~750 GB | write-once, read-many |
| Borrow request | 1 row per ask (pending → accepted/declined) | ~120,000 rows (~2× loans) | balanced, ~5:1 — written once, read a handful of times |
| Loan | 1 row per accepted request (out / returned / overdue, due = +30 days) | ~60,000 rows | ~10:1 — history pages read repeatedly |
| In-app notification | 1 row per event delivered to a member | ~300,000 rows (retain 90 days) | ~1:1 — written once, read once or twice |
| Weekly digest job | 1 transient queue message per member per week | ~260,000 messages (never stored) | consumed once |

## 2. Storage selection

| Data type | Chosen store | Why this store | Why not the alternatives |
|---|---|---|---|
| Members, books, borrow requests, loans, notifications | **Azure SQL** (one database, five tables) | The data is naturally relational: `books.owner_id → members`, `loans.book_id → books`, `loans.borrower_id → members`. "Borrower history per book" is one indexed JOIN; "overdue" is `status='out' AND due_at < now()` — a date predicate, not a batch job. Accepting a request must update the request, insert a loan, and flip `books.available` **atomically** — a single ACID transaction. | **Cosmos DB:** buys schema flexibility we don't need (book fields are stable) and gives up cheap cross-entity transactions (atomicity only within a partition) and ad-hoc JOINs — we'd rebuild them in app code. At 50k rows the RU pricing model buys nothing. **Separate DB per entity:** premature — the whole dataset is a few hundred MB. |
| Book photos | **Azure Blob Storage** (SQL stores only the URL) | Binary, up to 5 MB, write-once read-many; Blob is pennies per GB, scales horizontally, fronts a CDN, and the API can hand the mobile app a short-lived SAS URL so image bytes never pass through the Node process. | **SQL `varbinary`:** ~750 GB of images would bloat the database and every backup ~2,000× versus the ~300 MB of actual row data, pollute the buffer pool, and pull image bandwidth through the most expensive tier. Also explicitly forbidden by the NFR. |
| Catalogue search (title / author / ISBN) | **Azure SQL full-text index** (+ B-tree indexes on `isbn`, `created_at`) | 5,000 rows per building fits in memory; an indexed full-text query over 50k rows returns in single-digit milliseconds — the 300 ms p95 NFR has ~two orders of magnitude of headroom. One system of record stays consistent with itself. | **Azure AI Search:** an inverted index earns its keep at millions of documents or when relevance ranking matters. Here it adds ~USD 75+/month, indexer sync lag, and a second system that can disagree with SQL — for a query SQL already answers in <10 ms. Revisit if the catalogue passes ~1M books or we add fuzzy/semantic search. |
| Hot read copies | **Azure Cache for Redis** (cache-aside only) | Sub-millisecond reads on the two paths with a real hit-rate hypothesis (§3). | **"Cache everything":** caching without a hit-rate hypothesis is extra infrastructure and extra staleness bugs (the facilitator's exact pitfall). |
| Async work (notifications, digest email) | **Azure Service Bus** (queues: `borrow-events`, `digest-jobs`) | Durable buffer with peek-lock delivery, automatic retry, dead-lettering, and scheduled messages (the weekly digest is literally a scheduled enqueue). Decouples the API from the email service — the NFR requires listing to succeed while email is down. | **Storage Queues:** no native DLQ semantics, ordering, or scheduled delivery — we'd hand-roll all three. **Event Hubs/Kafka:** built for high-throughput stream replay; we dispatch hundreds of work items a day, not millions of events an hour. |

**Source of truth, stated plainly:** Azure SQL is the system of record for every business fact (members, books, requests, loans, notifications). Blob Storage is the system of record for photo *bytes* (SQL keeps the URL). Redis only ever holds **copies** that can be lost at any moment. Service Bus only ever holds **work in flight**, never the sole copy of a fact.

## 3. Cache plan

**What is hot enough to cache?** Two reads dominate, and both change far slower than they are asked for:

1. `books:list:p1:s20:all` — the default catalogue landing page (page 1, no filters, newest first). Nearly every app open requests it: ~500 members × several opens/day vs. a handful of new listings/day → hit rate well above 95%.
2. `books:recent10:{buildingId}` — the "10 most recently added books". Shown on the home screen **and** reused by the weekly digest builder, so one cached value serves both.

Book detail (`book:{id}`) is cached opportunistically with the same pattern.

**Cache-aside (pseudocode):**

```js
async function getCatalogueFirstPage(buildingId) {
  const key = `books:list:p1:s20:all:${buildingId}`;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);          // hit: ~1 ms

  const rows = await db.query(                    // miss: ~10 ms, still well under 300 ms
    "SELECT TOP 20 * FROM books WHERE building_id=@b ORDER BY created_at DESC", { b: buildingId });

  // TTL 60s: a brand-new listing may take up to 60s to appear on page 1 —
  // acceptable for a neighbourhood catalogue, and it caps staleness even if
  // an invalidation is ever missed.
  await redis.set(key, JSON.stringify(rows), "EX", 60);
  return rows;
}

async function updateBook(bookId, patch) {
  const updated = await db.update("books", bookId, patch);  // 1. source of truth first
  await redis.del(`book:${bookId}`);                        // 2. invalidate the copy
  return updated;                                           // next read repopulates
}
```

**TTL and invalidation strategy:**

| Key | TTL | Invalidation | Rationale |
|---|---|---|---|
| `books:list:p1:s20:*` | 60 s | TTL only | Filtered/paged variants are many; deleting them all needs SCAN. A 60 s ceiling on staleness is cheaper and fine for browsing. |
| `book:{id}` | 300 s | `DEL` on PATCH + TTL backstop | Detail views should reflect an owner's edit immediately; explicit delete gives that, TTL catches missed deletes. |
| `books:recent10:{building}` | 300 s | `DEL` on new listing | Also read by the digest worker — 5 min staleness is invisible in a weekly email. |

**When *not* to cache (required example):** **loan and borrow-request state.** Correctness of the 409 rules ("book already on loan", "request already decided") depends on the *current* row — a 60-second-stale cache could let two neighbours "borrow" the same book. The read is also cheap (single-row PK lookup) and re-read ratio is low, so a cache adds risk and buys nothing. Same logic: never cache anything private per-member, and never cache photo bytes (Blob + CDN already is that cache).

**If Redis goes down:** every read falls through the `if (cached)` branch to SQL. p95 rises from ~1 ms toward ~10–30 ms — degraded, not down. The cache is an optimisation, never a dependency.

## 4. Queue plan

**What goes on the queue and why:**

| Trigger (sync path) | Message → queue | Consumer does | Why async |
|---|---|---|---|
| `POST /books` returns 201 | `BookListed` → `borrow-events` | Feeds the recent-10 list / future "interested member" alerts | NFR: listing must succeed even if email is down — the API never calls email inline |
| `POST .../borrow-requests` returns 201 | `BorrowRequested` → `borrow-events` | Inserts the owner's in-app notification row (+ optional email) | Owner notified within 2 s (Service Bus delivery is typically well under 1 s) without the borrower waiting on it |
| `PATCH /borrow-requests/{id}` | `RequestDecided` → `borrow-events` | Notifies the borrower | Same |
| Sunday 18:00 timer (Azure Functions timer) | one `DigestRequested` per member → `digest-jobs` | Builds top-10 (from `books:recent10` cache, else SQL) → sends via ACS Email | Explicitly best-effort per the NFR; retries must never touch the request path |

**What happens if the consumer is down for 30 minutes:** nothing is lost and no user is blocked. Messages accumulate durably in Service Bus (default retention far exceeds 30 min); the API keeps returning 201s at full speed. On restart the worker drains the backlog — at our volumes (hundreds of messages) that is seconds of work. Delivery is peek-lock: a message only disappears after the worker completes it, so a crash mid-message means redelivery, not loss. After `maxDeliveryCount` (10) failed attempts a poison message moves to the **dead-letter queue**; we alert on DLQ depth > 0 and on queue age > 5 min (which is also how we'd notice the 2 s in-app SLA degrading during an outage). Consumers are **idempotent** — they key side effects on `messageId`, so a redelivered message never double-sends an email or duplicates a notification.

## 5. One-glance table layout (Sprint 0 basis)

`members(id PK, display_name, unit_no, phone†, email†)` · `books(id PK, owner_id FK, title, author, isbn, condition, description, photo_url, available, created_at)` · `borrow_requests(id PK, book_id FK, borrower_id FK, status, message, decided_at, created_at)` · `loans(id PK, book_id FK, borrower_id FK, status, borrowed_at, due_at, returned_at)` · `notifications(id PK, member_id FK, type, payload_json, read_at, created_at)`.
† returned by no API response — enforced by explicit column selection in queries, never `SELECT *`.

## 6. Retry policy for 5xx (Day-3 preview)

Clients and the worker retry only **idempotent** operations (GETs; PATCH return/decide, which are guarded by 409) on 5xx, with exponential backoff and jitter (250 ms → 4 s, max 3 attempts). `POST /books` and `POST .../borrow-requests` are not retried automatically until the API supports an `Idempotency-Key` header (proposed spec change #3 in the mock report). Server-side, the queue worker relies on Service Bus redelivery + DLQ rather than in-process retry loops.
