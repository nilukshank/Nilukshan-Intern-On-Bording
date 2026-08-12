NFR 1:     Submit round-trip under 1.5 s p95

Forbids:   Sending receipt files through the API during submit.
           Calling Teams inside the request.

Therefore: Receipts travel outside the submit call. The manager is
           notified after the user already has their confirmation.



NFR 2:     10 MB × 5 receipts, must survive patchy connectivity

Forbids:   Sending the file as one lump. Uploading through the API.

Therefore: The phone uploads to Blob Storage directly, in chunks.


NFR 3: Availability: 99.9% during business hours (08:00-19:00 Sri Lanka Standard Time, Mon-Fri)

Forbids:   Deploying during business hours (08:00–19:00 SLST, Mon–Fri).

Therefore: Routine releases go out after 19:00 or at weekends, where
           downtime costs nothing. Urgent daytime fixes ship via App
           Service deployment slots — deploy to staging, warm it up,
           then swap routing. No restart, no measured downtime.

           Side effect: slots require a paid App Service tier. Basic
           has no slots. This constrains the cost row later.

NFR 4:     Audit log tamper-evident, retained 7 years

Forbids:   A plain audit table that a privileged user can edit or delete
           without leaving a trace. Protection that lives only in
           application code. Writing the audit row separately from the
           state change it records.

Therefore: The audit trail must be cryptographically verifiable by the
           database itself — Azure SQL ledger tables, which hash-chain
           every row version and publish digests to immutable storage.
           Verification is a query, not a promise. Audit row and state
           change commit in the same transaction. Backups retained
           7 years.

           Side effect: this is a strong argument for Azure SQL over
           Cosmos DB. Flag it for ADR-0003.

NFR 5:     Only claimant, line manager, finance, audit role may view a claim

Forbids:   Treating "line manager" as a role column — it's a relationship
           between two people, not a job title. Copying the org structure
           into our database, where it goes stale silently on a transfer.
           Scattering role checks across endpoints, where a new endpoint
           gets added without one.

Therefore: Roles come from Entra ID app roles in the token. The manager
           relationship is read live from Microsoft Graph, never stored —
           Entra already owns it. One component makes every access
           decision, deny by default. 