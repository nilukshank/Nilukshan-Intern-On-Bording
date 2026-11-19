# Receipt Categoriser — AI-Driven Implementation Report

**Agent:** Claude (Opus) via Claude Code · **Date:** 2026-08-17
**Session length:** 2 prompts, ~35 minutes · **Hand-written code:** the fixture data only
**Result:** `npm test` → 15 assertions, 7 of 9 acceptance criteria, all passing

---

## Review log

| # | What I asked the AI | What it produced | Did it match the spec? | My fix / follow-up |
|---|---|---|---|---|
| 1 | First implementation pass, spec pasted whole, "list ambiguities before coding" (`prompt-1.md`) | Six ambiguities, then five source modules and a test file | **Partial.** It found two genuine holes in *my* spec before writing a line: no status code for a wrong file type, and a direct contradiction between §3.3 (`502` for "upstream OCR/LLM unavailable") and AC-03 (`200` when the LLM is down) | Amended the spec, not the code: added `415`, split the 502 case in two with the "Deliberate non-error" note, added AC-06 and `404 feature_disabled` |
| 2 | Same pass, code review by me | `CategoriserError` used TypeScript parameter properties | **No.** It broke an explicit constraint ("erasable-only syntax, no build step"). `npm test` executed **zero** tests — a green-looking terminal with nothing behind it | Quoted the constraint back, asked for a diff only. Rewrote as plain field declarations; 0 → 15 tests running |
| 3 | Same pass, cost review | The unparseable-image path called Azure OpenAI first and fell back afterwards | **Passed AC-04 but violated §3.5.** This is the interesting one: the acceptance criterion was green while the spec was being broken. AC-04 only asserted the output shape, never that we hadn't paid for a completion on a photo of someone's desk | Short-circuited before the LLM call **and tightened AC-04** to assert `llmCalls === 0`. The criterion was the defect, not just the code |
| 4 | "Rebuild telemetry as an allowlist" | Original built the event by spreading the request context and deleting `merchantName`, `ocrText` | **No.** A denylist passes AC-07 today and leaks the day someone adds a field | Explicit allowlist with no spread and no `delete`; exported `SUGGESTED_EVENT_PROPERTIES` so the builder and the set-equality test cannot drift |
| 5 | Nothing — unprompted | The agent challenged §3.4: "emitted within 5 s of the *response*" vs AC-01's "within 5 s of the *request*" — two different clocks | **The spec was wrong, not the code** | Settled on response-relative; AC-01 wording kept because claimant-visible latency is what AC-08 measures |

---

## The most expensive ambiguity

Not the missing status code — that would have been caught in code review in ten minutes.

It was **§3.3 vs AC-03**: the contract said an unavailable upstream returns `502`, and the
acceptance criterion said an unavailable LLM returns `200`. Both were written by me, forty
minutes apart, and both sounded right in isolation.

Given only §3.3, an agent builds a categoriser that fails closed — every Azure OpenAI blip
becomes a claimant staring at "something went wrong", and the whole point of the rule-based
fallback quietly never executes in production. Given only AC-03, it builds one that swallows a
genuine OCR outage and returns cheerful `Other` suggestions forever, and nobody gets paged.

The fix was one sentence in the spec — *no text at all → 502; text but no LLM → 200 + rule-based* —
and it is the sentence that made the difference between two completely different products.
I did not spot it. The agent did, because I told it to look before it typed.

## What I would do differently

1. **Write the "deliberate non-errors" table first.** Half my ambiguities were about which
   failures are errors and which are degraded successes. That belongs in the contract as a
   first-class list, not as an implication of the error table.
2. **Assume every acceptance criterion is weaker than it looks.** #3 above is the lesson of
   the day: a passing test told me the implementation was correct while it was burning tokens
   the NFR forbade. Ask of each criterion, *what could be badly wrong while this still passes?*
3. **Constrain the toolchain in the prompt and then verify it runs.** The parameter-properties
   bug was invisible in the diff and obvious the moment I ran `npm test`. Reading AI output is
   not testing it.
4. **Do not let the agent edit the spec.** "If you think the spec is wrong, say so and stop"
   was the highest-value line in either prompt. It turned an agent that would have silently
   patched around my contradiction into one that reported it.
