# Prompt 2 — pushing back on the agent's output

**Agent:** Claude (Opus) · **Date:** 2026-08-17 · **Mode:** diff-led correction

> Note the shape: I am not saying "it's broken, fix it". I am naming the spec line
> the code disagrees with. The spec stays the source of truth on every iteration.

---

Three problems with the previous pass. For each, quote the spec line you violated,
then give me the diff only.

1. `CategoriserError` uses TypeScript parameter properties (`constructor(readonly
   status: number, ...)`). That is not erasable syntax, so `node --experimental-strip-types`
   refuses the file and **`npm test` does not run at all**. My constraint said no build
   step. Rewrite using plain field declarations.

2. AC-04 says the unparseable-image path returns `Other`. Your implementation still
   calls the LLM first and only falls back after it returns. Re-read §3.5 (cost, LKR 5
   per suggestion) — spending a completion on an image with no line items and no total
   is a spec violation even though AC-04 still passes. Short-circuit before the LLM call
   and add an assertion that `llmCalls === 0` on that path.

3. `telemetry.ts` builds the event with a spread of the request context and then deletes
   PII keys. AC-07 asserts *set equality* on the property names. A denylist passes today
   and leaks the first time someone adds a field. Rebuild it as an explicit allowlist
   with no spread, so the failure mode is a failing test rather than a leak.

Do not change the spec to match the code. If you think the spec is wrong, say so and
stop.
