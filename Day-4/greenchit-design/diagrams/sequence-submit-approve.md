# Sequence — Submit and Approve a Claim



## Happy path

```mermaid
sequenceDiagram
    autonumber
    actor Claimant
    participant SPA as Claims SPA
    participant API as Claims API
    participant BLOB as Receipt Store
    participant DB as Claims Database
    participant BUS as Event Broker
    participant NW as Notification Worker
    participant TEAMS as Microsoft Teams
    actor Manager as Line Manager

    Note over Claimant,BLOB: Phase 1 — receipts upload before the claim exists,<br/>so 10 MB files never sit inside the 1.5 s submit budget

    Claimant->>SPA: Attach up to 5 receipt images
    SPA->>+API: POST /receipts/upload-tokens (bearer)
    API->>API: Authorize caller as Claimant
    API-->>-SPA: 201 Created, short-lived signed upload URLs

    loop per receipt, resumes if Wi-Fi drops
        SPA->>+BLOB: PUT Block, then PUT Block List
        BLOB-->>-SPA: 201 Created, blobId
    end

    Note over Claimant,DB: Phase 2 — submit is a small JSON call referencing blobIds

    Claimant->>SPA: Tap "Submit claim"
    SPA->>+API: POST /claims (blobIds, category, date, amount LKR)
    API->>API: Authorize and validate
    API->>BLOB: Confirm every blobId exists
    BLOB-->>API: All present

    rect rgb(238, 245, 252)
        Note over API,DB: One transaction — claim, audit row and event commit together
        API->>+DB: BEGIN TRAN
        API->>DB: INSERT claim (status = Submitted)
        API->>DB: INSERT audit ledger row (who, when, transition)
        API->>DB: INSERT outbox row (claim.submitted)
        API->>DB: COMMIT
        DB-->>-API: Committed
    end

    API-->>-SPA: 201 Created, status = Submitted
    SPA-->>Claimant: Confirmation, p95 under 1.5 s

    Note over API,Manager: Phase 3 — notification is asynchronous, so Teams<br/>latency cannot affect the claimant's 1.5 s budget

    API-)BUS: Publish claim.submitted (after responding)
    BUS-)NW: Deliver claim.submitted
    activate NW
    NW->>+API: GET /claims/{id} (managed identity)
    API-->>-NW: Claim summary and manager UPN
    NW->>+TEAMS: POST approval Adaptive Card
    TEAMS-->>-NW: 200 OK
    deactivate NW
    TEAMS-)Manager: Card appears in Teams

    Note over Manager,DB: Phase 4 — approval

    Manager->>SPA: Open card, tap "Approve"
    SPA->>+API: POST /claims/{id}/approve
    API->>API: Authorize caller as this claimant's line manager
    rect rgb(238, 245, 252)
        API->>+DB: BEGIN TRAN
        API->>DB: UPDATE claim SET status = Approved
        API->>DB: INSERT audit ledger row (approver, when)
        API->>DB: INSERT outbox row (claim.approved)
        API->>DB: COMMIT
        DB-->>-API: Committed
    end
    API-->>-SPA: 200 OK, status = Approved
    API-)BUS: Publish claim.approved
    SPA-->>Manager: Approved confirmation
```

---

## Error path 1 — a receipt upload never finished

**The decision:** the claim is **not created**. We refuse rather than accept a partial
claim, because a claim with 4 of 5 receipts reaches a manager who has no rule for judging
it, and reaches finance who pay real money against incomplete evidence. Preventing a bad
state is cheaper than managing one — every state we allow must then be handled in the UI,
in approval rules, in the audit ledger and in the CSV export.

This is why ADR-0004 uploads receipts **before** the claim exists: the ordering is chosen
so this failure cannot produce a broken claim.

**Two supporting decisions, visible in the diagram:**
- The API names **which** blobId is missing, so the SPA can highlight that one file rather
  than showing a generic error.
- Nothing was written to the database, so the SPA **keeps the typed details on screen**.
  The claimant re-attaches one file and submits again — roughly fifteen seconds.

```mermaid
sequenceDiagram
    autonumber
    actor Claimant
    participant SPA as Claims SPA
    participant API as Claims API
    participant BLOB as Receipt Store
    participant DB as Claims Database

    Note over Claimant,BLOB: 4 of 5 receipts uploaded. The fifth failed —<br/>the Wi-Fi dropped and never recovered.

    Claimant->>SPA: Tap "Submit claim"
    SPA->>+API: POST /claims (5 blobIds, category, date, amount LKR)
    API->>API: Authorize and validate
    API->>BLOB: Confirm every blobId exists
    BLOB-->>API: 4 present, 1 missing

    alt All 5 receipts present
        API->>DB: Commit claim, audit row and outbox row
        API-->>SPA: 201 Created, status = Submitted
    else One or more receipts missing
        Note over API,DB: Nothing is written. No claim row, no audit row,<br/>no partial state for anyone to interpret.
        API-->>-SPA: 422 Unprocessable Entity<br/>code = receipt_missing, blobId = {the missing one}
        SPA->>SPA: Keep the typed details on screen
        SPA-->>Claimant: Highlight receipt 5 only:<br/>"This receipt did not finish uploading. Re-attach it."
        Claimant->>SPA: Re-attach receipt 5, tap Submit again
    end
```

**Why 422 and not 500.** A 500 means "we broke". This is not a failure of the system — the
system correctly refused an invalid request. The claimant can fix it themselves, so the
response carries the information needed to fix it.

## Error path 2 — Teams is down, email fallback takes over

The claim is already safely `Submitted`. Only the notification is at risk, which is
exactly why it was moved out of the request.

```mermaid
sequenceDiagram
    autonumber
    participant BUS as Event Broker
    participant NW as Notification Worker
    participant TEAMS as Microsoft Teams
    participant EXO as Exchange Online

    BUS-)NW: Deliver claim.submitted
    activate NW

    alt Adaptive Card accepted
        NW->>+TEAMS: POST approval Adaptive Card
        TEAMS-->>-NW: 200 OK
    else Teams returns 429 or 5xx
        NW->>+TEAMS: POST approval Adaptive Card
        TEAMS-->>-NW: 429 Too Many Requests
        NW->>NW: Back off and retry once
        opt Second attempt also fails
            NW->>+EXO: Send approval email via Graph
            EXO-->>-NW: 202 Accepted
        end
    else Both channels fail
        NW--)BUS: Abandon message, Service Bus redelivers
        Note over NW,BUS: After 5 attempts the message dead-letters and raises<br/>an alert. The claim stays Submitted and still appears<br/>in the manager's queue in the SPA.
    end
    deactivate NW
```