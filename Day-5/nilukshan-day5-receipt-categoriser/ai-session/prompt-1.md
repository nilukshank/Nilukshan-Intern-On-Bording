# Prompt 1 — first implementation pass

**Agent:** Claude (Opus) · **Date:** 2026-08-17 · **Mode:** spec-led, single message

> Copied verbatim. Note what is *not* here: no "make it work", no chat, no
> description of the feature in my own words. The spec is the description.

---

You are implementing a feature in TypeScript. Below is the complete spec and the
complete acceptance criteria. Implement the feature so that all acceptance criteria
that do not require a live Azure environment can be made to pass with a test runner.

Constraints:
- Touch only files under `src/categoriser/` and `tests/`.
- Node 22 with native TypeScript stripping. No build step, no new dependencies,
  no test framework beyond `node:test`. Use erasable-only TypeScript syntax.
- Azure Document Intelligence, Azure OpenAI and Application Insights must sit behind
  injected ports so the tests can run offline and can *record* whether they were called.
- Do NOT invent fields, endpoints, status codes or behaviour that are not in the spec.
  If the spec is silent on something you need, stop and list it rather than choosing.
- Keep the LLM path and the rule-based path in separate modules.

Before writing any code, list every ambiguity in the spec you would want resolved,
and say for each one whether it blocks implementation or not.

[paste spec/spec.md]
[paste spec/acceptance.md]
