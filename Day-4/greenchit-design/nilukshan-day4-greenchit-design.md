# GreenChit — Architecture Design Pack

**Author:** {your-name} · **Date:** 2026-08-11 · **Status:** For design review

---

## 1. System Context

GreenChit is an internal BISTEC system replacing the spreadsheet-and-email reimbursement
process. A **claimant** (any staff member) submits a claim in LKR with a category, date,
amount, description and up to five receipt images. Their **line manager** — identified
from the Entra ID organisational graph rather than from anything GreenChit stores — is
notified in Microsoft Teams and can approve, reject, or request more information. A
**finance officer** exports approved claims to a CSV that the existing payroll automation
reads from a watched SharePoint folder. An **auditor** can read, but never alter, the full
history of any claim for seven years.

GreenChit does not pay anyone. It produces the authoritative record of *what was approved,
by whom, and when*, and hands that record to payroll. Every decision in this pack follows
from treating the audit trail — not the submission form — as the product.

**Boundaries.** GreenChit owns claim state and its audit ledger. It does not own identity
(Entra ID), message delivery (Teams, Exchange), the payroll drop folder (SharePoint), or
payment execution.

---

## 2. Containers (C4 Level 2)

![Container diagram](diagrams/container-diagram.png)

Source: [`diagrams/container-diagram.mmd`](diagrams/container-diagram.mmd) — renders
inline on GitHub and in VS Code with `Ctrl+K V`.

| # | Container | Technology | Responsibility |
|---|---|---|---|
| 1 | Claims SPA | React + TypeScript | Claim capture, receipt attachment, status tracking, approval UI |
| 2 | Claims API | ASP.NET Core 8, App Service P1v3 | Workflow state machine, authorization, audit ledger writes, outbox drain, signed-URL issuing |
| 3 | Claims Database | Azure SQL S1, ledger tables | Claims, line items, transitions, tamper-evident audit ledger, outbox table |
| 4 | Receipt Store | Blob Storage, `staging/` + `committed/` | Receipt images and malware scan verdicts |
| 5 | Event Broker | Service Bus Standard | Durable delivery of `claim.submitted` and `claim.approved` |
| 6 | Notification Worker | Azure Functions | Teams Adaptive Cards, email fallback, retry, dead-letter |
| 7 | Export Worker | Azure Functions, scheduled | Approved-claim CSV assembly and SharePoint write |

**External systems:** Microsoft Entra ID (SSO, app roles, manager graph), Microsoft Teams
(card delivery), Exchange Online (email fallback), SharePoint Online (payroll drop folder).

### Why each non-functional requirement lands where it does

| Requirement | Satisfied by |
|---|---|
| Submit under 1.5 s p95 | Receipt bytes never traverse the API (container 4); notification is asynchronous (containers 5 and 6) |
| 10 MB × 5 receipts over patchy Wi-Fi | Block-blob upload with per-block resume, direct from SPA to container 4 |
| 99.9% during 08:00–19:00 SLST | Releases after 19:00; urgent daytime fixes via App Service slot swap — no restart (ADR-0002) |
| Tamper-evident audit, 7 years | Azure SQL ledger tables verify cryptographically; audit row commits in the same transaction as the state change (ADR-0003) |
| Privacy: 4 principals only | One authorization component in container 2; manager relationship read live from Entra, never stored |

---

## 3. Components (C4 Level 3) — Claims API

![Component diagram](diagrams/component-diagram.png)

Source: [`diagrams/component-diagram.mmd`](diagrams/component-diagram.mmd).
**Notation is identical to Level 2** — same shapes, same colour roles, same verb-led edge
labels with protocols. The only change is that the boundary is now the Claims API and
inner boxes carry `[Component: Tech]`.

| # | Component | Technology | Responsibility |
|---|---|---|---|
| 1 | API Facade | ASP.NET Core controllers | Routing, request validation, HTTP status mapping |
| 2 | Authorization Policy Engine | Policy + requirement handlers | The single entry point for every access decision |
| 3 | Directory Adapter | MS Graph SDK | Reads the line manager relationship live from Entra |
| 4 | Claim Workflow Engine | C# domain service | State machine Draft → Submitted → Approved/Rejected → Paid, transition guards |
| 5 | Receipt Coordinator | C# + Storage SDK | Issues short-lived signed upload URLs, confirms scan verdicts |
| 6 | Audit Ledger Writer | C# + EF Core | Appends who/when/why rows inside the caller's transaction |
| 7 | Outbox Publisher | C# background service | Publishes events after the response has been returned |
| 8 | Export Assembler | C# service | Projects approved claims into payroll CSV rows |

**The load-bearing relationship:** components 4, 6 and 7 write inside **one database
transaction**. Claim state, audit row and outbox event commit together or not at all. That
single fact is why the audit ledger can be trusted, and why no state change can happen
without its audit record.

---

## 4. Reading order

1. **Section 1** — who the four principals are, and that the audit trail is the product.
2. **Section 2, the container diagram.** Follow the claimant's path first: Claims SPA →
   Claims API → Claims Database. Then the two asynchronous paths outward: API → Event
   Broker → Notification Worker → Teams, and → Export Worker → SharePoint.
3. **[`diagrams/sequence-submit-approve.md`](diagrams/sequence-submit-approve.md), happy
   path.** The same journey in time order. Note the four phases, and that receipts upload
   *before* the claim exists. If that surprises you, read ADR-0004 next.
4. **Section 3, the component diagram.** Only now zoom inside the API. Look for the single
   transaction spanning workflow, audit and outbox.
5. **The two error paths.** This is where the design earns its keep: an incomplete upload,
   and a Teams outage.
6. **The ADRs in order** — 0001 (why we write these), 0002 (hosting), 0003 (database),
   0004 (receipts).
7. **[`trade-offs/hosting-options.md`](trade-offs/hosting-options.md)** last. It ends in a
   22–22 tie, so read the decision rationale rather than the total.

**If you have ten minutes:** section 2, the happy path, and ADR-0002's Consequences.

---

## 5. What this design will NOT do in v1

- **No acting-manager or delegation support.** If a line manager is on leave, claims queue
  until they return. The Entra manager edge is the only routing rule. This is the most
  likely support ticket in week one and it is unresolved on purpose — BISTEC has no stated
  policy for acting approvers.
- **No multi-region or disaster recovery story.** Single region, point-in-time restore
  only. Recovery time is "however long a restore takes", which nobody has yet agreed.
- **No OCR.** Claimants type the amount; we do not read it off the receipt.
- **No write-back of `Paid`.** Payroll owns that transition and the contract for reporting
  it back is not yet designed.
- **No native mobile app.** The SPA is responsive; there is no separate client.
