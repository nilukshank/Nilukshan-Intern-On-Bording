# ADR 0003: Use Azure SQL Database with ledger tables for claims and audit

## Status

Accepted (date: 2026-08-10)

## Context

- The brief leaves the store to us: Azure SQL or Cosmos DB, defended here.
- **NFR 4 is the dominant force.** The audit log must be tamper-evident and kept for
  7 years. Tamper-evident is stronger than "we keep a log": it means a change must
  leave a mark that cannot be hidden, and the mark must survive someone with database
  administrator rights. A plain `audit_log` table fails this - one `UPDATE` rewrites a
  row and the table still looks completely normal.
- Protection that lives only in application code does not survive 7 years. In that
  time the database is migrated, restored, and possibly accessed by tools that never
  run our code.
- **The data shape is relational.** A claim has line items, a status, a claimant, an
  approver, and a chain of transitions. More importantly, finance's real questions
  span thousands of claims at once - "total approved claims by cost centre, by month".
  That is one `SUM` with a `GROUP BY` over tables. Against self-contained documents it
  means opening every document and aggregating in application code.
- **The volume is small.** Roughly 300 staff submitting a few claims each per month.
  This is megabytes per year. Neither global distribution nor elastic scale is needed.
- Finance staff already know SQL and Power BI. The team's strongest existing skill is
  EF Core against SQL Server, which matters against a 6-week deadline (ADR-0002).
- We do not yet know whether GreenChit will later ingest OCR output per receipt. That
  would be semi-structured, and is the one future requirement that would have favoured
  a document store.

## Decision

We use **Azure SQL Database, Standard S1**, with:

- **Ledger tables** for `Claims` and `ClaimTransitions`. Azure SQL hash-chains every
  row version and publishes database digests to immutable Blob storage. Verification
  is a built-in query (`sys.sp_verify_database_ledger`), not a promise we make. This
  gives tamper evidence against a database administrator, which application-level
  hashing cannot.
- **Row-Level Security** on `Claims` as defence in depth behind the application's
  authorization component (NFR 5).
- The **audit row and the state change it records commit in the same transaction**, so
  a crash can never leave a state change with no audit row.
- **Long-term retention backups held for 7 years** to satisfy the finance policy.
- `rowversion` columns for optimistic concurrency on the approve path.

## Consequences

- **Easier:** tamper evidence becomes a schema decision rather than a mechanism we
  build, test, and are eventually wrong about. Claim, audit and event writes are a
  single transaction. Finance can point Power BI straight at the data.
- **Harder:** ledger tables constrain schema evolution. You cannot drop or rename a
  column on a ledger table without recreating it, which breaks the chain we depend on.
  Every migration must be additive for the life of the system, and the team must learn
  that rule before the first migration, not after.
- **Harder:** restoring to a point in time breaks digest continuity from that point, so
  a restore is now an event requiring a written note to the auditor. The runbook has to
  cover it.
- **Different:** we pay a fixed tier (~AUD 45/month) whether or not anyone submits a
  claim. At this volume that is cheaper than the alternative and simpler to forecast.

## Alternatives considered

- **Cosmos DB (NoSQL API).** Rejected on two independent grounds. First, it has no
  equivalent of ledger tables, so we would hand-build a hash chain in application code
  and then defend that home-made scheme to a finance auditor - exactly the position
  NFR 4 exists to prevent. Second, finance's reporting spans many claims at once,
  which suits tables and joins rather than self-contained documents. Cosmos is the
  better engine for global distribution and unbounded scale; GreenChit needs neither.
- **Cosmos DB plus Synapse Link for reporting.** Rejected as the above plus a second
  system to operate, for data measured in megabytes.
- **Azure SQL with a separate append-only audit store.** Rejected: writing the audit
  record outside the claim transaction reintroduces the risk of losing it exactly when
  it matters most.
- **Azure SQL Serverless.** Rejected: auto-pause would add a cold start to the first
  submit of the morning, which is the 08:00 window the SLO covers.