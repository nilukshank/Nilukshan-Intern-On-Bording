# GreenChit — Reimbursement Claims Design Pack

Design pack for GreenChit, the BISTEC internal reimbursement claims system.
Intern Onboarding Track, Day 4.

> **Before submitting:** replace `YOUR-NAME` in both deliverable filenames and the
> `{your-name}` placeholders inside them, and complete both review sections in
> `YOUR-NAME-day4-trade-offs-and-review.md`.

## Start here

**[`YOUR-NAME-day4-greenchit-design.md`](YOUR-NAME-day4-greenchit-design.md)** — section 4
gives the reading order for everything else.

## The design in one paragraph

A React SPA talks to a single ASP.NET Core API on App Service. Receipts upload
**client-direct to Blob Storage** under short-lived signed URLs *before* the claim exists,
so a 50 MB attachment never sits inside the 1.5 s submit budget and no half-built claim is
possible. Submitting writes the claim, its audit row and an outbox event in **one Azure SQL
transaction**; a background publisher sends the event to Service Bus after the response has
already gone back, from which a Notification Worker posts a Teams card (falling back to
email) and an Export Worker writes the payroll CSV to SharePoint. Tamper evidence comes
from **Azure SQL ledger tables**, not application code. Authorization is decided in **one
component**, and the manager relationship is read live from Entra rather than stored.

## Contents

```
greenchit-design/
├── README.md
├── forces.md                                   # NFR -> forbids -> therefore
├── YOUR-NAME-day4-greenchit-design.md          # Deliverable 1
├── YOUR-NAME-day4-trade-offs-and-review.md     # Deliverable 4
├── diagrams/
│   ├── container-diagram.mmd                   # C4 L2
│   ├── component-diagram.mmd                   # C4 L3, Claims API
│   └── sequence-submit-approve.md              # Deliverable 2, happy path + 2 error paths
├── adrs/
│   ├── 0001-record-architecture-decisions.md
│   ├── 0002-hosting-platform.md                # App Service
│   ├── 0003-database-choice.md                 # Azure SQL + ledger tables
│   └── 0004-receipts-storage-and-virus-scan.md
└── trade-offs/
    └── hosting-options.md                      # Scored analysis behind ADR-0002
```

## Viewing and exporting diagrams

Mermaid sources render inline on GitHub and in VS Code (`Ctrl+K V`). To export PNGs, which
the deliverable requires:

```bash
npm install -g @mermaid-js/mermaid-cli
cd diagrams
mmdc -i container-diagram.mmd -o container-diagram.png -b transparent -w 2400
mmdc -i component-diagram.mmd -o component-diagram.png -b transparent -w 2400
mmdc -i sequence-submit-approve.md -o sequence-submit-approve.png -b transparent -w 2000
```

## Open questions for the client

1. What is the policy for **acting managers** during leave? Claims currently queue.
2. What is the agreed **recovery time** after a regional outage?
3. Who writes back the **`Paid`** transition, and through what contract?
