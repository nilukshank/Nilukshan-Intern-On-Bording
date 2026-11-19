# Response 2 — corrections applied

## 1. Erasable syntax
Quoted back: *"Node 22 with native TypeScript stripping. No build step… Use erasable-only
TypeScript syntax."* Parameter properties are a **transform**, not a type annotation, so
they survive stripping and crash the runtime.

```diff
 export class CategoriserError extends Error {
-  constructor(
-    readonly status: number,
-    readonly code: string,
-    ...
+  status: number;
+  code: string;
+  detail: string;
+  extra: Record<string, unknown>;
+
+  constructor(status: number, code: string, detail: string, extra: Record<string, unknown> = {}) {
     super(detail);
+    this.status = status;
```
`npm test` went from *0 tests executed* to *15 passing*.

## 2. Short-circuit the non-receipt path
Quoted back: *spec.md §3.5 — "Cost ≤ LKR 5 per suggestion"*.

```diff
+  const isReceipt = ocr.total !== null || ocr.lineItems.length > 0;
+  if (!isReceipt) {
+    const rule = categoriseByRules(ocr);   // AC-04 — do not spend a token here
+    source = "rule-based";
+    message = UNREADABLE_MESSAGE;
+  } else {
     const verdict = await deps.llm.categorise(ocr);
```
Test added: `assert.equal(h.llmCalls, 0, "no token should be spent on a non-receipt")`.

## 3. Allowlist, not denylist
Quoted back: *AC-07 — "asserted as a set equality, so a newly added property fails the test"*.
`buildSuggestedEvent` now names all twelve properties explicitly and contains no spread
and no `delete`. `SUGGESTED_EVENT_PROPERTIES` is exported so the test and the builder
cannot drift apart.

## Agent's own note back to me
> "I disagree with one thing in your spec rather than my code: §3.4 says the event is
> emitted 'within 5 s of the response', but AC-01 asserts it *within 5 seconds* of the
> request. Those are different clocks. Pick one."

I picked response-relative and left AC-01's wording, because the claimant-visible latency
is what AC-08 measures. **This is worth recording: the agent pushed back on the spec and
was right to.**
