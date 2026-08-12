# ADR 0004: Upload receipts direct to Blob Storage under short-lived signed URLs

## Status

Accepted (date: 2026-08-11)

## Context

- Receipts are up to **10 MB each, up to 5 per claim** — 50 MB worst case — uploaded
  from phones on office Wi-Fi the brief describes as intermittent.
- The submit round trip must be **under 1.5 s p95** (NFR 1). Streaming 50 MB through
  the Claims API cannot meet that, and it makes the API's memory profile hostage to
  file size.
- NFR 2 requires uploads to **succeed despite dropped connections**. A single large
  request has one failure mode: lose the connection at 80% and all 8 MB are gone.
  Recovering from that inside our own code means tracking which parts arrived and
  surviving a restart — machinery Blob Storage already provides.
- The brief mandates Blob Storage with a signed-URL pattern. It does not say **when**
  the upload happens relative to claim creation. That ordering is ours to decide, and
  it determines whether a half-built claim is possible.
- Receipts are arbitrary files uploaded by staff and later opened by managers, finance
  and auditors. An infected file reaching a finance officer's desktop is a real incident.
- We do not yet know how often staff will re-attach the same receipt to a second claim.

## Decision

**Receipts upload before the claim exists.**

1. The SPA calls `POST /receipts/upload-tokens`. The Claims API authorizes the caller
   and returns **write-only signed URLs valid for 20 minutes**, each scoped to a single
   blob path under `staging/`.
2. The SPA uploads using the **block blob API** in 4 MB blocks, so a dropped connection
   resumes at the last committed block instead of restarting the file.
3. **Microsoft Defender for Storage** scans each blob on upload and records the verdict.
4. `POST /claims` carries only blob IDs and a small JSON body. The API refuses to create
   the claim unless **every** referenced blob exists and is clean.
5. A **lifecycle rule deletes anything left in `staging/` after 24 hours**, so abandoned
   uploads clean themselves up with no background job.

We use **user-delegation SAS, never account-key SAS**: account keys cannot be attributed
to a user and cannot be revoked without rotating the key for every consumer.

## Consequences

- **Easier:** the 1.5 s budget is met by construction, because submit never carries file
  bytes. Dropped connections are handled by the storage SDK, not by us. Orphaned uploads
  are a lifecycle rule. There is no state in which a claim exists without its receipts.
- **Harder:** the SPA now talks to two endpoints with two different auth mechanisms, and
  front-end error handling gets more complex — several distinct failure codes at submit
  rather than one. The client is no longer a thin pass-through.
- **Harder:** scanning is asynchronous, so a claimant who taps Submit immediately after a
  large upload can be told to wait and retry. We accept a visible delay on a rare fast
  path in exchange for never distributing an infected file.
- **Different:** Defender for Storage is billed per GB scanned, adding a small variable
  line to an otherwise fixed bill, and it is a subscription-level setting the BISTEC
  platform team owns rather than us.

## Alternatives considered

- **Proxy uploads through the Claims API.** Rejected: breaks the latency budget, couples
  API sizing to file size, and gains only a marginally simpler client.
- **Create the claim first, then upload receipts against the claim ID.** Rejected: this
  is the ordering that manufactures the half-built claim. It needs a compensating
  transaction or a cleanup job to repair states we can simply never enter.
- **Account-key SAS with a long expiry.** Rejected: not attributable to a user, and
  revoking it means rotating the storage account key for everything.
- **Scan on read instead of on write.** Rejected: puts scan latency in the manager's
  approval path, and leaves malicious content sitting in our storage account.
