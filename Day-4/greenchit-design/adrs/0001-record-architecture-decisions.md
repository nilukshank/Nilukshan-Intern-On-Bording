# ADR 0001: Record architecture decisions

## Status

Accepted (date: 2026-08-11)

## Context

- GreenChit will be handed to whoever maintains BISTEC internal tooling. The people
  who operate it will not be the people who designed it.
- The finance policy requires claim records to survive seven years. The system will
  outlive the memory of every decision we are making this week.
- Two decisions in the brief are explicitly left to us to defend: App Service versus
  Container Apps, and Azure SQL versus Cosmos DB. A decision with no written defence
  is indistinguishable from an accident six months later.
- Several of our choices score badly on attributes a future reader will notice first.
  ADR-0002 accepts a 1 out of 5 on independent deploy. Without a written reason,
  someone will "fix" that and undo the decision along with it.
- We do not yet know which of these decisions will be revisited once real usage data
  exists, so we need a format that makes superseding cheap and visible.

## Decision

We record every architecturally significant decision as a numbered Markdown ADR in
`adrs/`, using the Michael Nygard template. A decision is architecturally significant
if reversing it would change more than one container, change a contract with an
external system, or change a cost or compliance posture.

ADRs are written **at the moment the decision is taken**, in the same commit as the
first diagram or code that assumes it. Accepted ADRs are immutable: we do not edit
them, we supersede them with a new ADR and mark the old one `Superseded by ADR-XXXX`.

## Consequences

- **Easier:** a new maintainer reads `adrs/` in order and reconstructs why the system
  looks the way it does. Design review has something concrete to attack.
- **Harder:** every significant change now carries a writing task, and the author has
  to admit in public what they rejected and why. This slows the first week of a project.
- **Different:** disagreement moves out of hallway conversation and into the repository,
  where it is diffable but also permanent. People are more careful, and less candid,
  in writing.

## Alternatives considered

- **A wiki page per decision.** Rejected: it drifts from the code, has no review gate,
  and nobody diffs it. The brief already pushes diagrams into git for the same reason.
- **Comments in code.** Rejected: they record what a line does, never the options that
  were rejected, and they disappear in the first refactor.
- **No formal record, rely on the design pack.** Rejected: the pack shows the end state.
  It cannot show that we seriously considered Cosmos DB and why it lost, which is
  exactly what a future maintainer needs before overturning the choice.
