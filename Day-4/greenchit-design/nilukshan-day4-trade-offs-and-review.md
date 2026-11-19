# GreenChit — Trade-offs and Design Review

**Author:** {your-name} · **Date:** 2026-08-11 · **Reviewed with:** {partner pair name}

---

## Setup

### Two architectural options under review

- **Option A — App Service.** One ASP.NET Core deployable on App Service P1v3 with
  staging/production slots; async work in two Consumption Functions.
- **Option B — Container Apps.** Three containerised services built via ACR, provisioned
  with Bicep, scaling independently.

### Quality attributes and why these six

Chosen by walking the brief's constraints, not by picking generic architecture words.

| Attribute | Traced to |
|---|---|
| Time-to-first-deploy | 6-week internal release window |
| Cost (low spend) | Internal tool; finance sponsor watches the Azure bill |
| Operability for a 10-person team | No platform engineer, no on-call after handover |
| Independent deploy | Named in the brief as a discriminator |
| Future scaling | ~300 staff today; headcount growth is the open question |
| Authn/authz consistency | NFR 5 — four principals, one of which is a *relationship* |

**Weighting.** We did not apply numeric weights, deliberately. Weights hide the argument
inside a multiplier. We scored flat, then named which rows decide it.

---

## The trade-off table

| Quality attribute | A: App Service | B: Container Apps | Why |
|---|:---:|:---:|---|
| Time-to-first-deploy | **5** | **2** | A is a deploy the team has done before — roughly 1 day. B needs Bicep, a Dockerfile per service, ACR, registry auth and ingress before one claim saves: ~6–8 days against a 6-week deadline. |
| Cost (low spend) | **3** | **4** | **B wins.** A pays for P1v3 continuously (~AUD 190/mo), and NFR 3 rules out cheaper Basic because we need deployment slots. B's consumption billing with scale-to-zero outside business hours costs ~AUD 100/mo compute, offset by ACR and heavier logging. All-in A ≈ 280, B ≈ 190. A scores 3 not 2 because its bill is flat and forecastable. |
| Operability for a 10-person team | **5** | **3** | A: one deployment, one log stream, one place to look at 09:00 when submissions fail. B: three revision histories, per-service scale rules, an ingress layer — with no platform engineer to hold it. |
| Independent deploy | **1** | **5** | A redeploys the whole API to change a CSV column order. B ships the export worker alone in two minutes. B is unambiguously better here. |
| Future scaling | **3** | **5** | B scales per service on its own signal. A scales as one unit. A gets 3 not 1 because P1v3 scale-out to 3 instances covers ~40× current peak — a real ceiling, but distant. |
| Authn/authz consistency | **5** | **3** | In A, Entra validation and the authorization policy are configured once in one middleware pipeline; every endpoint inherits them. In B, three services validate tokens and service-to-service calls need their own identity model. An authorization bug here is an HR incident. |
| **Total** | **22** | **22** | **Tied — the total is not the answer.** |

---

## Results Summary

| Metric | Target | Achieved |
|--------|--------|----------|
| Quality attributes scored | 6 | 6 |
| Cells with a written justification | 12 | 12 |
| Decision-affecting attributes identified | 2–3 | 2 |
| Rows where the losing option won | — | 3 (cost, independent deploy, future scaling) |

---

## Decision and rationale

**We choose Option A (App Service).**

The totals tied at 22–22 — the clearest possible evidence that the sum is an artefact of
how many rows we wrote rather than a measure of fit. A seventh row would have "decided" it
either way. We therefore decided on **two named attributes**:

1. **Time-to-first-deploy (5 vs 2).** Six-week window, no container experience on the team.
   Option B spends the first fortnight learning infrastructure instead of shipping a
   claims workflow.
2. **Operability for a 10-person team (5 vs 3).** After handover there is no platform
   engineer and no on-call rotation. A design requiring skills the operating team does not
   have is the wrong design, however good its diagram.

**What we lost, stated plainly:**

- **Cost.** Option B is ~AUD 90/month cheaper — roughly AUD 1,080/year. We chose the more
  expensive option. Option B would consume 6–8 engineering days in setup, worth
  considerably more than AUD 1,080. We consider the money bought, not wasted — but we lost
  this row and the finance sponsor is entitled to hear it.
- **Independent deploy (1 vs 5).** We accept a 1. It is only valuable when separate teams
  need separate release trains; GreenChit has one team and one cadence, so the capability
  has nobody to spend it. This is the row we expect a reviewer to attack, and the honest
  answer is "correct, and it buys us nothing yet."

Recorded in **ADR-0002**, with revisit triggers in `trade-offs/hosting-options.md`.

---

## Design review feedback (received from another pair)

> **TO BE COMPLETED IN HOUR 4.** Swap packs with your partner pair, have them run the
> design-review checklist against this pack, and paste their notes here verbatim.
> Do not write this section yourself — the rubric awards marks for a real exchange.

**3 strengths**
1.
2.
3.

**3 weaknesses or risks** *(at least one must be a risk — something that will bite later —
not only a gap, something absent today)*
1.
2.
3.

**2 actionable improvements** *(each naming a file, a section, and a suggested change)*
1.
2.

---

## Design review feedback (given to another pair)

> **TO BE COMPLETED IN HOUR 4.** Run the design-review checklist against their pack.
> Cite a file and section for every point. You must leave at least one disagreement —
> agreement-only review scores as theatre.

**Pair reviewed:**

**3 strengths**
1.
2.
3.

**3 weaknesses or risks**
1.
2.
3.

**2 actionable improvements**
1.
2.

**Our one disagreement, delivered verbally:**
