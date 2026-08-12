# ADR 0002: Host GreenChit on Azure App Service as a single deployable

## Status

Accepted (date: 2026-08-10)

## Context

- The brief leaves hosting to us: App Service or Container Apps, defended here.
- Hard deadline: a working internal release in 6 weeks.
- The team has built on App Service before. Nobody has production experience with
  containers, Bicep, or a container registry. Option B costs an estimated 6-8 days of
  setup before a single claim can be saved.
- After handover there is no platform engineer and no on-call rotation. Whoever
  operates GreenChit needs one place to look when something fails.
- Load is small: roughly 300 staff, under 50 submissions per peak hour.
- NFR 3 (99.9% during 08:00-19:00 SLST, Mon-Fri) works out to about 14 minutes of
  downtime per month. It also rules out the Basic tier, because we need deployment
  slots to release during business hours without a restart.
- NFR 5 requires that only the claimant, line manager, finance and audit role can see
  a claim, so authorization consistency carries unusual weight.
- Full scoring is in `trade-offs/hosting-options.md`. It ends 22-22.
- We do not yet know whether BISTEC will consolidate other internal tools onto a
  shared container platform. If three or four arrive, this decision changes.

## Decision

We host GreenChit as a single ASP.NET Core deployable on **Azure App Service, Premium
V3 (P1v3)**, with staging and production deployment slots and slot-swap releases. One
CI pipeline builds and deploys the whole API.

Routine releases go out after 19:00 or at weekends, where downtime costs nothing
against the business-hours SLO. Urgent daytime fixes deploy to the staging slot, warm
up, then swap routing - no restart, no measured downtime.

We revisit this when sustained load exceeds 200 RPS, when a second team needs its own
release cadence, or when a third internal tool would share a container platform.

## Consequences

- **Easier:** first deploy in about a day rather than a week. One deployment, one log
  stream, one Application Insights resource - one place to look at 09:00 when
  submissions fail. Entra ID validation and the authorization policy are configured
  once in one middleware pipeline, so every endpoint inherits them.
- **Harder:** everything runs in one app, so one failing part takes the whole system
  down. A bug in CSV export can stop claim submission, which had nothing wrong with
  it. Against a ~14-minute monthly downtime budget, one bad crash during business
  hours spends most of it.
- **Harder:** any change redeploys everything. Changing one CSV column order ships the
  workflow engine and audit writer with it, carrying full regression risk.
- **Different:** we pay about AUD 90/month more than Option B - roughly AUD 1,080/year,
  against the 6-8 engineering days Option B would consume in setup, which is more than
  a week of engineering time. We consider the money bought, not wasted, but we are on
  record that we lost the cost row.

## Alternatives considered

- **Azure Container Apps, three services.** Rejected on time-to-first-deploy (2 vs 5)
  and operability (3 vs 5), not on merit. It genuinely wins on independent deploy
  (5 vs 1), future scaling (5 vs 3) and cost (4 vs 3). But GreenChit has one team and
  one release cadence, so independent deploy has nobody to spend it, and the 6-week
  window does not survive learning Bicep, ACR and revision management alongside
  building the product.
- **Azure Functions for everything.** Rejected: cold starts are unpredictable against a
  1.5 s p95 submit budget, and a Premium plan would cost more than P1v3.
- **App Service Basic (B1).** Rejected: no deployment slots, so every release is
  downtime inside the business-hours SLO.
- **Azure Kubernetes Service.** Rejected without deep analysis. An internal tool for
  300 staff does not justify a cluster, and there is nobody to run it.