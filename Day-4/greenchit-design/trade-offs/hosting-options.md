# Trade-off analysis: hosting options for GreenChit

Supports **ADR-0002**. Scored 2026-08-11.

## Options

- **Option A — App Service.** One ASP.NET Core deployable on App Service P1v3 with
  staging/production slots. Async work in two Consumption Functions.
- **Option B — Container Apps.** Three containerised services (claims API, notification
  worker, export worker) built through ACR, provisioned with Bicep, scaling independently.

## Scoring rules

1 = actively bad for GreenChit, 5 = excellent for GreenChit. Scores are relative to
**this** system's requirements, not to the platforms in the abstract. Every cell carries
a written justification; a score without one is not a score.

| Quality attribute | A: App Service | B: Container Apps | Why |
|---|:---:|:---:|---|
| Time-to-first-deploy | **5** | **2** | A is a deploy the team has done before — roughly 1 day. B needs Bicep, a Dockerfile per service, ACR, registry auth and ingress config before a single claim saves: an estimated 6–8 days against a 6-week deadline. |
| Cost (low spend) | **3** | **4** | **B wins.** A pays for P1v3 continuously (~AUD 190/mo) whether or not anyone works, and NFR 3 rules out the cheaper Basic tier because we need deployment slots. B's consumption billing with scale-to-zero outside 08:00–19:00 costs ~AUD 100/mo compute, offset by ACR and heavier log ingestion. All-in A ≈ AUD 280/mo, B ≈ AUD 190/mo. A scores 3 rather than 2 because its bill is flat and forecastable. |
| Operability for a 10-person team | **5** | **3** | A gives one deployment, one log stream, one Application Insights resource — one place to look at 09:00 when submissions fail. B gives three revision histories, per-service scale rules and an ingress layer. There is no platform engineer and no on-call rotation after handover. |
| Independent deploy | **1** | **5** | A redeploys the whole API to change a CSV column order. B ships the export worker alone in two minutes. B is unambiguously better — see the decision below for whether that is worth anything to us today. |
| Future scaling | **3** | **5** | B scales each service on its own signal. A scales as one unit. A scores 3 rather than 1 because P1v3 scale-out to 3 instances covers roughly 40× current peak (~50 submissions/hour) — a real ceiling, but a distant one. |
| Authn/authz consistency | **5** | **3** | NFR 5 restricts a claim to four principals, one of which is a *relationship* rather than a role. In A, Entra validation and the authorization policy are configured once in one middleware pipeline and every endpoint inherits them. In B, three services each validate tokens and service-to-service calls need their own identity model. An authorization bug here is an HR incident. |
| **Total** | **22** | **22** | **Tied. The total is not the answer.** |

## Decision and rationale

**We choose Option A.**

The totals tie at 22–22. That is the clearest possible evidence that the sum is an
artefact of how many rows we happened to write rather than a measure of fit — a seventh
row would have "decided" it in either direction. We therefore decided on **two named
attributes**, chosen because they map to the two hardest constraints in the brief:

1. **Time-to-first-deploy (5 vs 2)** — six-week window, no container experience on the
   team. Option B spends the first fortnight of a six-week project learning
   infrastructure instead of shipping a claims workflow.
2. **Operability for a 10-person team (5 vs 3)** — after handover there is no platform
   engineer. A design that requires skills the operating team does not have is the wrong
   design, however good its diagram.

**What we gave up, stated plainly:**

- **Cost.** Option B is about AUD 90/month cheaper — roughly AUD 1,080/year. We chose the
  more expensive option. Against that, Option B costs 6–8 engineering days in setup, which
  is more than a week of engineering time and worth considerably more than AUD 1,080. We
  consider the money bought rather than wasted, but we lost this row and say so.
- **Independent deploy (1 vs 5).** We accept a 1. Independent deploy is only valuable when
  separate teams need separate release trains; GreenChit has one team and one cadence, so
  the capability has nobody to spend it. This is the row we expect a reviewer to attack,
  and the honest answer is "correct, and it buys us nothing yet."

## Revisit triggers

- Sustained load above 200 RPS, or P1v3 scale-out reaching 3 instances routinely.
- A second team needing to deploy into GreenChit on its own cadence.
- A third BISTEC internal tool that would amortise Option B's setup cost across more than
  one product.
